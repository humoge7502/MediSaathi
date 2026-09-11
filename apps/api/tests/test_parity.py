"""Cross-engine parity gate (ADR-0012, audit finding TD-D / MED-015).

Runs the shared 100+-case golden corpus (eval/parity/golden.json) through the
Python safety plane and asserts every case lands on the expected verdict class.
The TypeScript mirror (eval/parity/parity.ts via bun run parity) reads the
IDENTICAL file and runs the TS plane; CI requires BOTH to be 100%, so the two
engines cannot drift silently again (the corpus split 94/79/34 vs 84/47/27 is
closed, and the 25 -> 110 expansion closed three further drifts: a wrong
molecule mapping for Hydroquin 200, three missing formulary rows and three
missing contraindication rows on the TS side).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "packages", "contracts")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "eval", "parity")))

from parity import corpus_summary, load_parity_cases, run_parity_python  # noqa: E402


def test_corpus_exists_and_is_labeled() -> None:
    cases = load_parity_cases()
    # MED-015: the golden corpus must stay above the 100-case floor the plan
    # set; a shrinking corpus is a silent weakening of the drift gate.
    assert len(cases) >= 100, f"parity corpus shrank to {len(cases)} cases"
    ids = [c["id"] for c in cases]
    assert len(set(ids)) == len(ids), "duplicate parity case ids"
    for c in cases:
        assert c["expect"] in {"pass", "interaction", "contraindication", "duplicate_atc", "confirm_queue", "refused"}
        assert len(c["lines"]) == len(c["confidences"]), f"{c['id']}: lines/confidences mismatch"


def test_parity_python_all_agree() -> None:
    rows = run_parity_python()
    failed = [r for r in rows if not r["ok"]]
    summary = corpus_summary()
    assert not failed, (
        "Parity corpus disagreement on the Python plane: "
        + "; ".join(f"{r['id']} expect={r['expect']} got={r['py_verdict']}" for r in failed)
        + f" ({summary})"
    )
