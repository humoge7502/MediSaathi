import type { NextConfig } from "next";

// Security headers applied statically to every route. The Content-Security-
// Policy is NOT set here: middleware (src/middleware.ts) mints a per-request
// nonce and sets a strict script CSP on document routes (TD-2 — no more
// 'unsafe-inline' for scripts). Keep the remaining headers here so API routes
// and static assets carry them even when middleware short-circuits.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;