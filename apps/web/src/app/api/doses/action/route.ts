import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, audit } from "@/lib/api-helpers";
import { catchUpGuidance } from "@/lib/safety/adherence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/doses/action
 * Body: { doseId: string, action: "taken" | "skipped" }
 * Overdue doses get deterministic catch-up guidance before the action.
 * Taking a very overdue dose also notifies the family circle (escalation feed).
 */
export async function POST(req: NextRequest) {
  let body: { doseId?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const { doseId, action } = body;
  if (!doseId || !action || !["taken", "skipped"].includes(action)) {
    return fail("doseId and action (taken|skipped) are required");
  }

  const dose = await db.dose.findUnique({ where: { id: doseId }, include: { medication: { include: { plan: true } } } });
  if (!dose) return fail("Dose not found", 404);

  // First action wins. A dose that was already taken/skipped/missed is never
  // re-mutated — this is the double-dose guardrail: replaying "taken" (a
  // double tap, a retry, a script) cannot log a second intake.
  if (dose.status !== "pending") {
    await audit("dose.guarded", { doseId, action, reason: `already ${dose.status}` });
    return ok({
      status: "already_acted",
      dose: { id: dose.id, status: dose.status, note: dose.note },
      message: `This dose was already logged as ${dose.status}. It is not changed — never take a double dose to catch up.`,
    });
  }

  const now = new Date();
  const overdue = dose.scheduledAt < now;

  // Next pending dose for this medication after this one
  const nextDose = await db.dose.findFirst({
    where: { medicationId: dose.medicationId, scheduledAt: { gt: dose.scheduledAt }, status: "pending" },
    orderBy: { scheduledAt: "asc" },
  });

  const guidance = overdue ? catchUpGuidance(dose.scheduledAt, nextDose?.scheduledAt ?? null, now) : null;

  // Guardrail: refuse "taken" when guidance says skip — never let the UI double-dose.
  // The dose is actually persisted as skipped so it cannot be taken later.
  if (action === "taken" && guidance?.action === "skip_and_continue") {
    const protectedDose = await db.dose.update({
      where: { id: doseId },
      data: { status: "skipped", actedAt: now, note: "Protected by catch-up guardrail (too close to next dose)" },
    });
    await audit("dose.guarded", { doseId, action, reason: "too close to next dose" });
    return ok({
      status: "guarded",
      guidance,
      message: "This dose was logged as skipped-and-protected: taking it now would put two doses too close together. The next dose stays on schedule.",
      doseStatus: "skipped",
      dose: { id: protectedDose.id, status: protectedDose.status, note: protectedDose.note },
    });
  }

  const updated = await db.dose.update({
    where: { id: doseId },
    data: { status: action, actedAt: now, note: guidance ? guidance.text : null },
  });

  // Family-circle escalation for notably late intakes or skips
  if (overdue) {
    const lateHours = Math.round(((now.getTime() - dose.scheduledAt.getTime()) / 3600000) * 10) / 10;
    const patient = await db.patient.findFirst({ where: { id: dose.medication.plan.patientId } });
    if (patient) {
      await db.escalationEvent.create({
        data: {
          patientId: patient.id,
          kind: "dose_checkin",
          severity: lateHours >= 6 ? "moderate" : "info",
          message:
            action === "taken"
              ? `${patient.name.split(" ")[0]} took ${dose.medication.brand} about ${lateHours}h later than scheduled.`
              : `${patient.name.split(" ")[0]} skipped ${dose.medication.brand} (${lateHours}h overdue).`,
        },
      });
    }
  }

  await audit("dose.action", { doseId, action, overdue });

  return ok({
    status: "updated",
    dose: { id: updated.id, status: updated.status, note: updated.note },
    guidance,
  });
}
