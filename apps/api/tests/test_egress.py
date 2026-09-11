"""Egress proofs (MED-016).

Two claims this file makes executable rather than aspirational:

1. **The deterministic plane is network-free.** Its source imports nothing that
   can open a socket, and the live-vision path refuses *before* constructing an
   HTTP client when the privacy kill switch is set.
2. **Verdicts are invariant under model outage.** The same sealed fixtures
   produce byte-identical verdict kinds whether the live tier is available or
   hard-disabled — degraded mode is a configuration, not a promise.
"""
from __future__ import annotations

import os

import pytest
from app import vision
from app.routers.api import engine
from app.safety import engine as engine_module
from app.verdict import assemble
from medisaathi_contracts import ExtractionField, ExtractionResult

PLANE_SOURCES = [
    os.path.join(os.path.dirname(engine_module.__file__), "engine.py"),
    os.path.join(os.path.dirname(engine_module.__file__), "dosing.py"),
    os.path.join(os.path.dirname(os.path.dirname(engine_module.__file__)), "gate.py"),
    os.path.join(os.path.dirname(os.path.dirname(engine_module.__file__)), "verdict.py"),
]

NETWORK_TOKENS = ("import httpx", "import requests", "import urllib", "socket.")


@pytest.mark.parametrize("path", PLANE_SOURCES)
def test_safety_plane_source_has_no_network_imports(path):
    with open(path, encoding="utf-8") as f:
        source = f.read()
    for token in NETWORK_TOKENS:
        assert token not in source, f"{os.path.basename(path)} imports {token!r}"


def test_kill_switch_refuses_before_any_http_client(monkeypatch):
    """Zero egress, by construction: no httpx.Client is ever built."""
    calls: list[str] = []

    class ExplodingClient:
        def __init__(self, *a, **kw):
            calls.append("constructed")
            raise AssertionError("outbound HTTP must not happen in degraded mode")

    monkeypatch.setattr(vision.httpx, "Client", ExplodingClient)
    monkeypatch.setenv("MEDISAATHI_DISABLE_MODEL_EGRESS", "1")
    with pytest.raises(RuntimeError, match="egress disabled"):
        vision.extract_live(b"\x89PNG\r\n\x1a\n not-a-real-image")
    assert calls == []


def test_fixture_path_never_touches_http(monkeypatch):
    class ExplodingClient:
        def __init__(self, *a, **kw):
            raise AssertionError("the sealed offline path must not do network I/O")

    monkeypatch.setattr(vision.httpx, "Client", ExplodingClient)
    result = vision.extract("RX-001")
    assert result.fields


def _verdict_kinds() -> dict[str, str]:
    """Verdict kind for every sealed fixture, straight through the plane."""
    kinds: dict[str, str] = {}
    for i in range(1, 13):
        sid = f"RX-{i:03d}"
        try:
            result = vision.extract(sid)
        except vision.RefusalCandidate:
            kinds[sid] = "refused"
            continue
        report, items, _ = engine.run(result.fields, {})
        kinds[sid] = assemble(engine, result, report, items).kind.value
    return kinds


def test_verdicts_are_invariant_under_model_outage(monkeypatch):
    full = _verdict_kinds()
    monkeypatch.setenv("MEDISAATHI_DISABLE_MODEL_EGRESS", "1")
    degraded = _verdict_kinds()
    assert full == degraded
    # and the suite actually exercises the verdict vocabulary (not a vacuous pass)
    assert len(set(full.values())) >= 4


def test_low_confidence_field_never_bypasses_the_queue_under_egress_mode():
    """A live read that lands below the gate queues exactly like a fixture read."""
    fields = [
        ExtractionField(raw_text="Warf 5", brand_text="Warf 5", confidence=0.55),
        ExtractionField(raw_text="Ecosprin 75", brand_text="Ecosprin 75", confidence=0.97),
    ]
    report, items, _ = engine.run(fields, {})
    assert report.gate is not None
    assert report.gate.prescription_band == "confirm"
    verdict = assemble(engine, ExtractionResult(sample_id="live", fields=fields,
                                                engine="test"), report, items)
    assert verdict.kind.value == "confirm_queue"
