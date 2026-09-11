"""Cross-engine parity corpus (ADR-0012 / MED-015): one golden set, two engines.

The MediSaathi safety law exists twice — TypeScript (the product tier) and
Python (the verification tier). That duplication is deliberate (independent
evidence suites), but it carried a documented drift risk (R-7): the two planes
ran different corpora with nothing forcing them to agree. This module is the
contract that closes the risk.

The golden corpus lives in ONE file, `eval/parity/golden.json`, read by both
`parity.py` (this file) and `parity.ts`. The 25-case in-code corpus was
in-code-duplicated per language; at 100+ cases that duplication itself becomes
a drift source, so the plan's own recommendation (Section 2.3 / MED-015) is
followed: a shared, versioned conformance corpus. Both runners reading the
identical bytes makes cross-runner corpus drift impossible, and hashing the
file in the evidence binder makes cross-release drift visible.

Corpus design:
  * `lines` are human-authored prescription lines (NOT the RX-* fixtures, so
    the corpus tests the engines, not the fixture parser).
  * `expect` uses the shared verdict vocabulary: pass, interaction,
    contraindication, duplicate_atc, confirm_queue, refused.
  * `expect_finding` is a substring asserted against the finding text in each
    engine's own shape (mechanism for interaction findings).
  * Cases are checked against the REAL corpora: data/brands.csv (both tiers
    carry the same brand set) and both interaction tables.

Known, documented non-cases (deliberately excluded, recorded here so the
exclusion is auditable rather than silent):
  * Aggregate dose-cap cases. The TS plane derives daily dose from the raw line
    text; the Python plane derives it from structured strength/frequency fields
    that the parity harness does not construct. Both are exercised by their own
    tier suites (`dose-plausibility` in TS, `test_safety.py` in Python), but the
    raw-text parity interface cannot compare them. Whenever the harness carries
    structured fields, these move into the golden set.
  * Any case whose expected label was produced by a mutation that moved the
    perception confidence: the label is confidence-derived, so moving confidence
    invalidates it (see ml/adversarial.py, confidence_boundary_sensitivity).
"""
from __future__ import annotations

import json
import os

PARITY_VERSION = "2"

GOLDEN_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden.json")

# Verdict-class vocabulary shared by both engines. The TS plane's internal
# `duplicate` kind maps onto `duplicate_atc` (the Python VerdictKind) so a single
# string vocabulary fits both.
PARITY_VERDICTS = (
    "pass", "interaction", "contraindication", "duplicate_atc",
    "confirm_queue", "refused",
)


def load_golden() -> dict:
    with open(GOLDEN_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_parity_cases() -> list[dict]:
    """The shared golden corpus, one dict per case."""
    return [dict(c) for c in load_golden()["cases"]]


# Back-compat alias: older callers imported PARITY_CASES as a module constant.
# It is materialised from the golden file at import time.
PARITY_CASES: list[dict] = load_parity_cases()


def map_verdict(py_kind: str) -> str:
    """Python VerdictKind -> parity vocabulary.

    The TS plane calls a severe combination stack an 'interaction' (severity
    folded into findings); the Python verdict law does the same, so the mapping
    is the vocabulary.
    """
    return {
        "pass": "pass",
        "interaction": "interaction",
        "contraindication": "contraindication",
        "duplicate_atc": "duplicate_atc",
        "confirm_queue": "confirm_queue",
        "refused": "refused",
    }.get(py_kind, py_kind)


def run_parity_python() -> list[dict]:
    """Run every parity case through the Python safety plane + verdict law.
    Returns rows: {id, py_verdict, finding_text, ok}."""
    from app.safety.engine import SafetyEngine
    from app.verdict import assemble
    from medisaathi_contracts import ExtractionField, FieldSource

    data_dir = os.environ.get(
        "MEDISAATHI_DATA_DIR",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data")))
    engine = SafetyEngine.load(data_dir)

    rows: list[dict] = []
    for case in load_parity_cases():
        fields = [
            ExtractionField(
                raw_text=line, brand_text=line, confidence=conf,
                source=FieldSource.seed_fixture)
            for line, conf in zip(case["lines"], case["confidences"], strict=True)
        ]
        report, _confirm_items, _all_verified = engine.run(fields, {c: True for c in case["contexts"]})
        verdict = assemble(engine, _extraction_for(fields), report, _confirm_items)
        finding_text = " ".join(
            [f.mechanism for f in report.interactions]
            + [f.note for f in report.contraindications]
            + [f.note for f in report.duplicates]
        ).lower()
        expected = case["expect"]
        ok = map_verdict(verdict.kind.value) == expected
        if case.get("expect_finding"):
            ok = ok and case["expect_finding"].lower() in finding_text
        rows.append({
            "id": case["id"], "py_verdict": verdict.kind.value,
            "expect": expected, "finding_text": finding_text, "ok": ok,
        })
    return rows


def _extraction_for(fields):
    from medisaathi_contracts import ExtractionResult
    return ExtractionResult(sample_id="parity", fields=fields, engine="parity-corpus")


def corpus_summary() -> str:
    counts: dict[str, int] = {}
    for c in load_parity_cases():
        counts[c["expect"]] = counts.get(c["expect"], 0) + 1
    return f"n={len(load_parity_cases())} " + " ".join(
        f"{k}={v}" for k, v in sorted(counts.items()))


if __name__ == "__main__":
    rows = run_parity_python()
    failed = [r for r in rows if not r["ok"]]
    print(f"Python parity: {len(rows) - len(failed)}/{len(rows)} agree "
          f"({corpus_summary()})")
    for r in failed:
        print(f"  FAIL {r['id']}: expect={r['expect']} got={r['py_verdict']}")
    raise SystemExit(1 if failed else 0)
