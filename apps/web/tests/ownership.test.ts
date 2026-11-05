/**
 * Dose actions are scoped to the patient this server actually serves.
 *
 * A doseId is a capability the client supplies, and the web tier has no
 * authentication (TD-1), so the only remaining check is ownership against the
 * single-patient scope the other routes already resolve with
 * `patient.findFirst()`. Before this, `POST /api/doses/action` wrote any dose
 * row it could find by id — an id from another patient's plan was a valid
 * instruction to that patient's adherence timeline, and an overdue "taken"
 * also posted an escalation into their family feed.
 *
 * Every route that takes a row id from the request is covered here: the dose
 * action, /api/plans (which also CLAIMS an unowned prescription when it adopts
 * it), and the queue read, work list, history and resolution. What remains open
 * is the identity itself — `patient.findFirst()` is the tenant because there is
 * no authentication (TD-1); these predicates stop a caller writing to rows that
 * are not the served patient's, they do not establish who the caller is.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbDir = mkdtempSync(join(tmpdir(), "medisaathi-ownership-test-"));
const dbUrl = `file:${join(dbDir, "test.db")}`;
process.env.DATABASE_URL = dbUrl;

let scope: { id: string };
let foreign: { id: string };

const { POST } = await import("@/app/api/doses/action/route");
const { POST: plansPOST } = await import("@/app/api/plans/route");
const { GET: queueGET, POST: queuePOST } = await import("@/app/api/queue/route");
const { GET: historyGET } = await import("@/app/api/queue/history/route");
const { db } = await import("@/lib/db");

beforeAll(async () => {
  execSync("bunx prisma db push --skip-generate", {
    cwd: join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
  // Same law as the routes: the FIRST patient row is the tenant. Insert the
  // scoped one before any other, then a foreign patient whose rows the route
  // must not be able to reach.
  scope = (await db.patient.findFirst()) ?? (await db.patient.create({ data: { name: "Served", contexts: "" } }));
  foreign = await db.patient.create({ data: { name: "Not served", contexts: "" } });
}, 120_000);

/** A pending dose under `patientId`, `hoursLate` in the past when given. */
const createdPlanIds: string[] = [];
const createdPrescriptionIds: string[] = [];

async function doseFor(patientId: string, hoursLate: number | null) {
  const plan = await db.therapyPlan.create({ data: { patientId, label: "test plan", status: "active" } });
  createdPlanIds.push(plan.id);
  const med = await db.medication.create({
    data: {
      planId: plan.id,
      brand: "Telma 40",
      molecule: "telmisartan",
      doseMg: 40,
      frequencyCode: "OD",
      timesJson: JSON.stringify(["09:00"]),
      durationDays: 14,
    },
  });
  const scheduledAt = new Date();
  if (hoursLate !== null) scheduledAt.setHours(scheduledAt.getHours() - hoursLate);
  return db.dose.create({ data: { medicationId: med.id, scheduledAt, status: "pending" } });
}

async function act(doseId: string, action: string) {
  const res = await POST(new Request("http://localhost/api/doses/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ doseId, action }),
  }) as unknown as Parameters<typeof POST>[0]);
  return { status: res.status, json: (await res.json()) as { ok: boolean; error?: string; data?: Record<string, unknown> } };
}

