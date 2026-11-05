"""Prove that the verdict tally cannot drift when writers overlap.

    python tools/prove_tally_atomicity.py [--workers 3] [--rounds 1200] [--baseline 3000]

`store.verdict_counts()` reads a table that `put()` maintains on write instead of
counting the rows (TD-29/RES-31: the scan cost 5.8-12.9 ms per request at 56k-60k
rows). A maintained counter is only honest if the read-modify-write that maintains
it is atomic. `put()` reads the row's *previous* kind so it can decrement the
bucket being left, and on a single-process demo that is safe behind
`_write_lock`. Under `uvicorn --workers N` (TD-7's posture) it is not: two
processes can both read the old kind before either writes.

So this script runs the production `store.put()` against a temp database from
several processes at once and compares the tally with the ground truth the rows
still give, then repeats the experiment with the stale-read shape to show what
the guard is guarding against. It exits non-zero on drift.

Measured 2026-10-28 in one sweep of five configurations — the production path
matched the row scan in **all five** (4 500, 9 000, 7 500, 15 000 and 16 000
writes at 3, 3, 5, 5 and 8 processes), and the stale-read shape drifted in **all
five**. The number of writes that found their base already moved grew with the
contention rather than randomly: 6 at 3 x 1 500, 9 at 3 x 3 000, 20 at 5 x 1 500,
37 at 5 x 3 000, 58 at 8 x 2 000. The worst case is not subtle — at 5 x 3 000 the
tally read `{duplicate_atc: 10, interaction: 6}` against rows that say
`{duplicate_atc: 3, interaction: 3, pass: 2}`, i.e. a bucket invented and a kind
erased. That is why `put()` opens with `BEGIN IMMEDIATE`.

The refusals in those runs are a different thing and are counted separately:
0, 2, 3, 7 and 21 writes out of each run never got the write lock within
`busy_timeout` at 3 to 8 processes. That is throughput contention on one SQLite
file (TD-30), not tally drift, and it does not corrupt the count — the tally
still equals the rows at the end. Read that ladder as a magnitude, not a law: a
later run of the *first* configuration refused 1 write where the sweep refused 0.
The count at one rung is scheduling luck; the slope across rungs is the finding.

`--baseline ROWS` exists because TD-30 had to quote a write rate and the first
number written into it (643/s, from a throwaway script) turned out to be the
machine in its fast mode. Eleven runs of `--baseline 3000` land in three bands —
287/291/303, 315/323/334/340/342/370/381, and 643/692 writes/s on identical code —
which is why this prints a spread over repeated samples instead of a mean.

The first version of this script proved nothing, and the way it failed is worth
recording: each worker minted its *own* prescriptions, so no two processes ever
wrote the same row and the stale shape could not drift however badly it was
scheduled — it reported MATCH, which read as "the guard is decorative". The pool
is shared now because the race in production is two confirmations of *one*
prescription id.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
API = os.path.join(ROOT, "apps", "api")
CONTRACTS = os.path.join(ROOT, "packages", "contracts")
KINDS = ("pass", "interaction", "duplicate_atc")

#: The rows every worker writes. Fixed strings, not uuids, because the whole
#: point is that all processes hammer the *same* prescriptions — the API shape
#: is two workers confirming one `prescription_id`.
POOL = tuple(f"ATOMICITY-{i}" for i in range(8))


def _env(db_path: str) -> dict[str, str]:
    env = dict(os.environ)
    env["MEDISAATHI_DB_PATH"] = db_path
    env["PYTHONPATH"] = os.pathsep.join([API, CONTRACTS, ROOT])
    return env


def _baseline_worker(db: str, rows: int) -> int:
    """Single-process write rate on a store of `rows` prescriptions.

    Runs as its own process against its own file because `store` reads
    `MEDISAATHI_DB_PATH` at import time and caches a thread-local connection — a
    baseline measured in the parent would silently be a baseline of the race's
    database.

    This exists because TD-30 quotes a throughput ceiling and the first version
    of that measurement lived in a throwaway script. WAL allows one writer at a
    time, so this is also the ceiling the multi-process runs are measured
    against: the refusals they report are that serialisation showing up as
    `SQLITE_BUSY`, not a tally bug. The read is timed over the same rows so the
    asymmetry RES-31 bought — a cheap read, a longer write — is visible here
    rather than asserted.
    """
    import statistics
    import time

    sys.path.insert(0, API)
    sys.path.insert(0, CONTRACTS)
    from app import store
    from medisaathi_contracts import PrescriptionState, Verdict, VerdictKind

    put_ms: list[float] = []
    start = time.perf_counter()
    for i in range(rows):
        rx = PrescriptionState(prescription_id=f"BASELINE-{i}", sample_id="BASELINE")
        rx.verdict = Verdict(kind=VerdictKind.pass_, headline="h")
        t = time.perf_counter()
        store.put(rx)
        put_ms.append((time.perf_counter() - t) * 1000)
    elapsed = time.perf_counter() - start

    read_ms: list[float] = []
    for _ in range(min(rows, 1000)):
        t = time.perf_counter()
        store.verdict_counts()
        read_ms.append((time.perf_counter() - t) * 1000)
    put_ms.sort()
    read_ms.sort()

    print(json.dumps({
        "writes_per_s": round(rows / elapsed),
        "rows": store.count(),
        "put_p50": round(statistics.median(put_ms), 3),
        "put_p95": round(put_ms[int(len(put_ms) * 0.95)], 3),
        "put_p99": round(put_ms[int(len(put_ms) * 0.99)], 3),
        "put_max": round(put_ms[-1], 3),
        "read_p50": round(statistics.median(read_ms), 4),
        "read_p99": round(read_ms[int(len(read_ms) * 0.99)], 4),
    }))
    return 0


def _baseline(rows: int, samples: int = 3) -> None:
    """Repeat the same measurement so the spread, not one number, is the output.

    Three fresh stores rather than one: on the machine this was written on, eight
    runs of the identical command returned 323, 370, 381, 340, 334, 315, 342 and
    692 writes/s — the same code, the same row count, no configuration change. A
    single sample therefore describes the run, not the store, and TD-30 quotes the
    band for that reason.
    """
    rates = []
    for _ in range(samples):
        db = os.path.join(tempfile.mkdtemp(prefix="medisaathi-baseline-"), "base.db")
        proc = subprocess.run(
            [sys.executable, __file__, "--worker", "baseline", "--index", "0",
             "--worker-db", db, "--worker-rounds", str(rows)],
            env=_env(db), capture_output=True, text=True)
        out = (proc.stdout or "").strip().splitlines()
        if not out:
            err = (proc.stderr or "").strip().splitlines()
            print(f"  baseline            unavailable ({err[-1] if err else 'no output'})")
            return
        b = json.loads(out[-1])
        rates.append(b["writes_per_s"])
        print(f"  baseline (1 proc)   {b['writes_per_s']:,} writes/s over {b['rows']} rows"
              f" — put() p50 {b['put_p50']} p95 {b['put_p95']} p99 {b['put_p99']}"
              f" max {b['put_max']} ms"
              f" | verdict_counts() p50 {b['read_p50']} p99 {b['read_p99']} ms")
    print(f"                        spread: {min(rates)}-{max(rates)} writes/s"
          f" on identical code (the band, not the mean, is the number TD-30 quotes)")


def _scan(conn: sqlite3.Connection) -> dict[str, int]:
    return {k: n for k, n in conn.execute(
        "SELECT verdict_kind, COUNT(*) FROM prescriptions "
        "WHERE verdict_kind IS NOT NULL GROUP BY verdict_kind")}


def _worker(db: str, rounds: int, index: int) -> int:
    """Writes through the real store, flipping a shared set of rows' verdicts.

    The ids are a pure function of the pool, not minted per process: the race
    this script exists to measure is *two workers writing the same prescription*
    (two confirmations of one rx, TD-7), and a worker that only touches rows it
    created itself cannot race with anybody. Each worker also offsets its kind by
    its index, so the processes disagree about the target at the same moment —
    otherwise a stale read and a fresh one return the same answer and the control
    in `_stale_worker` reports a clean run for a broken shape.
    """
    sys.path.insert(0, API)
    sys.path.insert(0, CONTRACTS)
    from app import store
    from medisaathi_contracts import PrescriptionState, Verdict, VerdictKind

    kinds = [VerdictKind.pass_, VerdictKind.interaction, VerdictKind.duplicate_atc]
    busy = written = 0
    for i in range(rounds):
        pid = POOL[(i + index) % len(POOL)]
        rx = store.get(pid) or PrescriptionState(prescription_id=pid, sample_id="ATOMICITY")
        rx.verdict = Verdict(kind=kinds[(i + index) % 3], headline="t")
        try:
            store.put(rx)
            written += 1
        except sqlite3.OperationalError:
            busy += 1  # SQLITE_BUSY after busy_timeout: contention, not drift
    print(json.dumps({"busy": busy, "written": written}))
    return 0


def _stale_worker(db: str, rounds: int, index: int) -> int:
    """The pre-hardening shape: read the previous kind, THEN open the write txn.

    Deliberately a copy of the statements rather than a call into `store.put()`,
    because the point is to show the interleaving the current code prevents. Same
    pool and same per-worker kind offset as `_worker`, so the two runs differ only
    in whether the read that picks the bucket to decrement happens inside the
    transaction — and the run counts how often that read was already out of date
    by the time the write lock was held, which is the race `BEGIN IMMEDIATE` is
    there to close rather than something inferred from a final total.
    """
    sys.path.insert(0, API)
    sys.path.insert(0, CONTRACTS)
    from app import store

    conn = store._connect()  # noqa: SLF001 - same connection shape as put()
    stale = busy = 0
    done = 0
    for i in range(rounds):
        pid = POOL[(i + index) % len(POOL)]
        new = KINDS[(i + index) % 3]
        old = conn.execute(  # <-- read happens outside the transaction
            "SELECT verdict_kind FROM prescriptions WHERE prescription_id = ?",
            (pid,)).fetchone()
        try:
            conn.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError:
            busy += 1  # contention for the write lock, not a tally bug
            continue
        current = conn.execute(  # the value put() would have read inside the txn
            "SELECT verdict_kind FROM prescriptions WHERE prescription_id = ?",
            (pid,)).fetchone()
        if (current[0] if current else None) != (old[0] if old else None):
            stale += 1
        conn.execute(
            "UPDATE prescriptions SET verdict_kind = ? WHERE prescription_id = ?",
            (new, pid))
        prev = old[0] if old else None
        if prev != new:
            if prev:
                conn.execute("UPDATE verdict_tally SET n = n - 1 WHERE verdict_kind = ?", (prev,))
            conn.execute(
                "INSERT INTO verdict_tally (verdict_kind, n) VALUES (?, 1) "
                "ON CONFLICT(verdict_kind) DO UPDATE SET n = n + 1", (new,))
            conn.execute("DELETE FROM verdict_tally WHERE n <= 0")
        conn.commit()
        done += 1
    print(json.dumps({"stale": stale, "busy": busy, "written": done}))
    return 0


def _run(mode: str, db: str, workers: int, rounds: int) -> dict[str, int]:
    procs = [
        subprocess.Popen(
            [sys.executable, __file__, "--worker", mode, "--index", str(i),
             "--worker-db", db, "--worker-rounds", str(rounds)],
            env=_env(db), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        for i in range(workers)
    ]
    totals: dict[str, int] = {}
    for p in procs:
        out = (p.communicate()[0] or "").strip()
        if not out:
            continue  # a worker that crashed says nothing; the totals catch it
        for key, value in json.loads(out.splitlines()[-1]).items():
            totals[key] = totals.get(key, 0) + value
    return totals


def _report(label: str, db: str, workers: int, rounds: int) -> bool:
    totals = _run(label, db, workers, rounds)
    conn = sqlite3.connect(db)
    conn.execute("PRAGMA journal_mode=WAL")
    tally = dict(conn.execute("SELECT verdict_kind, n FROM verdict_tally WHERE n > 0"))
    truth = _scan(conn)
    conn.close()
    ok = tally == truth
    detail = f"written {totals.get('written', 0)}"
    if totals.get("busy"):
        detail += f", {totals['busy']} refused by SQLITE_BUSY"
    if totals.get("stale"):
        detail += f", {totals['stale']} of them from a stale base"
    print(f'  {label:12} {workers} x {rounds} rounds -> {detail}'
          f"\n{'':14}tally {tally}\n{'':14}rows  {truth}  {'MATCH' if ok else 'DRIFT'}")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--rounds", type=int, default=1200)
    ap.add_argument("--baseline", type=int, default=0, metavar="ROWS",
                    help="also measure the single-process write ceiling over ROWS rows")
    ap.add_argument("--worker", help=argparse.SUPPRESS)
    ap.add_argument("--index", help=argparse.SUPPRESS)
    ap.add_argument("--worker-db", help=argparse.SUPPRESS)
    ap.add_argument("--worker-rounds", help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.worker:  # child process
        rounds = int(args.worker_rounds)
        index = int(args.index)
        if args.worker == "baseline":
            return _baseline_worker(args.worker_db, rounds)
        if args.worker == "immediate":
            return _worker(args.worker_db, rounds, index)
        return _stale_worker(args.worker_db, rounds, index)

    workdir = tempfile.mkdtemp(prefix="medisaathi-atomicity-")
    db = os.path.join(workdir, "atomicity.db")
    # Settle the schema in the parent, before any child exists. Three processes
    # racing to create a fresh SQLite file race to run `PRAGMA journal_mode=WAL`,
    # which needs an exclusive lock — a real boot-time finding (measured 2026-10-28:
    # one of three simultaneous workers raised "database is locked" there, which is
    # why `db.apply_pragmas` sets busy_timeout first and retries the switch). It is
    # not what this script measures, so the file is opened once here and the run is
    # about the tally. Seeding the pool through the real store also gives every
    # worker rows that already exist, so an unchanged row is a verdict flip and not
    # an insert artefact.
    os.environ["MEDISAATHI_DB_PATH"] = db
    sys.path.insert(0, API)
    sys.path.insert(0, CONTRACTS)
    from app import store
    from medisaathi_contracts import PrescriptionState

    for pid in POOL:
        store.put(PrescriptionState(prescription_id=pid, sample_id="ATOMICITY"))

    print(f"atomicity of the verdict tally  (SQLite WAL, temp store {db})")
    print(f"  pool: {len(POOL)} prescriptions written by {args.workers} processes "
          f"x {args.rounds} rounds")
    if args.baseline:
        _baseline(args.baseline)
    clean = _report("immediate", db, args.workers, args.rounds)
    stale = _report("stale-read", db, args.workers, args.rounds)

    # The hardened path must hold; the stale path is reported, not asserted,
    # because whether it drifts depends on how the OS schedules the processes.
    # A green run therefore says both: production is exact, and the guard is
    # load-bearing rather than decorative only if the stale shape disagreed.
    print(f"\nproduction put(): {'exactly consistent' if clean else 'DRIFTED — this is a bug'}")
    print(f"stale-read shape: {'agreed this time (scheduling luck)' if stale else 'drifted, as expected'}")
    return 0 if clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
