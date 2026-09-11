"""The baseline ladder A0-A4 and component ablations (E-A / E-B).

Each arm is a *precisely defined* alternative pipeline, so the comparison means
something (no straw men):

    A0  model-proposes-verdict   the perception layer's read is the answer;
                                 nothing is screened, nothing is gated.
    A1  raw read                 fields accepted at face value, no confidence
                                 gate, no refusal, no confirm queue; the rule
                                 plane runs only on what happens to normalize.
    A2  gate without rules       correct three-band gate; no interaction,
                                 combination, contraindication or duplicate
                                 screening. Safe about *reading*, blind about
                                 *drugs*.
    A3  rules without a gate     perfect perception (ground-truth fields), full
                                 rule plane, no gate/queue. Catches interactions
                                 but auto-confirms uncertain reads.
    A4  full pipeline            schema-constrained read -> fusion -> three-band
                                 gate -> deterministic plane -> precedence ->
                                 queue blocking. (proposed system)

Ablations of A4 isolate each component's necessity (E-B); removing the gate or
the queue blocking must measurably destroy the safety property, which is the
synergy evidence an inventive-step argument needs.
"""
from __future__ import annotations

import time

from app.gate import get_threshold_set
from app.safety import engine as engine_module
from app.safety.engine import SafetyEngine
from app.verdict import assemble
from medisaathi_contracts import ExtractionField, ExtractionResult

from . import calibration as cal

ARMS = ("A0", "A1", "A2", "A3", "A4")

ABLATIONS = (
    "A4_minus_gate",
    "A4_minus_combination",
    "A4_minus_formulary_fusion",
    "A4_minus_queue_blocking",
    "A4_minus_refusal_band",
)

ARMS_AND_ABLATIONS = ARMS + ABLATIONS

VERDICT_VOCAB = ("pass", "interaction", "contraindication", "duplicate_atc",
                 "confirm_queue", "refused")

SERIOUS = ("interaction", "contraindication", "duplicate_atc")


def _fields(case: dict, *, ground_truth: bool = False) -> list[ExtractionField]:
    out = []
    for art, lbl in zip(case["artifact"]["lines"], case["labels"]["fields"], strict=False):
        brand = lbl["true_brand"] if ground_truth else (lbl["read_brand"] or art["raw"])
        out.append(ExtractionField(raw_text=art["raw"], brand_text=brand or art["raw"],
                                   confidence=float(art["confidence"])))
    return out


def _extraction(case: dict, fields: list[ExtractionField]) -> ExtractionResult:
    return ExtractionResult(sample_id=case["case_id"], fields=fields, engine="corpus")


class _Outcome:
    def __init__(self, verdict: str, confidence: float, findings: list[str],
                 queued: int, auto_confirmed: bool, engine_ms: float):
        self.verdict = verdict
        self.confidence = confidence
        self.findings = findings
        self.queued = queued
        self.auto_confirmed = auto_confirmed
        self.engine_ms = engine_ms

    def as_dict(self) -> dict:
        return {"verdict": self.verdict, "confidence": self.confidence,
                "findings": self.findings, "queued": self.queued,
                "auto_confirmed": self.auto_confirmed, "engine_ms": self.engine_ms}


def _py_verdict(kind: str) -> str:
    return "pass" if kind == "pass_" else kind


def _finding_matches(report, matches: list[dict]) -> list[str]:
    """Which labeled findings the arm actually surfaced (substring match)."""
    text = " ".join(
        [f.mechanism for f in report.interactions]
        + [f.note for f in report.contraindications]
        + [f.note for f in report.duplicates]
    ).lower()
    return [m["match"] for m in matches if m.get("match") and m["match"] in text]


