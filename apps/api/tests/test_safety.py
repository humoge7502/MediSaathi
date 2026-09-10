"""Safety plane unit tests.

LAW UNDER TEST: every seeded rule fires on its positive case and never fires
on shuffled non-pairs; the refusal gate refuses below 0.75 and queues between
0.75-0.90; unverified fields never reach the spoken plan.
"""
from __future__ import annotations

import csv
import os
import random

import pytest
from medisaathi_contracts import ExtractionField, FieldSource, Severity, VerdictKind

from app.safety.engine import CONFIRM_BELOW, REFUSE_BELOW, SafetyEngine

DATA_DIR = os.environ.get(
    "MEDISAATHI_DATA_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data")))


@pytest.fixture(scope="module")
def engine() -> SafetyEngine:
    return SafetyEngine.load(DATA_DIR)


def _field(brand: str, conf: float = 0.97) -> ExtractionField:
    return ExtractionField(raw_text=f"Tab {brand}", brand_text=brand,
                           confidence=conf, source=FieldSource.seed_fixture)


# ---------------------------------------------------------------- brands map

def test_every_seeded_brand_normalizes(engine):
    with open(os.path.join(DATA_DIR, "brands.csv"), encoding="utf-8") as f:
        brands = [r["brand"] for r in csv.DictReader(f)]
    assert len(brands) >= 50
    for b in brands:
        row = engine.normalize(b)
        assert row is not None, f"brand failed to normalize: {b}"
        assert row["molecule"]


def test_normalize_is_case_and_prefix_tolerant(engine):
    assert engine.normalize("  dolo   650 ")["brand"] == "Dolo 650"
    assert engine.normalize("tab dolo 650 - 1-0-1")["molecule"] == "paracetamol"
    assert engine.normalize("Zoloft") is None  # not in the Indian seed map


# ---------------------------------------------------------------- interactions

def test_every_interaction_pair_fires(engine):
    assert len(engine.interactions) >= 40
    for row in engine.interactions:
        hit = engine.screen_pair(row["molecule_a"], row["molecule_b"])
        assert hit is not None, f"pair failed to fire: {row}"
        assert hit["severity"] in {"mild", "moderate", "severe"}


def test_no_false_fires_on_shuffled_non_pairs(engine):
    rng = random.Random(7)
    pairs = [(r["molecule_a"], r["molecule_b"]) for r in engine.interactions]
    mols = sorted({m for p in pairs for m in p})
    checked = 0
    for _ in range(2000):
        a, b = rng.choice(mols), rng.choice(mols)
        if a == b or {a, b} in [set(p) for p in pairs]:
            continue
        assert engine.screen_pair(a, b) is None, f"false positive: {a}+{b}"
        checked += 1
    assert checked > 100


def test_known_severe_pair(engine):
    hit = engine.screen_pair("warfarin", "aspirin")
    assert hit and hit["severity"] == "severe"


# ---------------------------------------------------------------- run gate

def test_gate_confirms_below_090(engine):
    report, items, verified = engine.run([_field("Dolo 650", conf=0.85)])
    assert not verified
    assert any(i["reason"] == "low field confidence" for i in items)
    assert report.medications  # matched but gated


def test_gate_queues_unknown_brand(engine):
    report, items, verified = engine.run([_field("Zoloft")])
    assert not verified
    assert any(i["reason"] == "brand not in formulary map" for i in items)
    assert not report.medications


def test_full_pass_case(engine):
    report, items, verified = engine.run(
        [_field("Dolo 650"), _field("Pan 40")])
    assert verified and items == []
    assert len(report.medications) == 2
    assert report.interactions == []
    assert report.checks["interaction_graph"] is True


def test_duplicate_atc_detected(engine):
    report, _, _ = engine.run([_field("Dolo 650"), _field("Crocin Advance")])
    assert report.duplicates, "duplicate paracetamol pair must be caught"
    assert "N02BE01" in report.duplicates[0].atc


def test_aware_tagging_present_for_antibiotics(engine):
    report, _, _ = engine.run([_field("Azithral 500")])
    assert report.medications[0].aware_class in {"Access", "Watch", "Reserve"}


# ---------------------------------------------------------------- verdicts

def _assemble(engine, sample_id, ctx=None):
    from app.routers.api import engine as _e  # same singleton
    from app.verdict import assemble
    from app.vision import extract
    result = extract(sample_id)
    report, items, _ = engine.run(result.fields, ctx or {})
    return assemble(engine, result, report, items)


def test_verdict_refuses_blank_scan(engine):
    with pytest.raises(Exception) as ei:
        _assemble(engine, "RX-006")
    assert "no prescription content" in str(ei.value).lower() or "refus" in str(ei.value).lower()


def test_verdict_confirm_queue_on_handwriting(engine):
    from app.verdict import assemble
    from app.vision import extract
    result = extract("RX-003")
    report, items, _ = engine.run(result.fields)
    v = assemble(engine, result, report, items)
    assert v.kind == VerdictKind.confirm_queue


def test_verdict_severe_interaction(engine):
    v = _assemble(engine, "RX-002")
    assert v.kind == VerdictKind.interaction
    assert v.max_interaction_severity == Severity.severe


def test_verdict_contraindication(engine):
    v = _assemble(engine, "RX-009", ctx={"age_under_12": True})
    assert v.kind == VerdictKind.contraindication


def test_verdict_clean_pass(engine):
    v = _assemble(engine, "RX-007")
    assert v.kind == VerdictKind.pass_
    assert v.provenance  # provenance always attached


# ---------------------------------------------------------------- NLG law

def test_spoken_plan_uses_verified_slots_only(engine):
    from app.nlg import build_spoken_plan
    from app.vision import extract
    result = extract("RX-001")
    report, items, _ = engine.run(result.fields)
    plan = build_spoken_plan("en", report.medications, report)
    assert all(slot.verified for slot in plan.slots)
    for slot in plan.slots:
        if slot.slot.endswith(".brand"):
            assert engine.normalize(slot.value) is not None, \
                "spoken brand not traceable to the formulary - NLG authored content"


def test_spoken_plan_languages():
    from app.nlg.templates import _TEMPLATES
    assert set(_TEMPLATES) >= {"en", "ta", "hi"}
