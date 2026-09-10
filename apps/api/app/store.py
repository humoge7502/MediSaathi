"""Thread-safe SQLite-backed store. Zero external service, one file.

Boring on purpose (decision log): the event build must never lose a
prescription because the demo laptop hiccuped; SQLite survives restarts so the
demo can resume mid-walkthrough. The repository API is intentionally narrow so
the swap to Postgres post-event touches exactly this file.
"""
from __future__ import annotations

import os
import sqlite3
import threading
import uuid

from medisaathi_contracts import PrescriptionState

_DB_PATH = os.environ.get(
    "MEDISAATHI_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "medisaathi.db"),
)

_INIT = """
CREATE TABLE IF NOT EXISTS prescriptions (
    prescription_id TEXT PRIMARY KEY,
    sample_id       TEXT NOT NULL,
    state           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

_write_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(_INIT)
        _conn.commit()
    return _conn


def create(sample_id: str) -> PrescriptionState:
    rx = PrescriptionState(prescription_id=str(uuid.uuid4()), sample_id=sample_id)
    put(rx)
    return rx


def get(prescription_id: str) -> PrescriptionState | None:
    conn = _connect()
    row = conn.execute(
        "SELECT state FROM prescriptions WHERE prescription_id = ?",
        (prescription_id,)).fetchone()
    return PrescriptionState.model_validate_json(row[0]) if row else None


def put(rx: PrescriptionState) -> None:
    conn = _connect()
    with _write_lock:
        conn.execute(
            "INSERT INTO prescriptions (prescription_id, sample_id, state, updated_at) "
            "VALUES (?, ?, ?, datetime('now')) "
            "ON CONFLICT(prescription_id) DO UPDATE SET "
            "state = excluded.state, sample_id = excluded.sample_id, "
            "updated_at = datetime('now')",
            (rx.prescription_id, rx.sample_id, rx.model_dump_json()))
        conn.commit()


def count() -> int:
    conn = _connect()
    return int(conn.execute("SELECT COUNT(*) FROM prescriptions").fetchone()[0])


def verdict_counts() -> dict[str, int]:
    """Aggregate verdict kinds without materializing every stored row."""
    conn = _connect()
    counts: dict[str, int] = {}
    for (state,) in conn.execute("SELECT state FROM prescriptions"):
        try:
            v = PrescriptionState.model_validate_json(state).verdict
        except Exception:  # a corrupt row must never take metrics down
            continue
        if v is not None:
            counts[v.kind.value] = counts.get(v.kind.value, 0) + 1
    return counts
