/**
 * Circuit breaker tests (reliability audit R-9).
 *
 * The breaker must be deterministic: it is clock-injected, so the state
 * machine is walked without sleeping. The product law it pins: after
 * repeated model failures, copilot queries fail FAST and honestly
 * (service_unavailable) instead of paying the network timeout every time —
 * and recovery is automatic via the half-open probe.
 *
 * Run: bun test tests/breaker.test.ts
 */
import { describe, expect, test } from "bun:test";
import { CircuitBreaker, modelBreaker } from "../src/lib/ai/breaker";

describe("CircuitBreaker state machine (clock-injected, deterministic)", () => {
  test("starts closed and allows calls", () => {
    const b = new CircuitBreaker({ threshold: 2, cooldownMs: 1000, now: () => 0 });
    expect(b.state).toBe("closed");
    expect(b.allow()).toBe(true);
  });

  test("stays closed below the failure threshold", () => {
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
    b.failure();
    b.failure();
    expect(b.state).toBe("closed");
    expect(b.allow()).toBe(true);
  });

  test("opens at the threshold and fails fast", () => {
    let t = 0;
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => t });
    b.failure();
    b.failure();
    b.failure();
    expect(b.state).toBe("open");
    expect(b.allow()).toBe(false);
  });

  test("half-opens after the cooldown and closes on a successful probe", () => {
    let t = 0;
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: () => t });
    b.failure();
    expect(b.state).toBe("open");
    t = 999;
    expect(b.state).toBe("open"); // cooldown not yet elapsed
    t = 1000;
    expect(b.state).toBe("half_open");
    expect(b.allow()).toBe(true); // probe allowed
    b.success();
    expect(b.state).toBe("closed");
    expect(b.allow()).toBe(true);
  });

  test("a failed probe re-opens the breaker", () => {
    let t = 0;
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: () => t });
    b.failure();
    t = 1000;
    expect(b.state).toBe("half_open");
    b.failure();
    expect(b.state).toBe("open");
    t = 1500;
    expect(b.allow()).toBe(false); // still inside the new cooldown window
  });

  test("success resets the consecutive-failure counter", () => {
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
    b.failure();
    b.failure();
    b.success();
    b.failure();
    b.failure();
    expect(b.state).toBe("closed"); // 2 consecutive failures < 3
    b.failure();
    expect(b.state).toBe("open");
  });
});

describe("the shared model breaker", () => {
  test("is exported with the documented policy", () => {
    expect(modelBreaker.threshold).toBe(3);
    expect(modelBreaker.cooldownMs).toBe(30_000);
    expect(modelBreaker.state).toBe("closed"); // fresh process starts healthy
  });
});
