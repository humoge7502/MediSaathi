import { db } from "@/lib/db";
import { ok } from "@/lib/api-helpers";
import { computeAnalytics } from "@/lib/safety/adherence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/analytics — adherence analytics over the active plan (14-day window). */
export async function GET() {
  const patient = await db.patient.findFirst();
  if (!patient) return ok({ analytics: null, hasPlan: false });

  const plan = await db.therapyPlan.findFirst({
    where: { patientId: patient.id, status: "active" },
    include: { medications: { include: { doses: true } } },
  });

  if (!plan) return ok({ analytics: null, hasPlan: false });

  const rows = plan.medications.flatMap((m) =>
    m.doses.map((d) => ({
      medicationId: m.id,
      brand: m.brand,
      scheduledAt: d.scheduledAt,
      status: d.status,
    }))
  );

  const analytics = computeAnalytics(rows, 14);
  return ok({ analytics, hasPlan: true, planLabel: plan.label });
}
