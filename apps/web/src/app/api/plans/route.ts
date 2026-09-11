import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, bumpMetric, audit } from "@/lib/api-helpers";
import { defaultTimes } from "@/lib/safety/adherence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/plans — start a therapy plan from a verified prescription.
 * Body: { prescriptionId: string }
 * Only verdicts that produced confirmed medications can become plans.
 */
export async function POST(req: NextRequest) {
  let body: { prescriptionId?: string; patientId?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  if (!body.prescriptionId) return fail("prescriptionId is required");

  const prescription = await db.prescription.findUnique({ where: { id: body.prescriptionId } });
  if (!prescription) return fail("Prescription not found", 404);
  if (prescription.verdict === "refused") return fail("This prescription was refused and cannot become a plan");

  const extraction = JSON.parse(prescription.extractionJson) as { lines?: { raw: string }[] };
  const findings = JSON.parse(prescription.findingsJson) as unknown[];
  // The contexts the prescription was screened against at verify time — never
  // re-screened with an empty context (that would silently drop
  // contraindication findings when a plan starts).
  let contexts: string[] = [];
  try {
    contexts = JSON.parse(prescription.contextsJson ?? "[]") as string[];
  } catch {
    contexts = [];
  }

  // Re-run the deterministic plane to reconstruct confirmed meds (provenance-safe)
  const { runSafetyPlane } = await import("@/lib/safety/engine");
  const report = runSafetyPlane({
    rawLines: (extraction.lines ?? []).map((l) => l.raw),
    contexts,
  });

  if (report.confirmed.length === 0) {
    return fail("No confirmed medications available to schedule. Resolve the confirm queue first.");
  }

  // Demo patient (auth is post-event roadmap); first patient in DB is the demo identity
  let patient = await db.patient.findFirst();
  if (!patient) {
    patient = await db.patient.create({ data: { name: "Asha (demo patient)", ageYears: 67, sex: "female" } });
  }

  // Replace any previous active plan for the demo identity (single-patient event build).
  // The whole swap — archive old plan, create plan + medications + doses — runs in ONE
  // interactive transaction (audit TD-E): a failure mid-loop used to leave a partially
  // scheduled plan, and two concurrent starts could interleave archives and creates.
  const start = new Date();
  const created = await db.$transaction(async (tx) => {
    const existingActive = await tx.therapyPlan.findFirst({
      where: { patientId: patient.id, status: "active" },
      include: { medications: true },
    });
    if (existingActive) {
      await tx.therapyPlan.update({ where: { id: existingActive.id }, data: { status: "archived" } });
    }

    const plan = await tx.therapyPlan.create({
      data: {
        patientId: patient.id,
        prescriptionId: prescription.id,
        label: report.confirmed.map((m) => m.brand).join(" + "),
        status: "active",
      },
    });

    let slotCount = 0;
    for (const med of report.confirmed) {
      const times = defaultTimes(med.frequency || "OD");
      const createdMed = await tx.medication.create({
        data: {
          planId: plan.id,
          brand: med.brand ?? med.rawText,
          molecule: med.molecule,
          atcClass: med.atc,
          doseMg: med.strengthMg ?? 0,
          frequencyCode: med.frequency || "OD",
          timesJson: JSON.stringify(times),
          durationDays: med.durationDays ?? 7,
          instructions: med.instructions,
        },
      });
      const doses = times.flatMap((t) => {
        const [hh, mm] = t.split(":").map((x) => parseInt(x, 10));
        const days = Math.min(med.durationDays ?? 7, 14);
        return Array.from({ length: days }, (_, d) => {
          const when = new Date(start);
          when.setDate(when.getDate() + d);
          when.setHours(hh, mm, 0, 0);
          return { medicationId: createdMed.id, scheduledAt: when, status: "pending" };
        });
      });
      if (doses.length > 0) await tx.dose.createMany({ data: doses });
      slotCount += doses.length;
    }
    return { plan, slotCount };
  });
  const plan = created.plan;
  const slotCount = created.slotCount;

  // If the verdict carried findings, raise an escalation event for the family feed
  if (findings.length > 0) {
    const worst = findings.some((f) => (f as { severity?: string }).severity === "severe");
    await db.escalationEvent.create({
      data: {
        patientId: patient.id,
        kind: "interaction_alert",
        severity: worst ? "severe" : "moderate",
        message: `Plan started with ${findings.length} safety finding(s) — review the verification report together.`,
      },
    });
  }

  await Promise.all([bumpMetric("plans_started"), audit("plan.started", { planId: plan.id, meds: report.confirmed.length, slots: slotCount })]);

  return ok({ planId: plan.id, medications: report.confirmed.length, dosesScheduled: slotCount, label: plan.label });
}

/** GET /api/plans — active plan with today's doses. */
export async function GET() {
  const patient = await db.patient.findFirst();
  if (!patient) return ok({ plan: null, doses: [], patient: null });

  const plan = await db.therapyPlan.findFirst({
    where: { patientId: patient.id, status: "active" },
    include: { medications: { include: { doses: { where: { scheduledAt: { gte: todayStart(), lt: tomorrowEnd() } }, orderBy: { scheduledAt: "asc" } } } }, prescription: true },
  });

  if (!plan) return ok({ plan: null, doses: [], patient });

  const doses = plan.medications.flatMap((m) =>
    m.doses.map((d) => ({
      id: d.id,
      medicationId: m.id,
      brand: m.brand,
      molecule: m.molecule,
      doseMg: m.doseMg,
      time: d.scheduledAt.toISOString(),
      status: d.status,
      note: d.note,
    }))
  ).sort((a, b) => a.time.localeCompare(b.time));

  return ok({
    patient: { id: patient.id, name: patient.name, contexts: patient.contexts },
    plan: { id: plan.id, label: plan.label, createdAt: plan.createdAt, prescriptionVerdict: plan.prescription?.verdict },
    medications: plan.medications.map((m) => ({ id: m.id, brand: m.brand, molecule: m.molecule, doseMg: m.doseMg, frequency: m.frequencyCode, times: JSON.parse(m.timesJson) as string[], durationDays: m.durationDays })),
    doses,
  });
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function tomorrowEnd(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(23, 59, 59, 999);
  return d;
}
