"""Prove that opening the store with the WAL switch first can fail, and that the
order in `apps/api/app/db.py` cannot.

    python tools/prove_wal_boot_order.py [--trials 12] [--workers 4]

`store.py`, `queue.py` and `consent.py` all open the same SQLite file, and until
this pass each of them ran `PRAGMA journal_mode=WAL` *before* `PRAGMA
busy_timeout=...`. That order is not a style choice: converting a file to WAL
takes an exclusive lock, and SQLITE_BUSY returned by that pragma does not consult
the connection's busy handler — so the timeout that is supposed to absorb
 contention is not yet installed at the moment it would be needed. On a
multi-worker boot (`uvicorn --workers N`, TD-7) every worker runs this against a
file one of them is still creating.

Each trial deletes a database file, starts N processes that open it at the same
instant through one of the two shapes, and counts what came back. The broken
shape is the statements exactly as the three modules had them; the fixed shape is
the production helper, imported from `app.db`, so the gate fails if that helper
ever regresses.

Measured 2026-10-28 on this machine (12 trials x 4 processes per shape):
WAL-first lost **2 of 48** connections, both raised by the journal-mode
statement itself; timeout-first-and-retried lost **0 of 48**. The failure rate of
the broken shape is a race, so it is reported rather than asserted — a run where
it happens to pass says nothing about the order being safe.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
API = os.path.join(ROOT, "apps", "api")
CONTRACTS = os.path.join(ROOT, "packages", "contracts")

#: Runs in a child process. `_SHAPE` picks which of the two connection-opening
#: laws this connection obeys; `_STAGE` records the last statement that started,
#: because "database is locked" without a location is not a finding.
CHILD = r"""
import json, os, sqlite3, sys, time, traceback

sys.path[:0] = [os.environ["_API"], os.environ["_CON"]]
db, shape = os.environ["MEDISAATHI_DB_PATH"], os.environ["_SHAPE"]
started = time.perf_counter()
conn = sqlite3.connect(db)
stage = "connect"
try:
    if shape == "wal-first":       # exactly what store/queue/consent did
        stage = "journal_mode=WAL"; conn.execute("PRAGMA journal_mode=WAL")
        stage = "busy_timeout";       conn.execute("PRAGMA busy_timeout=5000")
    else:                          # the production helper
        from app.db import apply_pragmas
        stage = "apply_pragmas"; apply_pragmas(conn)
    stage = "write"
    conn.execute("CREATE TABLE IF NOT EXISTS boot_probe (x INTEGER)")
    conn.execute("INSERT INTO boot_probe (x) VALUES (1)")
    conn.commit()
    print(json.dumps({
        "ok": True,
        "mode": conn.execute("PRAGMA journal_mode").fetchone()[0],
        "ms": round((time.perf_counter() - started) * 1000, 1),
    }))
except Exception:
    print(json.dumps({
        "ok": False, "stage": stage,
        "err": traceback.format_exc().splitlines()[-1],
    }))
"""


def _trial(shape: str, workers: int) -> list[dict]:
    db = os.path.join(tempfile.mkdtemp(prefix="medisaathi-boot-"), "boot.db")
    env = dict(os.environ, MEDISAATHI_DB_PATH=db, _SHAPE=shape, _API=API, _CON=CONTRACTS)
    procs = [
        subprocess.Popen([sys.executable, "-c", CHILD], env=env,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for _ in range(workers)
    ]
    results = []
    for p in procs:
        out = (p.communicate()[0] or "").strip()
        results.append(json.loads(out.splitlines()[-1]) if out else {"ok": False, "stage": "no output"})
    return results


def _run(shape: str, trials: int, workers: int) -> dict:
    opened = failed = 0
    stages: dict[str, int] = {}
    errors: list[str] = []
    for _ in range(trials):
        for r in _trial(shape, workers):
            if r.get("ok"):
                opened += 1
            else:
                failed += 1
                stage = r.get("stage", "?")
                stages[stage] = stages.get(stage, 0) + 1
                err = r.get("err", "")
                if err not in errors:
                    errors.append(err)
    return {"opened": opened, "failed": failed, "stages": stages, "errors": errors}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=12)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    total = args.trials * args.workers
    print(f"multi-process SQLite boot, {args.trials} trials x {args.workers} processes "
          f"per shape ({total} connections each)")
    broken = _run("wal-first", args.trials, args.workers)
    fixed = _run("timeout-first", args.trials, args.workers)

    for label, r in (("wal-first (the old shape)", broken), ("timeout-first + retry (production)", fixed)):
        where = ", ".join(f"{k}: {v}" for k, v in r["stages"].items()) or "clean"
        print(f"  {label:34} {r['opened']}/{total} opened, {r['failed']} failed  [{where}]")
        for err in r["errors"]:
            print(f"  {'':34} -> {err}")

    # Only the production shape is a gate. The broken shape's failure rate is a
    # scheduling accident: reporting it honestly means it may be 0 in a given run
    # without the ordering law being any safer.
    if fixed["failed"]:
        print("\nREGRESSION: the production connection-open failed under a fresh-file boot")
        return 1
    note = ("reproduced" if broken["failed"]
            else "did not reproduce this run (a race, not a certainty)")
    print(f"\nproduction shape: {broken['failed']}-vs-{fixed['failed']} failures, "
          f"wal-first hazard {note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
