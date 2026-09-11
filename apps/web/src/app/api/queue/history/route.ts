import { ok, fail } from "@/lib/api-helpers";
import { queueHistory } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/queue/history?prescriptionId=... — append-only transition audit. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("prescriptionId");
  if (!id) return fail("prescriptionId is required");
  const transitions = await queueHistory(id);
  return ok({ transitions, count: transitions.length });
}
