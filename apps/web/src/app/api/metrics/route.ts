import { db } from "@/lib/db";
import { ok } from "@/lib/api-helpers";
import { SNAPSHOT } from "@/lib/safety/dataset";
import { INTERACTIONS, CONTRAINDICATIONS, BRANDS } from "@/lib/safety/dataset";
import { runSafetyPlane } from "@/lib/safety/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/metrics — public telemetry for the hero counter and judge walkthrough. */
export async function GET() {
  const metrics = await db.metric.findMany();
  const map: Record<string, number> = {};
  for (const m of metrics) map[m.key] = m.value;

  const [prescriptions, plans, events, queuePending, queueResolved] = await Promise.all([
    db.prescription.count(),
    db.therapyPlan.count(),
    db.escalationEvent.count(),
    db.confirmQueueItem.count({ where: { state: "pending" } }),
    db.confirmQueueItem.count({ where: { state: { in: ["confirmed", "rejected"] } } }),
  ]);

  return ok({
    verifications: map.verifications ?? 0,
    refusals: map.refusals ?? 0,
    findingsRaised: map.findings_raised ?? 0,
    plansStarted: map.plans_started ?? 0,
    prescriptions,
    plans,
    escalationEvents: events,
    // Gate-law telemetry (MED-003): queue burden vs. resolved automation.
    confirmQueuePending: queuePending,
    confirmQueueResolved: queueResolved,
    queueResolutionRate:
      queuePending + queueResolved > 0
        ? Math.round((queueResolved / (queuePending + queueResolved)) * 1000) / 1000
        : null,
    dataset: {
      snapshot: SNAPSHOT,
      brands: BRANDS.length,
      interactions: INTERACTIONS.length,
      contraindications: CONTRAINDICATIONS.length,
    },
    pipeline: {
      // Engine-side latency measured on THIS request (deterministic plane;
      // zero network), complementing the API tier's /slo endpoint.
      engineMs: runSafetyPlane({
        rawLines: ["Dolo 650 mg TDS 5 days"],
        contexts: [],
        skipGate: true,
      }).engineMs,
    },
  });
}