def run_arm(engine: SafetyEngine, case: dict, arm: str,
            threshold_set_id: str | None = None) -> _Outcome:
    """Run one case through one arm/ablation. Deterministic and offline."""
    lines = case["artifact"]["lines"]
    labels = case["labels"]
    t0 = time.perf_counter()

    def ms() -> float:
        return round((time.perf_counter() - t0) * 1000, 3)

    if arm == "A0":
        # The model's read IS the verdict: it named something, so it looks fine.
        verdict = "pass" if lines else "refused"
        return _Outcome(verdict, 0.9 if lines else 0.0, [], 0, bool(lines), ms())

    if arm == "A1":
        # Face-value read: no gate, no refusal, no queue, and NO formulary
        # normalization — the model's brand text is taken as the drug identity.
        # Whatever does not match the formulary exactly becomes invisible: an
        # invented or corrupted brand silently disappears instead of queuing,
        # which is precisely the harm the gate exists to stop.
        fields = _fields(case)
        exact = [f for f in fields
                 if f.brand_text and f.brand_text.strip().lower() in engine.brands]
        report, _items, _ = engine.run(exact or fields, {c: True for c in case["context"]},
                                       skip_gate=True, threshold_set_id=threshold_set_id)
        verdict = _py_verdict(assemble(
            engine, _extraction(case, fields), report, [],
            enable_refusal=False, enable_queue=False, queue_unmatched=False).kind.value)
        if not exact:
            verdict = "pass"  # nothing normalized, nothing to worry about (the harm)
        return _Outcome(verdict, _mean([f.confidence for f in fields]),
                        _finding_matches(report, labels["findings"]), 0, True, ms())

    if arm == "A2":
        # Correct gate, no rules: dispositions are right, drug knowledge absent.
        fields = _fields(case)
        report, items, _ = engine.run(fields, {c: True for c in case["context"]},
                                      threshold_set_id=threshold_set_id)
        gate = report.gate
        if items:
            verdict = "confirm_queue"
        elif fields and all(f.confidence < (gate.refuse_below if gate else 0.75)
                            for f in fields):
            verdict = "refused"
        else:
            verdict = "pass"
        return _Outcome(verdict, gate.prescription_fused if gate else 0.0,
                        [], len(items), verdict == "pass", ms())

    if arm == "A3":
        # Perfect perception, full rules, no gate/queue: everything auto-confirms.
        fields = _fields(case, ground_truth=True)
        report, _items, _ = engine.run(fields, {c: True for c in case["context"]},
                                       skip_gate=True, threshold_set_id=threshold_set_id)
        verdict = _py_verdict(assemble(
            engine, _extraction(case, fields), report, [],
            enable_refusal=False, enable_queue=False, queue_unmatched=False).kind.value)
        return _Outcome(verdict, 1.0, _finding_matches(report, labels["findings"]),
                        0, True, ms())

    # ---- A4 and its ablations -------------------------------------------
    fields = _fields(case, ground_truth=arm == "A3")
    ctx = {c: True for c in case["context"]}
    combination_backup = engine_module._combination_rules
    try:
        if arm in ("A4", "A4_minus_gate", "A4_minus_formulary_fusion",
                   "A4_minus_queue_blocking", "A4_minus_refusal_band"):
            pass
        if arm == "A4_minus_combination":
            engine_module._combination_rules = lambda molecules: []
        if arm == "A4_minus_gate":
            # Gate removed: every read auto-confirms, unmatched brands vanish.
            report, items, _ = engine.run(fields, ctx, threshold_set_id=threshold_set_id)
            verdict = _py_verdict(assemble(
                engine, _extraction(case, fields), report, items,
                enable_refusal=False, enable_queue=False,
                queue_unmatched=False).kind.value)
            return _Outcome(verdict, 1.0, _finding_matches(report, labels["findings"]),
                            0, True, ms())
        if arm == "A4_minus_formulary_fusion":
            # D4 ablation: an unmatched brand no longer queues when the model is
            # confident — fusion loses its formulary term.
            report, items, _ = engine.run(fields, ctx, threshold_set_id=threshold_set_id)
            items = [i for i in items if "formulary" not in i.get("reason", "")]
            verdict = _py_verdict(assemble(
                engine, _extraction(case, fields), report, items,
                queue_unmatched=False).kind.value)
            return _Outcome(verdict, _mean([f.confidence for f in fields]),
                            _finding_matches(report, labels["findings"]),
                            len(items), verdict == "pass", ms())
        if arm == "A4_minus_queue_blocking":
            # Queue blocking removed: the queue is still computed and shown, but
            # uncertainty no longer halts the verdict — it is advisory only.
            report, items, _ = engine.run(fields, ctx, threshold_set_id=threshold_set_id)
            verdict = _py_verdict(assemble(
                engine, _extraction(case, fields), report, items,
                enable_queue=False, queue_unmatched=False).kind.value)
            return _Outcome(verdict, _mean([f.confidence for f in fields]),
                            _finding_matches(report, labels["findings"]),
                            len(items), verdict == "pass", ms())
        if arm == "A4_minus_refusal_band":
            # Refusal removed: uncertainty queues instead of refusing, so a
            # fully-unreadable read is handed to a human as an actionable slot.
            report, items, _ = engine.run(fields, ctx, threshold_set_id=threshold_set_id)
            base = _py_verdict(assemble(
                engine, _extraction(case, fields), report, items,
                enable_refusal=False).kind.value)
            return _Outcome(base, report.gate.prescription_fused if report.gate else 0.0,
                            _finding_matches(report, labels["findings"]),
                            len(items), base == "pass", ms())
        if arm in ("A4", "A4_minus_combination"):
            report, items, _ = engine.run(fields, ctx, threshold_set_id=threshold_set_id)
            verdict = _py_verdict(assemble(engine, _extraction(case, fields), report, items).kind.value)
            return _Outcome(verdict, report.gate.prescription_fused if report.gate else 0.0,
                            _finding_matches(report, labels["findings"]),
                            len(items), verdict == "pass", ms())
        raise ValueError(f"unknown arm {arm!r}")
    finally:
        engine_module._combination_rules = combination_backup


