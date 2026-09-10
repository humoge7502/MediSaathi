import { db } from "@/lib/db";
import { ok } from "@/lib/api-helpers";
import { SNAPSHOT } from "@/lib/safety/dataset";
import { INTERACTIONS, CONTRAINDICATIONS, BRANDS } from "@/lib/safety/dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/metrics — public telemetry for the hero counter and judge walkthrough. */
export async function GET() {
  const metrics = await db.metric.findMany();
  const map: Record<string, number> = {};
  for (const m of metrics) map[m.key] = m.value;

  const [prescriptions, plans, events] = await Promise.all([
    db.prescription.count(),
    db.therapyPlan.count(),
    db.escalationEvent.count(),
  ]);

  return ok({
    verifications: map.verifications ?? 0,
    refusals: map.refusals ?? 0,
    findingsRaised: map.findings_raised ?? 0,
    plansStarted: map.plans_started ?? 0,
    prescriptions,
    plans,
    escalationEvents: events,
    dataset: {
      snapshot: SNAPSHOT,
      brands: BRANDS.length,
      interactions: INTERACTIONS.length,
      contraindications: CONTRAINDICATIONS.length,
    },
  });
}
