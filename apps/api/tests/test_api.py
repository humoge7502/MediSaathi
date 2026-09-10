"""Golden-path API tests: upload -> verdict -> plan -> price + judge route."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health_and_ready():
    assert client.get("/healthz").json()["ok"] is True
    r = client.get("/readyz").json()
    assert r["ok"] is True and r["data"]["brands"] >= 50


def test_pipeline_pass_and_plan_and_price():
    r = client.post("/api/v1/prescriptions", params={"sample_id": "RX-001"})
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["verdict"] == "pass"
    pid = body["data"]["prescription_id"]

    plan = client.get(f"/api/v1/prescriptions/{pid}/explanation", params={"lang": "ta"})
    assert plan.status_code == 200
    assert plan.json()["meta"]["slots_verified"] is True

    price = client.get(f"/api/v1/prescriptions/{pid}/price")
    assert price.status_code == 200
    assert price.json()["data"]["rows"][0]["molecule"] == "paracetamol"


def test_pipeline_refusal_on_corrupted():
    r = client.post("/api/v1/prescriptions", params={"sample_id": "RX-006"})
    assert r.status_code == 200  # refusal is a 200 with a refused verdict
    assert r.json()["meta"]["verdict"] == "refused"
    data = r.json()["data"]
    assert data["verdict"]["refusal_reason"] == "no_prescription_content"


def test_confirm_queue_blocks_plan_until_resolved():
    r = client.post("/api/v1/prescriptions", params={"sample_id": "RX-003"})
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["verdict"] == "confirm_queue"
    pid = body["data"]["prescription_id"]
    blocked = client.get(f"/api/v1/prescriptions/{pid}/explanation")
    assert blocked.status_code == 409  # unverified fields never reach the plan


def test_severe_interaction_case():
    r = client.post("/api/v1/prescriptions", params={"sample_id": "RX-002"})
    assert r.json()["meta"]["verdict"] == "interaction"
    v = r.json()["data"]["verdict"]
    assert "warfarin" in v["headline"].lower()


def test_judge_route_sealed_and_cached_fallback():
    r = client.get("/api/v1/judge/cases")
    assert r.status_code == 200
    ids = [c["sample_id"] for c in r.json()["sealed"]]
    assert ids == ["RX-001", "RX-002", "RX-009", "RX-006"]
    assert any(c["expect_verdict"] == "refused" for c in r.json()["sealed"])
    # cached tier answers with the baked envelope once tools/bake_judge_cache.py
    # has run; before baking it 404s - graceful, never a crash.
    cached = client.get("/api/v1/judge/cases/RX-001/cached")
    assert cached.status_code in (200, 404)
    if cached.status_code == 200:
        assert cached.json()["state"]["meta"]["verdict"] == "pass"


def test_metrics_counters():
    client.post("/api/v1/prescriptions", params={"sample_id": "RX-006"})
    m = client.get("/metrics").json()
    assert m["pipeline_started_total"] >= 1
    assert m["refused_total"] >= 1


def test_adr_draft_pvpi_shape():
    r = client.post("/api/v1/adr-reports", json={
        "medicine": "Azithral 500", "reaction": "mild rash",
        "severity": "mild", "onset_days": 2})
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["channel"].startswith("PvPI")
    assert "review before submission" in d["channel"]
