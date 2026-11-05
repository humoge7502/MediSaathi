/**
 * POST/GET /api/reminders — the boundary in front of the scheduling law.
 *
 * The settings row decides what the patient is told, so the tests are written as
 * boundary law:
 *  - what the server stores is what it answers. A clamped preference echoed back
 *    un-clamped leaves a control that looks like it worked and did nothing;
 *  - an unknown field is refused, not ignored. That is also the ownership guard:
 *    a body that tries to name a `patientId` is rejected by the same rule that
 *    rejects a typo, and the route never reads an identity from the request;
 *  - a partial patch must not wipe the rest of the settings (every other route in
 *    this app can be posted field-by-field, and a toggle that resets the quiet
 *    window is a toggle nobody trusts);
 *  - a stored row that cannot be parsed is a 409 that names the repair, never a
 *    silent fall back to defaults — defaults would re-enable reminders the patient
 *    turned off.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbDir = mkdtempSync(join(tmpdir(), "medisaathi-reminders-test-"));
const dbUrl = `file:${join(dbDir, "test.db")}`;
process.env.DATABASE_URL = dbUrl;

// 20 s (docs/TESTING.md, "shared-database timing"): the `prisma db push` fixture
// and the first query after another file's WAL checkpoint are the slow parts.
setDefaultTimeout(20_000);

let scope: { id: string };
let foreign: { id: string };
const createdAuditIds: string[] = [];

beforeAll(async () => {
  execSync("bunx prisma db push --skip-generate", {
    cwd: join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
  scope = (await db.patient.findFirst()) ?? (await db.patient.create({ data: { name: "Served", contexts: "" } }));
  foreign = await db.patient.create({ data: { name: "Not served", contexts: "" } });
}, 120_000);

const { GET, POST } = await import("@/app/api/reminders/route");
const { DEFAULT_SETTINGS } = await import("@/lib/safety/reminders");
const { db } = await import("@/lib/db");

type Envelope = { ok: boolean; error?: string; data?: { settings: typeof DEFAULT_SETTINGS } };

async function post(body: unknown): Promise<{ status: number; json: Envelope }> {
  const res = await POST(new Request("http://localhost/api/reminders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]);
  return { status: res.status, json: (await res.json()) as Envelope };
}

async function get(): Promise<{ status: number; json: Envelope }> {
  const res = await GET();
  return { status: res.status, json: (await res.json()) as Envelope };
}

/** The row the route wrote, straight from the table. */
const row = () => db.reminderSetting.findUnique({ where: { patientId: scope.id } });
async function clear() {
  await db.reminderSetting.deleteMany({ where: { patientId: { in: [scope.id, foreign.id] } } });
}

describe("GET", () => {
  test("before the first save answers the defaults, and writes nothing", async () => {
    await clear();
    const view = await get();
    expect(view.status).toBe(200);
    expect(view.json.data!.settings).toEqual(DEFAULT_SETTINGS);
    expect(await row()).toBeNull();
  });

  test("after a save answers exactly what was stored", async () => {
    const saved = await post({
      enabled: true, leadMinutes: 20, lateMinutes: 60,
      quiet: { startMinutes: 1320, endMinutes: 420 },
      mutedMedications: ["med-1", "med-2"],
    });
    const view = await get();
    expect(view.json.data!.settings).toEqual(saved.json.data!.settings);
    expect(view.json.data!.settings).toEqual({
      enabled: true, leadMinutes: 20, lateMinutes: 60,
      quiet: { startMinutes: 1320, endMinutes: 420 },
      mutedMedications: ["med-1", "med-2"],
    });
  });

  test("a `false` in the table reads back as false", async () => {
    await post({ enabled: false });
    expect((await get()).json.data!.settings.enabled).toBe(false);
  });

  test("a row whose mute list cannot be parsed is a 409 that names the repair", async () => {
    await post({ enabled: true });
    await db.reminderSetting.update({ where: { patientId: scope.id }, data: { mutedJson: "{ not json" } });
    const view = await get();
    expect(view.status).toBe(409);
    expect(view.json.error).toContain("cannot be read");
    // The alternative — falling back to defaults — would re-enable reminders for a
    // patient who turned them off, from a row the route merely failed to read.
    expect(view.json.data).toBeUndefined();
  });
});

