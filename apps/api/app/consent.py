"""Consent-artifact stub, ABDM-vocabulary aligned (MED-025).

The audit's honest position is that authentication and consent are deliberately
absent (demo scope) and are a release blocker before any real-patient use. This
module is the **smallest honest step** the plan asks for: a persisted
consent-artifact record whose field names follow ABDM/ABHA vocabulary, so the
data model is not the blocker when a real gateway is integrated. It is
explicitly NOT a live ABDM integration and NOT an authentication system:

* no patient identifiers — the artefact references a pseudonymous `patient_ref`,
  never a name, phone number or ABHA address;
* no cryptographic signature — `signature_ref` records *that* a signature must
  accompany a real artefact, it does not fabricate one;
* artefacts expire, and `is_active` treats expiry and revocation as denial
  (fail-closed, the same law as the confirm queue).

Storage is the same SQLite file as the rest of the tier; the swap point to a
consent registry is this module only.
"""
from __future__ import annotations

import os
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone

#: Purpose codes drawn from ABDM's consent vocabulary (hiu/hiu purposes).
PURPOSE_CODES = (
    "CAREMGT",     # care management
    "BREAKGLASS",  # emergency access
    "PUBHLTH",     # public health
    "HPAYMT",      # healthcare payment
    "DSRCH",       # disease-specific research (requires separate ethics path)
)

#: "HI types" this tier can produce, ABDM vocabulary.
HI_TYPES = ("OPConsultation", "Prescription", "WellnessRecord")

_DB_PATH = os.environ.get(
    "MEDISAATHI_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "medisaathi.db"),
)

_INIT = """
CREATE TABLE IF NOT EXISTS consent_artifacts (
    consent_id   TEXT PRIMARY KEY,
    patient_ref  TEXT NOT NULL,
    purpose      TEXT NOT NULL,
    hi_types     TEXT NOT NULL,
    status       TEXT NOT NULL,
    granted_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    revoked_at   TEXT,
    signature_ref TEXT NOT NULL DEFAULT ''
);
"""

_write_lock = threading.Lock()
_local = threading.local()

_MAX_TTL_DAYS = 365


class ConsentError(Exception):
    """Raised for an invalid consent request (unknown purpose / HI type / TTL)."""


def _connect() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(_DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        _local.conn = conn
        with _write_lock:
            conn.executescript(_INIT)
            conn.commit()
    return conn


def _now() -> datetime:
    return datetime.now(timezone.utc)


def reset() -> None:
    """Test hook: clear all consent artefacts."""
    conn = _connect()
    with _write_lock:
        conn.execute("DELETE FROM consent_artifacts")
        conn.commit()


def grant(patient_ref: str, purpose: str, hi_types: list[str],
          ttl_days: int = 30, signature_ref: str = "") -> dict:
    """Create a consent artefact. Validates against the vocabulary, fail-closed.

    Raises ``ConsentError`` on an unknown purpose code or HI type, and on a TTL
    outside (0, 365] days — an unbounded consent artefact is a bug, not a feature.
    """
    patient_ref = (patient_ref or "").strip()
    if not patient_ref:
        raise ConsentError("patient_ref is required (pseudonymous reference, never PII)")
    if purpose not in PURPOSE_CODES:
        raise ConsentError(f"unknown purpose code {purpose!r}; have {sorted(PURPOSE_CODES)}")
    invalid = [h for h in hi_types if h not in HI_TYPES]
    if invalid:
        raise ConsentError(f"unknown HI type(s) {invalid}; have {list(HI_TYPES)}")
    if not hi_types:
        raise ConsentError("at least one HI type is required")
    if not (0 < ttl_days <= _MAX_TTL_DAYS):
        raise ConsentError(f"ttl_days must be within (0, {_MAX_TTL_DAYS}]")

    consent_id = f"consent-{uuid.uuid4().hex[:16]}"
    granted = _now()
    expires = granted + timedelta(days=ttl_days)
    conn = _connect()
    with _write_lock:
        conn.execute(
            "INSERT INTO consent_artifacts (consent_id, patient_ref, purpose,"
            " hi_types, status, granted_at, expires_at, signature_ref)"
            " VALUES (?, ?, ?, ?, 'GRANTED', ?, ?, ?)",
            (consent_id, patient_ref, purpose, ",".join(hi_types),
             granted.isoformat(timespec="seconds"),
             expires.isoformat(timespec="seconds"), signature_ref))
        conn.commit()
    return get(consent_id)


def revoke(consent_id: str) -> dict | None:
    conn = _connect()
    with _write_lock:
        row = conn.execute("SELECT * FROM consent_artifacts WHERE consent_id = ?",
                           (consent_id,)).fetchone()
        if row is None:
            return None
        if row["status"] == "REVOKED":
            return _row(row)  # first transition wins: idempotent revoke
        conn.execute("UPDATE consent_artifacts SET status = 'REVOKED', revoked_at = ?"
                     " WHERE consent_id = ?",
                     (_now().isoformat(timespec="seconds"), consent_id))
        conn.commit()
    return get(consent_id)


def _row(row: sqlite3.Row) -> dict:
    now = _now()
    expires = datetime.fromisoformat(row["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    expired = expires <= now
    return {
        "consent_id": row["consent_id"],
        "patient_ref": row["patient_ref"],
        "purpose": row["purpose"],
        "hi_types": row["hi_types"].split(",") if row["hi_types"] else [],
        "status": "EXPIRED" if (expired and row["status"] == "GRANTED") else row["status"],
        "granted_at": row["granted_at"],
        "expires_at": row["expires_at"],
        "revoked_at": row["revoked_at"],
        "signature_ref": row["signature_ref"],
        # Fail-closed: only a live GRANTED artefact authorises data use.
        "is_active": row["status"] == "GRANTED" and not expired,
        "integration": "stub (ABDM vocabulary only; no live gateway, no signature)",
    }


def get(consent_id: str) -> dict | None:
    conn = _connect()
    row = conn.execute("SELECT * FROM consent_artifacts WHERE consent_id = ?",
                       (consent_id,)).fetchone()
    return _row(row) if row else None


def list_for_patient(patient_ref: str) -> list[dict]:
    conn = _connect()
    rows = conn.execute("SELECT * FROM consent_artifacts WHERE patient_ref = ?"
                        " ORDER BY granted_at DESC", (patient_ref,)).fetchall()
    return [_row(r) for r in rows]
