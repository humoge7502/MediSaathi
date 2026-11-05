import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy for the /api/* surface: request-ID correlation + per-client
 * sliding-window rate limits, mirroring the FastAPI tier's middleware contract
 * (apps/api/app/middleware_security.py) so both tiers answer with the same
 * headers and the same 429 envelope shape.
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy` and moved the
 * default runtime from edge to Node. Both halves of this contract survive the
 * move unchanged: the bucket table is still per-process (the same law it always
 * documented), and `crypto.randomUUID` / `btoa` are global in Node 18+.
 *
 * Threat-model notes (mirrored from the API tier, see docs/security/SECURITY_AUDIT.md):
 *  - X-Forwarded-For is honored ONLY when MEDISAATHI_TRUST_PROXY=1. A client
 *    that can set its own XFF must not be able to mint a fresh bucket per
 *    request (limit bypass) or flood the key table (memory pressure).
 *  - KEY SOURCE LAW (audit finding MS-02): without a trusted proxy, this layer
 *    cannot see the socket address, and `x-real-ip` is a CLIENT-SUPPLIED
 *    header — trusting it would let any caller rotate a fresh rate-limit bucket
 *    per request. The fallback is therefore a SHARED bucket ("anon"):
 *    unauthenticated strangers share one budget, and only a proxy we explicitly
 *    trust can give a client its own key. Same law as the API
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

/**
 * A limiter budget read from the environment. `Number(process.env.X ?? 60)` is
 * not enough, because a variable that is SET-but-EMPTY is `""`, not `undefined`,
 * and `??` deliberately passes `""` through: `Number("")` is `0`, so the write
 * limiter would ship a zero request budget and answer every POST with 429 — the
 * protection fails as a total outage rather than as a misconfiguration you would
 * notice. A non-numeric value has the same shape (`Number("5x")` is `NaN`, and
 * nothing ever passes `hits.length < NaN`). Both are a typo at deploy time, so the
 * answer is the documented default, not a silent denial of service.
 *
 * Contrast `MEDISAATHI_EVAL_REUSE_MS` in src/app/api/evals/route.ts, which accepts
 * an explicit `0`: there, `0` is a meaningful policy ("no cache window, run every
 * time"), whereas here it means "refuse everything".
 */
export function envPositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const WRITE_LIMIT = envPositiveNumber(process.env.MEDISAATHI_RATE_WRITE, 60);
const WRITE_WINDOW_MS = envPositiveNumber(process.env.MEDISAATHI_RATE_WRITE_WINDOW, 60) * 1000;
const READ_LIMIT = envPositiveNumber(process.env.MEDISAATHI_RATE_READ, 300);
const READ_WINDOW_MS = envPositiveNumber(process.env.MEDISAATHI_RATE_READ_WINDOW, 60) * 1000;
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

export function proxy(req: NextRequest) {
  const requestId =
    req.headers.get("x-request-id") && REQUEST_ID_RE.test(req.headers.get("x-request-id")!)
      ? (req.headers.get("x-request-id") as string)
      : crypto.randomUUID().replace(/-/g, "");

  const isApi = req.nextUrl.pathname.startsWith("/api");

  if (isApi) {
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

  // ---------------------------------------------------------------- pages
  // TD-2: nonce-based CSP (was 'unsafe-inline' for scripts). A per-request
  // nonce is minted here; Next's renderer reads it from the request headers
  // and stamps its inline bootstrap/flight scripts with it automatically.
  // 'strict-dynamic' lets the nonced bootstrap load the static chunks. Using
  // a nonce forces dynamic rendering of document routes (the landing page is
  // SSR per request) — accepted: the route is engine-free and tiny.
  // styles keep 'unsafe-inline' (Next inline styles; no untrusted HTML is
  // rendered anywhere; the XSS that matters travels through scripts).
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  // Every document route (nonce + CSP) plus the full /api surface (limiter,
  // request IDs, origin checks). Static assets are served directly.
  //
  // `/sw.js` is on that second list on purpose, and it is not a static asset.
  // The policy minted below is a *document* policy: `'strict-dynamic'` tells a
  // conforming browser to ignore every source expression in `script-src`, so a
  // script response carrying it has no allow-list left — the worker's own body
  // has no nonce to be evaluated with, and registration dies as a generic
  // SecurityError with nothing in the console naming the cause. The service
  // worker gets its own, blunt `default-src 'self'` from `next.config.ts`
  // instead, and `e2e/pwa.spec.ts` fails the build if that routing is undone.
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
