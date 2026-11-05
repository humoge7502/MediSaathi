import { db } from "@/lib/db";
import { ok, fail, bumpMetric, audit, readJson, bodyError, scopePatient } from "@/lib/api-helpers";
import { runSafetyPlane, overallConfidence } from "@/lib/safety/engine";
import { DEFAULT_THRESHOLD_SET_ID } from "@/lib/safety/gate";
import { applyRegimenEscalation } from "@/lib/regimen-state";
import { syncQueue } from "@/lib/queue";
import { extractPrescriptionLines } from "@/lib/ai/extraction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/verify
 * Body: { text: string, contexts: string[] }
 * Pipeline: perception (LLM, gated) -> safety plane (deterministic) -> verdict.
 * Every run is persisted with full provenance and counted in metrics.
 */
export async function POST(req: Request) {
  let body: { text?: string; contexts?: string[] };
  try {
    body = await readJson<typeof body>(req);
  } catch (e) {
    return bodyError(e);
  }

  const text = (typeof body.text === "string" ? body.text : "").trim();
  // Deliberately no per-context length cap: a declared context is safety
  // signal ("… and I take warfarin"), and truncating it could drop the very
  // word that raises a contraindication. The count is capped and the whole
  // body is now bounded at the edge instead.
  const contexts = Array.isArray(body.contexts) ? body.contexts.slice(0, 20).map(String) : [];
  if (text.length < 3) return fail("Prescription text is too short to verify");
  if (text.length > 4000) return fail("Prescription text is too long (max 4000 chars)");

  // 1. Perception plane (LLM proposes; never decides)
  //
  // Ownership (TD-1 progress) is resolved before the first write: the visit is
  // stamped with the patient this build serves, so a later route can tell a
  // foreign prescription id from a local one instead of trusting the caller. On
  // a fresh install the very first verify runs before any Patient row exists —
  // NULL there means "not claimed yet", and /api/plans claims the row when it
  // adopts the prescription.
  const scope = await scopePatient();
  let extraction;
  try {
    extraction = await extractPrescriptionLines(text);
  } catch {
    extraction = { lines: [], engine: "deterministic-fallback" as const, llmMs: 0, note: "Extraction crashed — refusing rather than guessing." };
  }

  if (extraction.lines.length === 0) {
    // Honest refusal — a designed success state
    await Promise.all([
      db.prescription.create({
        data: {
          rawText: text,
          verdict: "refused",
          confidence: 0,
          extractionJson: JSON.stringify({ lines: extraction.lines, engine: extraction.engine, note: extraction.note ?? "no medication content detected" }),
          findingsJson: "[]",
          engineSnapshot: "n/a",
          contextsJson: JSON.stringify(contexts),
          patientId: scope?.id ?? null,
        },
      }),
      bumpMetric("verifications"),
      bumpMetric("refusals"),
      audit("verify.refused", { engine: extraction.engine }),
    ]);
    return ok({
      verdict: "refused",
      headline: "Refused — no medication content detected",
      findings: [],
      confirmed: [],
      confirmQueue: [],
      aggregateDailyMg: {},
      extractionEngine: extraction.engine,
      extractionNote: extraction.note,
      prescriptionId: null,
      confidence: 0,
      pipelineMs: extraction.llmMs,
    });
  }

  // 2. Safety plane (deterministic, zero-network)
  // Confidence source: when the LLM read the lines, its per-line confidence
  // gates the plane. When the deterministic splitter is running (model tier
  // unavailable), the plane uses its own formulary-grounded brand-match
  // confidence instead of a flat guess — exact formulary lines auto-confirm
  // and the safety checks still demonstrate, while garbage still queues.
  const report = runSafetyPlane({
    rawLines: extraction.lines.map((l) => l.raw),
    contexts,
    lineConfidence: extraction.engine === "llm" ? extraction.lines.map((l) => l.confidence) : undefined,
    thresholdSetId: DEFAULT_THRESHOLD_SET_ID,
  });

  // Formulary-match factor: LLM brand claims that resolve nowhere lose confidence.
  // The formula lives in the safety plane as overallConfidence() (audit TD-F):
  // named, documented, boundary-tested — not a magic-weight inline expression.
  const confidence = overallConfidence(
    report.confirmed.length,
    report.confirmQueue.length,
    extraction.lines.map((l) => l.confidence)
  );

  // 3. Longitudinal regimen escalation (mechanisms A+B) — the law lives in
  // ONE place (applyRegimenEscalation) so verify and the queue-resolve path
  // apply it identically. Composed harms escalate the verdict; read
  // uncertainty that could hide harm queues; refills pass.
  const { regimen, finalVerdict, finalHeadline, confirmQueue, escalated: regimenEscalated } =
    await applyRegimenEscalation(report, extraction, contexts, DEFAULT_THRESHOLD_SET_ID);

  // 4. Persist with provenance
  const prescription = await db.prescription.create({
    data: {
        rawText: text,
        verdict: finalVerdict,
        confidence: confidence,
      extractionJson: JSON.stringify({ lines: extraction.lines, engine: extraction.engine, note: extraction.note ?? null }),
      findingsJson: JSON.stringify(report.findings),
      engineSnapshot: report.snapshot,
      contextsJson: JSON.stringify(contexts),
      patientId: scope?.id ?? null,
      // Gate-law provenance (MED-003): threshold set + fused score per verdict.
      thresholdSetId: report.gate?.thresholdSetId ?? DEFAULT_THRESHOLD_SET_ID,
      prescriptionFused: report.gate?.prescriptionFused ?? confidence,
      // Regimen escalation provenance (TD-12): nominal/worst verdicts,
      // fragility, verdict mass, crossing findings.
      regimenJson: JSON.stringify(regimen),
    },
  });

  // Persist the human-confirmation band as a state machine (MED-002). The plan
  // endpoint blocks while any of these rows is pending; the regimen escalation
  // rides the same machine (fieldIndex 0).
  await syncQueue(prescription.id, confirmQueue);

  await Promise.all([
    bumpMetric("verifications"),
    ...(finalVerdict === "refused" ? [bumpMetric("refusals")] : []),
    ...(report.findings.length > 0 ? [bumpMetric("findings_raised", report.findings.length)] : []),
    ...(regimenEscalated ? [bumpMetric("regimen_escalations")] : []),
    audit("verify.run", { verdict: finalVerdict, engine: extraction.engine, findings: report.findings.length, engineMs: report.engineMs, regimenEscalated }),
  ]);

  return ok({
    prescriptionId: prescription.id,
    verdict: finalVerdict,
    headline: finalHeadline,
    findings: report.findings,
    confirmed: report.confirmed,
    confirmQueue,
    aggregateDailyMg: report.aggregateDailyMg,
    extractionEngine: extraction.engine,
    extractionNote: extraction.note,
    confidence: confidence,
    snapshot: report.snapshot,
    engineMs: report.engineMs,
    pipelineMs: extraction.llmMs + report.engineMs,
    // Gate provenance + why-queued explanations (MED-014).
    thresholdSetId: report.gate?.thresholdSetId ?? DEFAULT_THRESHOLD_SET_ID,
    prescriptionFused: report.gate?.prescriptionFused ?? confidence,
    prescriptionBand: report.gate?.prescriptionBand ?? null,
    gateDecisions: report.gate?.decisions ?? [],
    // Longitudinal regimen screen (TD-12): shown in the UI when present.
    regimen: regimen
      ? {
          verdict: regimen.verdict,
          nominalVerdict: regimen.nominalVerdict,
          worstVerdict: regimen.worstVerdict,
          fragility: regimen.fragility,
          queued: regimen.queued,
          findings: regimen.findings,
          worlds: regimen.worlds,
          activeCount: regimen.provenance.activeCount as number,
        }
      : null,
  });
}
