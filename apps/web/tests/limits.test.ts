/**
 * Request-boundary laws (bun test).
 *
 * Three properties that only hold at the route edge, each with a failure mode
 * that was real in this codebase:
 *
 *   1. `req.json()` buffers an unbounded body. The proxy counts requests
 *      per minute, never bytes, so 60 legal requests a minute were 60
 *      unbounded allocations. `readJson` bounds them while they stream in.
 *   2. `/api/evals` costs ~20 model calls and 300 seconds per POST. The guard
 *      in `@/lib/run-guard` is only worth anything if the ROUTE actually uses
 *      it, so this file counts real handler calls, not library calls.
 *   3. A corrupt stored-JSON column used to answer either 500-with-stack (plans)
 *      or, worse, a silent `[]` for declared contexts. Both paths now refuse
 *      with the same 409 and name the repair, and the row stays untouched.
 *
 * The perception layer is sealed the same way tests/api.test.ts seals it: the
 * model never runs here.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbDir = mkdtempSync(join(tmpdir(), "medisaathi-limits-"));
const dbUrl = `file:${join(dbDir, "limits.db")}`;
process.env.DATABASE_URL = dbUrl;

beforeAll(() => {
  // Test-isolation bootstrapping only: a throwaway tmpdir DB. Production schema
  // changes go through `prisma migrate` (audit MS-05). 120s budget for bunx
  // resolution plus a cold Prisma start on Windows.
  execSync("bunx prisma db push --skip-generate", {
    cwd: join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
}, 120_000);

// ---- sealed evaluation layer -----------------------------------------------
// The suite is a controllable gate: tests decide when a "model call" finishes,
// so single-flight is asserted on a real count rather than on wall-clock.
// One mock for the whole file (swapped by a flag) — re-mocking mid-file would
// change the module out from under the route that already imported it.
let evalCalls = 0;
let evalMode: "gate" | "fail" = "gate";
let releaseNext: ((v: unknown) => void) | null = null;
mock.module("@/lib/ai/evals", () => ({
  EVAL_CASES: [{ id: "sealed-1", question: "q", expect: "grounded", activeMolecules: [] }],
  runCopilotEval: () => {
    evalCalls += 1;
    if (evalMode === "fail") {
      const rejected = Promise.reject(new Error("provider 503"));
      // The guard attaches its handler one microtask later, and bun reports a
      // rejection that has no handler at the instant it is created.
      rejected.catch(() => undefined);
      return rejected;
    }
    return new Promise((resolve) => {
      releaseNext = resolve;
    });
  },
}));

// bun's mock.module is hoisted; route modules must be imported AFTER it.
const { POST: evalsPOST } = await import("@/app/api/evals/route");
const { POST: dosesPOST } = await import("@/app/api/doses/action/route");
const { POST: queuePOST } = await import("@/app/api/queue/route");
const { db } = await import("@/lib/db");

const EVALS_URL = "http://localhost/api/evals";
const DOSES_URL = "http://localhost/api/doses/action";
const QUEUE_URL = "http://localhost/api/queue";

const jsonRequest = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const sealedOutcome = (tag: number) => ({
  rows: [{ id: "sealed-1", expected: "grounded", actual: "grounded", typePass: true, mentionPass: true, groundedness: 0.9, safety: 0.9, helpfulness: 0.9, latencyMs: 12 }],
  means: { typeAccuracy: 1, groundedness: 0.9, safety: 0.9, helpfulness: 0.9, latencyMs: 12 },
  judgeAvailable: true,
  totalMs: 20,
  tag,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

/** Release the run the handler launched. The handler reads the body before it
 *  can call the model layer, so a POST that has merely been *issued* has not
 *  reached the mock yet — wait for the gate to exist rather than assume it. */
async function finishEval(tag: number) {
  for (let i = 0; i < 50 && !releaseNext; i++) await tick();
  const release = releaseNext;
  expect(release, "a run must be in flight to release").toBeTypeOf("function");
  release?.(sealedOutcome(tag));
  releaseNext = null;
}

