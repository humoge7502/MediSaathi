import { db } from "@/lib/db";
import { ok, audit } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/seed — demo seeding with a `force` reset.
 * Body: { force?: boolean }
 *  - force: archive any active plans, then create the demo plan with
 *    14 days of realistic dose history (~82% adherence). Deterministic.
 *  - no force: seed only when no active plan exists (idempotent).
 */
export async function POST(req: Request) {
  let force = false;
  try {
    const body = (await req.json()) as { force?: boolean };
    force = body?.force === true;
  } catch {
    // empty body is fine
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
        // ~82% taken, ~8% missed, rest pending (future) — deterministic
        const status = !past ? "pending" : roll < 0.82 ? "taken" : roll < 0.9 ? "missed" : "skipped";
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

  await audit("seed.demo", { planId: plan.id });
  return ok({ seeded: true, planId: plan.id, patientId: patient.id });
}
