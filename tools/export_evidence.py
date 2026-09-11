"""Export the archived experiment results into the web app's evidence panel.

The web tier is a separate runtime from the research harness, so the numbers the
in-product Evidence tab shows are compiled here into a single generated artifact:

    python tools/export_evidence.py          # writes apps/web/src/data/evidence.json

The artifact carries its own provenance (dataset snapshot, engine git SHA, the
run directory behind every number), so the UI can label exactly what it is
showing instead of asserting a number from nowhere. Run this AFTER
`python tools/run_experiments.py --all`; it refuses to invent numbers when a run
is missing and records the gap honestly as `null` + a `missing` list.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "packages", "contracts"))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, ROOT)

RESULTS_DIR = os.path.join(ROOT, "eval", "results")
OUT_PATH = os.path.join(ROOT, "apps", "web", "src", "data", "evidence.json")

EXPERIMENTS = ("E-A", "E-B", "E-C", "E-D", "E-E", "E-F", "E-G")


def _load(name: str, missing: list[str]) -> dict | None:
    path = os.path.join(RESULTS_DIR, f"{name}.json")
    if not os.path.exists(path):
        missing.append(f"{name}.json (run tools/run_experiments.py)")
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _git_sha() -> str:
    try:
        from ml.manifest import git_sha
        return git_sha()
    except Exception:
        return "unknown"


def _snapshot() -> str:
    try:
        from ml.manifest import snapshot_id
        return snapshot_id()
    except Exception:
        return "unrecorded"


def build() -> dict:
    missing: list[str] = []
    runs = {name: _load(name, missing) for name in EXPERIMENTS}

    def metrics(name: str) -> dict:
        data = runs.get(name)
        return (data or {}).get("metrics", {})

    def run_dir(name: str) -> str | None:
        data = runs.get(name)
        return (data or {}).get("run")

    e_a = metrics("E-A")
    e_b = metrics("E-B")
    e_c = metrics("E-C")
    e_d = metrics("E-D")
    e_e = metrics("E-E")
    e_f = metrics("E-F")
    e_g = metrics("E-G")

    # Headline: the frozen operating point's calibration curve + operating point.
    frozen_on_test = e_d.get("frozen_on_test") or {}
    sweep = e_d.get("sweep", [])

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset_snapshot": _snapshot(),
        "engine_git_sha": _git_sha(),
        "missing_runs": missing,
        "runs": {name: run_dir(name) for name in EXPERIMENTS},
        "baseline_ladder": {
            "split": e_a.get("split"),
            "n": e_a.get("n"),
            "arms": {
                arm: {
                    "verdict_agreement": m.get("verdict_agreement"),
                    "verdict_macro_f1": m.get("verdict_macro_f1"),
                    "unsafe_auto_confirm_rate": m.get("unsafe_auto_confirm_rate"),
                    "queue_rate": m.get("queue_rate"),
                    "refusal_rate": m.get("refusal_rate"),
                    "ece_safety": (m.get("calibration_safety") or {}).get("ece"),
                }
                for arm, m in (e_a.get("arms") or {}).items()
            },
        },
        "ablations": {
            "n": e_b.get("n"),
            "deltas": e_b.get("deltas", {}),
        },
        "robustness": {
            "held_in_n": e_c.get("held_in_n"),
            "corruption": e_c.get("corruption", {}),
            "all_invariants_hold": e_c.get("all_invariants_hold"),
            "invented_brand_auto_confirm_rate": (e_c.get("invented_brands") or {}).get("auto_confirmed_rate"),
            "replay_refusal_rate": (e_c.get("replay") or {}).get("replay_refusal_rate"),
            "boundary_sensitivity": e_c.get("boundary_sensitivity", {}),
        },
        "calibration": {
            "default_id": e_d.get("default_id"),
            "frozen_operating_point_id": e_d.get("frozen_operating_point_id"),
            "promoted_fitted_point": e_d.get("promoted_fitted_point"),
            "finding": e_d.get("finding"),
            "calibration_split_n": e_d.get("calibration_split_n"),
            "test_split_n": e_d.get("test_split_n"),
            "grid_points": len(sweep),
            "within_review_target_15pct": e_d.get("within_review_target_15pct", []),
            "frozen_on_test": {
                "verdict_agreement": frozen_on_test.get("verdict_agreement"),
                "unsafe_auto_confirm_rate": frozen_on_test.get("unsafe_auto_confirm_rate"),
                "queue_rate": frozen_on_test.get("queue_rate"),
                "refusal_rate": frozen_on_test.get("refusal_rate"),
                "ece_safety": (frozen_on_test.get("calibration_safety") or {}).get("ece"),
                "brier_safety": (frozen_on_test.get("calibration_safety") or {}).get("brier"),
                "reliability": (frozen_on_test.get("calibration_safety") or {}).get("reliability", []),
            },
        },
        "parity": {
            "n": e_e.get("n"),
            "corpus": e_e.get("corpus"),
            "python_ok": (e_e.get("python_side") or {}).get("ok"),
            "typescript_ok": (e_e.get("typescript_side") or {}).get("ok"),
            "both_engines_agree": e_e.get("both_engines_agree"),
        },
        "latency": {
            "plane_n": (e_f.get("plane_full_corpus") or {}).get("n"),
            "plane_p50_ms": (e_f.get("plane_full_corpus") or {}).get("p50_ms"),
            "plane_p95_ms": (e_f.get("plane_full_corpus") or {}).get("p95_ms"),
            "within_budget": e_f.get("within_budget"),
            "bench": [
                {"endpoint": r.get("endpoint"), "p50_ms": r.get("p50_ms"), "p95_ms": r.get("p95_ms")}
                for r in (e_f.get("bench") or {}).get("results", [])
            ],
        },
        "hitl": {
            "reviewer": e_g.get("reviewer", {}),
            "arms": e_g.get("arms", {}),
            "acceptance": e_g.get("acceptance", {}),
        },
        "honesty": (
            "Software benchmark evidence from a synthetic-curated corpus, not "
            "clinical validation. Perception accuracy on real images is a "
            "separate, open experiment (live model required). The HITL arm uses "
            "a simulated reviewer policy, not a human subjects panel."
        ),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=OUT_PATH)
    ap.add_argument("--json", action="store_true", dest="as_json")
    args = ap.parse_args()
    doc = build()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, sort_keys=True)
        f.write("\n")
    if args.as_json:
        print(json.dumps(doc, indent=2, sort_keys=True))
    else:
        print(f"wrote {os.path.relpath(args.out, ROOT)}")
        if doc["missing_runs"]:
            print("  MISSING RUNS (numbers left null): "
                  + "; ".join(doc["missing_runs"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
