"""Cross-engine parity gate (ADR-0012, audit finding TD-D).

Runs the shared 25-case golden corpus through the Python safety plane and
asserts every case lands on the expected verdict class. The TypeScript mirror
(eval/parity/parity.ts via bun run parity) runs the identical corpus through
the TS plane; CI requires BOTH to be 25/25, so the two engines cannot drift
silently again (the corpus split 94/79/34 vs 84/47/27 is closed).
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
    assert len(cases) == 25
    ids = [c["id"] for c in cases]
    assert len(set(ids)) == 25, "duplicate parity case ids"
    for c in cases:
        assert c["expect"] in {"pass", "interaction", "contraindication", "duplicate_atc", "confirm_queue", "refused"}


def test_parity_python_25_of_25() -> None:
    rows = run_parity_python()
    failed = [r for r in rows if not r["ok"]]
    summary = corpus_summary()
    assert not failed, (
        "Parity corpus disagreement on the Python plane: "
        + "; ".join(f"{r['id']} expect={r['expect']} got={r['py_verdict']}" for r in failed)
        + f" ({summary})"
    )