describe("another patient's dose is not writable from this one", () => {
  test("acting on a foreign dose id answers 404 and changes nothing", async () => {
    const theirs = await doseFor(foreign.id, 1);
    const res = await act(theirs.id, "taken");
    expect(res.status).toBe(404);
    expect(res.json.ok).toBe(false);
    // Same answer as a dose that does not exist, so the response cannot be used
    // to discover which ids are real rows in the store.
    expect(res.json.error).toBe((await act("does-not-exist-at-all", "taken")).json.error);
    expect((await db.dose.findUnique({ where: { id: theirs.id } }))!.status).toBe("pending");
    expect((await db.dose.findUnique({ where: { id: theirs.id } }))!.actedAt).toBe(null);
  });

  test("a foreign skip writes no escalation into the family feed", async () => {
    const before = await db.escalationEvent.count({ where: { patientId: foreign.id } });
    const theirs = await doseFor(foreign.id, 30); // far overdue: the escalation branch
    expect((await act(theirs.id, "skipped")).status).toBe(404);
    expect(await db.escalationEvent.count({ where: { patientId: foreign.id } })).toBe(before);
  });

  test("the served patient's own dose still acts", async () => {
    const mine = await doseFor(scope.id, null);
    const res = await act(mine.id, "taken");
    expect(res.status).toBe(200);
    expect(res.json.data!.status).toBe("updated");
    expect((await db.dose.findUnique({ where: { id: mine.id } }))!.status).toBe("taken");
  });

  test("replay is still inert once the predicate is in front of it", async () => {
    const mine = await doseFor(scope.id, null);
    expect((await act(mine.id, "taken")).json.data!.status).toBe("updated");
    const replay = await act(mine.id, "taken");
    expect(replay.json.data!.status).toBe("already_acted");
    expect(replay.json.data!.message).toContain("never take a double dose");
  });

  test("an overdue action on a served dose escalates the served patient only", async () => {
    const late = await doseFor(scope.id, 20);
    const mineBefore = await db.escalationEvent.count({ where: { patientId: scope.id } });
    const theirsBefore = await db.escalationEvent.count({ where: { patientId: foreign.id } });
    expect((await act(late.id, "taken")).json.data!.status).toBe("updated");
    expect(await db.escalationEvent.count({ where: { patientId: scope.id } })).toBe(mineBefore + 1);
    expect(await db.escalationEvent.count({ where: { patientId: foreign.id } })).toBe(theirsBefore);
  });

  test("the body is still narrowed before any lookup", async () => {
    for (const body of [{ doseId: 42, action: "taken" }, { doseId: "x", action: 7 }, {}]) {
      const res = await POST(new Request("http://localhost/api/doses/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }) as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(400);
    }
  });
});

describe("a prescription belongs to a patient", () => {
  /** A plan-able prescription row, owned by `patientId` (null = unclaimed). */
  async function prescriptionFor(patientId: string | null) {
    const line = "Telma 40 mg OD 30 days";
    const row = await db.prescription.create({
      data: {
        rawText: line,
        verdict: "pass",
        confidence: 0.97,
        extractionJson: JSON.stringify({ lines: [{ raw: line, confidence: 0.97 }], engine: "llm", note: null }),
        findingsJson: "[]",
        engineSnapshot: "ownership-test",
        contextsJson: "[]",
        patientId,
      },
    });
    createdPrescriptionIds.push(row.id);
    return row;
  }

  const jsonReq = (url: string, body: unknown) =>
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as Parameters<typeof queuePOST>[0];

  const getReq = (url: string) => new Request(url) as unknown as Parameters<typeof queueGET>[0];

  const readBody = async (res: Response) =>
    (await res.json()) as { ok: boolean; error?: string; data?: Record<string, unknown> };

  test("another patient's prescription cannot start this one's plan", async () => {
    const theirs = await prescriptionFor(foreign.id);
    const res = await readBody(await plansPOST(jsonReq("http://localhost/api/plans", { prescriptionId: theirs.id })));
    expect(res.ok).toBe(false);
    // Identical to a prescription that does not exist: the answer cannot be
    // used to learn which ids are real, or whose.
    expect(res.error).toBe((await readBody(await plansPOST(jsonReq("http://localhost/api/plans", { prescriptionId: "no-such-id" })))).error);
    expect(await db.therapyPlan.count({ where: { prescriptionId: theirs.id } })).toBe(0);
  });

  test("an unclaimed prescription is claimed by the plan that adopts it", async () => {
    // The first-run order: verify happened before any Patient row existed, so
    // the visit belongs to nobody yet. Starting a plan ends that, rather than
    // leaving the row permanently outside every ownership check.
    const unowned = await prescriptionFor(null);
    const res = await readBody(await plansPOST(jsonReq("http://localhost/api/plans", { prescriptionId: unowned.id })));
    expect(res.ok).toBe(true);
    expect((await db.prescription.findUnique({ where: { id: unowned.id } }))!.patientId).toBe(scope.id);
  });

  test("a foreign queue row is unreadable, unresolvable and unlisted", async () => {
    const theirs = await prescriptionFor(foreign.id);
    const row = await db.confirmQueueItem.create({
      data: { prescriptionId: theirs.id, fieldIndex: 0, rawText: "Telma 4do mg OD 30 days", state: "pending" },
    });

    // Read: the empty queue a prescription with nothing to confirm would show.
    const view = await readBody(await queueGET(getReq(`http://localhost/api/queue?prescriptionId=${theirs.id}`)));
    expect(view.data!.pending).toBe(0);
    expect(view.data!.blocked).toBe(false);
    expect(view.data!.items).toEqual([]);

    // History: the empty log a never-queued prescription would show.
    const hist = await readBody(await historyGET(getReq(`http://localhost/api/queue/history?prescriptionId=${theirs.id}`)));
    expect(hist.data!.count).toBe(0);

    // Work list: the reviewer console must not carry another patient's read.
    const list = await readBody(await queueGET(getReq("http://localhost/api/queue")));
    expect((list.data!.open as { id: string }[]).some((r) => r.id === row.id)).toBe(false);

    // Write: refused with the message a missing row gets, and unchanged.
    const write = await queuePOST(jsonReq("http://localhost/api/queue", { prescriptionId: theirs.id, fieldIndex: 0, accepted: true }));
    const res = await readBody(write);
    expect(write.status).toBe(404);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("No queue row for that field");
    expect((await db.confirmQueueItem.findUnique({ where: { id: row.id } }))!.state).toBe("pending");
  });
});

afterAll(async () => {
  // Same shared-process law as the rest of the web suite: every test file that
  // imports `@/lib/db` writes to ONE SQLite database, so anything left ACTIVE
  // here changes what /api/verify composes against for whichever file runs
  // next (that is how regimen-route.test.ts's "same-brand refill keeps
  // passing" turned into a duplicate-ATC escalation once). Delete the rows this
  // file minted — including the plans /api/plans started from them.
  const plans = await db.therapyPlan.findMany({
    where: {
      OR: [
        { id: { in: createdPlanIds } }, // doseFor() minted these
        { patientId: foreign.id }, // ... and /api/plans started plans for it
        { prescriptionId: { in: createdPrescriptionIds } },
      ],
    },
  });
  const planIds = plans.map((p) => p.id);
  const meds = await db.medication.findMany({ where: { planId: { in: planIds } } });
  await db.dose.deleteMany({ where: { medicationId: { in: meds.map((m) => m.id) } } });
  await db.medication.deleteMany({ where: { planId: { in: planIds } } });
  await db.therapyPlan.deleteMany({ where: { id: { in: planIds } } });
  await db.confirmQueueItem.deleteMany({ where: { prescriptionId: { in: createdPrescriptionIds } } });
  await db.prescription.deleteMany({ where: { id: { in: createdPrescriptionIds } } });
  await db.escalationEvent.deleteMany({ where: { patientId: foreign.id } });
  await db.patient.delete({ where: { id: foreign.id } });
});
