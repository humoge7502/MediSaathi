/**
 * The destructive demo reset, tested as a deny-by-default matrix.
 *
 * POST /api/seed {force:true} archives the active plans and rewrites the
 * adherence timeline. There is no authentication on this tier (TD-1), so the
 * environment gate is the entire defence — which is why it is asserted per
 * switch combination rather than as a demo convenience.
 *
 * What shipped before: "MEDISAATHI_ENV unset or 'development' ⇒ allowed".
 * Two ways that failed — forgetting the variable silently produced an open
 * wipe-the-history route, and docker-compose.yml passed MEDISAATHI_ENV to the
 * api container (which never reads it) while the route lives in the web
 * container, so the deployment described by that file always ran permissive.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbDir = mkdtempSync(join(tmpdir(), "medisaathi-seed-test-"));
const dbUrl = `file:${join(dbDir, "test.db")}`;
process.env.DATABASE_URL = dbUrl;

beforeAll(() => {
  execSync("bunx prisma db push --skip-generate", {
    cwd: join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
}, 120_000);

const { POST } = await import("@/app/api/seed/route");
const { db } = await import("@/lib/db");

const URL = "http://localhost/api/seed";

async function seed(body: unknown, headers: Record<string, string> = {}) {
  const res = await POST(new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]);
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    data?: { seeded?: boolean; planId?: string; reason?: string };
  };
  // Remember the plans this file minted so afterAll can hand the shared
  // database back the way it found it (see the note there).
  if (json.data?.seeded === true && json.data.planId) createdPlanIds.push(json.data.planId);
  return { status: res.status, json };
}

const createdPlanIds: string[] = [];

/** Force every switch to a known state: tests never inherit the host shell. */
function switches({ reset = "", token = "" }: { reset?: string; token?: string } = {}) {
  if (reset === "") delete process.env.MEDISAATHI_ALLOW_DEMO_RESET;
  else process.env.MEDISAATHI_ALLOW_DEMO_RESET = reset;
  if (token === "") delete process.env.MEDISAATHI_ADMIN_TOKEN;
  else process.env.MEDISAATHI_ADMIN_TOKEN = token;
}

/** An active plan with history, the thing a force reset would destroy. */
async function withActivePlan() {
  switches();
  const first = await seed({});
  expect(first.status).toBe(200);
  switches();
  return first.json.data!.planId as string;
}

describe("force reset is denied until an operator asks for it", () => {
  test("nothing set: 403, and the active plan survives", async () => {
    switches();
    const planId = await withActivePlan();
    const res = await seed({ force: true });
    expect(res.status).toBe(403);
    expect(res.json.ok).toBe(false);
    expect((await db.therapyPlan.findUnique({ where: { id: planId } }))!.status).toBe("active");
  });

  test("an unset-but-present value is not an opt-in", async () => {
    for (const v of ["", "0", "true", "yes", "1 "]) {
      switches({ reset: v });
      expect((await seed({ force: true })).status).toBe(403);
    }
  });

  test("MEDISAATHI_ALLOW_DEMO_RESET=1 unlocks, and archives the old plan", async () => {
    switches();
    const planId = await withActivePlan();
    switches({ reset: "1" });
    const res = await seed({ force: true });
    expect(res.status).toBe(200);
    expect(res.json.data!.seeded).toBe(true);
    expect((await db.therapyPlan.findUnique({ where: { id: planId } }))!.status).toBe("archived");
  });

  test("MEDISAATHI_ENV is not a switch any more", async () => {
    // The variable the old gate trusted; setting it to the permissive-looking
    // value must change nothing now.
    switches();
    process.env.MEDISAATHI_ENV = "development";
    expect((await seed({ force: true })).status).toBe(403);
    delete process.env.MEDISAATHI_ENV;
  });
});

