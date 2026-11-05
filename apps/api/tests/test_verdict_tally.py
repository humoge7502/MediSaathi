"""The verdict tally must equal the ground truth it replaced (TD-29).

`/metrics` used to answer `verdict_counts()` with a `GROUP BY` over every stored
row. That aggregate is O(rows) — measured at 2.2-3.0 ms p50 on an empty store
against 5.8-12.9 ms at 56k-60k rows, while `/healthz` and a framework-free probe
were unchanged across both groups (docs/PERFORMANCE.md). The counts now live in a
table `put()` maintains transactionally, which trades a scan on read for one
indexed primary-key lookup on write.

These tests pin the two ways that trade can be gotten wrong: the tally drifting
from the rows (an upsert that forgets to decrement the bucket it is leaving), and
the read quietly becoming a scan again. Nothing here measures milliseconds — a
timing assertion on this machine is noise at 1 ms and would fail for the wrong
reason.
"""
from __future__ import annotations

import sqlite3

import pytest
from app import store
from medisaathi_contracts import Verdict, VerdictKind


@pytest.fixture
def isolated_store(tmp_path, monkeypatch):
    """Point the store at an empty database for one test.

    The rest of the suite writes into `apps/medisaathi.db`, which is how the
    development store reached 60k rows and why `/metrics` timings drifted between
    runs. `_DB_PATH` is read at *call* time inside `_connect()`, so patching the
    module attribute plus dropping the thread-local connection is enough — but
    the stale connection has to be closed first or this thread keeps talking to
    the old file.
    """
    stale = getattr(store._local, "conn", None)  # noqa: SLF001 - the store's own thread state
    if stale is not None:
        stale.close()
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "tally.db"))  # noqa: SLF001
    store._local.__dict__.pop("conn", None)  # noqa: SLF001
    yield tmp_path / "tally.db"
    live = getattr(store._local, "conn", None)  # noqa: SLF001
    if live is not None:
        live.close()
    store._local.__dict__.pop("conn", None)  # noqa: SLF001


def _ground_truth() -> dict[str, int]:
    """The O(rows) answer, straight from the rows — the oracle, not the optimisation."""
    conn = store._connect()  # noqa: SLF001
    return {
        kind: n
        for kind, n in conn.execute(
            "SELECT verdict_kind, COUNT(*) FROM prescriptions "
            "WHERE verdict_kind IS NOT NULL GROUP BY verdict_kind"
        )
    }


def _verdict(kind: VerdictKind) -> Verdict:
    return Verdict(kind=kind, headline="t")


def _write(sample: str, kind: VerdictKind | None) -> str:
    rx = store.create(sample)
    if kind is not None:
        rx.verdict = _verdict(kind)
        store.put(rx)
    return rx.prescription_id


def test_tally_equals_the_row_scan_after_plain_writes(isolated_store):
    for kind in (VerdictKind.pass_, VerdictKind.pass_, VerdictKind.interaction):
        _write("RX-TALLY-A", kind)
    _write("RX-TALLY-A", None)  # created, never verdicted: contributes to no bucket

    assert store.verdict_counts() == _ground_truth() == {"pass": 2, "interaction": 1}


def test_replacing_a_verdict_moves_one_unit_not_two(isolated_store):
    """The upsert case the old scan got for free and a naive tally gets wrong.

    `/api/plans` creates a state and the pipeline re-puts it with a verdict; the
    confirm route puts it again with another. A tally that only ever increments
    would report a verdict for a prescription that no longer has it, and the
    count would grow without any row being added.
    """
    pid = _write("RX-TALLY-B", VerdictKind.pass_)

    rx = store.get(pid)
    rx.verdict = _verdict(VerdictKind.confirm_queue)
    store.put(rx)
    after_replace = store.verdict_counts()
    # The emptied bucket drops out entirely, which is what the old GROUP BY did:
    # a kind with no rows was never in the answer, so the UI has no zero case.
    assert after_replace == _ground_truth() == {"confirm_queue": 1}

    store.put(rx)  # identical re-put: idempotent, must not double count
    assert store.verdict_counts() == after_replace == _ground_truth()

    rx.verdict = None  # verdict cleared: the bucket must empty and drop out
    store.put(rx)
    assert store.verdict_counts() == _ground_truth() == {}


def test_tally_seeds_from_a_database_written_before_it_existed(isolated_store):
    """Pre-v4 files have verdicts and no tally; the first open must count them.

    Silently reporting zeros here would be worse than the scan: `/metrics` would
    look healthy and be wrong.
    """
    db = str(isolated_store)
    live = getattr(store._local, "conn", None)  # noqa: SLF001
    if live is not None:
        live.close()
    store._local.__dict__.pop("conn", None)  # noqa: SLF001

    legacy = sqlite3.connect(db)
    legacy.executescript(store._INIT)  # noqa: SLF001 - the v3 schema, as it was
    for i, kind in enumerate(("pass", "pass", "interaction", None)):
        legacy.execute(
            "INSERT INTO prescriptions (prescription_id, sample_id, state, verdict_kind) "
            "VALUES (?, ?, ?, ?)",
            (f"legacy-{i}", f"RX-{i}", "{}", kind),
        )
    legacy.commit()
    legacy.close()

    assert store.verdict_counts() == {"pass": 2, "interaction": 1}
    conn = store._connect()  # noqa: SLF001
    assert conn.execute("SELECT COUNT(*) FROM prescriptions").fetchone()[0] == 4

    # Seeding is recorded, not inferred: a second open must not re-scan the rows.
    live = getattr(store._local, "conn", None)  # noqa: SLF001
    live.close()
    store._local.__dict__.pop("conn", None)  # noqa: SLF001
    assert store.verdict_counts() == {"pass": 2, "interaction": 1}
    seeded = store._connect().execute(  # noqa: SLF001
        "SELECT value FROM store_meta WHERE key = 'tally_seeded'"
    ).fetchone()
    assert seeded == ("1",)


def test_the_metrics_read_never_touches_the_row_table(isolated_store):
    """A query-plan guard against the optimisation quietly becoming a scan again.

    This plans the *production* statement (`store._TALLY_READ`) rather than a copy
    in this file, so editing `verdict_counts()` back to a `GROUP BY` over
    `prescriptions` fails here instead of in a customer's p95.
    """
    _write("RX-TALLY-C", VerdictKind.duplicate_atc)
    plan = " ".join(
        row[3]
        for row in store._connect().execute(  # noqa: SLF001
            f"EXPLAIN QUERY PLAN {store._TALLY_READ}"  # noqa: SLF001
        )
    )
    assert "prescriptions" not in plan, f"/metrics read reached the row table: {plan}"
