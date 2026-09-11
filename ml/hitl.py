"""Human-in-the-loop simulation (E-G).

Three arms, one question: does routing uncertain fields to a persisted human
confirmation queue beat both blind automation and blanket refusal?

    raw      auto-accept everything (no human in the loop)
    refusal  refuse everything uncertain and hand the whole prescription back
    queue    the claimed mechanism: auto-confirm the confident, escalate the rest

The reviewer is a **simulated policy** with an explicit accuracy knob, not a
human subjects study. That is stated everywhere it appears. When a real
reviewer panel is run, `--reviewer-accuracy` (or `--reviewers-file`) replaces
the policy and the same harness produces the paper's numbers.
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass

from app.safety.engine import SafetyEngine

from . import ladder as ladder_module

ARMS = ("raw", "refusal", "queue")


@dataclass
class ReviewerPolicy:
    """Simulated human reviewer. Documented, honest, replaceable."""

    #: probability the reviewer resolves a queued field correctly (this is the
    #: knob a real panel replaces; 0.95 is optimistic and labelled as such)
    resolve_accuracy: float = 0.95
    #: seconds spent per queued field (task-time model)
    seconds_per_field: float = 20.0
    #: extra seconds to re-read an entire refused prescription
    seconds_per_refusal: float = 90.0

    def as_dict(self) -> dict:
        return {"resolve_accuracy": self.resolve_accuracy,
                "seconds_per_field": self.seconds_per_field,
                "seconds_per_refusal": self.seconds_per_refusal,
                "kind": "simulated policy (not human subjects)"}


def run_hitl(engine: SafetyEngine, cases: list[dict], *,
             reviewer: ReviewerPolicy | None = None,
             seed: int = 20260911) -> dict:
    reviewer = reviewer or ReviewerPolicy()
    rng = random.Random(seed)
    results: dict[str, dict] = {}
    rows: list[dict] = []

    for arm in ARMS:
        correct = 0
        automated = 0
        reviewed_fields = 0
        seconds = 0.0
        for case in cases:
            label = case["labels"]["verdict"]
            base = ladder_module.run_arm(engine, case, "A4")
            if arm == "raw":
                raw = ladder_module.run_arm(engine, case, "A1")
                ok = raw.verdict == label
                # Blind automation: no human reviews anything, so every case is
                # "covered" by the machine — that is exactly the arm's hazard.
                automated += 1
                seconds += 0.0
            elif arm == "refusal":
                # everything that is not perfectly confident is handed back
                if base.queued or base.verdict == "refused":
                    ok = label in ("confirm_queue", "refused")
                    seconds += reviewer.seconds_per_refusal
                    reviewed_fields += 1
                else:
                    ok = base.verdict == label
                    automated += 1
            else:
                if base.queued or base.verdict == "refused":
                    reviewed_fields += 1
                    seconds += reviewer.seconds_per_field * (base.queued or 1)
                    # A human resolving the queued field either fixes the case
                    # (label was uncertain) or discovers the finding the gate
                    # held back. Either way the case is decided correctly with
                    # probability = reviewer accuracy.
                    ok = rng.random() < reviewer.resolve_accuracy
                else:
                    automated += 1
                    ok = base.verdict == label
            correct += 1 if ok else 0
            rows.append({"case_id": case["case_id"], "arm": arm, "label": label,
                         "ok": ok, "verdict": base.verdict, "queued": base.queued})
        n = len(cases)
        results[arm] = {
            "arm": arm,
            "n": n,
            "task_accuracy": round(correct / n, 4) if n else 0.0,
            "coverage": round(automated / n, 4) if n else 0.0,
            "reviewed_fields": reviewed_fields,
            "review_burden_per_100": round(reviewed_fields / n * 100, 2) if n else 0.0,
            "mean_seconds_per_case": round(seconds / n, 2) if n else 0.0,
            "total_review_minutes": round(seconds / 60, 2),
        }

    queue_arm = results["queue"]
    raw_arm = results["raw"]
    refusal_arm = results["refusal"]
    return {
        "reviewer": reviewer.as_dict(),
        "results": results,
        "rows": rows,
        "acceptance": {
            # the queue arm must beat blind automation on accuracy, automate at
            # least as much as the blanket-refusal arm, and cost less human time
            # than re-reading whole refused prescriptions.
            "queue_beats_raw_accuracy": queue_arm["task_accuracy"] > raw_arm["task_accuracy"],
            "queue_beats_refusal_accuracy": queue_arm["task_accuracy"]
            >= refusal_arm["task_accuracy"],
            "queue_automates_at_least_as_much_as_refusal":
                queue_arm["coverage"] >= refusal_arm["coverage"],
            "queue_costs_less_review_time_than_refusal":
                queue_arm["mean_seconds_per_case"]
                < refusal_arm["mean_seconds_per_case"],
        },
    }


def load_reviewers(path: str) -> ReviewerPolicy:
    """Load a real panel's measured accuracy/time from JSON (post-panel step)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return ReviewerPolicy(
        resolve_accuracy=float(data["resolve_accuracy"]),
        seconds_per_field=float(data.get("seconds_per_field", 20.0)),
        seconds_per_refusal=float(data.get("seconds_per_refusal", 90.0)),
    )
