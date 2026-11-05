import { defineConfig, devices } from "@playwright/test";

/**
 * MediSaathi web-tier E2E (TD-3 resolution).
 *
 * The suite runs against the production standalone build on :3457.
 *   bun run build   # once (produces .next/standalone)
 *   bun run e2e     # builds-if-needed, boots the server, runs the suite
 *
 * Every covered journey is on the deterministic tier (zero model calls):
 * verify verdicts, copilot gates, the engine self-test, the dose guardrail.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1, // sequential: the app is a single-patient demo store
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3457",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // No `VAR=value cmd` prefix: that is POSIX-shell syntax and cmd.exe on
    // Windows runs the command literally, so the whole E2E gate dies before a
    // browser starts. Playwright passes `env` to the child process instead.
    command: "node scripts/start-standalone.mjs",
    env: {
      ...process.env,
      PORT: "3457",
      NODE_ENV: "production",
      // e2e/product.spec.ts force-seeds so each run starts from the same
      // 14-day history. The seed route denies `force` unless an operator asked
      // for it — this test server is that request, made explicitly here rather
      // than assumed from an unset variable.
      MEDISAATHI_ALLOW_DEMO_RESET: "1",
    },
    url: "http://localhost:3457/api/evidence",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});