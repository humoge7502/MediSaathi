"""Persisted confirmation-queue state machine (MED-002).

The gate law routes uncertain fields to a *human* confirmation band. This module
is the persisted, auditable form of that band: every queue row is a
single-transition state machine

    pending --resolve(accepted=True)--> confirmed
    pending --resolve(accepted=False)--> rejected
    confirmed | rejected               -> terminal (replays refused)

and a prescription is **blocked** from generating a downstream therapy plan
while any of its rows is ``pending``. The block is evaluated inside a database
transaction at plan-creation time, so two concurrent plan starts cannot both
observe an empty queue and race past each other.

Storage is the same SQLite file as the prescription store (one boring file to
back up); the swap point to Postgres touches this module and ``store.py`` only.
"""
from __future__ import annotations

import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

from medisaathi_contracts import QueueItem, QueueItemState, QueueTransition

_DB_PATH = os.environ.get(
    "MEDISAATHI_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "medisaathi.db"),
)

_INIT_QUEUE = """
CREATE TABLE IF NOT EXISTS confirm_queue (
    item_id            TEXT PRIMARY KEY,
    prescription_id    TEXT NOT NULL,
    field_index        INTEGER NOT NULL,
    raw_text           TEXT NOT NULL DEFAULT '',
    reading_confidence REAL NOT NULL DEFAULT 0,
    fused              REAL NOT NULL DEFAULT 0,
    band               TEXT NOT NULL DEFAULT 'confirm',
    why                TEXT NOT NULL DEFAULT '',
    state              TEXT NOT NULL DEFAULT 'pending',
    resolved_brand     TEXT,
    actor              TEXT NOT NULL DEFAULT 'system',
    note               TEXT NOT NULL DEFAULT '',
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    UNIQUE (prescription_id, field_index)
);
"""

_INIT_TRANSITIONS = """
CREATE TABLE IF NOT EXISTS queue_transitions (
    transition_id   TEXT PRIMARY KEY,
    prescription_id TEXT NOT NULL,
    field_index     INTEGER NOT NULL,
    from_state      TEXT NOT NULL,
    to_state        TEXT NOT NULL,
    actor           TEXT NOT NULL DEFAULT 'system',
    note            TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL
);
"""

_INDEX_TRANSITIONS = (
    "CREATE INDEX IF NOT EXISTS idx_queue_transitions_rx "
    "ON queue_transitions (prescription_id, field_index)"
)

_write_lock = threading.Lock()
_local = threading.local()


class QueueBlockedError(Exception):
    """Raised when a plan is attempted while the confirm queue is non-empty."""

    def __init__(self, prescription_id: str, pending: int) -> None:
        super().__init__(
            f"{pending} field(s) awaiting human confirmation for {prescription_id}")
        self.prescription_id = prescription_id
        self.pending = pending


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _connect() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(_DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        _local.conn = conn
        with _write_lock:
            conn.executescript(_INIT_QUEUE)
            conn.executescript(_INIT_TRANSITIONS)
            conn.execute(_INDEX_TRANSITIONS)
            conn.commit()
    return conn


def reset(prescription_id: str | None = None) -> None:
    """Test/utility hook: clear the queue (optionally one prescription)."""
    conn = _connect()
    with _write_lock:
        if prescription_id is None:
            conn.execute("DELETE FROM confirm_queue")
            conn.execute("DELETE FROM queue_transitions")
        else:
            conn.execute("DELETE FROM confirm_queue WHERE prescription_id = ?",
                         (prescription_id,))
            conn.execute("DELETE FROM queue_transitions WHERE prescription_id = ?",
                         (prescription_id,))
        conn.commit()


def _transition(conn: sqlite3.Connection, prescription_id: str, field_index: int,
                from_state: str, to_state: str, actor: str, note: str) -> None:
    conn.execute(
        "INSERT INTO queue_transitions (transition_id, prescription_id, field_index,"
        " from_state, to_state, actor, note, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), prescription_id, field_index, from_state, to_state,
         actor, note, _now()))


