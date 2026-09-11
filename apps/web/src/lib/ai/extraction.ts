/**
 * Perception layer — turns raw prescription text into structured lines.
 *
 * Contract ("the model reads, the rules decide"):
 *  - The LLM proposes {raw, brand, strength, frequency, days, confidence}.
 *  - The deterministic engine re-normalizes against the formulary; a brand
 *    the model invents resolves to nothing and lands in the confirm queue.
 *  - Line confidence = LLM confidence x formulary-match factor.
 *  - If the LLM is unavailable, a deterministic splitter keeps the demo
 *    alive (resilience over elegance; honesty over fake answers).
 */

import ZAI from "z-ai-web-dev-sdk";

export interface ExtractedLine {
  raw: string;
  confidence: number;
}

export interface ExtractionOutcome {
  lines: ExtractedLine[];
  engine: "llm" | "deterministic-fallback";
  llmMs: number;
  note?: string;
}

const SYSTEM = `You extract structured medication lines from Indian prescriptions.
Return STRICT JSON only: {"lines":[{"raw":"<original line text>","confidence":<0-1 float>}]}
Rules:
- One array entry per distinct medicine (a line may combine a brand + frequency + duration).
- confidence is the model's honest per-line reading confidence. Use low values (<0.5) for unclear, partial, or ambiguous lines.
- Do NOT resolve brands to molecules. Do NOT invent medicines. If the text is not a prescription, return {"lines":[]}.
- Maximum 15 lines.`;

/**
 * Privacy kill switch (audit Ch.12): MEDISAATHI_DISABLE_MODEL_EGRESS=1
 * hard-disables every outbound model call. The deterministic splitter takes
 * over and the safety plane runs at full strength — zero third-party
 * transmission, by configuration rather than by promise.
 */
export function modelEgressDisabled(): boolean {
  return process.env.MEDISAATHI_DISABLE_MODEL_EGRESS === "1";
}

export async function extractPrescriptionLines(text: string): Promise<ExtractionOutcome> {
  const t0 = Date.now();
  const clipped = text.trim().slice(0, 2000);

  if (modelEgressDisabled()) {
    throw new Error("model egress disabled by MEDISAATHI_DISABLE_MODEL_EGRESS");
  }

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        // MS-09: system instructions travel as role "system" (instruction
        // hierarchy), not as an assistant turn the user content outranks.
        { role: "system", content: SYSTEM },
        { role: "user", content: clipped },
      ],
      thinking: { type: "disabled" },
    });
    const content = completion.choices[0]?.message?.content ?? "";
    const jsonText = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonText) as { lines?: { raw?: string; confidence?: number }[] };
    const lines = (parsed.lines ?? [])
      .filter((l) => typeof l.raw === "string" && l.raw.trim().length > 0)
      .slice(0, 15)
      .map((l) => ({
        raw: (l.raw as string).trim().slice(0, 160),
        confidence: Math.max(0, Math.min(1, typeof l.confidence === "number" ? l.confidence : 0.5)),
      }));
    if (lines.length === 0) {
      return { lines: [], engine: "llm", llmMs: Date.now() - t0, note: "Model reports no medication content in this text." };
    }
    return { lines, engine: "llm", llmMs: Date.now() - t0 };
  } catch {
    // Deterministic fallback: split on newlines / semicolons / bullets.
    const lines = clipped
      .split(/\n|;|•|\d+\.\s/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4)
      .slice(0, 15)
      .map((s) => ({ raw: s, confidence: 0.7 }));
    return {
      lines,
      engine: "deterministic-fallback",
      llmMs: Date.now() - t0,
      note: "Language service unavailable — deterministic line-splitter used. Safety checks remain fully active.",
    };
  }
}
