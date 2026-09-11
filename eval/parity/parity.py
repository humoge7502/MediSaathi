"""Cross-engine parity corpus (ADR-0012): one golden set, two engines.

The MediSaathi safety law exists twice — TypeScript (the product tier) and
Python (the verification tier). That duplication is deliberate (independent
evidence suites), but it carried a documented drift risk (R-7): the two planes
ran different corpora with nothing forcing them to agree. This corpus is the
contract that closes the risk: 25 golden cases spanning the verdict vocabulary
both engines share. Every case MUST produce the same verdict class from both
engines, enforced in CI by tests/test_parity.py (Python) and
scripts/parity.test.ts (TypeScript).

Corpus design:
  * `lines` are human-authored prescription lines (NOT the RX-* fixtures, so
    the corpus tests the engines, not the fixture parser).
  * `expect` uses the intersection of both verdict vocabularies: pass,
    interaction, contraindication, duplicate_atc, confirm_queue, refused.
  * `expect_finding` is a substring asserted against the finding text in both
    engines' own shapes (mechanism for interaction findings).
  * Cases are checked against the REAL corpora: brands.csv (both tiers now
    carry the same brand set) and both interaction tables.

Case sources (all curated from the same published interactions the planes
already encode; sources recorded per row in data/interactions.csv):
  T01-T05   clean chronic plans (pass) — prove no false positives
  T06-T10   severe pairwise interactions (warfarin+aspirin, digoxin+amiodarone,
            simvastatin+clarithromycin, lithium+ibuprofen, sildenafil+nitrate)
  T11-T13   contraindications against declared contexts
  T14-T15   duplicate-molecule double dosing
  T16-T17   combination (graph) rules: triple whammy, QT stack
  T18-T20   confirm-queue paths (unknown brand, low-confidence line)
  T21-T25   hygiene: duplicate ATC class, moderate interactions, bleeding stack
"""
from __future__ import annotations

import os

PARITY_VERSION = "1"

# Verdict-class vocabulary shared by both engines (TS VerdictKind mapped onto
# the Python VerdictKind; see map_verdict in each runner).
PARITY_VERDICTS = (
    "pass", "interaction", "contraindication", "duplicate_atc",
    "confirm_queue", "refused",
)

