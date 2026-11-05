import { db } from "@/lib/db";
import { ok, fail, scopePatient, prescriptionInScope } from "@/lib/api-helpers";
import { queueHistory } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/queue/history?prescriptionId=... — append-only transition audit.
 *
 *  Scoped the way the queue itself is (TD-1 progress): a transition row records
 *  which brand a reviewer accepted for which read, so it is a patient's record
 *  like any other. A foreign or unknown id answers with the empty history a
 *  never-queued prescription has — a distinct status here would confirm that
 *  the id exists, which is the one thing a route with no authentication should
 *  not hand out. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("prescriptionId");
  if (!id) return fail("prescriptionId is required");
  const scope = await scopePatient();
  const prescription = await db.prescription.findUnique({ where: { id }, select: { patientId: true } });
  if (!prescription || !prescriptionInScope(prescription, scope?.id ?? null)) return ok({ transitions: [], count: 0 });
  const transitions = await queueHistory(id);
  return ok({ transitions, count: transitions.length });
}
