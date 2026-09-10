import { ok, audit } from "@/lib/api-helpers";
import { runCopilotEval, EVAL_CASES } from "@/lib/ai/evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/evals — the labeled case set (without running it). */
export async function GET() {
  return ok({ cases: EVAL_CASES.map((c) => ({ id: c.id, question: c.question, expect: c.expect })), n: EVAL_CASES.length });
}

/** POST /api/evals — run the full evaluation suite (copilot + rubric judge). */
export async function POST() {
  const outcome = await runCopilotEval();
  await audit("evals.run", { n: outcome.rows.length, typeAccuracy: outcome.means.typeAccuracy });
  return ok(outcome);
}
