"""MediSaathi API - FastAPI service layer.

Run: uvicorn app.main:app --reload  (from apps/api)
"""
from __future__ import annotations

import os
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from medisaathi_contracts import Envelope

from .middleware_security import SecurityHeadersMiddleware
from .routers.api import router as v1_router
from .routers.judge import judge as judge_router

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
# Security pass: request id + headers + per-client rate limit (innermost = runs first).
app.add_middleware(SecurityHeadersMiddleware)
app.include_router(v1_router)
app.include_router(judge_router)


@app.middleware("http")
async def add_latency(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["x-medisaathi-latency-ms"] = str(
        int((time.perf_counter() - t0) * 1000))
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
