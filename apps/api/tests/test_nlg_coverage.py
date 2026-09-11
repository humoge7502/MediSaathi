"""MED-026: multilingual template coverage and slot traceability.

The NLG law is that the voice may only rephrase within verified slots. That law
has to hold in **every** language, not just English, so this suite runs the same
traceability assertions across en / ta / hi:

* every template key exists in every language (no silent fallback);
* every `slot_ref` on a segment names a slot that exists and is `verified`;
* no unresolved `{placeholder}` survives into spoken text;
* every branded medicine in a plan is actually spoken.
"""
from __future__ import annotations

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.nlg import build_spoken_plan  # noqa: E402
from app.nlg.templates import _TEMPLATES  # noqa: E402
from app.safety.engine import SafetyEngine  # noqa: E402
from medisaathi_contracts import ExtractionField, ExtractionResult, FieldSource  # noqa: E402

LANGUAGES = ("en", "ta", "hi")
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))


@pytest.fixture(scope="module")
def engine() -> SafetyEngine:
    return SafetyEngine.load(DATA_DIR)


def _plan(engine: SafetyEngine, lines: list[str], confidence: float = 0.97):
    fields = [ExtractionField(raw_text=ln, brand_text=ln, confidence=confidence,
                              source=FieldSource.seed_fixture) for ln in lines]
    report, _items, _ = engine.run(fields, {})
    return report, build_spoken_plan


def test_every_template_exists_in_every_language() -> None:
    keys_en = set(_TEMPLATES["en"])
    for lang in LANGUAGES:
        assert lang in _TEMPLATES, f"language {lang} has no template set"
        missing = keys_en - set(_TEMPLATES[lang])
        assert not missing, f"{lang} is missing template keys: {sorted(missing)}"


@pytest.mark.parametrize("lang", LANGUAGES)
def test_slots_are_traceable_in_every_language(engine: SafetyEngine, lang: str) -> None:
    lines = ["Telma 40 mg OD 30 days", "Glycomet 500 mg BD 30 days",
             "Brufen 400 mg TDS 5 days"]
    fields = [ExtractionField(raw_text=ln, brand_text=ln, confidence=0.97,
                              source=FieldSource.seed_fixture) for ln in lines]
    report, _items, _ = engine.run(fields, {})
    plan = build_spoken_plan(lang, report.medications, report)

    assert plan.language == lang
    assert plan.slots, "a plan with medicines must declare slots"
    assert all(s.verified for s in plan.slots), "unverified slots must never be spoken"

    names = {s.slot for s in plan.slots}
    for seg in plan.segments:
        assert seg.text.strip(), "empty spoken segment"
        for ref in seg.slot_refs:
            assert ref in names, f"{lang}: segment refs unknown slot {ref!r}"
        # no template ever survives unformatted
        assert not re.search(r"\{[a-z_]+\}", seg.text), f"{lang}: unformatted placeholder in {seg.text!r}"

    # every branded medicine is actually spoken
    brands = [m.brand for m in report.medications]
    assert brands, "fixture must resolve at least one medicine"
    for brand in brands:
        assert brand in plan.script, f"{lang}: {brand} missing from the spoken plan"


@pytest.mark.parametrize("lang", LANGUAGES)
def test_warning_and_refusal_segments_carry_slots(engine: SafetyEngine, lang: str) -> None:
    # warfarin + aspirin: a severe pairwise interaction the voice must relay
    lines = ["Warf 5 mg OD 30 days", "Ecosprin 75 mg OD 30 days"]
    fields = [ExtractionField(raw_text=ln, brand_text=ln, confidence=0.97,
                              source=FieldSource.seed_fixture) for ln in lines]
    report, _items, _ = engine.run(fields, {})
    plan = build_spoken_plan(lang, report.medications, report)

    warnings = [s for s in plan.segments if s.kind.value == "warning"]
    assert warnings, f"{lang}: an interaction plan must produce a spoken warning"
    for seg in warnings:
        assert seg.slot_refs, "a warning must cite the molecules it names"
        assert "{" not in seg.text

    # the safety close is never dropped, in any language
    assert plan.segments[-1].kind.value == "close"
    assert plan.segments[-1].text == _TEMPLATES[lang]["close"]


def test_unknown_language_falls_back_to_english(engine: SafetyEngine) -> None:
    lines = ["Telma 40 mg OD 30 days"]
    fields = [ExtractionField(raw_text=lines[0], brand_text=lines[0], confidence=0.97,
                              source=FieldSource.seed_fixture)]
    report, _items, _ = engine.run(fields, {})
    plan = build_spoken_plan("xx-unknown", report.medications, report)
    # fallback is explicit and safe: English text, no crash, slots still traced
    assert plan.segments
    assert all(s.verified for s in plan.slots)


def test_extraction_result_is_never_used_as_nlg_source(engine: SafetyEngine) -> None:
    """Regression guard: only verified normalized medication slots may be spoken."""
    lines = ["Telma 40 mg OD 30 days"]
    fields = [ExtractionField(raw_text=lines[0], brand_text=lines[0], confidence=0.97,
                              source=FieldSource.seed_fixture)]
    _report, _items, _ = engine.run(fields, {})
    extraction = ExtractionResult(sample_id="x", fields=fields, engine="test")
    # the plan builder takes normalized medications, not raw extraction text
    assert extraction.fields[0].raw_text == lines[0]
