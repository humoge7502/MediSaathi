"""MediSaathi API - FastAPI service layer.

Run: uvicorn app.main:app --reload  (from apps/api)
"""
from __future__ import annotations

import os
import time

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from medisaathi_contracts import Envelope

from .bounded_body import MAX_BODY_BYTES, MaxBodySizeMiddleware
from .middleware_security import SecurityHeadersMiddleware
from .obs import configure_logging, log_event, render_prometheus, tracker
from .routers.api import router as v1_router
from .routers.judge import judge as judge_router

configure_logging()

app = FastAPI(
    title="MediSaathi API",
    version="0.2.0",
    description="Verification-first prescription intelligence. "
                "The model reads; the rules decide.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("MEDISAATHI_CORS", "http://localhost:3000").split(","),
    allow_methods=["*"], allow_headers=["*"],
)
# Body cap before the app (TD-9: JSON endpoints previously had no size limit).
app.add_middleware(MaxBodySizeMiddleware, max_bytes=MAX_BODY_BYTES)
# Security pass: request id + headers + per-client rate limit (added last =
# outermost, so every response including 413s is stamped).
app.add_middleware(SecurityHeadersMiddleware)
app.include_router(v1_router)
app.include_router(judge_router)


@app.middleware("http")
async def add_latency(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    latency_ms = (time.perf_counter() - t0) * 1000
    route = request.scope.get("route")
    route_path = getattr(route, "path", request.url.path)
    tracker.observe(request.method, route_path, latency_ms)
    response.headers["x-medisaathi-latency-ms"] = str(int(latency_ms))
    if request.url.path not in ("/healthz", "/readyz", "/metrics", "/slo", "/metrics.prometheus"):
        log_event("http_request", route=str(route_path), method=request.method,
                  status=response.status_code, latency_ms=int(latency_ms),
                  request_id=getattr(request.state, "request_id", None))
    return response


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/readyz")
def readyz() -> Envelope:
    """Readiness = seed tables loaded and fixtures reachable."""
    from .routers.api import engine
    from .vision import FIXTURE_DIR
    ready = (
        len(engine.brands) > 0 and len(engine.interactions) > 0
        and os.path.isdir(FIXTURE_DIR)
    )
    return Envelope(ok=ready, data={
        "brands": len(engine.brands),
        "interactions": len(engine.interactions),
        "contraindications": len(engine.contraindications),
        "fixtures_dir_exists": os.path.isdir(FIXTURE_DIR),
    }, error=None if ready else "seed data not loaded")


@app.get("/metrics")
def metrics() -> dict:
    """Demo-critical counters (refusal discipline is measured, not claimed)."""
    from .store import count, verdict_counts
    from .vision import schema_fail_count
    counts = verdict_counts()
    return {
        "pipeline_started_total": count(),
        "verdicts": counts,
        "refused_total": counts.get("refused", 0),
        "confirm_queue_total": counts.get("confirm_queue", 0),
        "llm_schema_fail_total": schema_fail_count(),
    }


@app.get("/slo")
def slo() -> dict:
    """Per-endpoint latency percentiles from the in-process observation window.

    These are *service* SLOs (endpoint latency), measured live — distinct from
    the pipeline benchmark in tools/bench.py. Window is bounded (512 obs per
    route), so this reflects recent traffic, not all-time history.
    """
    return {"window_per_route": tracker.WINDOW, "endpoints": tracker.summary()}


@app.get("/metrics.prometheus",
         responses={200: {"content": {"text/plain; version=0.0.4": {}}}},
         include_in_schema=False)
def prometheus() -> Response:
    """Prometheus scrape endpoint (OpenMetrics text; counters + latency summary)."""
    from .store import count, verdict_counts
    from .vision import schema_fail_count
    body = render_prometheus(
        pipeline_started=count(), verdicts=verdict_counts(),
        schema_failures=schema_fail_count())
    return Response(content=body, media_type="text/plain; version=0.0.4; charset=utf-8")
