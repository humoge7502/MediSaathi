"""The file-level SQLite laws, shared by every module that opens the store.

`store.py`, `queue.py` and `consent.py` all point at the same SQLite file
(`MEDISAATHI_DB_PATH`), so the rules about *how a connection is opened* belong
here rather than being written three times — and, unlike the repository APIs
around them, they are not part of the Postgres swap surface.

The one rule that was silently wrong until it was measured:

    PRAGMA journal_mode=WAL  needs an exclusive lock, and SQLITE_BUSY from this
    specific pragma is returned WITHOUT consulting the connection's busy handler.

So a connection that switches the journal mode before setting `busy_timeout` can
fail on its very first statement, no matter how generous the timeout is meant to
be — and on a multi-worker boot (`uvicorn --workers N`, TD-7) several processes
run this against a file one of them is still creating.

Measured 2026-10-28 with `tools/prove_wal_boot_order.py`, which opens a deleted
file from N processes at once in both shapes: across three 30-trial x 4-process
runs the WAL-first order lost **3 of 360 connections**, every one of them raised
by the journal-mode statement itself, and the order below lost **0 of 360**. One
of those three runs was clean for both shapes — this is a rare race, not a
reliable crash, which is exactly why it survived until something was built to look
for it, and why the tool reports a clean run rather than asserting the hazard must
fire. It is a boot-time hazard (every worker opening the file at once), not a
request-path one.
"""
from __future__ import annotations

import sqlite3
import time

BUSY_TIMEOUT_MS = 5000
_WAL_ATTEMPTS = 5
_WAL_BACKOFF_S = 0.05


def apply_pragmas(conn: sqlite3.Connection) -> None:
    """Order matters: the timeout goes on first, then the WAL switch, retried.

    Retrying rather than falling through is deliberate. Continuing in rollback
    mode would leave the file's durability and concurrency characteristics up to
    how the processes happened to interleave, and then no latency number in
    `docs/PERFORMANCE.md` would describe the database the test actually ran
    against. Five attempts spanning ~1.5 s is a bounded worst case for a boot,
    and a real failure still surfaces as one.
    """
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    last: sqlite3.OperationalError | None = None
    for attempt in range(_WAL_ATTEMPTS):
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            return
        except sqlite3.OperationalError as exc:
            last = exc
            time.sleep(_WAL_BACKOFF_S * (2 ** attempt))
    assert last is not None  # the loop body assigns before it can exhaust
    raise last