def _row_to_item(row: sqlite3.Row) -> QueueItem:
    return QueueItem(
        item_id=row["item_id"],
        prescription_id=row["prescription_id"],
        field_index=row["field_index"],
        raw_text=row["raw_text"],
        reading_confidence=row["reading_confidence"],
        fused=row["fused"],
        band=row["band"],
        why=row["why"],
        state=QueueItemState(row["state"]),
        resolved_brand=row["resolved_brand"],
        actor=row["actor"],
        note=row["note"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def sync(prescription_id: str, items: list[dict]) -> list[QueueItem]:
    """Reconcile the persisted queue with the fields the engine queued.

    Idempotent per ``(prescription_id, field_index)``: a pending row refreshes
    its metadata (a human may have re-run the pipeline), while a row already
    resolved by a human is never resurrected or silently re-opened.
    """
    conn = _connect()
    with _write_lock:
        for item in items:
            idx = int(item["field_index"])
            existing = conn.execute(
                "SELECT * FROM confirm_queue WHERE prescription_id = ? AND field_index = ?",
                (prescription_id, idx)).fetchone()
            if existing is None:
                conn.execute(
                    "INSERT INTO confirm_queue (item_id, prescription_id, field_index,"
                    " raw_text, reading_confidence, fused, band, why, state, actor,"
                    " created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'system', ?, ?)",
                    (str(uuid.uuid4()), prescription_id, idx,
                     str(item.get("raw_text", "")), float(item.get("confidence", 0.0)),
                     float(item.get("fused", 0.0)), str(item.get("band", "confirm")),
                     str(item.get("why", "")), _now(), _now()))
                _transition(conn, prescription_id, idx, "none", "pending", "system",
                            "gate law routed field to the human-confirmation band")
            elif existing["state"] == QueueItemState.pending.value:
                conn.execute(
                    "UPDATE confirm_queue SET raw_text = ?, reading_confidence = ?,"
                    " fused = ?, band = ?, why = ?, updated_at = ?"
                    " WHERE item_id = ?",
                    (str(item.get("raw_text", "")), float(item.get("confidence", 0.0)),
                     float(item.get("fused", 0.0)), str(item.get("band", "confirm")),
                     str(item.get("why", "")), _now(), existing["item_id"]))
        conn.commit()
    return list_items(prescription_id)


def list_items(prescription_id: str) -> list[QueueItem]:
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM confirm_queue WHERE prescription_id = ? ORDER BY field_index",
        (prescription_id,)).fetchall()
    return [_row_to_item(r) for r in rows]


def pending_items(prescription_id: str) -> list[QueueItem]:
    return [i for i in list_items(prescription_id) if i.state == QueueItemState.pending]


def history(prescription_id: str) -> list[QueueTransition]:
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM queue_transitions WHERE prescription_id = ?"
        " ORDER BY created_at, rowid", (prescription_id,)).fetchall()
    return [QueueTransition(
        transition_id=r["transition_id"], prescription_id=r["prescription_id"],
        field_index=r["field_index"], from_state=r["from_state"],
        to_state=r["to_state"], actor=r["actor"], note=r["note"],
        created_at=r["created_at"]) for r in rows]


def status(prescription_id: str) -> dict:
    items = list_items(prescription_id)
    return {
        "prescription_id": prescription_id,
        "pending": sum(1 for i in items if i.state == QueueItemState.pending),
        "confirmed": sum(1 for i in items if i.state == QueueItemState.confirm),
        "rejected": sum(1 for i in items if i.state == QueueItemState.reject),
        "blocked": any(i.state == QueueItemState.pending for i in items),
        "items": [i.model_dump() for i in items],
    }


def resolve(prescription_id: str, field_index: int, accepted: bool,
            resolved_brand: str | None = None, actor: str = "pharmacist",
            note: str = "") -> tuple[QueueItem, bool]:
    """Resolve one queued field. First transition wins; replays are refused.

    Returns ``(item, replayed)``. ``replayed`` is True when the row had already
    reached a terminal state — the caller reports ``already_resolved`` as a
    protocol outcome, not an error (the same law as the dose ledger).
    """
    conn = _connect()
    with _write_lock:
        row = conn.execute(
            "SELECT * FROM confirm_queue WHERE prescription_id = ? AND field_index = ?",
            (prescription_id, int(field_index))).fetchone()
        if row is None:
            raise KeyError(f"no queue row for field {field_index}")
        if row["state"] != QueueItemState.pending.value:
            return _row_to_item(row), True
        to_state = QueueItemState.confirm.value if accepted else QueueItemState.reject.value
        now = _now()
        conn.execute(
            "UPDATE confirm_queue SET state = ?, resolved_brand = ?, actor = ?,"
            " note = ?, updated_at = ? WHERE item_id = ?",
            (to_state, resolved_brand, actor, note, now, row["item_id"]))
        _transition(conn, prescription_id, int(field_index),
                    QueueItemState.pending.value, to_state, actor,
                    note or "human resolved the queued field")
        conn.commit()
    return _row_to_item(conn.execute(
        "SELECT * FROM confirm_queue WHERE item_id = ?", (row["item_id"],)).fetchone()), False


def blocked_reason(prescription_id: str) -> str | None:
    """None when a plan may be generated; otherwise the deterministic reason."""
    pending = pending_items(prescription_id)
    if not pending:
        return None
    fields = ", ".join(str(i.field_index) for i in pending)
    return (f"{len(pending)} field(s) awaiting human confirmation "
            f"(field index: {fields}). Resolve the confirm queue to unlock the plan.")


def assert_plan_allowed(prescription_id: str) -> None:
    """Transactional plan gate: raises QueueBlockedError while pending > 0.

    Uses ``BEGIN IMMEDIATE`` so the read of pending state and any subsequent
    plan write happen under one write lock — a concurrent resolver cannot slip
    between the check and the plan creation.
    """
    conn = _connect()
    with _write_lock:
        conn.execute("BEGIN IMMEDIATE")
        try:
            pending = conn.execute(
                "SELECT COUNT(*) FROM confirm_queue WHERE prescription_id = ?"
                " AND state = 'pending'", (prescription_id,)).fetchone()[0]
            if pending:
                conn.execute("ROLLBACK")
                raise QueueBlockedError(prescription_id, int(pending))
            conn.execute("COMMIT")
        except QueueBlockedError:
            raise
        except Exception:
            conn.execute("ROLLBACK")
            raise