PARITY_CASES: list[dict] = [
    # ---- clean plans: the plane must NOT cry wolf -------------------------
    {"id": "P01", "lines": ["Telma 40 mg OD 30 days", "Glycomet 500 mg BD 30 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "pass"},
    {"id": "P02", "lines": ["Glycomet 500 mg TDS 30 days", "Amlong 5 mg OD 30 days", "Storvas 20 mg HS 30 days"], "confidences": [0.97, 0.97, 0.97], "contexts": [], "expect": "pass"},
    {"id": "P03", "lines": ["Pan 40 mg OD 15 days"], "confidences": [0.97], "contexts": [], "expect": "pass"},
    {"id": "P04", "lines": ["Azithral 500 mg OD 3 days", "Omez 20 mg OD 5 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "pass"},
    {"id": "P05", "lines": ["Thyronorm 50 mcg OD 30 days"], "confidences": [0.97], "contexts": [], "expect": "pass"},
    # ---- severe pairwise interactions -------------------------------------
    {"id": "P06", "lines": ["Warf 5 mg OD 30 days", "Ecosprin 75 mg OD 30 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "interaction", "expect_finding": "bleeding"},
    {"id": "P07", "lines": ["Digoxin 0.25 mg OD 30 days", "Cordarone 200 mg OD 30 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "interaction", "expect_finding": "digoxin"},
    {"id": "P08", "lines": ["Simvotin 20 mg HS 30 days", "Claribid 500 mg BD 7 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "interaction", "expect_finding": "statin"},
    {"id": "P09", "lines": ["Lithosun 300 mg BD 30 days", "Brufen 400 mg TDS 5 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "interaction", "expect_finding": "lithium"},
    {"id": "P10", "lines": ["Manforce 50 mg SOS 2 days", "Sorbitrate 5 mg TDS 30 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "interaction", "expect_finding": "hypotension"},
    # ---- contraindications against declared contexts ----------------------
    {"id": "P11", "lines": ["Doxy-1 100 mg BD 5 days"], "confidences": [0.97], "contexts": ["age_under_12"], "expect": "contraindication", "expect_finding": "staining"},
    {"id": "P12", "lines": ["Warf 5 mg OD 30 days"], "confidences": [0.97], "contexts": ["pregnancy"], "expect": "contraindication", "expect_finding": "teratogenic"},
    {"id": "P13", "lines": ["Glycomet 500 mg TDS 30 days"], "confidences": [0.97], "contexts": ["renal_severe"], "expect": "contraindication", "expect_finding": "lactic"},
    # ---- duplicates -------------------------------------------------------
    {"id": "P14", "lines": ["Dolo 650 mg TDS 5 days", "Crocin Advance 650 mg TDS 5 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "duplicate_atc"},
    {"id": "P15", "lines": ["Dolo 650 mg TDS 5 days", "Calpol 650 mg TDS 5 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "duplicate_atc"},
    # ---- combination (graph) rules ----------------------------------------
    {"id": "P16", "lines": ["Losar 50 mg OD 30 days", "Lasix 40 mg OD 30 days", "Brufen 400 mg TDS 5 days"], "confidences": [0.97, 0.97, 0.97], "contexts": [], "expect": "interaction", "expect_finding": "whammy"},
    {"id": "P17", "lines": ["Ciplox 500 mg BD 7 days", "Azithral 500 mg OD 3 days", "Zofran ODT 4 mg TDS 3 days"], "confidences": [0.97, 0.97, 0.97], "contexts": [], "expect": "interaction", "expect_finding": "QT"},
    # ---- confirm queue: unknown brand / low confidence ---------------------
    {"id": "P18", "lines": ["asdkjh 123 asd"], "confidences": [0.97], "contexts": [], "expect": "confirm_queue"},
    {"id": "P19", "lines": ["Warf 5 mg OD 30 days", "Xenomol 500 mg BD 5 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "confirm_queue"},
    {"id": "P20", "lines": ["Warf 5 mg OD 30 days"], "confidences": [0.4], "contexts": [], "expect": "refused"},
    # ---- moderate interactions + ATC-level duplicates + bleeding stack -----
    {"id": "P21", "lines": ["Clopilet 75 mg OD 30 days", "Omez 20 mg OD 30 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "interaction", "expect_finding": "CYP2C19"},
    {"id": "P22", "lines": ["Envas 5 mg BD 30 days", "Aldactone 25 mg OD 30 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "interaction", "expect_finding": "hyperkalemia"},
    {"id": "P23", "lines": ["Warf 5 mg OD 30 days", "Sertraline 50 mg OD 30 days", "Brufen 400 mg TDS 5 days"], "confidences": [0.97, 0.97, 0.97], "contexts": [], "expect": "interaction", "expect_finding": "bleeding"},
    {"id": "P24", "lines": ["Dolo 650 mg TDS 5 days", "Zerodol P 650 mg TDS 5 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "duplicate_atc"},
    {"id": "P25", "lines": ["Warf 5 mg OD 30 days", "Warfone 5 mg OD 30 days"], "confidences": [0.97, 0.97], "contexts": [], "expect": "duplicate_atc"},
]


def load_parity_cases() -> list[dict]:
    """The canonical in-code corpus (kept in-code so both runners read the
    identical bytes without cross-package imports)."""
    return [dict(c) for c in PARITY_CASES]


def map_verdict(py_kind: str) -> str:
    """Python VerdictKind -> parity vocabulary. The TS plane calls a severe
    combination stack an 'interaction' (severity folded into findings); the
    Python verdict law does the same, so the mapping is the vocabulary."""
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
    return "n=25 " + " ".join(f"{k}={v}" for k, v in sorted(counts.items()))


if __name__ == "__main__":
    rows = run_parity_python()
    failed = [r for r in rows if not r["ok"]]
    print(f"Python parity: {len(rows) - len(failed)}/{len(rows)} agree "
          f"({corpus_summary()})")
    for r in failed:
        print(f"  FAIL {r['id']}: expect={r['expect']} got={r['py_verdict']}")
    raise SystemExit(1 if failed else 0)
