"""Perception-plane tests: the parser must actually parse.

Regression root: the original parser used doubled backslashes inside raw
strings, silently turning every pattern into a no-op. These tests pin the
parsing contract so that class of bug can never ship silently again.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from app.safety.dosing import daily_dose_mg, enrich_field  # noqa: E402
from app.vision import (  # noqa: E402
    RefusalCandidate,
    _parse_line,
    extract,
    extract_live,
    parse_frequency_per_day,
)
from medisaathi_contracts import FieldSource  # noqa: E402


def test_parser_reads_tac_frequency():
    f = _parse_line("1. Tab Dolo 650 - 1-0-1 x 5 days - after food", 0.97, FieldSource.seed_fixture)
    assert f.frequency == "1-0-1"
    assert f.duration == "5 days"


def test_parser_reads_dose():
    f = _parse_line("1. Cap Doxy-1 100 mg - 1-0-1 x 5 days", 0.93, FieldSource.seed_fixture)
    assert f.dose.startswith("100")


def test_parser_reads_shorthand_frequency():
    f = _parse_line("2. Tab Amlong 5 BD x 30 days", 0.95, FieldSource.seed_fixture)
    assert f.frequency.upper() == "BD"
    assert f.duration == "30 days"


def test_perception_never_invents_a_strength_unit():
    """A brand's trailing number is read as a number, not as milligrams.

    Stamping " mg" onto every trailing digit made "Thyronorm 50" a 50 mg
    levothyroxine course against a 0.3 mg/day cap — a thousandfold over-read of
    a 50 mcg tablet — and "Calcirol 60K" a 60 mg sachet, dropping both the kilo
    multiplier and the unit the preparation is sold in. An explicit unit on the
    line is still read verbatim.
    """
    bare = _parse_line("1. Tab Dolo 650 - 1-0-1 x 5 days", 0.97, FieldSource.seed_fixture)
    assert bare.strength == "", "a bare brand number must not arrive pre-unitised"
    stated = _parse_line("1. Tab Thyronorm 50 mcg - 1-0-0 x 30 days",
                         0.97, FieldSource.seed_fixture)
    assert stated.strength == "50 mcg"


@pytest.mark.parametrize("line,brand,molecule,expected", [
    ("1. Tab Thyronorm 50 - 1-0-0 x 30 days", "Thyronorm 50", "levothyroxine", "50 mcg"),
    ("1. Tab Calcirol 60K - 0-0-1 weekly x 8 weeks", "Calcirol 60K", "cholecalciferol", "60000 iu"),
    ("1. Cap Folitrax 10 HS", "Folitrax 10", "methotrexate", "10 mg"),
    ("1. Tab Dolo 650 - 1-0-1 x 5 days", "Dolo 650", "paracetamol", "650 mg"),
])
def test_the_unit_comes_from_the_formulary_row(line, brand, molecule, expected):
    """The deciding plane resolves the unit, because it knows the molecule.

    This is the half of the law that has to survive: the 50 mcg tablet screens
    as 0.05 mg/day, and the 60 000 IU sachet declines mg arithmetic rather than
    asserting a 60 000 mg/day dose.
    """
    src = _parse_line(line, 0.97, FieldSource.seed_fixture)
    got = enrich_field(src, brand=brand, molecule=molecule)
    assert got.strength == expected, (brand, got.strength)
    if molecule == "cholecalciferol":
        assert daily_dose_mg(got) is None       # IU is not mg-convertible
    else:
        assert daily_dose_mg(got) is not None


@pytest.mark.parametrize("freq,expected", [
    ("1-0-1", 2), ("1-1-1", 3), ("0-0-1", 1), ("BD", 2), ("TDS", 3),
    ("OD", 1), ("HS", 1), ("1-1-0", 2),
])
def test_frequency_per_day_table(freq, expected):
    assert parse_frequency_per_day(freq) == expected


def test_frequency_per_day_garbage_is_none():
    assert parse_frequency_per_day("as directed") is None


def test_extract_all_fixtures_produce_fields_or_refusal():
    """Every non-refusal fixture must yield at least one field with a brand."""
    for sid in [f"RX-{i:03d}" for i in range(1, 13)]:
        try:
            result = extract(sid)
        except RefusalCandidate:
            continue
        assert result.fields, f"{sid} produced zero fields"
        assert all(f.brand_text for f in result.fields), f"{sid} has a brandless field"


def test_extract_refuses_blank():
    with pytest.raises(RefusalCandidate):
        extract("RX-006")


def test_extract_refuses_non_rx():
    with pytest.raises(RefusalCandidate):
        extract("RX-012")


def test_live_path_requires_key():
    with pytest.raises(RuntimeError):
        extract_live(b"not-a-real-image")


def test_live_path_retry_then_failure(monkeypatch):
    """The HTTP layer retries once on failure, then surfaces a RuntimeError."""
    import app.vision as v
    import httpx
    monkeypatch.setattr(v, "LIVE_KEY", "test-key")

    calls = {"n": 0}

    def boom(self, *args, **kw):
        calls["n"] += 1
        request = httpx.Request("POST", "https://example.invalid/chat/completions")
        raise httpx.ConnectError("upstream down", request=request)

    monkeypatch.setattr(httpx.Client, "post", boom)
    with pytest.raises(RuntimeError):
        extract_live(b"img")
    assert calls["n"] == 2  # exactly one retry, then give up


def test_live_path_happy_path(monkeypatch):
    import app.vision as v
    monkeypatch.setattr(v, "LIVE_KEY", "test-key")
    answer = v.LiveExtraction.model_validate({
        "prescription_detected": True,
        "refusal_reason": None,
        "lines": [{
            "raw_text": "Tab Dolo 650 - 1-0-1 x 3 days", "brand_text": "Dolo 650",
            "strength": "650 mg", "dose": "", "frequency": "1-0-1",
            "duration": "3 days", "confidence": 0.93,
        }],
    })
    monkeypatch.setattr(v, "_live_call", lambda *a, **k: answer)
    result = extract_live(b"img")
    assert result.fields[0].brand_text == "Dolo 650"
    assert result.fields[0].source == FieldSource.vision
    assert result.engine.startswith("live:")


def test_live_refusal_when_model_reports_no_rx(monkeypatch):
    import app.vision as v
    monkeypatch.setattr(v, "LIVE_KEY", "test-key")
    answer = v.LiveExtraction.model_validate({
        "prescription_detected": False,
        "refusal_reason": "no_prescription_content",
        "lines": [],
    })
    monkeypatch.setattr(v, "_live_call", lambda *a, **k: answer)
    with pytest.raises(RefusalCandidate):
        extract_live(b"img")
