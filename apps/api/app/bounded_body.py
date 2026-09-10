"""Bounded request-body middleware (TD-9 resolution).

All JSON endpoints previously had no body-size cap: an attacker could stream
an unbounded JSON body into a request slot (the multipart image path already
had its own 12 MiB cap). This middleware enforces one limit for every request:

  1. Fast path: a declared ``Content-Length`` above the cap is rejected with
     413 before any body byte is read.
  2. Streaming path: for chunked/unknown-length bodies the receive channel is
     wrapped and byte-counted; exceeding the cap aborts the request with 413.

Design notes:

  * The overflow signal is a ``BaseException`` (not ``Exception``) on purpose:
    FastAPI/Starlette swallow ``Exception`` raised while parsing a request
    body and turn it into a generic 400, which would hide the real reason.
    A ``BaseException`` propagates untouched to this middleware, which sends
    the 413 while the response has not yet started.
  * ``multipart/form-data`` bodies are exempt: the upload endpoint already
    bounds itself to 12 MiB while streaming, and its boundary handling is
    tested separately. Everything else (JSON, raw, urlencoded) is capped.
  * The 413 is a normal Envelope-shaped JSON response, so clients see the same
    error contract as everywhere else. Security headers and request-ids are
    stamped by SecurityHeadersMiddleware (added after this one, so it runs
    outermost and decorates every response, including these 413s).
"""
from __future__ import annotations

import json
import os

MAX_BODY_BYTES = int(os.environ.get("MEDISAATHI_MAX_BODY_BYTES", str(1024 * 1024)))


class _BodyTooLarge(BaseException):
    """Control flow only: propagates past FastAPI's body-parsing error
    handlers so the middleware can answer 413 itself."""


class MaxBodySizeMiddleware:
    """Pure ASGI middleware (not BaseHTTPMiddleware) so it can bound the
    actual byte stream instead of the buffered replay stream."""

    def __init__(self, app, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if self._is_multipart(scope):
            # upload path has its own 12 MiB streaming cap + MIME validation
            await self.app(scope, receive, send)
            return

        declared = self._content_length(scope)
        if declared is not None and declared > self.max_bytes:
            await self._send_413(send)
            return

        received = 0
        started = {"value": False}

        async def bounded_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge()
            return message

        async def watch_send(message):
            if message["type"] == "http.response.start":
                started["value"] = True
            await send(message)

        try:
            await self.app(scope, bounded_receive, watch_send)
        except _BodyTooLarge:
            # If headers already went out we cannot re-send a 413; dropping
            # the connection is the only correct move at that point.
            if not started["value"]:
                await self._send_413(send)

    @staticmethod
    def _is_multipart(scope) -> bool:
        for name, value in scope.get("headers", []):
            if name == b"content-type" and value.startswith(b"multipart/form-data"):
                return True
        return False

    @staticmethod
    def _content_length(scope) -> int | None:
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    return int(value)
                except ValueError:
                    return None
        return None

    async def _send_413(self, send) -> None:
        body = json.dumps({
            "ok": False,
            "data": None,
            "error": f"request body exceeds {self.max_bytes} byte limit",
            "meta": {"limit_bytes": self.max_bytes},
        }).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": body})