def _mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 4) if values else 0.0


def _macro_f1(pairs: list[tuple[str, str]]) -> float:
    """Macro-averaged F1 over the verdict vocabulary (absent classes count 0)."""
    scores = []
    for v in VERDICT_VOCAB:
        tp = sum(1 for p, g in pairs if p == v and g == v)
        fp = sum(1 for p, g in pairs if p == v and g != v)
        fn = sum(1 for p, g in pairs if p != v and g == v)
        if tp + fp + fn == 0:
            continue  # class absent from labels and predictions: skip
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        scores.append(0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall))
    return round(sum(scores) / len(scores), 4) if scores else 0.0


def evaluate(engine: SafetyEngine, cases: list[dict], arm: str,
             threshold_set_id: str | None = None) -> dict:
    """Full metric set for one arm on one case list."""
    rows: list[dict] = []
    pairs: list[tuple[str, str]] = []
    confidences: list[float] = []
    correctness: list[bool] = []
    selective_conf: list[float] = []
    selective_correct: list[bool] = []
    unsafe = 0
    missed_serious = 0
    queued = 0
    refused = 0
    refusal_tp = refusal_fp = refusal_fn = 0
    finding_hits = finding_total = 0
    latencies: list[float] = []

    for case in cases:
        outcome = run_arm(engine, case, arm, threshold_set_id)
        label = case["labels"]["verdict"]
        pairs.append((outcome.verdict, label))
        confidences.append(outcome.confidence)
        correct = outcome.verdict == label
        correctness.append(correct)
        latencies.append(outcome.engine_ms)
        if outcome.verdict == "pass" and label != "pass":
            unsafe += 1
        if outcome.verdict == "pass" and label in SERIOUS:
            missed_serious += 1
        if outcome.verdict == "confirm_queue":
            queued += 1
        if outcome.verdict == "refused":
            refused += 1
        if outcome.verdict not in ("confirm_queue", "refused"):
            # Selective-classification view: calibration is measured only over
            # the cases the arm chose to AUTOMATE (abstentions are coverage).
            selective_conf.append(outcome.confidence)
            selective_correct.append(correct)
        if label == "refused" and outcome.verdict == "refused":
            refusal_tp += 1
        elif outcome.verdict == "refused":
            refusal_fp += 1
        elif label == "refused":
            refusal_fn += 1
        expected = [m for m in case["labels"]["findings"] if m.get("match")]
        if expected:
            finding_total += len(expected)
            finding_hits += len(outcome.findings)
        rows.append({
            "case_id": case["case_id"], "stratum": case["stratum"],
            "predicted": outcome.verdict, "label": label,
            "agree": correct, "queued": outcome.queued,
            "auto_confirmed": outcome.auto_confirmed,
            "unsafe": outcome.verdict == "pass" and label != "pass",
        })

    n = len(cases)
    latencies = sorted(latencies)
    metrics = {
        "arm": arm,
        "threshold_set_id": threshold_set_id or get_threshold_set().set_id,
        "n": n,
        "verdict_agreement": round(sum(1 for p, g in pairs if p == g) / n, 4) if n else 0.0,
        "verdict_macro_f1": _macro_f1(pairs),
        "unsafe_auto_confirms": unsafe,
        "unsafe_auto_confirm_rate": round(unsafe / n, 4) if n else 0.0,
        "unsafe_ci": list(cal.wilson_interval(unsafe, n)),
        "missed_serious": missed_serious,
        "missed_serious_rate": round(missed_serious / n, 4) if n else 0.0,
        "queue_rate": round(queued / n, 4) if n else 0.0,
        "refusal_rate": round(refused / n, 4) if n else 0.0,
        "refusal_precision": round(refusal_tp / (refusal_tp + refusal_fp), 4)
        if (refusal_tp + refusal_fp) else 0.0,
        "refusal_recall": round(refusal_tp / (refusal_tp + refusal_fn), 4)
        if (refusal_tp + refusal_fn) else 0.0,
        "finding_recall": round(finding_hits / finding_total, 4) if finding_total else None,
        "calibration": cal.calibration_report(confidences, correctness),
        # Headline calibration claim: the reported confidence should predict the
        # ABSENCE of an unsafe auto-confirmation (not verdict agreement, which
        # conflates a correct queued disposition with a miscalibrated score).
        "calibration_safety": cal.calibration_report(
            confidences, [not (p == "pass" and g != "pass") for p, g in pairs]),
        # Selective-classification view (the honest way to read a gate law):
        # coverage = share automated, risk = error among automated,
        # calibration = ECE over automated cases only.
        "selective_coverage": round(len(selective_conf) / n, 4) if n else 0.0,
        "selective_risk": round(sum(1 for ok in selective_correct if not ok)
                                / len(selective_correct), 4) if selective_correct else 0.0,
        "calibration_selective": cal.calibration_report(selective_conf, selective_correct),
        "latency_ms_p50": latencies[n // 2] if n else 0.0,
        "latency_ms_p95": latencies[min(n - 1, int(n * 0.95))] if n else 0.0,
    }
    return {"metrics": metrics, "rows": rows}


def ladder(engine: SafetyEngine, cases: list[dict],
           arms: tuple[str, ...] = ARMS,
           threshold_set_id: str | None = None) -> dict:
    """Run several arms over the same cases; returns metrics + per-arm rows."""
    out: dict[str, dict] = {}
    for arm in arms:
        result = evaluate(engine, cases, arm, threshold_set_id)
        out[arm] = result
    return out


def safety_burden_table(results: dict[str, dict]) -> str:
    """Pretty table for the console: safety vs burden per arm."""
    header = (f"{'arm':26} {'unsafe':>7} {'queue':>7} {'missed':>7} "
              f"{'agree':>7} {'f1':>6}")
    lines = [header, "-" * len(header)]
    for arm, res in results.items():
        m = res["metrics"]
        lines.append(
            f"{arm:26} {m['unsafe_auto_confirm_rate']:>7.3f} {m['queue_rate']:>7.3f} "
            f"{m['missed_serious_rate']:>7.3f} {m['verdict_agreement']:>7.3f} "
            f"{m['verdict_macro_f1']:>6.3f}")
    return "\n".join(lines)
