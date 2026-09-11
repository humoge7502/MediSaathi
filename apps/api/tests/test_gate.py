"""Gate-law + fusion tests (MED-003).

The gate is the patent core, so its boundaries are pinned here rather than left
to the integration suites: exact threshold values, the asymmetric bands
(refusal consumes perception confidence only), the fusion invariant that an
unresolvable brand can never auto-confirm, and the provenance contract that
every run records its threshold-set id and fused score.
"""
from __future__ import annotations

import pytest
from app.gate import (
    AUTO,
    CONFIRM,
    DEFAULT_THRESHOLD_SET_ID,
    REFUSED,
    THRESHOLD_SETS,
    FusionWeights,
    ThresholdSet,
    all_below_refusal,
    band_of,
    fuse_field,
    fuse_prescription,
    get_threshold_set,
)
from app.safety.engine import SafetyEngine
from medisaathi_contracts import ExtractionField

# ------------------------------------------------------------------ weights

def test_fusion_weights_must_sum_to_one():
    with pytest.raises(ValueError):
        FusionWeights(formulary=0.5, reading=0.4)


def test_fusion_weights_reject_negative():
    with pytest.raises(ValueError):
        FusionWeights(formulary=-0.1, reading=1.1)


def test_threshold_set_rejects_inverted_bands():
    with pytest.raises(ValueError):
        ThresholdSet(set_id="bad", refuse_below=0.95, confirm_below=0.5)


def test_threshold_set_rejects_unknown_banding():
    with pytest.raises(ValueError):
        ThresholdSet(set_id="bad", refuse_below=0.5, confirm_below=0.9, banding="vibes")


def test_unknown_threshold_set_fails_loudly():
    with pytest.raises(KeyError):
        get_threshold_set("does-not-exist")


def test_default_set_is_frozen_and_documented():
    ts = get_threshold_set()
    assert ts.set_id == DEFAULT_THRESHOLD_SET_ID
    assert (ts.refuse_below, ts.confirm_below) == (0.75, 0.90)
    assert ts.fusion.as_dict() == {"formulary": 0.4, "reading": 0.6}
    assert set(THRESHOLD_SETS) >= {"v1-2026-09", "fused-2026-09"}


# ------------------------------------------------------------------ fusion

def test_fuse_field_clamps_and_bounds():
    assert fuse_field(1.0, True) == 1.0
    assert fuse_field(0.0, False) == 0.0
    # an unresolvable read can never exceed the reading weight
    assert fuse_field(1.0, False) == 0.6
    assert fuse_field(2.0, True) == 1.0  # clamped, never > 1


def test_fuse_prescription_boundaries():
    assert fuse_prescription(0, 0, []) == 0.0
    assert fuse_prescription(2, 0, [1.0, 1.0]) == 1.0
    assert fuse_prescription(0, 2, [1.0, 1.0]) == 0.6
    assert fuse_prescription(2, 0, [0.5, 0.5]) == 0.7


# ------------------------------------------------------------------ band law

@pytest.mark.parametrize("conf,expected", [
    (0.7499, REFUSED),
    (0.75, CONFIRM),      # refusal band is strictly below refuse_below
    (0.8999, CONFIRM),
    (0.90, AUTO),         # auto band is inclusive at confirm_below
    (1.0, AUTO),
])
def test_band_boundaries_for_resolvable_reads(conf, expected):
    assert band_of(conf, resolvable=True).band == expected


def test_unresolvable_never_auto_confirms_even_at_full_confidence():
    d = band_of(1.0, resolvable=False)
    assert d.band == CONFIRM
    assert d.fused == pytest.approx(0.6)


def test_refusal_band_ignores_formulary_resolvability():
    """Design law 1: the refusal band consumes perception confidence only."""
    resolvable = band_of(0.4, resolvable=True)
    unresolvable = band_of(0.4, resolvable=False)
    assert resolvable.band == unresolvable.band == REFUSED
    assert "refusal threshold" in resolvable.reason


def test_fusion_can_only_demote_never_promote():
    """Alternative 'fused' banding must not promote a below-confirm read."""
    ts = get_threshold_set("fused-2026-09")
    # fused = 0.4*1 + 0.6*0.8 = 0.88 < 0.90, so a resolvable 0.8 read demotes
    assert band_of(0.8, True, ts).band == CONFIRM
    # same read under the frozen default banding: 0.8 < 0.90 -> also confirm
    assert band_of(0.8, True).band == CONFIRM


def test_all_below_refusal_requires_a_non_empty_all_refused_set():
    assert all_below_refusal([band_of(0.4, True), band_of(0.5, False)])
    assert not all_below_refusal([band_of(0.4, True), band_of(0.97, True)])
    assert not all_below_refusal([])


# ------------------------------------------------------------------ engine plumbing

def _field(brand: str, conf: float = 0.97) -> ExtractionField:
    return ExtractionField(raw_text=brand, brand_text=brand, confidence=conf)


@pytest.fixture(scope="module")
def engine() -> SafetyEngine:
    return SafetyEngine.load()


def test_engine_records_gate_provenance_and_threshold_set(engine):
    report, items, _ = engine.run([_field("Dolo 650"), _field("Pan 40")])
    assert report.gate is not None
    assert report.gate.threshold_set_id == DEFAULT_THRESHOLD_SET_ID
    assert report.gate.prescription_band == AUTO
    # 0.4 * formulary ratio (1.0) + 0.6 * mean reading confidence (0.97)
    assert report.gate.prescription_fused == pytest.approx(0.98, abs=0.01)
    assert len(report.gate.decisions) == 2
    assert items == []


def test_engine_queues_unresolvable_with_why_and_fused(engine):
    report, items, _ = engine.run([_field("Zzznotadrug 500")])
    assert report.gate is not None
    assert report.gate.prescription_band == CONFIRM
    assert len(items) == 1
    assert items[0]["band"] == CONFIRM
    assert items[0]["fused"] == pytest.approx(0.6 * 0.97, abs=1e-6)
    assert "not in formulary" in items[0]["why"]


def test_engine_records_refusal_band_for_all_low_confidence(engine):
    report, _items, verified = engine.run([_field("Warf 5", 0.4)])
    assert report.gate is not None
    assert report.gate.prescription_band == REFUSED
    assert report.gate.decisions[0].band == REFUSED
    assert verified is False
