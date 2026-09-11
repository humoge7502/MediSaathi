/**
 * Web middleware security contract tests (audit TD-A / MS-02).
 *
 * The API tier's red-team suite (43 cases in apps/api/tests/test_redteam.py)
 * pins the FastAPI middleware; this suite pins the edge middleware to the
 * SAME contract so the two implementations cannot drift apart silently —
 * the exact bug class already found and fixed once on the API side
 * (XFF rotation minting fresh buckets).
 *
 * The middleware module exports its internals (`allow`, `clientKey`,
 * `originAllowed`) so the contract can be exercised directly, deterministically,
 * without booting the edge runtime.
 *
 * Run: bun test tests/middleware.security.test.ts
 */
import { describe, expect, test } from "bun:test";

process.env.MEDISAATHI_TRUST_PROXY = "0"; // pin the unproxied law for this suite

const { allow, clientKey, originAllowed } = await import("../src/middleware");

const MINUTE = 60_000;

// ---------------------------------------------------------------- key source

describe("clientKey (MS-02: no client-settable key without a trusted proxy)", () => {
  test("x-real-ip is IGNORED without trust flag (shared anon bucket)", () => {
    const h = new Headers({ "x-real-ip": "1.2.3.4" });
    expect(clientKey(h)).toBe("anon");
  });

  test("rotating x-real-ip cannot mint fresh buckets", () => {
    // The exact attack the API tier fixed once already: rotate the header,
    // get a fresh bucket each time, never hit a limit.
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      keys.add(clientKey(new Headers({ "x-real-ip": `10.0.0.${i}` })));
    }
    expect(keys.size).toBe(1); // everything collapses into the shared bucket
  });

  test("x-forwarded-for is ignored without the trust flag", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "8.8.8.8" }))).toBe("anon");
  });

  test("no headers at all -> anon (never throws)", () => {
    expect(clientKey(new Headers())).toBe("anon");
  });

  test("behind a trusted proxy, the first XFF hop becomes the key", async () => {
    process.env.MEDISAATHI_TRUST_PROXY = "1";
    try {
      // fresh import so the flag is read at module scope
      const mod = await import(`${"../src/middleware"}?proxy=1`);
      const key = (mod as typeof import("../src/middleware")).clientKey;
      expect(key(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    } finally {
      process.env.MEDISAATHI_TRUST_PROXY = "0";
    }
  });
});

// ------------------------------------------------------------- sliding window

describe("allow (sliding-window + approx-LRU eviction)", () => {
  test("admits up to the limit, then refuses within the window", () => {
    const key = `t1:${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(allow(key, 5, MINUTE, 1_000 + i)).toBe(true);
    expect(allow(key, 5, MINUTE, 6_000)).toBe(false);
  });

  test("the window slides: old hits expire and the client recovers", () => {
    const key = `t2:${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(allow(key, 5, MINUTE, 1_000 + i)).toBe(true);
    expect(allow(key, 5, MINUTE, 6_000)).toBe(false);
    expect(allow(key, 5, MINUTE, 1_000 + MINUTE + 1)).toBe(true);
  });

  test("write and read windows are separate buckets per client", () => {
    const k = Math.random();
    for (let i = 0; i < 5; i++) expect(allow(`w:${k}`, 5, MINUTE, 1_000)).toBe(true);
    expect(allow(`w:${k}`, 5, MINUTE, 1_001)).toBe(false);
    // the read bucket for the same client is untouched by write traffic
    expect(allow(`r:${k}`, 5, MINUTE, 1_002)).toBe(true);
  });

  test("eviction never flushes an ACTIVE client's budget (regression law)", () => {
    // Mirrors test_limiter_eviction_never_flushes_active_buckets on the API
    // tier: flood the table, a real client arrives and talks, junk floods
    // again — the active client's bucket must survive (it is most-recently
    // used). Behavioral proof: exactly one hit-slot may remain afterwards.
    // If eviction had wiped the bucket, the client would get three fresh
    // admits instead of one.
    const active = `t3:active:${Math.random()}`;
    for (let i = 0; i < 10_000; i++) allow(`t3:junk-a:${i}`, 1, MINUTE, 1_000); // fill to the guard
    expect(allow(active, 3, MINUTE, 1_100)).toBe(true);
    expect(allow(active, 3, MINUTE, 1_101)).toBe(true); // 2 of 3 slots used
    for (let i = 0; i < 1_005; i++) allow(`t3:junk-b:${i}`, 1, MINUTE, 2_000); // force eviction of old junk
    expect(allow(active, 3, MINUTE, 2_100)).toBe(true); // 3rd slot -> its 2 earlier hits survived
    expect(allow(active, 3, MINUTE, 2_101)).toBe(false); // and no more than that
  });

  test("junk-key floods cannot resurrect a saturated client's budget", () => {
    const active = `t3:sat:${Math.random()}`;
    for (let i = 0; i < 3; i++) allow(active, 3, MINUTE, 1_000 + i);
    expect(allow(active, 3, MINUTE, 2_000)).toBe(false); // saturated
    for (let i = 0; i < 1_500; i++) allow(`t3:junk-c:${i}`, 1, MINUTE, 3_000); // junk churn below eviction horizon
    expect(allow(active, 3, MINUTE, 4_000)).toBe(false); // still limited: flood gained nothing
  });
});

// ----------------------------------------------------------- origin gate (MS-10)

describe("originAllowed (cross-origin mutation defense)", () => {
  test("same origin is allowed", () => {
    expect(originAllowed("http://localhost:3000", "localhost:3000")).toBe(true);
  });

  test("cross origin is rejected", () => {
    expect(originAllowed("http://evil.example", "localhost:3000")).toBe(false);
  });

  test("garbage Origin is rejected", () => {
    expect(originAllowed("not-a-url", "localhost:3000")).toBe(false);
  });

  test("no Origin header is allowed (curl / service-to-service)", () => {
    expect(originAllowed(null, "localhost:3000")).toBe(true);
  });

  test("lookalike hosts are rejected (suffix spoof)", () => {
    expect(originAllowed("http://localhost:3000.evil.example", "localhost:3000")).toBe(false);
  });
});
