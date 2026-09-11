"""Regimen-mode evaluation: the longitudinal plane vs the single-prescription law.

Arms (all deterministic, offline, no model):

    single_rx   the shipped law — the incoming prescription screened in
                isolation (active regimen ignored). This is the incumbent.
    regimen     mechanism A only: the incoming prescription screened against
                the union of the active regimen, fields treated as certain.
    regimen+prop  mechanisms A+B: the union screen *and* read-uncertainty
                propagation, so a fragile read forces the confirm queue.

The comparison is the evidence: how many cross-prescription harms the incumbent
law cannot express, and what the coupling costs in review load.
"""
from __future__ import annotations

import json
import os

from app.safety.engine import SafetyEngine
from app.safety.regimen import active_med_from_row, screen_regimen
from app.verdict import assemble
from medisaathi_contracts import ExtractionField, ExtractionResult

from .manifest import ROOT

REGIMEN_PATH = os.path.join(ROOT, "data", "corpus", "regimen.jsonl")

ARM_SINGLE_RX = "single_rx"
ARM_REGIMEN = "regimen"
ARM_REGIMEN_PROP = "regimen+propagation"
ARMS = (ARM_SINGLE_RX, ARM_REGIMEN, ARM_REGIMEN_PROP)

#: labels that mean "a human or a rule must intervene" — a bare pass here is unsafe
HARMFUL = ("interaction", "contraindication", "duplicate_atc")


def load_cases(path: str = REGIMEN_PATH) -> list[dict]:
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"regimen corpus missing: {path} — run `python tools/build_regimen_corpus.py`")
    out: list[dict] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def fields_of(case: dict) -> list[ExtractionField]:
    return [
        ExtractionField(raw_text=ln["raw"], brand_text=ln.get("read_brand", ln["raw"]),
                        confidence=float(ln["confidence"]))
        for ln in case["artifact"]["lines"]
    ]


def active_of(engine: SafetyEngine, case: dict) -> list:
    out = []
    for entry in case.get("active", []):
        row = engine.normalize(entry["brand"])
        if row is not None:
            out.append(active_med_from_row(
                row,
                started_day=int(entry.get("started_day", 0)),
                duration_days=int(entry.get("duration_days", 30)),
            ))
    return out


def run_case(engine: SafetyEngine, case: dict, arm: str) -> dict:
    """Run one regimen case through one arm. Returns {verdict, fragility, queued, crossing}."""
    fields = fields_of(case)
    ctx = {c: True for c in case.get("context", [])}
    if arm == ARM_SINGLE_RX:
        report, items, _ = engine.run(fields, ctx)
        kind = assemble(
            engine,
            ExtractionResult(sample_id=case["case_id"], fields=fields),
            report, items).kind.value
        return {"verdict": "pass" if kind == "pass_" else kind,
                "fragility": 0.0, "queued": kind == "confirm_queue",
                "crossing": False}

    screen = screen_regimen(
        engine, fields, active_of(engine, case), ctx,
        as_of_day=int(case.get("as_of_day", 0)),
        propagate=(arm == ARM_REGIMEN_PROP),
    )
    return {"verdict": screen.verdict, "fragility": screen.fragility,
            "nominal_verdict": screen.nominal_verdict,
            "worst_verdict": screen.worst_verdict, "worst_mass": screen.worst_mass,
            "queued": screen.queued,
            "crossing": any(f.crossing for f in screen.findings)}


def _mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 4) if values else 0.0


def evaluate(engine: SafetyEngine, cases: list[dict], arm: str) -> dict:
    """Metric set for one arm: does it catch cross-prescription harm, at what burden?"""
    rows: list[dict] = []
    label_harm = 0
    unsafe = 0            # verdict "pass" on a harmful case
    caught = 0            # harmful case met with a rule verdict or a queue
    serious_caught = 0
    cross_total = cross_caught = 0
    queued = 0
    agrees = 0
    fragilities: list[float] = []
    for case in cases:
        out = run_case(engine, case, arm)
        label = case["labels"]["verdict"]
        harmful = label in HARMFUL
        is_cross = bool(case["labels"].get("crossing"))
        v = out["verdict"]
        if harmful:
            label_harm += 1
            if v == "pass":
                unsafe += 1
            else:
                caught += 1
                if label in ("interaction", "contraindication"):
                    serious_caught += 1
        if is_cross:
            cross_total += 1
            if v != "pass":
                cross_caught += 1
        if v == "confirm_queue":
            queued += 1
        if v == label or (label == "confirm_queue" and v == "confirm_queue"):
            agrees += 1
        fragilities.append(out["fragility"])
        rows.append({
            "case_id": case["case_id"], "stratum": case["stratum"],
            "predicted": v, "label": label, "agree": v == label,
            "crossing": is_cross, "unsafe": harmful and v == "pass",
            "queued": v == "confirm_queue", "fragility": out["fragility"],
            "worst_verdict": out.get("worst_verdict"),
        })
    n = len(cases)
    return {
        "metrics": {
            "arm": arm,
            "n": n,
            "verdict_agreement": round(agrees / n, 4) if n else 0.0,
            "unsafe_pass": unsafe,
            "unsafe_pass_rate": round(unsafe / label_harm, 4) if label_harm else 0.0,
            "harmful_caught_rate": round(caught / label_harm, 4) if label_harm else 0.0,
            "serious_caught_rate": round(serious_caught / label_harm, 4) if label_harm else 0.0,
            "cross_prescription_catch_rate": round(cross_caught / cross_total, 4)
            if cross_total else None,
            "n_cross_prescription": cross_total,
            "queue_rate": round(queued / n, 4) if n else 0.0,
            "mean_fragility": _mean(fragilities),
        },
        "rows": rows,
    }


def evaluate_all(engine: SafetyEngine, cases: list[dict],
                 arms: tuple[str, ...] = ARMS) -> dict[str, dict]:
    return {arm: evaluate(engine, cases, arm) for arm in arms}


def summary_table(results: dict[str, dict]) -> str:
    header = (f"{'arm':22} {'unsafe_pass':>11} {'caught':>7} {'cross':>7} "
              f"{'queue':>7} {'agree':>7} {'frag':>7}")
    lines = [header, "-" * len(header)]
    for arm, res in results.items():
        m = res["metrics"]
        cross = m["cross_prescription_catch_rate"]
        lines.append(
            f"{arm:22} {m['unsafe_pass_rate']:>11.3f} {m['harmful_caught_rate']:>7.3f} "
            f"{(cross if cross is not None else float('nan')):>7.3f} "
            f"{m['queue_rate']:>7.3f} {m['verdict_agreement']:>7.3f} "
            f"{m['mean_fragility']:>7.3f}")
    return "\n".join(lines)
