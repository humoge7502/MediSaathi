import { ok, fail, audit, readJson, bodyError } from "@/lib/api-helpers";
import { runCopilotEval, EVAL_CASES, type EvalOutcome } from "@/lib/ai/evals";
import { makeRunGuard } from "@/lib/run-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** One guard per process — see the law in `@/lib/run-guard`. */
const guard = makeRunGuard<EvalOutcome>();

/** How long a finished run answers for. 2 minutes is a judgement, not a
 *  constant of nature: it is long enough that a page refresh, a second tab or
 *  an impatient double-click costs nothing, and short enough that a reviewer
 *  who is genuinely iterating on the knowledge base sees the new numbers
 *  without hunting for a flag. */
const reuseWindowMs = () => {
  // Not `Number(env) || 120_000`: that reads an explicit `0` — "no window, run
  // every time" — as if it were unset, and silently keeps the default. But `""`
  // is the opposite hazard: a set-but-empty variable is `""`, `Number("")` is a
  // legal `0`, and a blank line in an operator's `.env` would then run the
  // ~20-model-call suite on every request. Blank is unset; a written `0` is `0`.
  const raw = process.env.MEDISAATHI_EVAL_REUSE_MS?.trim();
  if (raw === "") return 120_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 120_000;
};

/** GET /api/evals — the labeled case set (without running it). */
export async function GET() {
  return ok({
    cases: EVAL_CASES.map((c) => ({ id: c.id, question: c.question, expect: c.expect })),
    n: EVAL_CASES.length,
    reuseMs: reuseWindowMs(),
  });
}

/**
 * POST /api/evals — run the full evaluation suite (copilot + rubric judge).
 * Body: { force?: boolean }. Concurrent calls join the run already in flight;
 * a call inside the reuse window is served the previous run and told so.
 */
export async function POST(req: Request) {
  let body: { force?: boolean };
  try {
    body = await readJson<{ force?: boolean }>(req);
  } catch (e) {
    return bodyError(e);
  }

  const reuseMs = reuseWindowMs();
  const force = body.force === true;

  let outcome;
  try {
    outcome = await guard.run(runCopilotEval, { reuseMs, force });
  } catch (e) {
    // Never rethrow: an unhandled error here is a 500 carrying a stack trace
    // from the model client, and it would leave the caller guessing whether
    // anything was billed.
    console.error("evals.POST failed", e);
    await audit("evals.failed", { error: e instanceof Error ? e.name : "unknown" });
    return fail("The evaluation suite did not complete. Nothing was recorded as a result.", 500);
  }

  await audit("evals.run", {
    n: outcome.value.rows.length,
    typeAccuracy: outcome.value.means.typeAccuracy,
    source: outcome.source,
  });
  return ok({
    ...outcome.value,
    run: { source: outcome.source, ageMs: outcome.ageMs, reuseMs, launches: guard.launches },
  });
}
