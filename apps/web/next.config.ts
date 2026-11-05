import type { NextConfig } from "next";

// Security headers applied statically to every route. The Content-Security-
// Policy is NOT set here: proxy (src/proxy.ts) mints a per-request
// nonce and sets a strict script CSP on document routes (TD-2 — no more
// 'unsafe-inline' for scripts). Keep the remaining headers here so API routes
// and static assets carry them even when proxy short-circuits.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// The service worker's own policy, and it has to be a different one from the
// document's. `src/proxy.ts` mints a per-request nonce and adds
// `'strict-dynamic'`, which makes a conforming browser ignore `'self'` — correct
// for a document whose bootstrap script carries that nonce, fatal for a script
// whose *body* is what must run: the worker has no nonce, so under that policy it
// has no permission to exist. `public/sw.js` is therefore excluded from the proxy
// matcher (see its `config.matcher`) and answered here with a policy that has no
// nonce and no strict-dynamic, only same-origin script.
const SERVICE_WORKER_CSP = ["default-src 'self'", "script-src 'self'", "object-src 'none'"].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  // The standalone server's cwd is `.next/standalone`, which holds only what the
  // tracer saw, and a file read is invisible to that tracer. `/opengraph-image`
  // is prerendered today — `next build` reads these bytes from the source tree,
  // so the image already contains the finished PNG — which is exactly the kind
  // of dependency that looks satisfied and is not: the first dynamic card (per
  // plan, per drug, the reason `next/og` exists) would read them at request time
  // and throw ENOENT in the container while passing every local check. Verified
  // traced: `.next/standalone/src/app/fonts/` carries both faces and both
  // licences, and both read back from that cwd.
  outputFileTracingIncludes: {
    "/opengraph-image": ["./src/app/fonts/**"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // A worker whose script never changes is a worker that never updates, so
      // this must not be cached like `/_next/static`, which is content-hashed.
      // Browsers already bypass the HTTP cache when checking for an update;
      // `must-revalidate` is what keeps a proxy in front of the app from serving
      // an old queue implementation to a new page.
      {
        source: "/sw.js",
        headers: [
          ...SECURITY_HEADERS,
          { key: "Content-Security-Policy", value: SERVICE_WORKER_CSP },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;