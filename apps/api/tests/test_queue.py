"""Confirm-queue state machine tests (MED-002).

The persisted queue is what turns "low confidence" from a UI warning into a
machine-enforced block on downstream plan generation. These tests pin the
transition law (first transition wins, replays refused), the audit trail, and
the transactional plan gate end-to-end through the HTTP surface.
"""
from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MEDISAATHI_RATE_WRITE", "100000")
os.environ.setdefault("MEDISAATHI_RATE_READ", "100000")

from app import queue  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def rx_id() -> str:
    return f"test-{uuid.uuid4()}"


def _item(idx: int, why: str = "low field confidence") -> dict:
    return {
        "field_index": idx, "raw_text": f"line {idx}", "confidence": 0.8,
        "fused": 0.88, "band": "confirm", "why": why,
    }


def test_sync_then_resolve_first_wins(rx_id):
    items = queue.sync(rx_id, [_item(0), _item(1)])
    assert len(items) == 2
    assert all(i.state.value == "pending" for i in items)

    resolved, replayed = queue.resolve(rx_id, 0, accepted=True, resolved_brand="Pan 40")
    assert resolved.state.value == "confirmed"
    assert resolved.resolved_brand == "Pan 40"
    assert replayed is False

    # replay: the first transition wins, the row is not re-mutated
    again, replayed = queue.resolve(rx_id, 0, accepted=False)
    assert replayed is True
    assert again.state.value == "confirmed"

    assert queue.pending_items(rx_id) == [queue.list_items(rx_id)[1]]


def test_sync_is_idempotent_and_never_resurrects_resolved_rows(rx_id):
    queue.sync(rx_id, [_item(0)])
    queue.resolve(rx_id, 0, accepted=False)
    queue.sync(rx_id, [_item(0, why="re-run refresh")])
    item = queue.list_items(rx_id)[0]
    assert item.state.value == "rejected"  # not re-opened by a re-run


def test_sync_removes_nothing_but_records_transitions(rx_id):
    queue.sync(rx_id, [_item(0)])
    queue.resolve(rx_id, 0, accepted=True)
    transitions = queue.history(rx_id)
    assert [(t.from_state, t.to_state) for t in transitions] == [
        ("none", "pending"), ("pending", "confirmed")]


def test_blocked_reason_and_transactional_gate(rx_id):
    queue.sync(rx_id, [_item(0)])
    assert queue.blocked_reason(rx_id) is not None
    with pytest.raises(queue.QueueBlockedError):
        queue.assert_plan_allowed(rx_id)
    queue.resolve(rx_id, 0, accepted=True)
    assert queue.blocked_reason(rx_id) is None
    queue.assert_plan_allowed(rx_id)  # must not raise


def test_resolve_unknown_field_is_key_error(rx_id):
    with pytest.raises(KeyError):
        queue.resolve(rx_id, 9, accepted=True)


# ------------------------------------------------------------------ HTTP surface

def test_queue_endpoints_and_plan_block(client):
    """A queued prescription cannot become a plan; resolving unlocks it."""
    start = client.post("/api/v1/prescriptions?sample_id=RX-003")
    assert start.status_code == 200
    rx = start.json()["data"]
    assert rx["verdict"]["kind"] == "confirm_queue"
    pid = rx["prescription_id"]

    state = client.get(f"/api/v1/prescriptions/{pid}/queue").json()
    assert state["data"]["blocked"] is True
    assert state["data"]["pending"] >= 1

    blocked = client.get(f"/api/v1/prescriptions/{pid}/explanation")
    assert blocked.status_code == 409
    assert "awaiting human confirmation" in blocked.json()["detail"]

    # Resolve every queued field; the plan unlocks only when the last one
    # clears. A field the machine could not resolve needs a corrected brand
    # from the human (that is what the queue is for) - the API refuses to
    # confirm an invented brand.
    pending = [i for i in state["data"]["items"] if i["state"] == "pending"]
    for n, item in enumerate(pending, start=1):
        payload = {"field_index": item["field_index"], "accepted": True,
                   "actor": "pharmacist", "note": "checked against the tube"}
        r = client.post(f"/api/v1/prescriptions/{pid}/queue/resolve", json=payload)
        if r.status_code == 422:
            payload["brand_text"] = "Doxy-1 100"  # human correction of the misread
            r = client.post(f"/api/v1/prescriptions/{pid}/queue/resolve", json=payload)
        assert r.status_code == 200
        body = r.json()["data"]
        assert body["status"] == "resolved"
        assert body["queue"]["pending"] == len(pending) - n
        assert body["queue"]["blocked"] is (n < len(pending))

    spoken = client.get(f"/api/v1/prescriptions/{pid}/explanation")
    assert spoken.status_code == 200

    history = client.get(f"/api/v1/prescriptions/{pid}/queue/history").json()
    assert history["meta"]["count"] >= 2


def test_queue_resolve_is_replay_proof_over_http(client):
    pid = client.post("/api/v1/prescriptions?sample_id=RX-003").json()["data"]["prescription_id"]
    state = client.get(f"/api/v1/prescriptions/{pid}/queue").json()["data"]
    idx = state["items"][0]["field_index"]
    first = client.post(f"/api/v1/prescriptions/{pid}/queue/resolve",
                        json={"field_index": idx, "accepted": False}).json()["data"]
    assert first["status"] == "resolved"
    second = client.post(f"/api/v1/prescriptions/{pid}/queue/resolve",
                         json={"field_index": idx, "accepted": True}).json()["data"]
    assert second["status"] == "already_resolved"
    assert second["item"]["state"] == "rejected"


def test_unknown_prescription_queue_is_404(client):
    assert client.get("/api/v1/prescriptions/nope/queue").status_code == 404
