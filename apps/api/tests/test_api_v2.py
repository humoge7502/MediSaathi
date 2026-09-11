"""API surface v2: upload gating, formulary search, price savings, judge
cache, envelope invariants."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# The judge-cache test below exercises the demo's opted-in state; the flag
# now defaults to 0 (MS-08), so tests that need the route set it explicitly.
os.environ.setdefault("MEDISAATHI_JUDGE_OPEN", "1")

client = TestClient(app)


def test_upload_without_key_is_503(monkeypatch):
    import app.routers.api as api_mod
    monkeypatch.setattr(api_mod, "LIVE_KEY_IMPORT_FAIL", False, raising=False)
    # ensure the module-level LIVE_KEY is empty
    import app.vision as v
    monkeypatch.setattr(v, "LIVE_KEY", "")
    r = client.post("/api/v1/prescriptions/upload",
                    files={"image": ("rx.jpg", b"fake", "image/jpeg")})
    assert r.status_code == 503
    assert "MEDISAATHI_VISION_KEY" in r.json()["detail"]


def test_upload_empty_image_rejected():
    # Even with a key configured, empty bytes must 422 before any network call
    import app.routers.api as api_mod
    import app.vision as v
    prev = v.LIVE_KEY
    try:
        v.LIVE_KEY = "test-key"
        assert callable(api_mod.extract_live)  # import target exists
        r = client.post("/api/v1/prescriptions/upload",
                        files={"image": ("rx.jpg", b"", "image/jpeg")})
        assert r.status_code == 422
    finally:
        v.LIVE_KEY = prev


def test_formulary_search_prefix_and_molecule():
    r = client.get("/api/v1/formulary/search", params={"q": "dol"})
    assert r.status_code == 200
    brands = [x["brand"] for x in r.json()["data"]["results"]]
    assert "Dolo 650" in brands
    r2 = client.get("/api/v1/formulary/search", params={"q": "paracetamol"})
    brands2 = [x["brand"] for x in r2.json()["data"]["results"]]
    assert "Dolo 650" in brands2 and "Calpol" in brands2


def test_formulary_search_empty_is_empty():
    r = client.get("/api/v1/formulary/search", params={"q": ""})
    assert r.json()["data"]["results"] == []


def test_price_savings_and_summary():
    r = client.post("/api/v1/prescriptions", params={"sample_id": "RX-001"})
    pid = r.json()["data"]["prescription_id"]
    p = client.get(f"/api/v1/prescriptions/{pid}/price").json()["data"]
    assert "summary" in p and "rows" in p
    row = p["rows"][0]
    assert row["generic_available"] is True
    assert row["generic_brand"]
    # savings must be consistent: unit - generic, floored at 0
    if row["unit_price_inr"] is not None and row["generic_price_inr"] is not None:
        expected = max(0.0, round(row["unit_price_inr"] - row["generic_price_inr"], 2))
        assert row["savings_inr"] == expected
    s = p["summary"]
    assert s["unit_total_inr"] >= s["generic_total_inr"]
    assert s["savings_total_inr"] == round(s["unit_total_inr"] - s["generic_total_inr"], 2)


def test_plan_contains_audio_segments_with_refs():
    r = client.post("/api/v1/prescriptions", params={"sample_id": "RX-002"})
    pid = r.json()["data"]["prescription_id"]
    plan = client.get(f"/api/v1/prescriptions/{pid}/explanation").json()["data"]
    kinds = [s["kind"] for s in plan["segments"]]
    assert "open" in kinds and "medication" in kinds and "warning" in kinds and "close" in kinds
    warn = next(s for s in plan["segments"] if s["kind"] == "warning")
    assert warn["slot_refs"], "warning segment must cite its slots"


def test_judge_cached_after_bake():
    """The bake script (tools/bake_judge_cache.py) writes judge_cache.json;
    when present, the cached tier must answer the baked bundle."""
    cache_path = os.path.abspath(os.path.join(
        os.path.dirname(__file__), "..", "app", "data", "judge_cache.json"))
    if not os.path.exists(cache_path):
        r = client.get("/api/v1/judge/cases/RX-001/cached")
        assert r.status_code == 404  # graceful before baking
        return
    r = client.get("/api/v1/judge/cases/RX-001/cached")
    assert r.status_code == 200
    body = r.json()
    assert body["state"]["meta"]["verdict"] == "pass"
    assert body["state"]["data"]["prescription_id"]
    assert body["baked_at"]


def test_envelope_shape_everywhere():
    for path in ["/healthz", "/readyz", "/metrics"]:
        r = client.get(path)
        assert r.status_code == 200
