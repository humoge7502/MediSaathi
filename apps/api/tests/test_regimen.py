"""Longitudinal regimen plane + read-uncertainty propagation (mechanisms A+B).

Each test names the failure mode it guards:

* a harm that exists only because two prescriptions were composed must be
  caught by the regimen plane and must remain invisible to the incumbent
  single-prescription law (that invisibility is the defect being fixed);
* read uncertainty that could *hide* a harm must force the confirm queue, and
  switching propagation off must remove the queue — the coupling's necessity;
* the field gate semantics (refusal, queue) must be preserved unchanged.
"""
from __future__ import annotations

import pytest
from app.safety.engine import SafetyEngine
from app.safety.regimen import (
    DEFAULT_FRAGILITY_THRESHOLD,
    active_med_from_row,
    identity_distribution,
    screen_regimen,
)
from app.verdict import assemble
from medisaathi_contracts import ExtractionField, ExtractionResult


@pytest.fixture(scope="module")
def engine() -> SafetyEngine:
    return SafetyEngine.load()


def _fields(*pairs: tuple[str, float]) -> list[ExtractionField]:
    return [ExtractionField(raw_text=b, brand_text=b, confidence=c) for b, c in pairs]


def _active(engine: SafetyEngine, *brands: str) -> list:
    out = []
    for b in brands:
        row = engine.normalize(b)
        assert row is not None, f"fixture brand not in formulary: {b}"
        out.append(active_med_from_row(row))
    return out


def _single_rx(engine: SafetyEngine, fields: list[ExtractionField]) -> str:
    report, items, _ = engine.run(fields, {})
    kind = assemble(engine, ExtractionResult(sample_id="t", fields=fields),
                    report, items).kind.value
    return "pass" if kind == "pass_" else kind


# -------------------------------------------------------------- mechanism A

def test_triple_whammy_across_two_visits_is_caught(engine):
    """ARB + diuretic already active; a new NSAID completes the triple whammy.
    No single prescription contains all three, so the incumbent law passes it."""
    active = _active(engine, "Losar 50", "Lasix 40")
    fields = _fields(("Brufen 400", 0.97))
    assert _single_rx(engine, fields) == "pass"  # the defect
    screen = screen_regimen(engine, fields, active)
    assert screen.verdict == "interaction"
    assert any(f.crossing and f.kind == "combination" for f in screen.findings)


def test_third_qt_prolonger_across_visits_is_caught(engine):
    active = _active(engine, "Azithral 500", "Ciplox 500")
    fields = _fields(("Citalopram 20", 0.97))
    assert _single_rx(engine, fields) == "pass"
    assert screen_regimen(engine, fields, active).verdict == "interaction"


def test_duplicate_molecule_via_new_brand_across_visits(engine):
    active = _active(engine, "Deplatt 75")
    fields = _fields(("Clopilet 75", 0.97))
    assert _single_rx(engine, fields) == "pass"
    assert screen_regimen(engine, fields, active).verdict == "duplicate_atc"


def test_clean_continuation_passes(engine):
    active = _active(engine, "Pan 40")
    screen = screen_regimen(engine, _fields(("Cetzine 10", 0.97)), active)
    assert screen.verdict == "pass"
    assert not screen.queued


def test_incoming_only_harm_is_unchanged_by_regimen_mode(engine):
    """A harm inside the new prescription must still be caught (no regression)."""
    fields = _fields(("Warf 5", 0.97), ("Ecosprin 75", 0.97))
    assert _single_rx(engine, fields) == "interaction"
    assert screen_regimen(engine, fields, []).verdict == "interaction"


# -------------------------------------------------------------- mechanism B

def test_confusable_read_forces_queue_and_ablation_removes_it(engine):
    """Reading 'Ecosprin 75' while gemfibrozil is active: the resolved read is a
    bare aspirin (pass), but the look-alike 'Ecospirin AV 75' carries
    atorvastatin, which interacts. The incumbent auto-confirms; propagation
    must queue, and switching propagation off must return the auto-confirm."""
    active = _active(engine, "Lopid 600")
    fields = _fields(("Ecosprin 75", 0.93))
    assert _single_rx(engine, fields) == "pass"
    on = screen_regimen(engine, fields, active, propagate=True)
    assert on.nominal_verdict == "pass"
    assert on.worst_verdict == "interaction"
    assert on.fragility > DEFAULT_FRAGILITY_THRESHOLD
    assert on.queued and on.verdict == "confirm_queue"
    off = screen_regimen(engine, fields, active, propagate=False)
    assert off.fragility == 0.0 and not off.queued
    assert off.verdict == "pass"


def test_identity_distribution_normalises_and_is_grounded(engine):
    dist = identity_distribution(engine, "Amlong 5", 0.93)
    assert abs(sum(c.mass for c in dist) - 1.0) < 1e-6
    resolved = [c for c in dist if c.kind == "resolved"]
    assert resolved and resolved[0].brand == "Amlong 5"
    assert resolved[0].mass == pytest.approx(0.93, abs=1e-6)
    assert any(c.brand == "Amitone 10" for c in dist), \
        "the amlodipine/amitriptyline look-alike must be in the neighbourhood"


def test_unresolvable_read_stays_queued_by_the_field_gate(engine):
    """A confidently-read unknown brand keeps its existing queue semantics even
    in regimen mode — mechanism B never auto-confirms an invented read."""
    screen = screen_regimen(engine, _fields(("Xenomol 500", 0.99)), [])
    assert screen.verdict == "confirm_queue"


def test_low_confidence_field_still_refuses_in_regimen_mode(engine):
    screen = screen_regimen(engine, _fields(("Brufen 400", 0.4)), _active(engine, "Losar 50"))
    assert screen.verdict == "refused" and screen.gate_band == "refused"


# -------------------------------------------------------------- determinism

def test_screen_is_deterministic(engine):
    active = _active(engine, "Sertraline 50", "Tramazac 50")
    fields = _fields(("Amlong 5", 0.93))
    a = screen_regimen(engine, fields, active).as_dict()
    b = screen_regimen(engine, fields, active).as_dict()
    assert a == b


def test_verdict_mass_sums_to_one(engine):
    screen = screen_regimen(engine, _fields(("Amlong 5", 0.93)),
                            _active(engine, "Sertraline 50", "Tramazac 50"))
    assert abs(sum(screen.verdict_mass.values()) - 1.0) < 1e-6


def test_finding_mass_never_exceeds_one(engine):
    screen = screen_regimen(engine, _fields(("Amlong 5", 0.93)),
                            _active(engine, "Sertraline 50", "Tramazac 50"))
    assert all(0.0 <= f.mass <= 1.0 + 1e-9 for f in screen.findings)
