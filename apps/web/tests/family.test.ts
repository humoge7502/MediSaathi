/**
 * Family circle: the join code is the only credential on this surface, so the
 * tests are written as credential law rather than as UI smoke.
 *
 * Failure modes pinned here (all of them were real in the shipped route):
 *  - the owner view used to answer ANY request — including one that only
 *    presented a single caregiver code — with `joinCode` plus every
 *    `links[].code`: one invited caregiver reads the whole circle's invites;
 *  - linking a second caregiver wrote no row (it reused the first link and
 *    answered `ok` with its code), so the circle list silently stayed at one;
 *  - both acknowledge actions updated `EscalationEvent` by id alone, so a code
 *    for patient A resolved patient B's row;
 *  - `familyCode()` mapped a Uint32 over a 31-symbol alphabet with `%`, which
 *    is not uniform — for a credential, "slightly biased" is a bug, not a nit;
 *  - the audit log stored codes in full, so a DB dump doubled as an invite list.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbDir = mkdtempSync(join(tmpdir(), "medisaathi-family-test-"));
const dbUrl = `file:${join(dbDir, "test.db")}`;
process.env.DATABASE_URL = dbUrl;

// 20 s per test rather than bun's 5 s default (docs/TESTING.md, "shared-database
// timing"): the fixture that mints a plan, a dosing schedule and a caregiver code
// measured 4.6 s on its own, and the first query in any of these files can land
// on a WAL checkpoint left by whichever file wrote last.
setDefaultTimeout(20_000);

let owner: { id: string };
let stranger: { id: string };
// Rows this file writes that no other file may inherit: an ACTIVE plan would
// change `/api/verify`'s regimen composition for every test file that runs after
// this one, because bun's workers share one Prisma client and one SQLite file.
const createdPlanIds: string[] = [];
const createdEventIds: string[] = [];
const createdLinkCodes: string[] = [];

beforeAll(async () => {
  // 120s hook budget: `bunx` resolution plus a cold Prisma start can exceed
  // bun's 5s default on Windows (see the same fix in api.test.ts).
  execSync("bunx prisma db push --skip-generate", {
    cwd: join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
  // Every route here resolves "the patient" with an unfiltered `findFirst()`
  // (single-tenant demo; TD-1 is the auth debt), and bun's test workers share
  // one module registry — so a file that inserts its own first patient would
  // not be the patient the route answers for. Resolve it the way the route
  // does, and create one only when the database has none.
  owner = (await db.patient.findFirst())
    ?? (await db.patient.create({ data: { name: "Owner", contexts: "" } }));
  stranger = await db.patient.create({ data: { name: "Stranger", contexts: "" } });
}, 120_000);

const { GET, POST } = await import("@/app/api/family/route");
const { POST: dosePOST } = await import("@/app/api/doses/action/route");
const { familyCode } = await import("@/lib/join-code");
const { db } = await import("@/lib/db");

const URL = "http://localhost/api/family";

/** POST /api/family with a JSON body. */
async function post(body: unknown) {
  const res = await POST(new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]);
  return { status: res.status, json: await read(res) };
}

/** GET /api/family[?query]. */
async function get(query = "") {
  const res = await GET(new Request(`${URL}${query}`) as unknown as Parameters<typeof GET>[0]);
  return { status: res.status, json: await read(res) };
}

const read = async (res: Response) => (await res.json()) as {
  ok: boolean;
  error?: string;
  data?: {
    joinCode?: string | null;
    links?: { id: string; caregiverName: string; relation: string; hint?: string; code?: string }[];
    events?: { id: string; acknowledged: boolean }[];
  };
};

