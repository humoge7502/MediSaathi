import { db } from "@/lib/db";
import {
  ok, fail, bumpMetric, audit, parseStored, UnreadableRecordError, readJson, bodyError,
  scopePatient, prescriptionInScope,
} from "@/lib/api-helpers";
import { scheduleFor, slotDates } from "@/lib/safety/adherence";
import { PlanBlockedError, assertPlanAllowed, blockedReason } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/plans — start a therapy plan from a verified prescription.
 * Body: { prescriptionId: string }
 * Only verdicts that produced confirmed medications can become plans.
 */
export async function POST(req: Request) {
  let body: { prescriptionId?: string };
  try {
    body = await readJson<typeof body>(req);
  } catch (e) {
    return bodyError(e);
  }

  const prescriptionId = typeof body.prescriptionId === "string" ? body.prescriptionId : null;
  if (!prescriptionId) return fail("prescriptionId is required");

  const prescription = await db.prescription.findUnique({ where: { id: prescriptionId } });
  if (!prescription) return fail("Prescription not found", 404);
  // A prescriptionId arrives from the client, so it is checked against the
  // patient this build serves before anything is read or written (TD-1
  // progress). Answered exactly like a prescription that does not exist, so the
  // route cannot be used to discover which ids are real rows — or whose.
  const scope = await scopePatient();
  if (!prescriptionInScope(prescription, scope?.id ?? null)) return fail("Prescription not found", 404);
  if (prescription.verdict === "refused") return fail("This prescription was refused and cannot become a plan");

  // Persisted-queue block (MED-002): uncertainty deterministically halts
  // downstream automation. Checked here for a precise message AND again inside
  // the transaction below so the check and the write share one write lock.
  const reason = await blockedReason(prescriptionId);
  if (reason) return fail(reason, 409);

  // The contexts the prescription was screened against at verify time — never
  // re-screened with an empty context (that would silently drop
  // contraindication findings when a plan starts). The column is NOT NULL with
  // a default, so a value that will not parse is corruption, not history.
  let extraction: { lines?: { raw: string }[] };
  let findings: unknown[];
  let contexts: string[];
  try {
    extraction = parseStored(prescription.extractionJson, "verified lines");
    findings = parseStored(prescription.findingsJson, "safety findings");
    contexts = parseStored<string[]>(prescription.contextsJson, "declared patient contexts");
  } catch (e) {
    if (e instanceof UnreadableRecordError) {
      await audit("plan.unreadable_record", { prescriptionId: prescription.id });
      return fail(e.message, 409);
    }
    throw e;
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

  // Second line of defense (MED-021). The plane already routes a never-event
  // schedule into the confirm queue, which `assertPlanAllowed` below blocks on —
  // but the scheduler must refuse it independently, because the thing being
  // refused here is a lethal regimen (oral methotrexate once-daily), not a
  // preference. Same for a line the schedule law cannot read: inventing a
  // once-daily slot for an unstated frequency is how a weekly drug got dosed
  // daily, so an unreadable frequency is a hard stop, never a default.
  if (report.doseHazards.length > 0) {
    const hz = report.doseHazards[0];
    return fail(
      `${hz.brand} is prescribed ${hz.observed || "(no frequency)"}, but it is labeled ` +
        `${hz.required}. A human must confirm the interval before a plan can start.`,
      409
    );
  }
  const schedules = report.confirmed.map((m) => scheduleFor(m.frequency));
  const unreadable = report.confirmed.filter((_, i) => schedules[i] === null);
  if (unreadable.length > 0) {
    return fail(
      `Cannot schedule ${unreadable.map((m) => m.brand ?? m.rawText).join(", ")}: ` +
        "no recognized dosing frequency. Confirm the regimen first — the system will not invent one.",
      409
    );
  }

  // Demo patient (auth is post-event roadmap); first patient in DB is the demo
  // identity — the same row the ownership check above resolved.
  const patient = scope ?? (await db.patient.create({ data: { name: "Asha (demo patient)", ageYears: 67, sex: "female" } }));

  // Replace any previous active plan for the demo identity (single-patient event build).
  // The whole swap — archive old plan, create plan + medications + doses — runs in ONE
  // interactive transaction (audit TD-E): a failure mid-loop used to leave a partially
  // scheduled plan, and two concurrent starts could interleave archives and creates.
  const start = new Date();
  let created: { plan: { id: string; label: string }; slotCount: number };
  try {
    created = await db.$transaction(async (tx) => {
    // Transactional plan gate: throws while any confirm-queue row is pending.
    await assertPlanAllowed(tx, prescriptionId);
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

    // Claim the visit (Prescription.patientId). A prescription verified on a
    // fresh install predates the first Patient row and is therefore unowned;
    // the plan that adopts it ends that, so every later ownership check treats
    // it as this patient's. Conditional on NULL so an already-stamped row is
    // never re-owned by whoever starts a plan next.
    if (prescription.patientId === null) {
      await tx.prescription.update({ where: { id: prescription.id }, data: { patientId: patient.id } });
    }

    let slotCount = 0;
    for (const [i, med] of report.confirmed.entries()) {
      const schedule = schedules[i]!;
      const createdMed = await tx.medication.create({
        data: {
          planId: plan.id,
          brand: med.brand ?? med.rawText,
          molecule: med.molecule,
          atcClass: med.atc,
          doseMg: med.strengthMg ?? 0,
          frequencyCode: med.frequency || "OD",
          timesJson: JSON.stringify(schedule.times),
          durationDays: med.durationDays ?? 7,
          instructions: med.instructions,
        },
      });
      const doses = slotDates(schedule, med.durationDays ?? 7, start).map((scheduledAt) => ({
        medicationId: createdMed.id,
        scheduledAt,
        status: "pending",
      }));
      if (doses.length > 0) await tx.dose.createMany({ data: doses });
      slotCount += doses.length;
    }
    return { plan, slotCount };
    });
  } catch (e) {
    // A pending confirm-queue row is a designed 409, not a server error.
    if (e instanceof PlanBlockedError) return fail(e.message, 409);
    // Anything else is unexpected: the transaction above has already rolled
    // back, so keep the stack server-side and answer with the envelope the
    // client can render instead of a 500 with internals attached.
    console.error("plans.POST failed", e);
    await audit("plan.start_failed", {
      prescriptionId,
      error: e instanceof Error ? e.name : "unknown",
    });
    return fail("Could not start the plan. Nothing was scheduled.", 500);
  }
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

  const schedules: Record<string, string[]> = {};
  for (const m of plan.medications) {
    try {
      schedules[m.id] = parseStored<string[]>(m.timesJson, "dose schedule");
    } catch (e) {
      if (e instanceof UnreadableRecordError) return fail(e.message, 409);
      throw e;
    }
  }

  return ok({
    patient: { id: patient.id, name: patient.name, contexts: patient.contexts },
    plan: { id: plan.id, label: plan.label, createdAt: plan.createdAt, prescriptionVerdict: plan.prescription?.verdict },
    medications: plan.medications.map((m) => ({ id: m.id, brand: m.brand, molecule: m.molecule, doseMg: m.doseMg, frequency: m.frequencyCode, times: schedules[m.id], durationDays: m.durationDays })),
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
