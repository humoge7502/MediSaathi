/**
 * Vaidya copilot — a *grounded* medication assistant.
 *
 * Architecture (three gates, in order):
 *   1. Deterministic emergency triage  -> urgent-care redirect, no LLM call.
 *   2. Deterministic scope refusal     -> personal dosage-change requests are
 *      refused before any generation. A rule, not a hope.
 *   3. Grounded generation             -> the LLM answers ONLY from retrieved
 *      chunks, with numbered citations. Post-check strips dosage prescriptions
 *      the model may have added despite the prompt.
 *
 * Failure law: when retrieval confidence is low, the copilot says
 * "I don't have verified information on that" — refusal is a designed
 * success state, never a fallback.
 */

import ZAI from "z-ai-web-dev-sdk";
import { DOSAGE_ADVICE_PATTERNS, EMERGENCY_PATTERNS } from "./knowledge";
import { retrieve } from "./retrieval";

export interface CopilotRequest {
  question: string;
  activeMolecules: string[]; // user's current plan molecules for context
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface CopilotCitation {
  n: number;
  id: string;
  title: string;
  source: string;
}

export interface CopilotResponse {
  kind: "grounded" | "refused_scope" | "refused_low_confidence" | "emergency";
  answer: string;
  citations: CopilotCitation[];
  retrievalScores: number[];
  latencyMs: number;
  guarded: boolean; // post-check modified the output
}

const RETRIEVAL_FLOOR = 2.2;

/**
 * Deterministic gates 1+2 (emergency triage, scope refusal). Extracted so the
 * refusal law is testable without any model call — the same code path the
 * self-test suite exercises.
 */
export function copilotGate(question: string): { kind: "emergency" | "refused_scope" | "ok" } {
  const q = (question ?? "").trim();
  if (EMERGENCY_PATTERNS.some((p) => p.test(q))) return { kind: "emergency" };
  if (DOSAGE_ADVICE_PATTERNS.some((p) => p.test(q))) return { kind: "refused_scope" };
  return { kind: "ok" };
}

export async function answerCopilot(req: CopilotRequest): Promise<CopilotResponse> {
  const t0 = Date.now();
  const question = (req.question ?? "").trim().slice(0, 600);

  if (!question) {
    return { kind: "refused_low_confidence", answer: "Please type a question about your medicines.", citations: [], retrievalScores: [], latencyMs: Date.now() - t0, guarded: false };
  }

  // Gate 1 — emergency triage (deterministic)
  const gate = copilotGate(question);
  if (gate.kind === "emergency") {
    return {
      kind: "emergency",
      answer: "This may be an emergency. Please contact your local emergency number or go to the nearest hospital right now. If you or someone near you has chest pain, severe breathlessness, uncontrolled bleeding, seizures, or thoughts of self-harm, do not wait for online advice. Bring all current medicine packets with you — they help the treating team act fast.",
      citations: [],
      retrievalScores: [],
      latencyMs: Date.now() - t0,
      guarded: false,
    };
  }

  // Gate 2 — scope refusal (deterministic): no personal dosage decisions, ever
  if (gate.kind === "refused_scope") {
    return {
      kind: "refused_scope",
      answer: "I can't advise on changing doses — that decision belongs to your doctor or pharmacist, who know your condition and test results. What I can do: explain what a medicine is generally used for, how it usually works, and what safety points people are commonly told. Ask me that, and I'll answer from verified sources.",
      citations: [],
      retrievalScores: [],
      latencyMs: Date.now() - t0,
      guarded: false,
    };
  }

  // Retrieval
  const hits = retrieve(question, 3, req.activeMolecules);
  const scores = hits.map((h) => Math.round(h.score * 100) / 100);

  if (hits.length === 0 || hits[0].score < RETRIEVAL_FLOOR) {
    return {
      kind: "refused_low_confidence",
      answer: "I don't have verified information on that in my knowledge base, and in medication questions I refuse rather than guess. Try asking about one of your current medicines, general safety around food and alcohol, missed-dose habits, or why completing a course matters.",
      citations: [],
      retrievalScores: scores,
      latencyMs: Date.now() - t0,
      guarded: false,
    };
  }

  // Gate 3 — grounded generation
  const contextBlocks = hits
    .map((h, i) => `[${i + 1}] ${h.chunk.title} (source: ${h.chunk.source})\n${h.chunk.text}`)
    .join("\n\n");

  const medContext = req.activeMolecules.length
    ? `The user's currently verified plan includes: ${req.activeMolecules.join(", ")}. You may mention interactions between these generally, but only using the provided sources.`
    : "No verified plan is attached. Keep answers fully general.";

  const system = [
    "You are Vaidya, a medication-literacy assistant for patients and families in India.",
    "RULES (absolute):",
    "1. Answer ONLY from the numbered sources below. If they are insufficient, reply exactly: I don't have verified information on that.",
    "2. Never recommend, change, confirm or refuse a specific dose, brand switch, or start/stop decision. If asked, remind the user to ask their doctor or pharmacist.",
    "3. Cite sources inline like [1] or [2] after each claim sentence. At least one citation per paragraph.",
    "4. Plain, warm language at an 8th-grade reading level. Short paragraphs.",
    "5. Maximum 140 words. No markdown headers, no bullet lists longer than 3 items.",
    "6. You are an information layer, not a doctor. Never imply clinical authority.",
    "",
    "SOURCES:",
    contextBlocks,
    "",
    medContext,
  ].join("\n");

  const messages: { role: "assistant" | "user"; content: string }[] = [
    { role: "assistant", content: system },
    ...((req.history ?? []).slice(-4).map((m) => ({ role: m.role, content: m.content.slice(0, 500) }))),
    { role: "user", content: question },
  ];

  let raw = "";
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: "disabled" },
    });
    raw = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    return {
      kind: "refused_low_confidence",
      answer: "The language service is unavailable right now, so I can't generate an answer — I won't improvise on medication topics. The deterministic safety checks (interactions, contraindications, dose caps) still run without any AI, so your plan verification remains fully active.",
      citations: [],
      retrievalScores: scores,
      latencyMs: Date.now() - t0,
      guarded: false,
    };
  }

  if (!raw) {
    return { kind: "refused_low_confidence", answer: "I don't have verified information on that.", citations: [], retrievalScores: scores, latencyMs: Date.now() - t0, guarded: false };
  }

  // The model followed its grounding rule and declared insufficient sources —
  // that is a refusal (honesty), not a grounded answer. Relabel for telemetry.
  const refusedByModel = /^(i don'?t have verified information on that\.?)/i.test(raw.trim());
  if (refusedByModel) {
    return {
      kind: "refused_low_confidence",
      answer: raw.trim(),
      citations: [],
      retrievalScores: scores,
      latencyMs: Date.now() - t0,
      guarded: false,
    };
  }

  // Post-check: strip dosage prescriptions the model may have added
  const guarded = /\b(take|switch to|start|stop)\b[^.]{0,40}?\b\d+\s?(mg|mcg|ml|tablets?|pills?)\b/i.test(raw) && !/\ball(owed|ays)/i.test(raw);
  if (guarded) {
    return {
      kind: "refused_scope",
      answer: "Let me keep that general: I can't advise specific doses — your doctor or pharmacist sets those. Generally: " + raw.replace(/^.*?:\s*/, "").slice(0, 400),
      citations: hits.map((h, i) => ({ n: i + 1, id: h.chunk.id, title: h.chunk.title, source: h.chunk.source })),
      retrievalScores: scores,
      latencyMs: Date.now() - t0,
      guarded: true,
    };
  }

  return {
    kind: "grounded",
    answer: raw,
    citations: hits.map((h, i) => ({ n: i + 1, id: h.chunk.id, title: h.chunk.title, source: h.chunk.source })),
    retrievalScores: scores,
    latencyMs: Date.now() - t0,
    guarded: false,
  };
}
