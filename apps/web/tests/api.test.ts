/**
 * Web-tier API integration tests (bun test).
 *
 * Strategy mirrors the API tier's sealed-fixture law: the perception layer
 * (LLM) is MOCKED with fixed per-line confidences so the deterministic
 * safety plane, the route handlers, the Prisma/SQLite persistence and the
 * guardrails can be tested deterministically — with or without model keys.
 *
 * Run: bun run test   (the setup creates its own isolated SQLite file and
 * pushes the Prisma schema automatically.)
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolated database for the whole suite. Must be set BEFORE any route module
// (and therefore the Prisma client) is imported.
const dbDir = mkdtempSync(join(tmpdir(), "medisaathi-test-"));
const dbUrl = `file:${join(dbDir, "test.db")}`;
process.env.DATABASE_URL = dbUrl;

beforeAll(() => {
  execSync("bunx prisma db push --accept-data-loss --skip-generate", {
    cwd: join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
});

// ---- sealed perception layer (the LLM never runs in tests) ----------------
const sealedLines = (pairs: { raw: string; confidence: number }[], engine: "llm" | "deterministic-fallback" = "llm") => ({
  lines: pairs,
  engine,
  llmMs: 0,
});

mock.module("@/lib/ai/extraction", () => ({
  extractPrescriptionLines: async (text: string) => {
    if (text.includes("GARBAGE")) return sealedLines([], "llm");
    const lines = text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((raw) => ({ raw, confidence: 0.95 }));
    return sealedLines(lines);
  },
}));

// bun's mock.module is hoisted; route modules must be imported AFTER it.
const verifyPOST = (await import("@/app/api/verify/route")).POST;
const plansPOST = (await import("@/app/api/plans/route")).POST;
const plansGET = (await import("@/app/api/plans/route")).GET;
const dosesPOST = (await import("@/app/api/doses/action/route")).POST;
const familyPOST = (await import("@/app/api/family/route")).POST;
const metricsGET = (await import("@/app/api/metrics/route")).GET;

const jsonReq = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof verifyPOST>[0];

const body = async (res: Response) => (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: string };

describe("POST /api/verify (safety plane over sealed perception)", () => {
  test("warfarin + aspirin -> severe interaction finding, persisted", async () => {
    const res = await verifyPOST(
      jsonReq("http://localhost/api/verify", {
        text: "Warf 5 mg OD 30 days\nEcosprin 75 mg OD 30 days",
        contexts: [],
      })
    );
    const b = await body(res);
    expect(b.ok).toBe(true);
    expect(b.data!.verdict).toBe("interaction");
    const findings = b.data!.findings as { severity: string; kind: string }[];
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe("severe");
    expect(typeof b.data!.prescriptionId).toBe("string");
  });

  test("no medication content -> refused, never guessed", async () => {
    const res = await verifyPOST(jsonReq("http://localhost/api/verify", { text: "GARBAGE input", contexts: [] }));
    const b = await body(res);
    expect(b.data!.verdict).toBe("refused");
    expect((b.data!.findings as unknown[]).length).toBe(0);
  });

  test("input validation: too-short text is rejected", async () => {
    const res = await verifyPOST(jsonReq("http://localhost/api/verify", { text: "ab", contexts: [] }));
    const b = await body(res);
    expect(b.ok).toBe(false);
  });

  test("declared context reaches the plane: doxycycline + child -> contraindication", async () => {
    const res = await verifyPOST(
      jsonReq("http://localhost/api/verify", {
        text: "Doxy-1 100 mg BD 5 days",
        contexts: ["age_under_12"],
      })
    );
    const b = await body(res);
    expect(b.data!.verdict).toBe("contraindication");
  });
});

describe("plan lifecycle (verify -> plan -> doses -> guardrail)", () => {
  let prescriptionId = "";
  let planId = "";
  let doseId = "";

  test("clean chronic plan verifies to pass", async () => {
    const res = await verifyPOST(
      jsonReq("http://localhost/api/verify", {
        text: "Telma 40 mg OD 30 days\nGlycomet 500 mg BD 30 days",
        contexts: [],
      })
    );
    const b = await body(res);
    expect(b.data!.verdict).toBe("pass");
    prescriptionId = b.data!.prescriptionId as string;
  });

  test("plan starts from verified prescription and schedules doses", async () => {
    const res = await plansPOST(jsonReq("http://localhost/api/plans", { prescriptionId }));
    const b = await body(res);
    expect(b.ok).toBe(true);
    planId = b.data!.planId as string;
    expect(b.data!.medications).toBe(2);
    expect(Number(b.data!.dosesScheduled)).toBeGreaterThan(10);
  });

  test("GET /api/plans returns today's doses for the active plan", async () => {
    const res = await plansGET();
    const b = await body(res);
    const plan = b.data!.plan as { id: string } | null;
    expect(plan!.id).toBe(planId);
    expect((b.data!.doses as unknown[]).length).toBeGreaterThan(0);
    doseId = (b.data!.doses as { id: string }[])[0].id;
  });

  test("double-dose guardrail: replaying an action is inert", async () => {
    const first = await body(await dosesPOST(jsonReq("http://localhost/api/doses/action", { doseId, action: "taken" })));
    expect(first.data!.status).toBe("updated");
    const replay = await body(await dosesPOST(jsonReq("http://localhost/api/doses/action", { doseId, action: "taken" })));
    expect(replay.data!.status).toBe("already_acted");
    expect(replay.data!.message).toContain("never");
  });

  test("action validation: unknown action rejected", async () => {
    const res = await dosesPOST(jsonReq("http://localhost/api/doses/action", { doseId, action: "double" }));
    expect((await body(res)).ok).toBe(false);
  });

  test("starting a second plan archives the first (single active plan law)", async () => {
    const res2 = await verifyPOST(
      jsonReq("http://localhost/api/verify", { text: "Telma 40 mg OD 30 days", contexts: [] })
    );
    const pid = (await body(res2)).data!.prescriptionId as string;
    const second = await body(await plansPOST(jsonReq("http://localhost/api/plans", { prescriptionId: pid })));
    expect(second.ok).toBe(true);
    const after = await body(await plansGET());
    const plan = after.data!.plan as { id: string } | null;
    expect(plan!.id).not.toBe(planId);
  });

  test("refused prescription cannot become a plan", async () => {
    const rres = await verifyPOST(jsonReq("http://localhost/api/verify", { text: "GARBAGE", contexts: [] }));
    const refusedId = (await body(rres)).data!.prescriptionId as string | null;
    if (refusedId === null) return; // refused runs are not persisted with an id
    const res = await plansPOST(jsonReq("http://localhost/api/plans", { prescriptionId: refusedId }));
    expect((await body(res)).ok).toBe(false);
  });
});

describe("family circle", () => {
  test("linking a caregiver returns a 6-char CSPRNG join code", async () => {
    const res = await familyPOST(jsonReq("http://localhost/api/family", { caregiverName: "Ravi", relation: "son" }));
    const b = await body(res);
    expect(b.ok).toBe(true);
    expect(b.data!.joinCode as string).toMatch(/^[A-Z2-9]{6}$/);
  });

  test("malformed eventId is rejected before any lookup", async () => {
    const res = await familyPOST(
      jsonReq("http://localhost/api/family", { action: "acknowledge", eventId: "'; DROP TABLE EscalationEvent;--" })
    );
    const b = await body(res);
    expect(b.ok).toBe(false);
  });
});

describe("metrics", () => {
  test("counters moved after the suite exercised the pipeline", async () => {
    const res = await metricsGET();
    const b = await body(res);
    const d = b.data as { verifications: number; dataset: { brands: number } };
    expect(d.verifications).toBeGreaterThan(3);
    expect(d.dataset.brands).toBeGreaterThan(50);
  });
});
