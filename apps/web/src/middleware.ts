import { NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware for the /api/* surface: request-ID correlation + per-client
 * sliding-window rate limits, mirroring the FastAPI tier's middleware contract
 * (apps/api/app/middleware_security.py) so both tiers answer with the same
 * headers and the same 429 envelope shape.
 *
 * Threat-model notes (mirrored from the API tier, see docs/SECURITY.md):
 *  - X-Forwarded-For is honored ONLY when MEDISAATHI_TRUST_PROXY=1. A client
 *    that can set its own XFF must not be able to mint a fresh bucket per
 *    request (limit bypass) or flood the key table (memory pressure).
 *  - The limiter is per process/instance, deliberately: this is a demo-scale
 *    monolith. Swap point for Redis = `limit()` (see docs/DECISIONS.md).
 *  - Memory is bounded: at most MAX_KEYS buckets; eviction removes the
 *    OLDEST keys (insertion-order approximation of LRU), never clear-all.
 */

const WRITE_LIMIT = Number(process.env.MEDISAATHI_RATE_WRITE ?? 60);
const WRITE_WINDOW_MS = Number(process.env.MEDISAATHI_RATE_WRITE_WINDOW ?? 60) * 1000;
const READ_LIMIT = Number(process.env.MEDISAATHI_RATE_READ ?? 300);
const READ_WINDOW_MS = Number(process.env.MEDISAATHI_RATE_READ_WINDOW ?? 60) * 1000;
const TRUST_PROXY = process.env.MEDISAATHI_TRUST_PROXY === "1";
const MAX_KEYS = 10_000;
const EVICT_BATCH = 1_000;

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

function allow(key: string, limit: number, windowMs: number, now: number): boolean {
  const b = buckets.get(key);
  if (b) {
    buckets.delete(key); // re-insert below => most-recently-used position
    buckets.set(key, b);
  } else {
    buckets.set(key, { hits: [] });
  }
  const bucket = buckets.get(key)!;
  const cutoff = now - windowMs;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  if (bucket.hits.length >= limit) return false;
  bucket.hits.push(now);
  if (buckets.size > MAX_KEYS) {
    for (const oldest of [...buckets.keys()].slice(0, EVICT_BATCH)) {
      buckets.delete(oldest);
    }
  }
  return true;
}

function clientKey(req: NextRequest): string {
  if (TRUST_PROXY) {
    const fwd = req.headers.get("x-forwarded-for") ?? "";
    const firstHop = fwd.split(",")[0]?.trim() ?? "";
    if (firstHop) return firstHop;
  }
  // Self-hosted without a proxy: Next does not expose the socket address to
  // middleware; x-real-ip is what the platform/runner sets. Fall back to a
  // shared bucket rather than trusting a client-supplied header.
  return req.headers.get("x-real-ip") ?? "local";
}

export function middleware(req: NextRequest) {
  const requestId =
    req.headers.get("x-request-id") && REQUEST_ID_RE.test(req.headers.get("x-request-id")!)
      ? (req.headers.get("x-request-id") as string)
      : crypto.randomUUID().replace(/-/g, "");

  const isWrite = WRITE_METHODS.has(req.method);
  const limit = isWrite ? WRITE_LIMIT : READ_LIMIT;
  const window = isWrite ? WRITE_WINDOW_MS : READ_WINDOW_MS;
  const key = clientKey(req);

  if (!allow(key, limit, window, Date.now())) {
    const res = NextResponse.json(
      { ok: false, error: "rate limit exceeded; slow down and retry" },
      { status: 429, headers: { "retry-after": String(Math.ceil(window / 1000)) } }
    );
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const res = NextResponse.next();
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
