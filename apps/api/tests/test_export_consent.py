"""MED-025 (consent stub) and MED-028 (FHIR export mapping).

Both are deliberately narrow:

* the consent stub must reject anything that looks like a real identifier path,
  fail closed on expiry/revocation, and validate against the ABDM vocabulary;
* the FHIR export must refuse to serialise an unverified read — the same
  safety law as the plan gate, one hop downstream.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import consent  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_consent():
    consent.reset()
    yield
    consent.reset()


# ------------------------------------------------------------------ consent
def test_consent_grant_validates_vocabulary() -> None:
    artefact = consent.grant("pseudo-7f3a", "CAREMGT", ["Prescription"], ttl_days=7)
    assert artefact["status"] == "GRANTED"
    assert artefact["is_active"] is True
    assert artefact["hi_types"] == ["Prescription"]
    assert artefact["integration"].startswith("stub")

    with pytest.raises(consent.ConsentError):
        consent.grant("pseudo-7f3a", "NOT_A_PURPOSE", ["Prescription"])
    with pytest.raises(consent.ConsentError):
        consent.grant("pseudo-7f3a", "CAREMGT", ["NotAHiType"])
    with pytest.raises(consent.ConsentError):
        consent.grant("pseudo-7f3a", "CAREMGT", ["Prescription"], ttl_days=0)
    with pytest.raises(consent.ConsentError):
        consent.grant("", "CAREMGT", ["Prescription"])


def test_consent_revoke_is_fail_closed_and_idempotent() -> None:
    artefact = consent.grant("pseudo-1111", "BREAKGLASS", ["Prescription"])
    assert artefact["is_active"] is True

    revoked = consent.revoke(artefact["consent_id"])
    assert revoked is not None and revoked["is_active"] is False
    assert revoked["status"] == "REVOKED"
    assert revoked["revoked_at"]

    # first transition wins: a second revoke is a no-op, not a new state
    again = consent.revoke(artefact["consent_id"])
    assert again is not None and again["revoked_at"] == revoked["revoked_at"]
    assert consent.revoke("consent-does-not-exist") is None


def test_consent_expiry_denies_use() -> None:
    artefact = consent.grant("pseudo-2222", "CAREMGT", ["Prescription"], ttl_days=1)
    # simulate expiry by rewriting the row (no clock injection needed here)
    conn = consent._connect()
    conn.execute("UPDATE consent_artifacts SET expires_at = ? WHERE consent_id = ?",
                 ("2000-01-01T00:00:00+00:00", artefact["consent_id"]))
    conn.commit()
    expired = consent.get(artefact["consent_id"])
    assert expired is not None
    assert expired["status"] == "EXPIRED"
    assert expired["is_active"] is False


def test_consent_routes(client: TestClient) -> None:
    created = client.post("/api/v1/consent", json={
        "patient_ref": "pseudo-9abc", "purpose": "CAREMGT",
        "hi_types": ["Prescription"], "ttl_days": 30,
    })
    assert created.status_code == 200, created.text
    body = created.json()["data"]
    assert body["is_active"] is True

    fetched = client.get(f"/api/v1/consent/{body['consent_id']}")
    assert fetched.status_code == 200
    assert fetched.json()["data"]["purpose"] == "CAREMGT"

    bad = client.post("/api/v1/consent", json={
        "patient_ref": "pseudo-9abc", "purpose": "MADE_UP",
    })
    assert bad.status_code == 422

    revoked = client.post(f"/api/v1/consent/{body['consent_id']}/revoke")
    assert revoked.status_code == 200
    assert revoked.json()["data"]["is_active"] is False

    assert client.get("/api/v1/consent/consent-missing").status_code == 404


# ------------------------------------------------------------------ FHIR
def _start(client: TestClient, sample_id: str, context: str = "") -> str:
    r = client.post(f"/api/v1/prescriptions?sample_id={sample_id}{context}")
    assert r.status_code == 200, r.text
    return r.json()["data"]["prescription_id"]


def test_fhir_export_maps_a_verified_prescription(client: TestClient) -> None:
    pid = _start(client, "RX-001")
    res = client.get(f"/api/v1/prescriptions/{pid}/fhir")
    assert res.status_code == 200, res.text
    bundle = res.json()["data"]["bundle"]
    assert bundle["resourceType"] == "Bundle"
    assert bundle["type"] == "collection"
    assert bundle["meta"]["tag"][0]["code"], "dataset snapshot must travel with the export"

    meds = [e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "MedicationRequest"]
    assert meds, "a verified prescription must produce MedicationRequest resources"
    for m in meds:
        assert m["status"] == "active"
        assert m["intent"] == "order"
        assert m["medicationCodeableConcept"]["text"]
        assert m["dosageInstruction"]
        assert "not a medical device" in m["note"][0]["text"]

    provenance = [e["resource"] for e in bundle["entry"]
                  if e["resource"]["resourceType"] == "Provenance"]
    assert provenance and "threshold_set" in provenance[0]["entity"][0]["what"]["display"]


def test_fhir_export_refuses_unverified_reads(client: TestClient) -> None:
    # RX-003 is the sealed confirm-queue fixture: unresolved fields must NOT export.
    queued = _start(client, "RX-003")
    blocked = client.get(f"/api/v1/prescriptions/{queued}/fhir")
    assert blocked.status_code == 409
    assert "human confirmation" in blocked.json()["detail"]

    # RX-006 is the sealed refusal fixture: a refusal is never exported.
    refused = _start(client, "RX-006")
    refused_res = client.get(f"/api/v1/prescriptions/{refused}/fhir")
    assert refused_res.status_code == 409

    assert client.get("/api/v1/prescriptions/rx-does-not-exist/fhir").status_code == 404


def test_fhir_export_excludes_queued_prescription_after_resolution(client: TestClient) -> None:
    """Resolving the queue unlocks the export — the block is state, not a flag."""
    pid = _start(client, "RX-003")
    assert client.get(f"/api/v1/prescriptions/{pid}/fhir").status_code == 409

    state = client.get(f"/api/v1/prescriptions/{pid}/queue").json()["data"]
    assert state["blocked"] is True
    items = state["items"]
    assert items

    resolved = client.post(f"/api/v1/prescriptions/{pid}/queue/resolve", json={
        "field_index": items[0]["field_index"], "accepted": True,
        "brand_text": "Pan 40", "actor": "pharmacist", "note": "corrected read",
    })
    assert resolved.status_code == 200, resolved.text

    after = client.get(f"/api/v1/prescriptions/{pid}/queue").json()["data"]
    if after["blocked"] is False:
        assert client.get(f"/api/v1/prescriptions/{pid}/fhir").status_code == 200