describe("the admin-token path", () => {
  const TOKEN = "medisaathi-demo-admin";

  test("matching x-admin-token unlocks the reset", async () => {
    switches({ token: TOKEN });
    const res = await seed({ force: true }, { "x-admin-token": TOKEN });
    expect(res.status).toBe(200);
  });

  test("a wrong, short or absent header is denied", async () => {
    switches({ token: TOKEN });
    expect((await seed({ force: true }, { "x-admin-token": "medisaathi-demo-admiX" })).status).toBe(403);
    expect((await seed({ force: true }, { "x-admin-token": TOKEN.slice(0, -1) })).status).toBe(403);
    expect((await seed({ force: true })).status).toBe(403);
  });

  test("an empty token is never unlockable by an empty header", async () => {
    switches({ token: "" });
    process.env.MEDISAATHI_ADMIN_TOKEN = "";
    expect((await seed({ force: true }, { "x-admin-token": "" })).status).toBe(403);
  });

  test("denial audits which switch was missing, never the credential", async () => {
    switches({ token: TOKEN });
    await seed({ force: true }, { "x-admin-token": "wrong-wrong-wrong-wron" });
    const rows = await db.auditLog.findMany({ where: { action: "seed.force_denied" }, orderBy: { createdAt: "desc" } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.metaJson.includes(TOKEN)).toBe(false);
      expect(row.metaJson.includes("wrong")).toBe(false);
    }
    expect(rows[0].metaJson).toContain("adminTokenConfigured");
  });
});

describe("the non-force path is untouched by the gate", () => {
  test("seeding without force stays idempotent when a plan exists", async () => {
    switches();
    await withActivePlan();
    const res = await seed({});
    expect(res.status).toBe(200);
    expect(res.json.data!.seeded).toBe(false);
    expect(res.json.data!.reason).toBe("Active plan already exists");
  });

  test("a non-boolean force never reaches the destructive branch", async () => {
    switches();
    const planId = await withActivePlan();
    // `force === true` is the only truth the route accepts: a string, a number
    // or a nested object runs the idempotent no-force path instead.
    for (const v of ["true", 1, { force: true }, null]) {
      const res = await seed({ force: v });
      expect(res.status).toBe(200);
      expect(res.json.data!.seeded).toBe(false);
    }
    expect((await db.therapyPlan.findUnique({ where: { id: planId } }))!.status).toBe("active");
  });
});

describe("the seeded timeline is actionable at every hour", () => {
  // The demo course runs from 13 days ago to *today*, and `GET /api/plans`
  // returns today's doses only. The old law resolved today's earlier slots by
  // the clock, so a reset after the last slot (21:00) produced a plan with zero
  // pending doses: an empty Today panel, a catch-up guardrail no journey could
  // reach, and an e2e result that depended on the time the suite started.
  test("today is open, every earlier day is closed", async () => {
    switches({ reset: "1" });
    const res = await seed({ force: true });
    expect(res.status).toBe(200);

    const meds = await db.medication.findMany({ where: { planId: res.json.data!.planId as string } });
    expect(meds.length).toBe(3);
    const doses = await db.dose.findMany({ where: { medicationId: { in: meds.map((m) => m.id) } } });

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const today = doses.filter((d) => d.scheduledAt >= dayStart && d.scheduledAt < dayEnd);
    // Telma 09:00, Glycomet 09:00 + 21:00, Ecosprin 14:00
    expect(today.length).toBe(4);
    expect(today.every((d) => d.status === "pending")).toBe(true);

    const history = doses.filter((d) => d.scheduledAt < dayStart);
    expect(history.length).toBeGreaterThan(0);
    // The history is a *history*: an unresolved dose before today would sit in
    // every adherence number the demo shows as a dose that never happened.
    expect(history.every((d) => d.status !== "pending")).toBe(true);
    expect(new Set(history.map((d) => d.status)).size).toBeGreaterThan(1);
  });
});

afterAll(async () => {
  // Same shared-process law as ownership.test.ts: every web test file writes to
  // ONE SQLite database, so a demo plan left ACTIVE here would be the regimen
  // /api/verify composes against for whichever file runs next. Delete the rows
  // this file minted; leave the patient and the audit trail, which other files
  // read by id and never by count.
  const meds = await db.medication.findMany({ where: { planId: { in: createdPlanIds } } });
  await db.dose.deleteMany({ where: { medicationId: { in: meds.map((m) => m.id) } } });
  await db.medication.deleteMany({ where: { planId: { in: createdPlanIds } } });
  await db.therapyPlan.deleteMany({ where: { id: { in: createdPlanIds } } });
});
