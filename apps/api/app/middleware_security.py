"""Security middleware: request IDs, security headers, per-client rate limits.

One pass over each request:
  1. attach/propagate an x-request-id (echoes a client-supplied valid id)
  2. rate-limit writes and reads per client (sliding window, in-memory)
  3. stamp security headers on every response (including 429s)

Design notes:
  * The limiter is deliberately in-memory and per-process: this is a demo-scale
    monolith. The `RateLimiter` interface (allow(key) -> bool) is the swap point
    for Redis or any shared store post-event (see docs/DECISIONS.md ADR-006).
  * Request IDs are server-generated UUIDs; client-supplied ids are accepted
    only if they match a sane id pattern, so they can never smuggle header
    content into logs or responses (CRLF/unicode abuse).
  * The client key is the forwarded-for first hop when present, else the socket
    address. We do not log or persist it.
"""
from __future__ import annotations

import os
import re
import time
import uuid
from collections import defaultdict, deque

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

# Write endpoints (mutations) get a tighter bucket than reads. Env-overridable
# so deployments (and load benchmarks) can tune without code changes.
_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
WRITE_LIMIT = int(os.environ.get("MEDISAATHI_RATE_WRITE", "60"))   # requests
WRITE_WINDOW_S = int(os.environ.get("MEDISAATHI_RATE_WRITE_WINDOW", "60"))
READ_LIMIT = int(os.environ.get("MEDISAATHI_RATE_READ", "300"))
READ_WINDOW_S = int(os.environ.get("MEDISAATHI_RATE_READ_WINDOW", "60"))

_SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
}


class SlidingWindowLimiter:
    """Fixed-memory sliding window: one deque of timestamps per client key."""

    def __init__(self, limit: int, window_s: int) -> None:
        self.limit = limit
        self.window = window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        q = self._hits[key]
        cutoff = now - self.window
        while q and q[0] <= cutoff:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        # Bound memory: a key that never talks to us again holds one empty deque.
        if len(self._hits) > 10_000:  # pragma: no cover - abuse guard
            self._hits.clear()
        return True


# Process-wide buckets (created before the app starts serving).
_WRITES = SlidingWindowLimiter(WRITE_LIMIT, WRITE_WINDOW_S)
_READS = SlidingWindowLimiter(READ_LIMIT, READ_WINDOW_S)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Request id + security headers + rate limit in a single middleware.

    Limiters live at module level (one process-wide bucket each) and limits
    are re-read from the module constants on every request, so policy changes
    take effect without rebuilding the app.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        request_id = self._request_id(request)

        _WRITES.limit, _WRITES.window = WRITE_LIMIT, WRITE_WINDOW_S
        _READS.limit, _READS.window = READ_LIMIT, READ_WINDOW_S
        limiter = _WRITES if request.method in _WRITE_METHODS else _READS
        if not limiter.allow(self._client_key(request)):
            resp = JSONResponse(
                status_code=429,
                content={"ok": False, "data": None,
                         "error": "rate limit exceeded; slow down and retry",
                         "meta": {"retry_after_s": WRITE_WINDOW_S}},
            )
            self._stamp(resp, request_id)
            return resp

        request.state.request_id = request_id
        response = await call_next(request)
        self._stamp(response, request_id)
        return response

    @staticmethod
    def _request_id(request: Request) -> str:
        supplied = request.headers.get("x-request-id", "")
        if _REQUEST_ID_RE.fullmatch(supplied):
            return supplied
        return uuid.uuid4().hex

    @staticmethod
    def _client_key(request: Request) -> str:
        fwd = request.headers.get("x-forwarded-for", "")
        first_hop = fwd.split(",")[0].strip() if fwd else ""
        return first_hop or (request.client.host if request.client else "unknown")

    @staticmethod
    def _stamp(response: Response, request_id: str) -> None:
        response.headers["x-request-id"] = request_id
        for k, v in _SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
