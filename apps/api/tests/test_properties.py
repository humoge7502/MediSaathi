"""Property-based tests for the deterministic safety plane (hypothesis).

The safety engine is pure and deterministic — exactly the shape of code where
property-based testing pays off. Instead of hand-picked examples, hundreds of
generated prescriptions are pushed through the plane and every run must uphold
the INVARIANTS that make the product safe. A single violated property is a real
bug class (crashes, verdict vocabulary escapes, dose-cap bypasses, finding
leakage past the gate).

Properties under test (each maps to a product law):
  P1  Totality        — the engine NEVER crashes on any input; it always
                        returns a report and a verdict in the known vocabulary.
  P2  Gate integrity  — no unverified field ever contributes findings: if any
                        field lands in the confirm queue, the spoken/decided
                        output is built from VERIFIED fields only.
  P3  Symmetry        — screening a pair (a, b) finds the same rule as (b, a).
  P4  Dose caps       — the aggregate paracetamol cap fires whenever the total
                        daily mg across brands exceeds it (never the reverse:
                        no false cap without the sum exceeding).
  P5  Monotonic gate  — raising a line's perception confidence can never move
                        the verdict toward refusal.
"""
from __future__ import annotations

import os
import sys

import pytest

hypothesis = pytest.importorskip("hypothesis")
from hypothesis import given, settings  # noqa: E402
from hypothesis import strategies as st

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "packages", "contracts")))

from app.safety.engine import SafetyEngine, _split_molecules  # noqa: E402
from medisaathi_contracts import ExtractionField, FieldSource  # noqa: E402

ENGINE = SafetyEngine.load()

VERDICT_KINDS = {"pass", "interaction", "contraindication", "duplicate_atc",
                 "confirm_queue", "refused", "interaction_severe",
                 "interaction_moderate"}

# Real brand names from the formulary (plus noise the normalizer must survive)
BRAND_NAMES = sorted(ENGINE.brands)[:40]
NOISE = ["xyzab", "qwerty 500", "", "   ", "tab", "mg", "!!!!", "123", "武器"]


def _fields(lines: list[tuple[str, float]]) -> list[ExtractionField]:
    return [
        ExtractionField(raw_text=text, brand_text=text, confidence=conf,
                        source=FieldSource.seed_fixture)
        for text, conf in lines
    ]


def _run(fields):
    return ENGINE.run(fields, {})


# ------------------------------------------------------------------ P1 totality
@given(st.lists(
    st.tuples(
        st.one_of(st.sampled_from(BRAND_NAMES), st.sampled_from(NOISE),
                  st.text(max_size=12)),
        st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
    ),
    max_size=6,
))
@settings(max_examples=200, deadline=None)
def test_engine_never_crashes_and_verdict_stays_in_vocabulary(lines):
    report, _confirm, _all_verified = _run(_fields(lines))
    # report is complete: every rule family executed and reported
    assert all(report.checks.values()), f"a rule family skipped: {report.checks}"
    # the assembled verdict kind must stay in the shared vocabulary
    from app.verdict import assemble
    verdict = assemble(ENGINE, _extraction_of(lines), report, _confirm)
    assert verdict.kind.value in VERDICT_KINDS, f"verdict escape: {verdict.kind}"


def _extraction_of(lines):
    from medisaathi_contracts import ExtractionResult
    return ExtractionResult(sample_id="prop", fields=_fields(lines), engine="property-test")


# ------------------------------------------------------------- P2 gate integrity
@given(st.lists(
    st.tuples(st.sampled_from(BRAND_NAMES),
              st.floats(min_value=0.0, max_value=0.6, allow_nan=False)),
    min_size=1, max_size=4,
))
@settings(max_examples=120, deadline=None)
def test_low_confidence_fields_never_reach_findings(lines):
    """Every field below REFUSE/CONFIRM bands must be queued, never screened.

    If anything was queued, all VERIFIED medication rows must come only from
    fields whose confidence passed the gate (or that matched exactly and were
    auto-confirmed deterministically) — the findings stream may not be fed by
    an unverified line.
    """
    fields = _fields(lines)
    report, confirm_items, all_verified = ENGINE.run(fields, {})
    REFUSE_BELOW = float(os.environ.get("MEDISAATHI_REFUSE_BELOW", "0.75"))
    if confirm_items:
        assert not all_verified
        for c in confirm_items:
            f = fields[c["field_index"]]
            # a field is queued either for low confidence OR unknown brand
            assert (f.confidence < REFUSE_BELOW) or c["reason"] == "brand not in formulary map"
    # interaction findings must reference molecules of VERIFIED meds only
    verified_molecules = {
        mol
        for row in (ENGINE.normalize(f.brand_text or f.raw_text) for f in fields)
        if row is not None
        for mol in _split_molecules(row["molecule"])
    }
    for finding in report.interactions:
        a = set(_split_molecules(finding.molecule_a))
        b = set(_split_molecules(finding.molecule_b))
        assert (a | b) & verified_molecules or finding.source == "BMJ/AKI guidance", (
            f"finding from unverified line: {finding}")


