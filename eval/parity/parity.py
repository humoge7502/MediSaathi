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
  * Interval mandates for brands neither formulary carries yet (alendronate,
    risedronate, ibandronate, semaglutide). The rule itself is mirrored and
    unit-tested in both planes — see `test_interval_law.py` and
    `apps/web/tests/interval.test.ts` — only the brand rows are missing, which is
    the 99-vs-2,836 formulary asymmetry tracked as TD-formulary-symmetry.
  * A garbage frequency token ("QODS"): on a raw line it is never extracted, so
    the line carries no frequency and passes. A *legible-shaped but unlegible*
    code does reach the queue rule from raw text, and is a case (P133/P134:
    "Q5H", "every 999 days").
  * Any case whose expected label was produced by a mutation that moved the
    perception confidence: the label is confidence-derived, so moving confidence
    invalidates it (see ml/adversarial.py, confidence_boundary_sensitivity).

Aggregate dose-cap cases used to be on this list. They are not any more:
`dosing.enrich_field` derives strength/frequency/duration from the raw line text,
so the arithmetic the TS plane ran on text is now available to the Python plane
too — P128 ("6 hourly" methotrexate) is an aggregate-cap case end to end.
"""
from __future__ import annotations

import json
import os

#: The corpus version this runner was written against, as the corpus stores it:
#: an integer. TS mirrors this constant (`PARITY_VERSION` in parity.ts).
PARITY_VERSION = 12

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
        doc = json.load(f)
    # The runner pins the corpus it was written against. Without this, editing
    # golden.json without bumping PARITY_VERSION leaves a stale version label in
    # every evidence binder that quotes it.
    file_version = doc.get("parity_version")
    if file_version != PARITY_VERSION:
        raise SystemExit(
            f"parity corpus version mismatch: golden.json says {file_version!r}, "
            f"this runner says {PARITY_VERSION!r}. Bump PARITY_VERSION only after "
            f"re-checking that both planes agree on the new corpus.")
    return doc


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
            # A dose hazard and the reason a line queued are both part of what the
            # verdict is claiming, so `expect_finding` has to be able to assert on
            # them. Without them a corpus case can demand confirm_queue and pass
            # while explaining a completely different rule than the one it names.
            + [h.note for h in report.dose_hazards]
            + [c["why"] for c in _confirm_items if isinstance(c, dict) and c.get("why")]
            + [c["reason"] for c in _confirm_items
               if isinstance(c, dict) and c.get("reason")]
            # An advisory breach lives in `warnings` here and in `findings` there.
            # Same sentence, different container — and the v7 cases (a self-care
            # limit the patient did not cross, a ceiling their own declaration
            # lowered) are exactly the claims that text carries, so leaving it out
            # would make those cases assert on a verdict alone.
            + list(report.warnings)
        ).lower()
        expected = case["expect"]
        ok = map_verdict(verdict.kind.value) == expected
        if case.get("expect_finding"):
            ok = ok and case["expect_finding"].lower() in finding_text
        if case.get("expect_not_finding"):
            # Some bugs are invented *evidence*, not wrong verdicts: applying one
            # stated strength to every molecule of a combination brand produced
            # "380 mg/day atorvastatin" on a routine statin+aspirin regimen. The
            # verdict was already wrong enough to catch, but only a negative
            # assertion pins that the engine stopped making the number up.
            ok = ok and case["expect_not_finding"].lower() not in finding_text
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
