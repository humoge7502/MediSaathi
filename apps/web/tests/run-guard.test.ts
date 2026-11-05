/**
 * run-guard laws (bun test, no database).
 *
 * The guard exists because /api/evals is an unauthenticated POST that bills
 * ~20 model calls and may run for 300 seconds. These tests hold the two
 * properties that make it safe: one run at a time, and a finished run answers
 * for a window. Both are asserted on the launch counter — the number the guard
 * exists to keep small — not on timing, so they cannot flake.
 */
import { describe, expect, test } from "bun:test";
import { makeRunGuard } from "@/lib/run-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("run guard — single flight", () => {
  test("ten callers that arrive in one tick cost one run", async () => {
    const gate = deferred<number>();
    const guard = makeRunGuard<number>();
    let calls = 0;
    const run = () => {
      calls += 1;
      return gate.promise;
    };

    const ten = Array.from({ length: 10 }, () => guard.run(run, { reuseMs: 120_000 }));
    gate.resolve(42);
    const settled = await Promise.all(ten);

    expect(calls).toBe(1);
    expect(guard.launches).toBe(1);
    expect(settled.map((s) => s.value)).toEqual(Array.from({ length: 10 }, () => 42));
    expect(settled.filter((s) => s.source === "ran")).toHaveLength(1);
    expect(settled.filter((s) => s.source === "joined")).toHaveLength(9);
  });

  test("a finished run answers for the whole window", async () => {
    let clock = 0;
    const now = () => clock;
    const guard = makeRunGuard<string>();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return `run-${calls}`;
    };
    const opts = { reuseMs: 120_000, now };

    const first = await guard.run(run, opts);
    expect([first.source, first.value]).toEqual(["ran", "run-1"]);

    clock += 119_999;
    const second = await guard.run(run, opts);
    expect(second.source).toBe("recent");
    expect(second.value).toBe("run-1");
    expect(second.ageMs).toBe(119_999);
    expect(calls).toBe(1);

    clock += 2;
    const third = await guard.run(run, opts);
    expect([third.source, third.value]).toEqual(["ran", "run-2"]);
    expect(calls).toBe(2);
  });

  test("the window is measured from completion, not from launch", async () => {
    let clock = 0;
    const guard = makeRunGuard<number>();
    const slow = async () => {
      clock += 5_000; // a run that itself takes five seconds
      return 1;
    };
    await guard.run(slow, { reuseMs: 2_000, now: () => clock });

    clock = 6_000; // one second after it finished
    const soon = await guard.run(async () => 2, { reuseMs: 2_000, now: () => clock });
    expect(soon.source).toBe("recent");

    clock = 8_500; // 3.5s after it finished
    const late = await guard.run(async () => 3, { reuseMs: 2_000, now: () => clock });
    expect([late.source, late.value]).toEqual(["ran", 3]);
  });

  test("force skips the window but never runs two at once", async () => {
    let clock = 0;
    const gate = deferred<number>();
    const guard = makeRunGuard<number>();
    let calls = 0;
    const run = () => {
      calls += 1;
      return gate.promise;
    };

    const inFlight = guard.run(run, { reuseMs: 60_000, now: () => clock });
    clock += 1;
    const forced = guard.run(run, { reuseMs: 60_000, force: true, now: () => clock });
    gate.resolve(7);

    expect([calls, guard.launches]).toEqual([1, 1]);
    expect((await inFlight).value).toBe(7);
    expect((await forced).value).toBe(7);
  });

  test("a failed run is not remembered as a result", async () => {
    let clock = 0;
    const guard = makeRunGuard<number>();
    let calls = 0;

    await expect(
      guard.run(
        async () => {
          calls += 1;
          throw new Error("provider 503");
        },
        { reuseMs: 120_000, now: () => clock }
      )
    ).rejects.toThrow("provider 503");

    clock += 1_000;
    const ok = await guard.run(
      async () => {
        calls += 1;
        return calls;
      },
      { reuseMs: 120_000, now: () => clock }
    );
    expect([ok.source, ok.value]).toEqual(["ran", 2]);
  });

  test("joiners of a failing run are told it failed", async () => {
    const gate = deferred<number>();
    const guard = makeRunGuard<number>();
    const a = guard.run(() => gate.promise, { reuseMs: 0 });
    const b = guard.run(() => gate.promise, { reuseMs: 0 });
    // allSettled is attached BEFORE the rejection lands: bun reports a rejection
    // that has no handler at the instant it is created, even if the next line
    // would have handled it.
    const settled = Promise.allSettled([a, b]);
    gate.reject(new Error("model call expired"));

    const outcomes = await settled;
    expect(outcomes.map((o) => o.status)).toEqual(["rejected", "rejected"]);
    // The slot is released, so the next caller may try again.
    const c = await guard.run(async () => 1, { reuseMs: 0 });
    expect(c.source).toBe("ran");
  });

  test("a zero window still coalesces concurrent callers", async () => {
    const gate = deferred<number>();
    const guard = makeRunGuard<number>();
    let calls = 0;
    const run = () => {
      calls += 1;
      return gate.promise;
    };
    const a = guard.run(run, { reuseMs: 0 });
    const b = guard.run(run, { reuseMs: 0 });
    gate.resolve(1);
    await Promise.all([a, b]);
    expect(calls).toBe(1);
  });
});
