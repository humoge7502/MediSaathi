"""Safety-plane additions: dosing warnings, context validation, same-brand
duplicates, verdict-vs-warning separation (warnings never change a verdict)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from medisaathi_contracts import ExtractionField, FieldSource  # noqa: E402

from app.safety.dosing import daily_dose_mg, dose_warning  # noqa: E402
from app.safety.engine import SafetyEngine  # noqa: E402

DATA_DIR = os.environ.get(
    "MEDISAATHI_DATA_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data")))


@pytest.fixture(scope="module")
def engine() -> SafetyEngine:
    return SafetyEngine.load(DATA_DIR)


def _field(brand: str, conf: float = 0.97, **kw) -> ExtractionField:
    return ExtractionField(raw_text=f"Tab {brand}", brand_text=brand,
                           confidence=conf, source=FieldSource.seed_fixture, **kw)


# ------------------------------------------------------------------ dosing
def test_daily_dose_math():
    f = _field("Dolo 650", frequency="1-0-1", strength="650 mg")
    assert daily_dose_mg(f) == 1300.0


def test_paracetamol_over_cap_warns():
    f = _field("Dolo 650", frequency="1-1-1", strength="2000 mg")  # 6000 mg/day
    w = dose_warning(f, molecule="paracetamol")
    assert w and "cap" in w and "6000" in w


def test_under_cap_clean(engine):
    f = _field("Dolo 650", frequency="1-1-1", strength="650 mg")  # 1950 < 4000
    assert dose_warning(f, molecule="paracetamol") is None


def test_combined_paracetamol_across_brands_warns(engine):
    """Two paracetamol brands, each under the cap, sum above it."""
    a = _field("Dolo 650", frequency="1-1-1", strength="650 mg")        # 1950
    b = _field("Crocin Advance", frequency="1-1-1", strength="1000 mg")  # 3000
    report, _, _ = engine.run([a, b], {})
    assert any("combined" in w and "paracetamol" in w for w in report.warnings), report.warnings


def test_paracetamol_long_course_warns():
    f = _field("Dolo 650", frequency="1-0-1", duration="14 days")
    assert dose_warning(f, molecule="paracetamol") and \
        "review" in dose_warning(f, molecule="paracetamol")


def test_clean_regimen_no_warning():
    f = _field("Dolo 650", frequency="1-0-1", strength="650 mg", duration="5 days")
    assert dose_warning(f, molecule="paracetamol") is None


def test_bizarre_frequency_warns():
    f = _field("Dolo 650", frequency="3-3-3")
    assert dose_warning(f) and "unusual frequency" in dose_warning(f)


# ------------------------------------------------------------------ context
def test_context_validation_drops_unknown_keys(engine):
    ctx = engine.validate_context({"pregnancy": True, "purple_polkadots": True})
    assert ctx == {"pregnancy": True}


def test_contraindication_fires_only_with_declared_context(engine):
    from medisaathi_contracts import VerdictKind
    from app.routers.api import engine as api_engine
    from app.verdict import assemble
    from app.vision import extract
    result = extract("RX-009")
    # without context: no contraindication
    report, items, _ = api_engine.run(result.fields, {})
    v = assemble(api_engine, result, report, items)
    assert v.kind != VerdictKind.contraindication
    # with declared context: contraindication verdict
    report, items, _ = api_engine.run(result.fields, {"age_under_12": True})
    v = assemble(api_engine, result, report, items)
    assert v.kind == VerdictKind.contraindication


# ------------------------------------------------------------------ warnings vs verdicts
def test_warnings_attached_but_verdict_untouched(engine):
    """A dose warning must ride along in the report without flipping the
    verdict - warnings inform humans; verdicts come from the gate law."""
    from app.routers.api import engine as api_engine
    from app.verdict import assemble
    from app.vision import extract
    result = extract("RX-001")  # clean pass
    weird = ExtractionField(
        raw_text="Tab Dolo 650 - 1-1-1 x 30 days", brand_text="Dolo 650",
        frequency="1-1-1", duration="30 days", strength="2500 mg",
        confidence=0.97, source=FieldSource.seed_fixture)
    result.fields.append(weird)
    report, items, verified = api_engine.run(result.fields, {})
    assert report.warnings, "over-cap regimen must produce a warning"
    v = assemble(api_engine, result, report, items)
    from medisaathi_contracts import VerdictKind
    # verdict machinery still runs its normal law (dup ATC here due to 2x dolo)
    assert v.kind in {VerdictKind.pass_, VerdictKind.duplicate_atc}


# ------------------------------------------------------------------ store
def test_store_roundtrip_and_metrics():
    from app.store import count, create, get, put, verdict_counts
    rx = create("RX-TEST-STORE")
    rx.meta["marker"] = "roundtrip"
    put(rx)
    back = get(rx.prescription_id)
    assert back is not None and back.meta["marker"] == "roundtrip"
    assert count() >= 1
    assert isinstance(verdict_counts(), dict)
