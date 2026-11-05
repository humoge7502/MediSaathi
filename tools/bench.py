"""API latency benchmark: p50/p95/p99 under three transports, plus a bare-app
probe that says how much of each number is the framework.

Why two: the September and October runs of this tool disagreed by 5x, and the
single number it reports cannot say which side of the socket the cost moved to.
`asgi` calls the app in-process through httpx's ASGI transport - no socket, no
serialization, so it isolates application work (middleware, validation, rule
engine, store). `live` boots uvicorn on a loopback port and speaks real HTTP to
it, so it carries the TCP + HTTP/1.1 framing floor as well. The delta between
the two p50s on `/healthz` - an endpoint that runs no rule work - is that floor;
everything above it in the `live` column is the request path. Run both sides
before and after any optimization, and quote the column, not a lone number.

Why the bare probe: `/healthz` is a poor noise floor, because it runs through
the exact stack a FastAPI or Starlette upgrade replaces - routing, the
BaseHTTPMiddleware chain, response serialisation. When it moves, the machine and
the framework are both candidates and one run cannot tell them apart. `_noop` is
a raw ASGI 3 callable with no framework in it at all, so `asgi(noop)` is what
this machine costs to move a request through an event loop, and
`asgi(/healthz) - asgi(noop)` is the framework's own cost - the number an
upgrade is supposed to move.

Usage (repo root):
  python tools/bench.py [--requests 400] [--transport asgi|live|both] [--json] [--out PATH]
  (`--transport both` is the TD-25 split; the default is `asgi`, which is what
  the recorded September and October tables and the E-F run used.)
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import importlib.metadata
import json
import os
import shutil
import socket
import statistics
import sys
import tempfile
import threading
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.join(ROOT, "packages", "contracts"))

# Generous local rate limits so the benchmark measures latency, not the limiter.
os.environ.setdefault("MEDISAATHI_RATE_WRITE", "100000")
os.environ.setdefault("MEDISAATHI_RATE_READ", "100000")

import uvicorn  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

_APP = None


def get_app():
    """Import the application on first use.

    Not a style choice: `app/store.py` reads `MEDISAATHI_DB_PATH` at import time,
    so a top-level `from app.main import app` freezes the store before `--fresh-db`
    can point it somewhere else. The app must be imported after argparse.
    """
    global _APP
    if _APP is None:
        from app.main import app
        _APP = app
    return _APP

CASES = ["RX-001", "RX-002", "RX-004", "RX-008", "RX-009", "RX-012"]

# Requests made per endpoint before timing starts. Module import loads the
# engine tables; the first request through each route still pays for lazy
# per-route work (schema build, response model compile). Ten is enough to clear
# that without letting it land in a 400-sample p50.
WARMUP = 10

NOOP_NAME = "GET /noop (bare ASGI app - no framework)"


async def _noop(scope, receive, send):  # noqa: ARG001 - `receive` is read only for lifespan
    """A raw ASGI 3 callable: no FastAPI, no routing, no middleware, no Pydantic.

    Answers the lifespan handshake too, because uvicorn sends it before it will
    serve a single request. Everything this costs is the machine's: an event-loop
    turn, a response object, and for `live` the socket.
    """
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    await send({
        "type": "http.response.start",
        "status": 200,
        "headers": [(b"content-type", b"text/plain"), (b"content-length", b"2")],
    })
    await send({"type": "http.response.body", "body": b"ok"})


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    k = max(0, min(len(sorted_vals) - 1, round(p / 100 * (len(sorted_vals) - 1))))
    return sorted_vals[k]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def live_server(application=None):
    """uvicorn on a loopback port, in this process, so the machine is the same."""
    application = application or get_app()
    port = free_port()
    server = uvicorn.Server(
        uvicorn.Config(application, host="127.0.0.1", port=port, log_level="error", loop="asyncio")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 60
    while not server.started:
        if time.time() > deadline:
            raise RuntimeError("uvicorn did not start within 60s")
        time.sleep(0.05)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=15)


def bench_sync(client, name: str, fn, requests: int) -> dict:
    for _ in range(WARMUP):
        fn(client)
    lat: list[float] = []
    for _ in range(requests):
        t0 = time.perf_counter()
        fn(client)
        lat.append((time.perf_counter() - t0) * 1000)
    return summarize(name, lat)


async def bench_async(client, name: str, fn, requests: int) -> dict:
    """Same law as `bench_sync`, against an awaitable client."""
    for _ in range(WARMUP):
        await fn(client)
    lat: list[float] = []
    for _ in range(requests):
        t0 = time.perf_counter()
        await fn(client)
        lat.append((time.perf_counter() - t0) * 1000)
    return summarize(name, lat)


def summarize(name: str, lat: list[float]) -> dict:
    lat.sort()
    return {
        "endpoint": name,
        "n": len(lat),
        "p50_ms": round(percentile(lat, 50), 3),
        "p95_ms": round(percentile(lat, 95), 3),
        "p99_ms": round(percentile(lat, 99), 3),
        "max_ms": round(lat[-1], 3),
        "mean_ms": round(statistics.mean(lat), 3),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--requests", type=int, default=400)
    ap.add_argument("--transport", choices=["asgi", "live", "testclient", "both", "all"], default="asgi")
    ap.add_argument("--json", action="store_true", dest="as_json")
    ap.add_argument(
        "--out",
        metavar="PATH",
        help="write the --json payload to PATH instead of stdout. The app logs "
        "JSON lines on stdout (app/obs.py), so a redirected benchmark file "
        "otherwise arrives as log noise with one JSON blob at the end — and "
        "the per-request writes into that same file are part of what is timed.",
    )
    ap.add_argument(
        "--fresh-db",
        action="store_true",
        dest="fresh_db",
        help="run against an empty SQLite file in a temp dir instead of the "
        "development store. Every timed pipeline request writes a row, so "
        "without this the table a run measures is whatever previous runs left "
        "behind, and two runs of the same code are not comparable.",
    )
    args = ap.parse_args()

    # `--out` implies `--json`. Without this, asking for a file and forgetting the
    # switch ran the whole benchmark and wrote nothing at all — measured, not
    # guessed: four 150-request runs completed with rc=0 and left no artifact.
    if args.out:
        args.as_json = True

    # The store is a variable, not a constant. Every timed pipeline request
    # inserts a row, so a bench run on a table four weeks of runs built measures
    # a different table than the run whose numbers are in docs/PERFORMANCE.md —
    # and `/metrics` scans that table's index. `--fresh-db` pins the starting
    # point; the row count is reported either way so a quoted number carries the
    # size of the store it was taken against.
    fresh_dir = None
    if args.fresh_db:
        fresh_dir = tempfile.mkdtemp(prefix="medisaathi-bench-")
        os.environ["MEDISAATHI_DB_PATH"] = os.path.join(fresh_dir, "bench.db")

    # Imported only now, so the store this run measures is the one the flags chose.
    from app import store as store_mod
    rows_at_start = store_mod.count()

    def calls() -> list[tuple[str, object]]:
        out = [
            ("GET /healthz", lambda c: c.get("/healthz")),
            ("GET /metrics (verdict tally, O(kinds))", lambda c: c.get("/metrics")),
            ("GET /formulary/search?q=par", lambda c: c.get("/api/v1/formulary/search?q=par")),
        ]
        for sid in CASES:
            ctx = "&context=age_under_12" if sid == "RX-009" else ""
            out.append((
                f"POST /prescriptions {sid} (full pipeline)",
                lambda c, sid=sid, ctx=ctx: c.post(f"/api/v1/prescriptions?sample_id={sid}{ctx}"),
            ))
        return out

    async def noop_asgi() -> dict:
        async with AsyncClient(transport=ASGITransport(app=_noop), base_url="http://bench", timeout=60.0) as c:
            return await bench_async(c, NOOP_NAME, lambda cc: cc.get("/noop"), args.requests)

    async def over_asgi() -> list[dict]:
        # AsyncClient + ASGITransport: the app object is called directly in this
        # loop. No socket, no portal thread — so the number is the request path.
        async with AsyncClient(transport=ASGITransport(app=get_app()), base_url="http://bench", timeout=60.0) as c:
            return [await bench_async(c, n, f, args.requests) for n, f in calls()]

    async def over_socket(base: str) -> list[dict]:
        async with AsyncClient(base_url=base, timeout=60.0) as c:
            return [await bench_async(c, n, f, args.requests) for n, f in calls()]

    async def noop_socket(base: str) -> dict:
        async with AsyncClient(base_url=base, timeout=60.0) as c:
            return await bench_async(c, NOOP_NAME, lambda cc: cc.get("/noop"), args.requests)

    # The bare probe runs next to each transport, not once, so a machine that got
    # busier halfway through the run shows up in that transport's delta.
    bare: dict[str, dict] = {}
    wanted = {"both": ["asgi", "live"], "all": ["asgi", "live", "testclient"]}.get(
        args.transport, [args.transport])
    runs: dict[str, list[dict]] = {}
    if "asgi" in wanted:
        bare["asgi"] = asyncio.run(noop_asgi())
        runs["asgi"] = asyncio.run(over_asgi())
    if "live" in wanted:
        with live_server(_noop) as noop_base:
            bare["live"] = asyncio.run(noop_socket(noop_base))
        with live_server() as base:
            runs["live"] = asyncio.run(over_socket(base))
    if "testclient" in wanted:
        # Starlette's TestClient: the harness the September and October tables
        # were measured with. Kept as its own column because its per-request
        # anyio portal is a cost the deployed server never pays, and TD-25 is
        # precisely a question about which side of that line the time moved to.
        tc_noop = TestClient(_noop)
        bare["testclient"] = bench_sync(tc_noop, NOOP_NAME, lambda c: c.get("/noop"), args.requests)
        tc_noop.close()
        tc = TestClient(get_app())
        runs["testclient"] = [bench_sync(tc, n, f, args.requests) for n, f in calls()]
        tc.close()

    def p50(transport: str) -> float | None:
        rows = runs.get(transport)
        if not rows:
            return None
        return next((r["p50_ms"] for r in rows if r["endpoint"] == "GET /healthz"), None)

    def bare_p50(transport: str) -> float | None:
        row = bare.get(transport)
        return None if row is None else row["p50_ms"]

    # What the framework itself costs, per transport: /healthz runs the whole
    # middleware + routing + serialisation stack, the bare app runs none of it.
    # This is the column a FastAPI or Starlette version change is supposed to move.
    framework = [
        {
            "transport": t,
            "bare_p50_ms": bare_p50(t),
            "healthz_p50_ms": p50(t),
            "framework_overhead_ms": round(p50(t) - bare_p50(t), 3),
        }
        for t in wanted
        if p50(t) is not None and bare_p50(t) is not None
    ]

    store = {
        "path": store_mod._DB_PATH,  # noqa: SLF001 - the bench reports what it measured
        "db_path_env": os.environ.get("MEDISAATHI_DB_PATH", "(default)"),
        "fresh_db": bool(fresh_dir),
        "rows_at_start": rows_at_start,
        "rows_at_end": store_mod.count(),
        "bytes_at_end": (
            os.path.getsize(store_mod._DB_PATH) if os.path.exists(store_mod._DB_PATH) else 0
        ),
        "versions": {
            "fastapi": importlib.metadata.version("fastapi"),
            "starlette": importlib.metadata.version("starlette"),
            "uvicorn": importlib.metadata.version("uvicorn"),
            "httpx": importlib.metadata.version("httpx"),
            "python": sys.version.split()[0],
        },
    }

    # The transport floor: what the socket + HTTP framing costs on the cheapest
    # possible endpoint. Stated as a delta so a reader can subtract it. The
    # `bare_*` pair is the same subtraction on the framework-free app, which is
    # the purer floor: no routing, no middleware, no response model.
    asgi_p50, live_p50, client_p50 = p50("asgi"), p50("live"), p50("testclient")
    floor = ({"asgi_p50_ms": asgi_p50, "live_p50_ms": live_p50,
              "delta_ms": round(live_p50 - asgi_p50, 3)}
             if asgi_p50 is not None and live_p50 is not None else None)
    harness = ({"asgi_p50_ms": asgi_p50, "testclient_p50_ms": client_p50,
                "delta_ms": round(client_p50 - asgi_p50, 3)}
               if asgi_p50 is not None and client_p50 is not None else None)
    if floor and bare_p50("asgi") is not None and bare_p50("live") is not None:
        floor["bare_asgi_p50_ms"] = bare_p50("asgi")
        floor["bare_live_p50_ms"] = bare_p50("live")
        floor["bare_delta_ms"] = round(bare_p50("live") - bare_p50("asgi"), 3)
    if harness and bare_p50("asgi") is not None and bare_p50("testclient") is not None:
        harness["bare_asgi_p50_ms"] = bare_p50("asgi")
        harness["bare_testclient_p50_ms"] = bare_p50("testclient")
        harness["bare_delta_ms"] = round(bare_p50("testclient") - bare_p50("asgi"), 3)

    if args.as_json:
        # `results` keeps v0's shape and v0's meaning — the in-process ASGI rows,
        # application work only — because `tools/run_experiments.py` (E-F) and
        # `tools/export_evidence.py` both read that flat list. The socket rows are
        # a new field, not a redefinition of the old one.
        primary = runs.get("asgi") or runs.get("live") or []
        payload = {
            "benchmark": "medisaathi-api-bench-v1",
            "transport": "asgi-in-process" if "asgi" in runs else "loopback-http",
            "requests_per_endpoint": args.requests,
            "warmup_per_endpoint": WARMUP,
            "results": primary,
        }
        if "live" in runs:
            payload["live_results"] = runs["live"]
        if "testclient" in runs:
            payload["testclient_results"] = runs["testclient"]
        if floor:
            payload["transport_floor"] = floor
        if harness:
            payload["harness_floor"] = harness
        payload["bare_app"] = {t: r for t, r in bare.items()}
        payload["framework_overhead"] = framework
        payload["store"] = store
        text = json.dumps(payload, indent=2)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as fh:
                fh.write(text + "\n")
        else:
            print(text)
        if fresh_dir:
            shutil.rmtree(fresh_dir, ignore_errors=True)
        return 0

    LABELS = {
        "asgi": "in-process ASGI — application work only",
        "live": "loopback HTTP — application work + socket floor",
        "testclient": "starlette TestClient — application work + anyio portal per request",
    }
    for transport, results in runs.items():
        w = max(len(r["endpoint"]) for r in results)
        print(f"\n{LABELS[transport]}  (n={args.requests}, warmup={WARMUP})")
        print(f"{'endpoint':{w}} {'p50':>8} {'p95':>8} {'p99':>8} {'max':>8}  (ms)")
        b = bare.get(transport)
        if b:
            print(f"{b['endpoint']:{w}} {b['p50_ms']:>8} {b['p95_ms']:>8} {b['p99_ms']:>8} {b['max_ms']:>8}")
        for r in results:
            print(f"{r['endpoint']:{w}} {r['p50_ms']:>8} {r['p95_ms']:>8} {r['p99_ms']:>8} {r['max_ms']:>8}")

    for row in framework:
        print(f"\nframework cost ({row['transport']}): bare app {row['bare_p50_ms']} ms -> "
              f"/healthz {row['healthz_p50_ms']} ms  (stack {row['framework_overhead_ms']} ms)")

    if floor and "bare_delta_ms" in floor:
        print(f"socket floor (bare app p50): asgi {floor['bare_asgi_p50_ms']} ms -> "
              f"live {floor['bare_live_p50_ms']} ms  (delta {floor['bare_delta_ms']} ms)")
    if harness and "bare_delta_ms" in harness:
        print(f"portal floor (bare app p50): asgi {harness['bare_asgi_p50_ms']} ms -> "
              f"TestClient {harness['bare_testclient_p50_ms']} ms  "
              f"(delta {harness['bare_delta_ms']} ms)")
    if floor:
        print(f"\nsocket floor (/healthz p50): asgi {floor['asgi_p50_ms']} ms -> "
              f"live {floor['live_p50_ms']} ms  (delta {floor['delta_ms']} ms)")
    if harness:
        print(f"harness floor (/healthz p50): asgi {harness['asgi_p50_ms']} ms -> "
              f"TestClient {harness['testclient_p50_ms']} ms  (delta {harness['delta_ms']} ms)")
    v = store["versions"]
    print(f"\nstore: {store['rows_at_start']} rows at start -> {store['rows_at_end']} at end, "
          f"{store['bytes_at_end'] // 1024} KiB, fresh_db={store['fresh_db']}")
    print("versions: " + ", ".join(f"{k} {x}" for k, x in v.items()))
    if fresh_dir:
        shutil.rmtree(fresh_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