describe("request body bound", () => {
  test("a body past the cap is refused with 413 before anything is read", async () => {
    const huge = "x".repeat(1024 * 1024);
    const res = await dosesPOST(jsonRequest(DOSES_URL, { doseId: huge, action: "taken" }));
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(res.status).toBe(413);
    expect(json.ok).toBe(false);
    expect(json.error).toContain("too large");
  });

  test("a client that lies about content-length is still bounded", async () => {
    // No content-length header at all: only the running total can catch this.
    const huge = "y".repeat(512 * 1024);
    const res = await dosesPOST(
      new Request(DOSES_URL, { method: "POST", body: JSON.stringify({ doseId: huge, action: "taken" }) })
    );
    expect(res.status).toBe(413);
  });

  test("a small but malformed body stays a 400, not a 500", async () => {
    const res = await dosesPOST(
      new Request(DOSES_URL, { method: "POST", headers: { "content-type": "application/json" }, body: "{ not json" })
    );
    expect(res.status).toBe(400);
  });

  test("a body inside the cap reaches the handler's own validation", async () => {
    const res = await dosesPOST(jsonRequest(DOSES_URL, { doseId: "no-such-dose", action: "taken" }));
    expect(res.status).toBe(404);
  });

  test("a field of the wrong JSON type is refused, not crashed", async () => {
    // `caregiverName: 123` used to reach `.trim()` and answer 500.
    const res = await queuePOST(jsonRequest(QUEUE_URL, { prescriptionId: 12345, fieldIndex: "2", accepted: "yes" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("required");
  });

  test("the cap is configurable but never zero or negative", async () => {
    const { MAX_BODY_BYTES } = await import("@/lib/api-helpers");
    expect(MAX_BODY_BYTES).toBeGreaterThanOrEqual(1024);
  });
});

describe("evaluation suite cost law", () => {
  test("two POSTs while one is running cost one evaluation", async () => {
    process.env.MEDISAATHI_EVAL_REUSE_MS = "120000";
    const before = evalCalls;
    const a = evalsPOST(jsonRequest(EVALS_URL, {}));
    const b = evalsPOST(jsonRequest(EVALS_URL, {}));
    await finishEval(1);
    const [ra, rb] = await Promise.all([a, b]);
    expect(evalCalls - before).toBe(1);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);

    const ja = (await ra.json()) as { data: { run?: { source: string } } };
    const jb = (await rb.json()) as { data: { run?: { source: string } } };
    expect([ja.data.run?.source, jb.data.run?.source].sort()).toEqual(["joined", "ran"]);
  });

  test("a POST inside the reuse window is served the previous result", async () => {
    const before = evalCalls;
    const res = await evalsPOST(jsonRequest(EVALS_URL, {}));
    expect(res.status).toBe(200);
    expect(evalCalls).toBe(before);
    const json = (await res.json()) as { data: { run?: { source: string; ageMs: number }; tag: number } };
    expect(json.data.run?.source).toBe("recent");
    expect(json.data.tag).toBe(1);
  });

  test("force opts out of the window — and says so", async () => {
    const before = evalCalls;
    const p = evalsPOST(jsonRequest(EVALS_URL, { force: true }));
    await finishEval(2);
    expect(evalCalls - before).toBe(1);
    const json = (await (await p).json()) as { data: { run?: { source: string }; tag: number } };
    expect(json.data.run?.source).toBe("ran");
    expect(json.data.tag).toBe(2);
  });

  test("a failed suite is not cached as a result", async () => {
    process.env.MEDISAATHI_EVAL_REUSE_MS = "120000";
    evalMode = "fail";
    try {
      const res = await evalsPOST(jsonRequest(EVALS_URL, { force: true }));
      expect(res.status).toBe(500);
      const json = (await res.json()) as { ok: boolean; error: string };
      expect(json.ok).toBe(false);
      // The message must not leak the provider stack, and must not claim a result.
      expect(json.error).toContain("did not complete");
      expect(json.error.includes("503")).toBe(false);
    } finally {
      evalMode = "gate";
    }

    // The next caller is not served the failure as if it were the report.
    const again = evalsPOST(jsonRequest(EVALS_URL, {}));
    await finishEval(3);
    const back = (await (await again).json()) as { data: { run?: { source: string } } };
    expect(back.data.run?.source).toBe("ran");
  });

  test("the reuse window is re-read per request, not frozen at import", async () => {
    process.env.MEDISAATHI_EVAL_REUSE_MS = "0";
    const before = evalCalls;
    const p = evalsPOST(jsonRequest(EVALS_URL, {}));
    await finishEval(4);
    const json = (await (await p).json()) as { data: { run?: { source: string; reuseMs: number } } };
    expect(json.data.run?.reuseMs).toBe(0);
    expect(json.data.run?.source).toBe("ran");
    expect(evalCalls - before).toBe(1);

    // A zero window means every request runs — the knob is there for a
    // deployment where the suite is cheap, not to make the guard lazy.
    const p2 = evalsPOST(jsonRequest(EVALS_URL, {}));
    await finishEval(5);
    const second = (await (await p2).json()) as { data: { run?: { source: string } } };
    expect(second.data.run?.source).toBe("ran");
    expect(evalCalls - before).toBe(2);
    process.env.MEDISAATHI_EVAL_REUSE_MS = "120000";
  });

  test("GET never runs the suite", async () => {
    const { GET } = await import("@/app/api/evals/route");
    const before = evalCalls;
    const res = await GET();
    expect(evalCalls).toBe(before);
    expect(res.status).toBe(200);
  });

  test("a blank reuse window reads as unset, not as zero", async () => {
    // The `0` above is a policy an operator wrote. This is the same number typed
    // by nobody: `MEDISAATHI_EVAL_REUSE_MS=` in a .env is set-but-empty, and
    // `Number("")` is a valid 0 — so a blank line would put the ~20-model-call
    // suite on every request while the operator believed the default was intact.
    process.env.MEDISAATHI_EVAL_REUSE_MS = "";
    try {
      const { GET } = await import("@/app/api/evals/route");
      const json = (await (await GET()).json()) as { data: { reuseMs: number } };
      expect(json.data.reuseMs).toBe(120_000);
    } finally {
      process.env.MEDISAATHI_EVAL_REUSE_MS = "120000";
    }
  });
});

describe("stored-record refusal (RES-1 class)", () => {
  /** A prescription whose stored JSON is corrupt, with a pending queue row on
   *  it, so the review path is the one that hits the damage. */
  async function brokenRun(contextsJson: string, extractionJson: string) {
    const prescription = await db.prescription.create({
      data: {
        rawText: "1. Tab Dolo 650 - 1-0-1 x 5 days",
        verdict: "confirm_queue",
        confidence: 0.42,
        extractionJson,
        findingsJson: "[]",
        engineSnapshot: "test",
        contextsJson,
      },
    });
    await db.confirmQueueItem.create({
      data: { prescriptionId: prescription.id, fieldIndex: 1, rawText: "Tab Dolo 650", state: "pending", band: "confirm" },
    });
    return prescription;
  }

  test("a corrupt verified-lines column answers 409 with the repair, not a stack", async () => {
    const rx = await brokenRun("[]", '{"lines": [{"raw": "Tab Dol');
    const res = await queuePOST(jsonRequest(QUEUE_URL, { prescriptionId: rx.id, fieldIndex: 1, accepted: true }));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("verified lines");
    expect(json.error).toContain("Re-verify");
  });

  test("a corrupt declared-contexts column is never read as an empty list", async () => {
    const rx = await brokenRun('["pregnancy", {"truncated', "[]");
    const res = await queuePOST(jsonRequest(QUEUE_URL, { prescriptionId: rx.id, fieldIndex: 1, accepted: true }));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("declared patient contexts");

    // Refusing must be reversible: nothing downstream was decided on a context
    // list the code invented, so the review is still open exactly as it was.
    const row = await db.confirmQueueItem.findUnique({
      where: { prescriptionId_fieldIndex: { prescriptionId: rx.id, fieldIndex: 1 } },
    });
    expect(row?.state).toBe("pending");
    const stored = await db.prescription.findUnique({ where: { id: rx.id } });
    expect(stored?.verdict).toBe("confirm_queue");
  });

  test("an empty declared-contexts list is honest history and still screens", async () => {
    // The other half of the law: `[]` parses, so it must NOT 409. (NULL cannot
    // be produced at all — the column is NOT NULL with a default — which is
    // why the handlers read the value instead of special-casing an absent one.)
    const rx = await brokenRun("[]", '{"lines": [{"raw": "Tab Dolo 650", "confidence": 0.99}] }');
    const res = await queuePOST(jsonRequest(QUEUE_URL, { prescriptionId: rx.id, fieldIndex: 1, accepted: true }));
    expect(res.status).not.toBe(409);
    const row = await db.confirmQueueItem.findUnique({
      where: { prescriptionId_fieldIndex: { prescriptionId: rx.id, fieldIndex: 1 } },
    });
    expect(row?.state).not.toBe("pending");
  });

  test("the refusal is audited under the route that produced it", async () => {
    const rows = await db.auditLog.findMany({ where: { action: { contains: "unreadable_record" } } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((r) => r.action)).toContain("queue.unreadable_record");
  });
});
