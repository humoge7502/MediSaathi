import { db } from "@/lib/db";
import { ok, fail, audit, readJson, bodyError, scopePatient } from "@/lib/api-helpers";
import { catchUpGuidance } from "@/lib/safety/adherence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/doses/action
 * Body: { doseId: string, action: "taken" | "skipped" }
 * Overdue doses get deterministic catch-up guidance before the action.
 * Taking a very overdue dose also notifies the family circle (escalation feed).
 */
export async function POST(req: Request) {
  let body: { doseId?: string; action?: string };
  try {
    body = await readJson<typeof body>(req);
  } catch (e) {
    return bodyError(e);
  }

  const doseId = typeof body.doseId === "string" ? body.doseId : null;
  const action = typeof body.action === "string" ? body.action : null;
  if (!doseId || !action || !["taken", "skipped"].includes(action)) {
    return fail("doseId and action (taken|skipped) are required");
  }

  const dose = await db.dose.findUnique({ where: { id: doseId }, include: { medication: { include: { plan: true } } } });
  if (!dose) return fail("Dose not found", 404);

  // A dose id is a capability the client supplies, so it is checked against the
  // identity this server actually serves before anything is written: acting on a
  // dose that belongs to a different patient is answered exactly like a dose that
  // does not exist, so the response cannot confirm whose rows are in the store.
  const scope = await scopePatient();
  if (!scope || dose.medication.plan.patientId !== scope.id) return fail("Dose not found", 404);

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
  const lateHours = Math.round(((now.getTime() - dose.scheduledAt.getTime()) / 3600000) * 10) / 10;
  // Read once, here: the two guards above proved `dose` and `scope` non-null, and
  // a closure over the narrowed originals would have to be re-proved by whoever
  // reads this next.
  const patientId = scope.id;
  const firstName = scope.name.split(" ")[0];
  const brand = dose.medication.brand;

  /**
   * Tell the family circle about an overdue intake or skip.
   *
   * `forced` marks the dose the engine skipped on the patient's behalf. The
   * panel's own escalation law promises the circle is told when a dose is
   * skipped — and a dose skipped to block a double intake is the one a relative
   * most needs to read, so both write paths announce it rather than only the
   * path the patient chose.
   */
  const notifyCircle = async (action: "taken" | "skipped", forced: boolean) => {
    if (!overdue) return;
    await db.escalationEvent.create({
      data: {
        patientId,
        kind: "dose_checkin",
        severity: lateHours >= 6 || forced ? "moderate" : "info",
        message: forced
          ? `${firstName} tried to take ${brand} ${lateHours}h late — the guardrail logged it skipped so two doses stay apart.`
          : action === "taken"
            ? `${firstName} took ${brand} about ${lateHours}h later than scheduled.`
            : `${firstName} skipped ${brand} (${lateHours}h overdue).`,
      },
    });
  };

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
    await notifyCircle("skipped", true);
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

  await notifyCircle(action as "taken" | "skipped", false);

  await audit("dose.action", { doseId, action, overdue });

  return ok({
    status: "updated",
    dose: { id: updated.id, status: updated.status, note: updated.note },
    guidance,
  });
}