describe("POST", () => {
  test("refuses a preference outside the system bound rather than narrowing it", async () => {
    await clear();
    await post({ leadMinutes: 15 });
    expect((await post({ leadMinutes: 900 })).status).toBe(400);
    expect((await post({ lateMinutes: 5000 })).status).toBe(400);
    // The control then still shows the value that IS in force, because nothing
    // was written. Silently storing 180 instead would let a buggy client believe
    // its own lie.
    expect((await row())!.leadMinutes).toBe(15);
    expect((await get()).json.data!.settings.leadMinutes).toBe(15);
  });

  test("a row written by an older build is clamped on the way out", async () => {
    await clear();
    await post({ enabled: true });
    await db.reminderSetting.update({ where: { patientId: scope.id }, data: { leadMinutes: 900, lateMinutes: -4 } });
    const view = await get();
    expect(view.json.data!.settings.leadMinutes).toBe(180);
    expect(view.json.data!.settings.lateMinutes).toBe(0);
    // The stored row is left alone: the read path is where a row that outlived its
    // build gets made safe, and rewriting it on a GET is not a read.
    expect((await row())!.leadMinutes).toBe(900);
  });

  test("one row per patient, however many saves", async () => {
    await clear();
    for (const lead of [5, 10, 20]) await post({ leadMinutes: lead });
    expect(await db.reminderSetting.count({ where: { patientId: scope.id } })).toBe(1);
    expect((await row())!.leadMinutes).toBe(20);
  });

  test("a partial patch keeps the rest of the settings", async () => {
    await post({
      leadMinutes: 20, lateMinutes: 45,
      quiet: { startMinutes: 1350, endMinutes: 390 },
      mutedMedications: ["med-9"],
    });
    const res = await post({ enabled: false });
    expect(res.json.data!.settings).toEqual({
      enabled: false, leadMinutes: 20, lateMinutes: 45,
      quiet: { startMinutes: 1350, endMinutes: 390 },
      mutedMedications: ["med-9"],
    });
  });

  test("clearing the quiet window nulls both bounds, not one", async () => {
    await post({ quiet: { startMinutes: 1320, endMinutes: 420 } });
    const stored = await row();
    expect([stored!.quietStartMinutes, stored!.quietEndMinutes]).toEqual([1320, 420]);
    await post({ quiet: null });
    const cleared = await row();
    expect([cleared!.quietStartMinutes, cleared!.quietEndMinutes]).toEqual([null, null]);
    expect((await get()).json.data!.settings.quiet).toBeNull();
  });

  test("refuses a malformed patch and changes nothing", async () => {
    await clear();
    await post({ leadMinutes: 15 });
    for (const body of [
      { leadMinutes: "soon" }, { leadMinutes: -1 }, { lateMinutes: 721 },
      { enabled: "yes" }, { quiet: { startMinutes: 1320 } }, { quiet: "off" },
      { mutedMedications: "med-1" }, { mutedMedications: [1, 2] },
      { leadMinutes: 10, patientId: foreign.id },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    // The last body is the ownership case: a caller cannot name the patient whose
    // settings it writes, and the same refusal that catches a typo catches it.
    expect((await row())!.leadMinutes).toBe(15);
    expect(await db.reminderSetting.count({ where: { patientId: foreign.id } })).toBe(0);
  });

  test("a body that is not JSON is a 400, not a 500", async () => {
    expect((await post("{oops")).status).toBe(400);
    expect((await post("[]")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
  });

  test("an oversized body is refused while it streams, before it is parsed", async () => {
    const huge = { mutedMedications: Array.from({ length: 20_000 }, (_, i) => `med-${i}`) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(64 * 1024);
    const res = await post(huge);
    expect(res.status).toBe(413);
    expect(res.json.error).toContain("too large");
  });

  test("every save is audited with the settings that took effect", async () => {
    await clear();
    await post({ leadMinutes: 25, quiet: { startMinutes: 1320, endMinutes: 420 } });
    const auditRow = await db.auditLog.findFirst({ where: { action: "reminders.updated" }, orderBy: { createdAt: "desc" } });
    expect(auditRow).not.toBeNull();
    createdAuditIds.push(auditRow!.id);
    const meta = JSON.parse(auditRow!.metaJson) as Record<string, unknown>;
    expect(meta.leadMinutes).toBe(25);
    expect(meta.quiet).toEqual({ startMinutes: 1320, endMinutes: 420 });
  });
});

afterAll(async () => {
  // The shared-database law: settings left at `enabled: false` would change what
  // a later file reads, and these audit rows are this file's debt.
  await clear();
  await db.auditLog.deleteMany({ where: { id: { in: createdAuditIds } } });
});
