import { NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware for the /api/* surface: request-ID correlation + per-client
 * sliding-window rate limits, mirroring the FastAPI tier's middleware contract
 * (apps/api/app/middleware_security.py) so both tiers answer with the same
 * headers and the same 429 envelope shape.
 *
 * Threat-model notes (mirrored from the API tier, see docs/security/SECURITY_AUDIT.md):
 *  - X-Forwarded-For is honored ONLY when MEDISAATHI_TRUST_PROXY=1. A client
 *    that can set its own XFF must not be able to mint a fresh bucket per
 *    request (limit bypass) or flood the key table (memory pressure).
 *  - KEY SOURCE LAW (audit finding MS-02): without a trusted proxy, Next.js
 *    edge middleware cannot see the socket address, and `x-real-ip` is a
 *    CLIENT-SUPPLIED header — trusting it would let any caller rotate a fresh
 *    rate-limit bucket per request. The fallback is therefore a SHARED bucket
 *    ("anon"): unauthenticated strangers share one budget, and only a proxy
 *    we explicitly trust can give a client its own key. Same law as the API
 *    tier (XFF honored only behind MEDISAATHI_TRUST_PROXY=1).
 *  - The limiter is per process/instance, deliberately: this is a demo-scale
 *    monolith. Swap point for Redis = `limit()` (see docs/DECISIONS.md).
 *  - Memory is bounded: at most MAX_KEYS buckets; eviction removes the
 *    OLDEST keys (insertion-order approximation of LRU), never clear-all.
 *  - Mutations carry a same-origin check (defense in depth for the day
 *    cookie sessions exist — audit finding MS-10). Cross-origin JSON POSTs
 *    are rejected before any handler runs; same-origin and server-to-server
 *    callers without an Origin header pass.
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

/** Sliding-window allow with approx-LRU eviction. Exported for the contract tests. */
export function allow(classedKey: string, limit: number, windowMs: number, now: number): boolean {
  const b = buckets.get(classedKey);
  if (b) {
    buckets.delete(classedKey); // re-insert below => most-recently-used position
    buckets.set(classedKey, b);
  } else {
    buckets.set(classedKey, { hits: [] });
  }
  const bucket = buckets.get(classedKey)!;
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

/**
 * Rate-limit key source. NEVER trusts a client-settable header without an
 * explicit proxy trust flag: unproxied callers share the "anon" bucket
 * instead of minting private ones. Exported for the contract tests.
 */
export function clientKey(headers: Headers): string {
  if (TRUST_PROXY) {
    const fwd = headers.get("x-forwarded-for") ?? "";
    const firstHop = fwd.split(",")[0]?.trim() ?? "";
    if (firstHop) return firstHop;
  }
  return "anon";
}

/**
 * Same-origin check for state-changing requests (MS-10 defense in depth).
 * Browsers always attach Origin on cross-origin POSTs; non-browser callers
 * (curl, service-to-service) send no Origin and are allowed — the demo API
 * is curl-driven by design. Exported for the contract tests.
 */
export function originAllowed(origin: string | null, host: string): boolean {
  if (!origin) return true; // non-browser client (curl / same-origin server call)
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const requestId =
    req.headers.get("x-request-id") && REQUEST_ID_RE.test(req.headers.get("x-request-id")!)
      ? (req.headers.get("x-request-id") as string)
      : crypto.randomUUID().replace(/-/g, "");

  const isWrite = WRITE_METHODS.has(req.method);

  // MS-10: reject cross-origin mutations before any handler runs.
  if (isWrite && !originAllowed(req.headers.get("origin"), req.headers.get("host") ?? "")) {
    const res = NextResponse.json(
      { ok: false, error: "cross-origin mutation rejected" },
      { status: 403 }
    );
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const limit = isWrite ? WRITE_LIMIT : READ_LIMIT;
  const window = isWrite ? WRITE_WINDOW_MS : READ_WINDOW_MS;
  // Separate window per (class, client) — mirroring the FastAPI tier's distinct
  // _WRITES/_READS limiters. A single shared bucket would let read traffic
  // consume the write budget (and vice versa): a read-heavy browser session
  // would 429 its first POST after ~60 combined hits, which is wrong.
  const key = `${isWrite ? "w" : "r"}:${clientKey(req.headers)}`;

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
