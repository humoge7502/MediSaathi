"""Observability primitives: structured logs, latency SLOs, Prometheus metrics.

Design law (same as the safety plane): zero third-party dependencies. The
Prometheus text exposition format is ~30 lines to emit correctly, and pulling
in a client library for it would be the only compiled dependency in the tier.

Three pieces:

1. ``configure_logging`` — JSON-lines logs on stdout (one object per line:
   ts, level, logger, event, plus structured fields). Machine-parseable logs
   are the contract for any log shipper; the demo-laptop case still reads them
   fine with jq.

2. ``LatencyTracker`` — bounded per-(route, method) latency rings observed by
   the request middleware. ``/slo`` exposes p50/p95/p99 per endpoint; rings are
   capped so memory is O(routes x window), never O(traffic).

3. ``render_prometheus`` — the counters that already exist (verdicts,
   refusals, schema failures) plus latency summaries, rendered in the OpenMetrics
   text format Prometheus scrapes, with HELP/TYPE lines and correct labels.
"""
from __future__ import annotations

import json
import logging
import sys
import threading
import time
from collections import deque

# ------------------------------------------------------------------- logging

_JSON_FIELDS = ("event", "request_id", "route", "method", "status", "latency_ms", "detail")


class _JsonFormatter(logging.Formatter):
    """One JSON object per log record; extras in _JSON_FIELDS ride at top level."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
                  + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for field in _JSON_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"))


def configure_logging(level: int = logging.INFO) -> None:
    """Idempotent: installs the JSON handler once on the 'medisaathi' logger."""
    logger = logging.getLogger("medisaathi")
    if any(isinstance(h, logging.StreamHandler) for h in logger.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False


def log_event(event: str, **fields: object) -> None:
    """Structured event on the medisaathi logger (extra keys whitelisted)."""
    logging.getLogger("medisaathi").info(event, extra={
        k: v for k, v in fields.items() if k in _JSON_FIELDS or k == "detail"
    })


# ----------------------------------------------------------------- latencies

def _percentile(sorted_values: list[float], p: float) -> float:
    """Nearest-rank percentile on a pre-sorted list (ceil rank; no numpy)."""
    if not sorted_values:
        return 0.0
    import math
    idx = max(0, min(len(sorted_values) - 1, math.ceil(p / 100 * len(sorted_values)) - 1))
    return sorted_values[idx]


class LatencyTracker:
    """Bounded per-route latency rings. Thread-safe; memory is capped."""

    WINDOW = 512  # observations kept per (method, route)

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rings: dict[tuple[str, str], deque[float]] = {}

    def observe(self, method: str, route: str, latency_ms: float) -> None:
        key = (method, route)
        with self._lock:
            ring = self._rings.get(key)
            if ring is None:
                ring = self._rings[key] = deque(maxlen=self.WINDOW)
            ring.append(round(latency_ms, 3))

    def summary(self) -> dict:
        """{"/route": {"method": {"n", "p50_ms", "p95_ms", "p99_ms", "max_ms"}}}"""
        out: dict[str, dict[str, dict[str, float | int]]] = {}
        with self._lock:
            items = [(k, list(v)) for k, v in self._rings.items()]
        for (method, route), values in sorted(items):
            values.sort()
            bucket = out.setdefault(route, {})
            bucket[method] = {
                "n": len(values),
                "p50_ms": _percentile(values, 50),
                "p95_ms": _percentile(values, 95),
                "p99_ms": _percentile(values, 99),
                "max_ms": values[-1] if values else 0.0,
            }
        return out

    def total_requests(self) -> int:
        with self._lock:
            return sum(len(v) for v in self._rings.values())


tracker = LatencyTracker()


# ---------------------------------------------------------------- prometheus

def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def render_prometheus(*, pipeline_started: int, verdicts: dict[str, int],
                      schema_failures: int) -> str:
    """OpenMetrics text format. Counters only observed values; HELP/TYPE first."""
    lines: list[str] = [
        "# HELP medisaathi_pipeline_started_total Total prescriptions entering the pipeline.",
        "# TYPE medisaathi_pipeline_started_total counter",
        f"medisaathi_pipeline_started_total {pipeline_started}",
        "# HELP medisaathi_verdict_total Verdicts issued, by kind.",
        "# TYPE medisaathi_verdict_total counter",
    ]
    for kind in sorted(verdicts):
        lines.append(f'medisaathi_verdict_total{{kind="{_escape_label(kind)}"}} {verdicts[kind]}')
    refused = verdicts.get("refused", 0)
    confirm = verdicts.get("confirm_queue", 0)
    total = sum(verdicts.values())
    refusal_ratio = f"{refused / total:.4f}" if total else "0"
    confirm_ratio = f"{confirm / total:.4f}" if total else "0"
    lines += [
        "# HELP medisaathi_refusal_ratio Fraction of verdicts that were refusals.",
        "# TYPE medisaathi_refusal_ratio gauge",
        f"medisaathi_refusal_ratio {refusal_ratio}",
        "# HELP medisaathi_confirm_queue_ratio Fraction of verdicts sent to human confirmation.",
        "# TYPE medisaathi_confirm_queue_ratio gauge",
        f"medisaathi_confirm_queue_ratio {confirm_ratio}",
        "# HELP medisaathi_llm_schema_fail_total Schema/net failures of the live vision call.",
        "# TYPE medisaathi_llm_schema_fail_total counter",
        f"medisaathi_llm_schema_fail_total {schema_failures}",
        "# HELP medisaathi_http_request_duration_ms Endpoint latency summary (observed window).",
        "# TYPE medisaathi_http_request_duration_ms summary",
    ]
    for route, methods in tracker.summary().items():
        for method, s in methods.items():
            labels = f'route="{_escape_label(route)}",method="{method}"'
            lines += [
                f'medisaathi_http_request_duration_ms{{{labels},quantile="0.5"}} {s["p50_ms"]}',
                f'medisaathi_http_request_duration_ms{{{labels},quantile="0.95"}} {s["p95_ms"]}',
                f'medisaathi_http_request_duration_ms{{{labels},quantile="0.99"}} {s["p99_ms"]}',
                f'medisaathi_http_request_duration_ms_count{{{labels}}} {s["n"]}',
            ]
    return "\n".join(lines) + "\n"
