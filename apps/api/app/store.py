"""Thread-safe SQLite-backed store. Zero external service, one file.

Boring on purpose (decision log): the event build must never lose a
prescription because the demo laptop hiccuped; SQLite survives restarts so the
demo can resume mid-walkthrough. The repository API is intentionally narrow so
the swap to Postgres post-event touches exactly this file.

v3: verdict_kind is materialized as an indexed column so /metrics aggregates
in O(1) via GROUP BY instead of re-parsing every stored JSON row. Existing
databases are migrated in place (column added + backfilled) on first open.
"""
from __future__ import annotations

import json
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
    verdict_kind    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

_INDEX = (
    "CREATE INDEX IF NOT EXISTS idx_prescriptions_verdict_kind "
    "ON prescriptions (verdict_kind)"
)

_MIGRATE_V2_TO_V3 = "ALTER TABLE prescriptions ADD COLUMN verdict_kind TEXT"

_write_lock = threading.Lock()
_local = threading.local()  # one connection per thread (reads never share state)


def _connect() -> sqlite3.Connection:
    """Thread-local connection. The previous single shared connection (with
    check_same_thread=False) meant concurrent reads could interleave with a
    write transaction on the same connection object; per-thread connections
    remove that coupling entirely. WAL mode keeps writer/reader concurrency."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(_DB_PATH)  # owned by this thread, enforced by sqlite3
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        _local.conn = conn
        with _write_lock:  # schema init is idempotent and must run exactly once logically
            _ensure_schema(conn)
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    # Order matters: create the table, THEN migrate old schemas (add the
    # column + backfill), THEN create the index - the index references a
    # column that pre-v3 databases do not have yet.
    conn.executescript(_INIT)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(prescriptions)")}
    if "verdict_kind" not in cols:
        conn.execute(_MIGRATE_V2_TO_V3)
        _backfill_verdict_kind(conn)
    conn.execute(_INDEX)
    conn.commit()


def _backfill_verdict_kind(conn: sqlite3.Connection) -> None:
    for pid, state in conn.execute("SELECT prescription_id, state FROM prescriptions"):
        try:
            v = json.loads(state).get("verdict")
            kind = v.get("kind") if isinstance(v, dict) else None
        except Exception:  # corrupt row: leave NULL, metrics skip NULLs
            kind = None
        conn.execute(
            "UPDATE prescriptions SET verdict_kind = ? WHERE prescription_id = ?",
            (kind, pid))
    conn.commit()


def _kind_of(rx: PrescriptionState) -> str | None:
    return rx.verdict.kind.value if rx.verdict is not None else None


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
            "INSERT INTO prescriptions (prescription_id, sample_id, state, verdict_kind, updated_at) "
            "VALUES (?, ?, ?, ?, datetime('now')) "
            "ON CONFLICT(prescription_id) DO UPDATE SET "
            "state = excluded.state, sample_id = excluded.sample_id, "
            "verdict_kind = excluded.verdict_kind, updated_at = datetime('now')",
            (rx.prescription_id, rx.sample_id, rx.model_dump_json(), _kind_of(rx)))
        conn.commit()


def count() -> int:
    conn = _connect()
    return int(conn.execute("SELECT COUNT(*) FROM prescriptions").fetchone()[0])


def verdict_counts() -> dict[str, int]:
    """O(1) aggregate over the indexed column; NULL kinds are simply skipped."""
    conn = _connect()
    return {
        kind: n
        for kind, n in conn.execute(
            "SELECT verdict_kind, COUNT(*) FROM prescriptions "
            "WHERE verdict_kind IS NOT NULL GROUP BY verdict_kind")
    }