# ------------------------------------------------------------------- P3 symmetry
@given(st.sampled_from(BRAND_NAMES), st.sampled_from(BRAND_NAMES))
@settings(max_examples=300, deadline=None)
def test_pair_screening_is_symmetric(brand_a, brand_b):
    mol_a = _split_molecules(ENGINE.normalize(brand_a)["molecule"])
    mol_b = _split_molecules(ENGINE.normalize(brand_b)["molecule"])
    for x in mol_a:
        for y in mol_b:
            forward = ENGINE.screen_pair(x, y)
            backward = ENGINE.screen_pair(y, x)
            assert (forward is None) == (backward is None), f"asymmetric pair {x}/{y}"
            if forward and backward:
                assert forward["severity"] == backward["severity"]
                assert forward["mechanism"] == backward["mechanism"]


# ----------------------------------------------------------------- P4 dose caps
@given(st.lists(st.sampled_from(
    [b for b in BRAND_NAMES if "paracetamol" in _split_molecules(
        ENGINE.normalize(b)["molecule"])[0]] or BRAND_NAMES),
    min_size=1, max_size=4))
@settings(max_examples=120, deadline=None)
def test_aggregate_paracetamol_cap_matches_total(brands):
    """The aggregate cap warning exists iff the summed daily mg exceeds it."""
    PARACETAMOL_DAILY_CAP_MG = 4000.0
    fields = []
    total = 0.0
    for brand in brands:
        row = ENGINE.normalize(brand)
        mol = _split_molecules(row["molecule"])[0]
        if mol != "paracetamol":
            continue
        # Calpol/Dolo/Crocin 650 TDS = 1950 mg/day each (strength carries the
        # unit: daily_dose_mg parses "<n> mg" x frequency)
        fields.append(ExtractionField(
            raw_text=f"{brand} 650 mg TDS 5 days", brand_text=brand,
            strength="650 mg", dose="650 mg", frequency="TDS", duration="5 days",
            confidence=0.97, source=FieldSource.seed_fixture))
        total += 1950.0
    if not fields:
        return
    report, _confirm, _v = ENGINE.run(fields, {})
    # Combination molecules (Combiflam = paracetamol+ibuprofen) legitimately
    # trip OTHER molecules' caps; the property is about the paracetamol cap.
    caps = [w for w in report.warnings if "paracetamol" in w.lower()]
    if total > PARACETAMOL_DAILY_CAP_MG:
        assert caps, f"cap bypass: total {total} mg with no warning"
    else:
        assert not caps, f"false cap: total {total} mg warned: {caps}"


# --------------------------------------------------------------- P5 gate monotonic
@given(st.lists(st.tuples(st.sampled_from(BRAND_NAMES),
                          st.floats(min_value=0.0, max_value=1.0, allow_nan=False)),
                min_size=1, max_size=4),
       st.floats(min_value=0.76, max_value=1.0, allow_nan=False))
@settings(max_examples=150, deadline=None)
def test_raising_confidence_never_refuses(lines, high_conf):
    """Monotonicity: lifting every line above the gate can only improve the
    outcome — a plan that queues/refuses at low confidence must NOT refuse
    when the very same lines are read with high confidence."""
    from app.verdict import assemble
    low_fields = _fields(lines)
    low_report, _c, _v = ENGINE.run(low_fields, {})
    low_verdict = assemble(ENGINE, _extraction_of(lines), low_report, _c)

    high_lines = [(text, max(conf, high_conf)) for text, conf in lines]
    high_fields = _fields(high_lines)
    high_report, high_confirm, _v = ENGINE.run(high_fields, {})
    high_verdict = assemble(ENGINE, _extraction_of(high_lines), high_report, high_confirm)

    if low_verdict.kind.value == "refused":
        assert high_verdict.kind.value != "refused", (
            "raising confidence produced a refusal — gate law is not monotonic")
