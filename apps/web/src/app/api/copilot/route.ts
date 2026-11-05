import { db } from "@/lib/db";
import { ok, fail, audit, readJson, bodyError } from "@/lib/api-helpers";
import { answerCopilot } from "@/lib/ai/copilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/copilot — knowledge-base stats for the UI. */
export async function GET() {
  const { KNOWLEDGE } = await import("@/lib/ai/knowledge");
  return ok({ chunks: KNOWLEDGE.length, sources: [...new Set(KNOWLEDGE.map((k) => k.source))] });
}

/**
 * POST /api/copilot — grounded Q&A.
 * Body: { question, history?: [{role, content}] }
 * The user's active plan molecules are attached as retrieval context.
 */
export async function POST(req: Request) {
  let body: { question?: string; history?: { role: "user" | "assistant"; content: string }[] };
  try {
    body = await readJson<typeof body>(req);
  } catch (e) {
    return bodyError(e);
  }

  // Unauthenticated input, and both fields are walked with string methods one
  // layer down (the prompt builder slices the history) — so narrow at the edge.
  const question = (typeof body.question === "string" ? body.question : "").trim();
  if (!question) return fail("question is required");
  const history = Array.isArray(body.history)
    ? body.history.filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    : undefined;

  const plan = await db.therapyPlan.findFirst({
    where: { status: "active" },
    include: { medications: true },
  });
  const activeMolecules = [...new Set((plan?.medications ?? []).flatMap((m) => m.molecule.split("+").map((s) => s.trim())))];

  const res = await answerCopilot({ question, activeMolecules, history });

  await audit("copilot.query", { kind: res.kind, latencyMs: res.latencyMs });
  return ok(res);
}