describe("the join code", () => {
  test("is six symbols from the read-aloud alphabet, and not a biased draw", () => {
    const codes = Array.from({ length: 200 }, () => familyCode());
    for (const c of codes) {
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
    // 200 draws from a ~30-bit space: a repeat means the generator is not
    // drawing independently (a seeded PRNG, a constant, ...).
    expect(new Set(codes).size).toBe(codes.length);
    // Every symbol is reachable — the claim rejection sampling is there for.
    expect(new Set(codes.join("")).size).toBe(31);
  });
});

describe("caregiver linking", () => {
  test("every caregiver is recorded, each with its own code", async () => {
    const first = await post({ caregiverName: "Ravi", relation: "son" });
    const second = await post({ caregiverName: "Sunita", relation: "daughter" });
    expect(first.json.ok).toBe(true);
    expect(second.json.ok).toBe(true);
    const codeA = first.json.data!.joinCode as string;
    const codeB = second.json.data!.joinCode as string;
    expect(codeB).not.toBe(codeA);

    // The old route answered `ok` with the FIRST link's code and wrote no row
    // for the second caregiver, so the circle list stayed at one name.
    const rows = await db.caregiverLink.findMany({ where: { code: { in: [codeA, codeB] } } });
    expect(rows.map((r) => r.caregiverName).sort()).toEqual(["Ravi", "Sunita"]);
    expect(new Set(rows.map((r) => r.patientId))).toEqual(new Set([owner.id]));
  });

  test("a blank name is refused before any write", async () => {
    const res = await post({ caregiverName: "   " });
    expect(res.json.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(await db.caregiverLink.count({ where: { caregiverName: "" } })).toBe(0);
  });
});

describe("a read path never returns a live code", () => {
  // There is no authentication in front of this route, so the server cannot
  // tell the patient's own browser from anyone else's: "the no-code view is the
  // owner" was an assumption, and the answer that followed from it handed every
  // invite code in the circle to the first anonymous visitor. A code now exists
  // only in the POST response that minted it.
  test("neither the owner view nor the caregiver view carries one", async () => {
    const invited = await post({ caregiverName: "Asha", relation: "spouse" });
    const code = invited.json.data!.joinCode as string;

    for (const query of ["", `?code=${code}`]) {
      const view = await get(query);
      expect(view.json.ok).toBe(true);
      expect(view.json.data!.joinCode).toBeUndefined();
      expect(view.json.data!.links!.every((l) => l.code === undefined)).toBe(true);
      // The serialization, not just the typed shape: a stray field is exactly
      // what an `as unknown as` cast would hide from the compiler.
      expect(JSON.stringify(view.json)).not.toContain(code);
    }
  });

  test("what a read path does return is the hint", async () => {
    const mine = await post({ caregiverName: "Vikram", relation: "son" });
    const code = mine.json.data!.joinCode as string;
    const links = (await get()).json.data!.links!;
    const row = links.find((l) => l.caregiverName === "Vikram")!;
    expect(row.hint).toBe(`${code.slice(0, 2)}••••`);
    expect(row.hint).not.toContain(code.slice(2));
  });

  test("minting discloses once; a re-read of the same circle never repeats it", async () => {
    const minted = await post({ caregiverName: "Priya", relation: "daughter" });
    const code = minted.json.data!.joinCode as string;
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    for (let i = 0; i < 3; i++) expect(JSON.stringify((await get()).json)).not.toContain(code);
    // ... and the link still works, which is the point of the credential.
    expect((await get(`?code=${code}`)).json.ok).toBe(true);
  });
});

describe("an unknown or malformed code is refused, and never a 500", () => {
  test("regexp-checked before any lookup", async () => {
    expect((await get("?code=QQQQQQ")).status).toBe(403);
    expect((await get("?code=%27%3B--")).status).toBe(403);
    expect((await get("?code=short")).status).toBe(403);
  });
});

describe("acknowledgement is scoped to the patient that owns the event", () => {
  test("a caregiver code cannot acknowledge another patient's escalation", async () => {
    const link = await post({ caregiverName: "Caretaker", relation: "family" });
    const foreign = await db.escalationEvent.create({
      data: { patientId: stranger.id, kind: "missed_streak", severity: "moderate", message: "not yours" },
    });

    const res = await post({
      action: "acknowledge_by_code", eventId: foreign.id, code: link.json.data!.joinCode,
    });
    expect(res.json.ok).toBe(false);
    expect(res.status).toBe(404);
    expect((await db.escalationEvent.findUnique({ where: { id: foreign.id } }))!.acknowledged).toBe(false);
  });

  test("the patient view cannot acknowledge it either", async () => {
    const foreign = await db.escalationEvent.create({
      data: { patientId: stranger.id, kind: "low_adherence", severity: "moderate", message: "not yours either" },
    });
    const res = await post({ action: "acknowledge", eventId: foreign.id });
    expect(res.json.ok).toBe(false);
    expect(res.status).toBe(404);
    expect((await db.escalationEvent.findUnique({ where: { id: foreign.id } }))!.acknowledged).toBe(false);
  });

  test("the same action with the matching patient does acknowledge", async () => {
    const mine = await db.escalationEvent.create({
      data: { patientId: owner.id, kind: "dose_checkin", severity: "info", message: "own row" },
    });
    const link = await db.caregiverLink.findFirst({ where: { patientId: owner.id } });
    const res = await post({ action: "acknowledge_by_code", eventId: mine.id, code: link!.code });
    expect(res.json.ok).toBe(true);
    expect((await db.escalationEvent.findUnique({ where: { id: mine.id } }))!.acknowledged).toBe(true);
  });

  test("a malformed event id is rejected before any lookup", async () => {
    const res = await post({ action: "acknowledge", eventId: "'; DROP TABLE EscalationEvent;--" });
    expect(res.json.ok).toBe(false);
    expect(res.status).toBe(400);
  });
});

describe("the audit trail does not store the credential", () => {
  test("no full join code appears in any audit row", async () => {
    const linked = await post({ caregiverName: "Imran", relation: "nephew" });
    const code = linked.json.data!.joinCode as string;
    createdLinkCodes.push(code);
    const rows = await db.auditLog.findMany({ where: { action: { startsWith: "family." } } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.metaJson.includes(code)).toBe(false);
  });
});

describe("a guardrail skip reaches the circle", () => {
  // The panel states its own escalation law out loud: the circle is informed when
  // "a dose is skipped". The branch that skips a dose *for* the patient — refusing
  // a late "taken" that would put two doses too close together — answered and
  // returned before that write, so the most safety-relevant skip in the product
  // was the one no relative was ever told about.
  test("the engine skipping a dose on the patient's behalf is an escalation", async () => {
    const sevenHoursLate = new Date(Date.now() - 7 * 3600_000);
    const twoHoursAhead = new Date(Date.now() + 2 * 3600_000);
    const plan = await db.therapyPlan.create({
      data: {
        patientId: owner.id,
        status: "archived", // never the active plan another file's /api/verify would compose against
        label: "guardrail feed fixture",
        medications: {
          create: [{
            brand: "Telma 40", molecule: "telmisartan", doseMg: 40, frequencyCode: "BD",
            timesJson: JSON.stringify(["08:00", "20:00"]), durationDays: 7,
            doses: {
              create: [
                { scheduledAt: sevenHoursLate, status: "pending" },
                { scheduledAt: twoHoursAhead, status: "pending" },
              ],
            },
          }],
        },
      },
      include: { medications: { include: { doses: true } } },
    });
    createdPlanIds.push(plan.id);
    const [late, next] = plan.medications[0].doses
      .slice()
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    expect(next.scheduledAt.getTime() - Date.now()).toBeLessThan(4 * 3600_000);

    const before = await db.escalationEvent.count({ where: { patientId: owner.id } });
    const res = await dosePOST(new Request("http://localhost/api/doses/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doseId: late.id, action: "taken" }),
    }) as unknown as Parameters<typeof dosePOST>[0]);
    const payload = (await res.json()) as { data: { status: string; doseStatus?: string } };
    expect(payload.data.status).toBe("guarded");
    expect(payload.data.doseStatus).toBe("skipped");

    const events = await db.escalationEvent.count({ where: { patientId: owner.id } });
    expect(events).toBe(before + 1);
    const event = await db.escalationEvent.findFirst({
      where: { patientId: owner.id, kind: "dose_checkin" },
      orderBy: { createdAt: "desc" },
    });
    createdEventIds.push(event!.id);
    expect(event!.severity).toBe("moderate");
    // Attributed to the machine, not to the patient: "Ravi skipped Telma" would
    // tell a caregiver the relative was non-adherent when they were not.
    expect(event!.message).toContain("guardrail");
    expect(event!.message).toContain("Telma 40");

    // And the caregiver, reading with their own code, actually sees it.
    const link = await post({ caregiverName: "Sunita", relation: "daughter" });
    const code = link.json.data!.joinCode as string;
    createdLinkCodes.push(code);
    const view = await get(`?code=${code}`);
    expect(view.json.data!.events!.some((e) => e.id === event!.id)).toBe(true);

    // The protected dose cannot be taken afterwards — it is persisted as skipped.
    expect((await db.dose.findUnique({ where: { id: late.id } }))!.status).toBe("skipped");
  });

  test("an on-time dose stays out of the feed", async () => {
    // `overdue` gates the write on both paths, so the guardrail branch did not
    // turn every action into noise for the family.
    const plan = await db.therapyPlan.create({
      data: {
        patientId: owner.id,
        status: "archived",
        label: "on-time fixture",
        medications: {
          create: [{
            brand: "Ecosprin 75", molecule: "aspirin", doseMg: 75, frequencyCode: "OD",
            timesJson: JSON.stringify(["08:00"]), durationDays: 7,
            doses: { create: [{ scheduledAt: new Date(Date.now() + 3600_000), status: "pending" }] },
          }],
        },
      },
      include: { medications: { include: { doses: true } } },
    });
    createdPlanIds.push(plan.id);
    const dose = plan.medications[0].doses[0];

    const before = await db.escalationEvent.count({ where: { patientId: owner.id, kind: "dose_checkin" } });
    const res = await dosePOST(new Request("http://localhost/api/doses/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doseId: dose.id, action: "taken" }),
    }) as unknown as Parameters<typeof dosePOST>[0]);
    const onTime = (await res.json()) as { data: { status: string } };
    expect(onTime.data.status).toBe("updated");
    expect(await db.escalationEvent.count({ where: { patientId: owner.id, kind: "dose_checkin" } })).toBe(before);
  });
});

afterAll(async () => {
  // See the note on `createdPlanIds`: these rows are this file's debt to pay.
  const meds = await db.medication.findMany({ where: { planId: { in: createdPlanIds } }, select: { id: true } });
  await db.dose.deleteMany({ where: { medicationId: { in: meds.map((m) => m.id) } } });
  await db.medication.deleteMany({ where: { planId: { in: createdPlanIds } } });
  await db.therapyPlan.deleteMany({ where: { id: { in: createdPlanIds } } });
  await db.escalationEvent.deleteMany({ where: { id: { in: createdEventIds } } });
  await db.caregiverLink.deleteMany({ where: { code: { in: createdLinkCodes } } });
});
