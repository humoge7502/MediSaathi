import { db } from "@/lib/db";
import { ok, fail, audit, readJson, bodyError, BodyTooLargeError } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/seed — demo seeding with a `force` reset (audit MS-03).
 * Body: { force?: boolean }
 *  - no force: seed only when no active plan exists (idempotent, harmless).
 *  - force: archive any active plans, then create the demo plan with 14 days
 *    of realistic dose history. DESTRUCTIVE to the adherence timeline, and
 *    there is no authentication in front of this route, so "the caller is the
 *    demo operator" is not something the server can derive from a request.
 *    It is therefore denied unless an operator turned it on, one of two ways:
 *      · MEDISAATHI_ADMIN_TOKEN set + the same value in `x-admin-token`.
 *        An empty token value never unlocks the route.
 *      · MEDISAATHI_ALLOW_DEMO_RESET=1 — the deliberate local/demo opt-in,
 *        set in `.env.local` or the e2e webServer environment, never implied.
 *
 *    The previous rule was "MEDISAATHI_ENV unset or 'development' ⇒ allowed",
 *    which failed twice over: forgetting a variable silently produced an
 *    open wipe-the-history route, and `docker-compose.yml` passed MEDISAATHI_ENV
 *    only to the api container (which never reads it) — so even a compose
 *    deployment labelled production left the web tier on the default-allow side.
 */
function forceAllowed(req: Request): boolean {
  const expected = process.env.MEDISAATHI_ADMIN_TOKEN ?? "";
  if (expected) {
    const supplied = req.headers.get("x-admin-token") ?? "";
    if (supplied.length !== expected.length) return false;
    // Constant-time compare (timing-safe equal length walk).
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
    return diff === 0;
  }
  return process.env.MEDISAATHI_ALLOW_DEMO_RESET === "1";
}

export async function POST(req: Request) {
  let force = false;
  try {
    const body = await readJson<{ force?: boolean }>(req);
    force = body?.force === true;
  } catch (e) {
    if (e instanceof BodyTooLargeError) return bodyError(e);
    // empty body is fine
  }

  if (force && !forceAllowed(req)) {
    // Which switch was missing, not what the token was: an audit row that
    // recorded the supplied header would put a credential in the database.
    await audit("seed.force_denied", {
      adminTokenConfigured: Boolean(process.env.MEDISAATHI_ADMIN_TOKEN),
      demoResetOptIn: process.env.MEDISAATHI_ALLOW_DEMO_RESET ?? "",
    });
    return fail(
      "Force reset is disabled in this deployment — set MEDISAATHI_ALLOW_DEMO_RESET=1 for a local demo, or send x-admin-token",
      403,
    );
  }

  let patient = await db.patient.findFirst();
  if (!patient) {
    patient = await db.patient.create({
      data: { name: "Asha (demo patient)", ageYears: 67, sex: "female", contexts: "heart_failure" },
    });
  }

  const active = await db.therapyPlan.findFirst({ where: { patientId: patient.id, status: "active" } });
  if (active && !force) {
    return ok({ seeded: false, reason: "Active plan already exists", planId: active.id });
  }
  if (active && force) {
    await db.therapyPlan.updateMany({ where: { patientId: patient.id, status: "active" }, data: { status: "archived" } });
  }

  // Deterministic pseudo-random for reproducible history
  let seedState = 42;
  const rand = () => {
    seedState = (seedState * 1103515245 + 12345) % 2147483648;
    return seedState / 2147483648;
  };

  const plan = await db.therapyPlan.create({
    data: {
      patientId: patient.id,
      label: "Telma 40 + Glycomet 500 + Ecosprin 75",
      status: "active",
    },
  });

  const specs = [
    { brand: "Telma 40", molecule: "telmisartan", atc: "C09CA07", doseMg: 40, freq: "OD", times: ["09:00"], days: 14 },
    { brand: "Glycomet 500", molecule: "metformin", atc: "A10BA02", doseMg: 500, freq: "BD", times: ["09:00", "21:00"], days: 14 },
    { brand: "Ecosprin 75", molecule: "aspirin", atc: "B01AC06", doseMg: 75, freq: "OD", times: ["14:00"], days: 14 },
  ];

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 13); // history begins 13 days ago

  for (const spec of specs) {
    const med = await db.medication.create({
      data: {
        planId: plan.id,
        brand: spec.brand,
        molecule: spec.molecule,
        atcClass: spec.atc,
        doseMg: spec.doseMg,
        frequencyCode: spec.freq,
        timesJson: JSON.stringify(spec.times),
        durationDays: 14,
        instructions: `${spec.brand} ${spec.freq}`,
      },
    });

    const doses: { medicationId: string; scheduledAt: Date; status: string; actedAt: Date | null }[] = [];
    for (let d = 0; d < spec.days; d++) {
      for (const t of spec.times) {
        const [hh, mm] = t.split(":").map((x) => parseInt(x, 10));
        const when = new Date(start);
        when.setDate(when.getDate() + d);
        when.setHours(hh, mm, 0, 0);
        const past = when < now;
        const roll = rand();
        // The seeded history ends today, so "today" is the only day whose clock
        // position varies with when the seed runs. Pre-resolving it leaves an
        // after-21:00 visitor with a Today panel that has nothing in it to act
        // on — and makes the catch-up guardrail unreachable from the demo.
        // Today stays pending at every hour: the panel then always shows the
        // state it exists for, a dose overdue right now with live guidance.
        const isToday = when.toDateString() === now.toDateString();
        // ~82% taken, ~8% missed across the seeded days, today still open
        const status = isToday || !past ? "pending" : roll < 0.82 ? "taken" : roll < 0.9 ? "missed" : "skipped";
        doses.push({
          medicationId: med.id,
          scheduledAt: when,
          status,
          actedAt: status === "taken" ? when : status === "missed" || status === "skipped" ? when : null,
        });
      }
    }
    if (doses.length) await db.dose.createMany({ data: doses });
  }

  await db.escalationEvent.createMany({
    data: [
      {
        patientId: patient.id,
        kind: "low_adherence",
        severity: "info",
        message: "Weekly summary: 2 doses were missed this week — mostly the evening metformin slot.",
      },
      {
        patientId: patient.id,
        kind: "manual",
        severity: "info",
        message: "Asha added her son Ravi to the family circle.",
      },
    ],
  });

  await audit("seed.demo", { planId: plan.id, forced: force });
  return ok({ seeded: true, planId: plan.id, patientId: patient.id });
}
