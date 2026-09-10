"""API latency benchmark: p50/p95/p99 over the real HTTP stack.

Uses ASGI transport (no network socket) so numbers isolate application work -
middleware, validation, rule engine, store - from TCP/TLS noise. That is the
number that reflects code changes. Run it before and after any optimization.

Usage (repo root):  python tools/bench.py [--requests 400] [--json]
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.join(ROOT, "packages", "contracts"))

# Generous local rate limits so the benchmark measures latency, not the limiter.
os.environ.setdefault("MEDISAATHI_RATE_WRITE", "100000")
os.environ.setdefault("MEDISAATHI_RATE_READ", "100000")

from app.main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

CASES = ["RX-001", "RX-002", "RX-004", "RX-008", "RX-009", "RX-012"]


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    k = max(0, min(len(sorted_vals) - 1, round(p / 100 * (len(sorted_vals) - 1))))
    return sorted_vals[k]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--requests", type=int, default=400)
    ap.add_argument("--json", action="store_true", dest="as_json")
    args = ap.parse_args()

    c = TestClient(app)

    def bench(name: str, fn) -> dict:
        lat: list[float] = []
        for _ in range(args.requests):
            t0 = time.perf_counter()
            fn()
            lat.append((time.perf_counter() - t0) * 1000)
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

    results = [
        bench("GET /healthz", lambda: c.get("/healthz")),
        bench("GET /metrics (O(1) GROUP BY)", lambda: c.get("/metrics")),
        bench("GET /formulary/search?q=par", lambda: c.get("/api/v1/formulary/search?q=par")),
    ]

    for sid in CASES:
        ctx = "&context=age_under_12" if sid == "RX-009" else ""
        results.append(bench(
            f"POST /prescriptions {sid} (full pipeline)",
            lambda sid=sid, ctx=ctx: c.post(f"/api/v1/prescriptions?sample_id={sid}{ctx}")))

    if args.as_json:
        print(json.dumps({
            "benchmark": "medisaathi-api-bench-v0",
            "transport": "asgi-in-process",
            "requests_per_endpoint": args.requests,
            "results": results,
        }, indent=2))
        return 0

    w = max(len(r["endpoint"]) for r in results)
    print(f"{'endpoint':{w}} {'p50':>8} {'p95':>8} {'p99':>8} {'max':>8}  (ms, n={args.requests})")
    for r in results:
        print(f"{r['endpoint']:{w}} {r['p50_ms']:>8} {r['p95_ms']:>8} {r['p99_ms']:>8} {r['max_ms']:>8}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
