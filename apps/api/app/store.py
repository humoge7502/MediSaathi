"""Thread-safe SQLite-backed store. Zero external service, one file.

Boring on purpose (decision log): the event build must never lose a
prescription because the demo laptop hiccuped; SQLite survives restarts so the
demo can resume mid-walkthrough. The repository API is intentionally narrow so
the swap to Postgres post-event touches this file plus the connection-opening
rules in `db.py`.

v3: verdict_kind is materialized as an indexed column so reads stopped
re-parsing every stored JSON row. Existing databases are migrated in place
(column added + backfilled) on first open.

v4: that was still O(rows) per /metrics call — an index makes a GROUP BY cheap
per row, it does not make it skip rows (measured: 2.2-3.0 ms p50 on an empty
store vs 5.8-12.9 ms at 56k-60k rows, docs/PERFORMANCE.md). The counts now live
in a `verdict_tally` table maintained transactionally by `put()`, so the read is
O(distinct kinds) and the write path pays one indexed primary-key lookup.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid

from medisaathi_contracts import PrescriptionState

from .db import apply_pragmas

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

_TALLY_INIT = """
CREATE TABLE IF NOT EXISTS verdict_tally (
    verdict_kind TEXT PRIMARY KEY,
    n            INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS store_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

_INDEX = (
    "CREATE INDEX IF NOT EXISTS idx_prescriptions_verdict_kind "
    "ON prescriptions (verdict_kind)"
)

_MIGRATE_V2_TO_V3 = "ALTER TABLE prescriptions ADD COLUMN verdict_kind TEXT"

_TALLY_READ = "SELECT verdict_kind, n FROM verdict_tally WHERE n > 0"

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
        apply_pragmas(conn)
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
    conn.executescript(_TALLY_INIT)
    _reconcile_tally_if_unseeded(conn)
    conn.commit()


def _reconcile_tally_if_unseeded(conn: sqlite3.Connection) -> None:
    """Seed the tally from a full scan exactly once per database file.

    The one-time cost is the point: a database written before this table existed
    has real verdicts and an empty tally, and the only honest way to start
    counting from there is to count what is already stored. Seeding is recorded
    in `store_meta` rather than inferred from the tally being empty, because an
    all-NULL-kind store would otherwise re-scan on every connection — the same
    O(rows) read this table exists to remove. After seeding, `put()` owns the
    deltas and no read touches the prescriptions table.
    """
    seeded = conn.execute(
        "SELECT value FROM store_meta WHERE key = 'tally_seeded'").fetchone()
    if seeded:
        return
    conn.execute(
        "INSERT INTO verdict_tally (verdict_kind, n) "
        "SELECT verdict_kind, COUNT(*) FROM prescriptions "
        "WHERE verdict_kind IS NOT NULL GROUP BY verdict_kind "
        "ON CONFLICT(verdict_kind) DO UPDATE SET n = excluded.n"
    )
    conn.execute(
        "INSERT OR REPLACE INTO store_meta (key, value) VALUES ('tally_seeded', '1')"
    )


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
    kind = _kind_of(rx)
    conn = _connect()
    with _write_lock:
        # One IMMEDIATE transaction, not a read followed by a write. pysqlite
        # would open its own deferred transaction at the first UPDATE, and a
        # deferred read can be overtaken by another process between the SELECT
        # and the write: two workers confirming the same prescription would each
        # see the kind that is about to be replaced and decrement it twice.
        # Taking the write lock up front keeps the tally's read-modify-write
        # atomic across processes as well as threads — the price of maintaining
        # a counter instead of scanning for it (TD-7).
        conn.execute("BEGIN IMMEDIATE")
        prev = conn.execute(
            "SELECT verdict_kind FROM prescriptions WHERE prescription_id = ?",
            (rx.prescription_id,)).fetchone()
        conn.execute(
            "INSERT INTO prescriptions (prescription_id, sample_id, state, verdict_kind, updated_at) "
            "VALUES (?, ?, ?, ?, datetime('now')) "
            "ON CONFLICT(prescription_id) DO UPDATE SET "
            "state = excluded.state, sample_id = excluded.sample_id, "
            "verdict_kind = excluded.verdict_kind, updated_at = datetime('now')",
            (rx.prescription_id, rx.sample_id, rx.model_dump_json(), kind))
        _apply_delta(conn, prev[0] if prev else None, kind)
        conn.commit()


def _apply_delta(conn: sqlite3.Connection, old: str | None, new: str | None) -> None:
    """Move this row's one unit of count between tally buckets.

    The `old` read happens inside `_write_lock` because `put()` is an upsert: a
    verdict being *replaced* (a confirm over a queued verdict, a re-run of the
    same prescription id) must decrement the bucket it leaves, not only increment
    the one it enters, or the totals drift upward forever. Buckets that reach
    zero are deleted so `verdict_counts()` keeps the shape the old GROUP BY had —
    only kinds that exist.
    """
    if old == new:
        return
    if old is not None:
        conn.execute(
            "UPDATE verdict_tally SET n = n - 1 WHERE verdict_kind = ?", (old,))
    if new is not None:
        conn.execute(
            "INSERT INTO verdict_tally (verdict_kind, n) VALUES (?, 1) "
            "ON CONFLICT(verdict_kind) DO UPDATE SET n = n + 1", (new,))
    conn.execute("DELETE FROM verdict_tally WHERE n <= 0")


def count() -> int:
    conn = _connect()
    return int(conn.execute("SELECT COUNT(*) FROM prescriptions").fetchone()[0])


def verdict_counts() -> dict[str, int]:
    """O(distinct kinds) — reads the tally `put()` maintains, never the rows.

    The previous implementation was a GROUP BY over the indexed column and was
    documented as O(1). It was not: an index makes that aggregate cheaper per
    row, it does not skip the rows. Measured 2026-10-28 (n=150, in-process,
    alternating runs) — 2.227-2.993 ms p50 on an empty store against
    5.756-12.909 ms at 56k-60k rows, while /healthz and a framework-free probe
    overlapped across both groups. See docs/PERFORMANCE.md and TD-29.
    """
    conn = _connect()
    return {kind: n for kind, n in conn.execute(_TALLY_READ)}
