import { db } from "@/lib/db";
import {
  ok, fail, audit, bumpMetric, parseStored, UnreadableRecordError, readJson, bodyError,
  scopePatient, prescriptionInScope,
} from "@/lib/api-helpers";
import { normalizeLine, runSafetyPlane, overallConfidence } from "@/lib/safety/engine";
import { DEFAULT_THRESHOLD_SET_ID } from "@/lib/safety/gate";
import { applyRegimenEscalation } from "@/lib/regimen-state";
import {
  blockedReason,
  queueStatus,
  resolveQueueField,
  syncQueue,
} from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/queue?prescriptionId=... — persisted confirmation queue + block state.
 * Without a prescriptionId, returns every open (pending) item: the pharmacist
 * console's work list.
 *
 * Both branches are scoped to the patient this build serves (TD-1 progress):
 * a queued field is a fragment of someone's clinical record — the raw reading
 * of their prescription — and there is no authentication in front of it, so the
 * only boundary left is that a row is shown when it belongs to the served
 * identity (or is not yet claimed by anyone). A foreign or invented
 * `prescriptionId` answers as an EMPTY queue rather than a fresh status code,
 * because a 404 here is a oracle that confirms which ids exist.
 *
 * Handlers are typed `Request` (not `NextRequest`): they only read the URL and
 * the JSON body, and the narrower signature keeps them drivable from the
 * integration suite with a plain `Request`.
 */
export async function GET(req: Request) {
  // `new URL(req.url)` rather than `req.nextUrl` so the handler is testable with
  // a plain Request (the integration suite drives it directly).
  const scope = await scopePatient();
  const scopeId = scope?.id ?? null;
  const id = new URL(req.url).searchParams.get("prescriptionId");
  if (id) {
    const prescription = await db.prescription.findUnique({ where: { id }, select: { patientId: true } });
    if (!prescription || !prescriptionInScope(prescription, scopeId)) {
      return ok({ prescriptionId: id, pending: 0, confirmed: 0, rejected: 0, blocked: false, items: [], blockedReason: null });
    }
    const status = await queueStatus(id);
    return ok({ ...status, blockedReason: await blockedReason(id) });
  }
  const open = await db.confirmQueueItem.findMany({
    where: {
      state: "pending",
      prescription: scopeId ? { OR: [{ patientId: scopeId }, { patientId: null }] } : { patientId: null },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { prescription: { select: { id: true, verdict: true, confidence: true, rawText: true, createdAt: true } } },
  });
  return ok({
    open: open.map((row) => ({
      id: row.id,
      prescriptionId: row.prescriptionId,
      fieldIndex: row.fieldIndex,
      rawText: row.rawText,
      fused: row.fused,
      band: row.band,
      why: row.why,
      state: row.state,
      createdAt: row.createdAt,
      prescription: {
        verdict: row.prescription.verdict,
        confidence: row.prescription.confidence,
        rawText: row.prescription.rawText,
        createdAt: row.prescription.createdAt,
      },
    })),
    count: open.length,
  });
}

/**
 * POST /api/queue — resolve one queued field (first transition wins).
 *
 * Body: { prescriptionId, fieldIndex, accepted, brandText?, actor?, note? }
 * On accept the human read (or the machine read, if no correction is supplied)
 * replaces the line, the deterministic plane RE-SCREENS against the run's
 * original context, and the verdict is re-assembled and persisted.
 */
export async function POST(req: Request) {
  let body: {
    prescriptionId?: string;
    fieldIndex?: number;
    accepted?: boolean;
    brandText?: string;
    actor?: string;
    note?: string;
  };
  try {
    body = await readJson<typeof body>(req);
  } catch (e) {
    return bodyError(e);
  }
  const { prescriptionId: rawId, fieldIndex, accepted } = body;
  // The declared shape is a wish, not a guarantee: JSON arrives with whatever
  // types the client chose, and the first thing that actually breaks on a wrong
  // one is a Prisma `where` clause. Narrow here so the handler below only ever
  // sees the types its name claims.
  const prescriptionId = typeof rawId === "string" ? rawId : null;
  const brandText = typeof body.brandText === "string" ? body.brandText : null;
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
  const actor = typeof body.actor === "string" ? body.actor.slice(0, 60) : "pharmacist";
  if (!prescriptionId || typeof fieldIndex !== "number" || typeof accepted !== "boolean") {
    return fail("prescriptionId, fieldIndex and accepted are required");
  }
  // A brand correction is REFUSED past the cap rather than sliced: half a brand
  // name still resolves to a molecule, and a reviewer's decision must not be
  // re-decided by a length rule. Note and actor are prose, so they may clamp.
  if (brandText && brandText.length > 200) return fail("brandText is too long (max 200 chars)");

  const prescription = await db.prescription.findUnique({ where: { id: prescriptionId } });
  if (!prescription) return fail("Prescription not found", 404);

  // Ownership (TD-1 progress): a queue row is a fragment of someone's clinical
  // record, so a foreign (prescriptionId, fieldIndex) pair is answered with the
  // SAME text a missing row gets — a reviewer resolving the wrong patient's
  // uncertain reading would be worse than the bug this route started as.
  const scope = await scopePatient();
  if (!prescriptionInScope(prescription, scope?.id ?? null)) return fail("No queue row for that field", 404);

  const row = await db.confirmQueueItem.findUnique({
    where: { prescriptionId_fieldIndex: { prescriptionId, fieldIndex } },
  });
  if (!row) return fail("No queue row for that field", 404);

  // Replay law: a terminal row is never re-mutated (double-tap / retry / script).
  if (row.state !== "pending") {
    await audit("queue.replayed", { prescriptionId, fieldIndex, state: row.state });
    return ok({
      status: "already_resolved",
      item: row,
      queue: await queueStatus(prescriptionId),
    });
  }

  // A human resolution re-screens with the contexts the patient DECLARED. The
  // column is NOT NULL with a default, so there is no "old row that declared
  // nothing" to honour — a value that will not parse is corruption, and reading
  // it as `[]` is the exact bug RES-1 records: it would drop contraindication
  // findings at the moment of review.
  let extraction: {
    lines?: { raw: string; confidence: number }[];
    engine?: string;
    note?: string | null;
  };
  let contexts: string[];
  try {
    extraction = parseStored(prescription.extractionJson, "verified lines");
    contexts = parseStored<string[]>(prescription.contextsJson, "declared patient contexts");
  } catch (e) {
    if (e instanceof UnreadableRecordError) {
      await audit("queue.unreadable_record", { prescriptionId });
      return fail(e.message, 409);
    }
    throw e;
  }

  const lines = (extraction.lines ?? []).map((l) => ({ ...l }));
  if (fieldIndex !== 0) {
    const target = lines[fieldIndex - 1];
    if (!target) return fail("Queue row does not match a known line", 422);

    if (accepted) {
      // The human is the authority; their read is the highest confidence there is.
      // But an invented brand is never confirmed: the correction must resolve
      // against the formulary index before it can leave the queue.
      const before = target.raw;
      const corrected = (brandText ?? before).trim();
      // A brand correction replaces the whole line, so carry the regimen the
      // reviewer did NOT dispute onto it. Without this, "Fakezol 500 mg OD 5
      // days" -> "Pan 40" loses its frequency, and a scheduler that refuses to
      // invent one (see lib/safety/adherence.ts) can no longer plan the patient.
      const prev = normalizeLine(before, fieldIndex);
      const next = normalizeLine(corrected, fieldIndex);
      let raw = corrected;
      if (!next.frequency && prev.frequency) raw += ` ${prev.frequency}`;
      if (!next.durationDays && prev.durationDays) raw += ` ${prev.durationDays} days`;
      target.raw = raw.trim();
      if (!normalizeLine(target.raw, fieldIndex).brand) {
        return fail("Brand not in the formulary map — supply the corrected brand name", 422);
      }
      target.confidence = 0.97;
    } else {
      // Rejected: the read is withdrawn and can never verify. The plan stays blocked.
      target.confidence = 0;
    }
  } // fieldIndex 0 = the synthetic regimen escalation row: there is no line to
  // correct; acceptance records the reviewed-arm decision (E-G).

  const resolved = await resolveQueueField(prescriptionId, fieldIndex, accepted, {
    // Provenance records the line the plane actually re-screened — the
    // corrected brand plus the regimen carried over from the original read.
    resolvedBrand:
      accepted && fieldIndex !== 0 ? (lines[fieldIndex - 1]?.raw ?? null) : null,
    actor,
    note:
      fieldIndex === 0
        ? accepted
          ? "regimen escalation accepted (E-G reviewed arm)"
          : "regimen escalation rejected"
        : note ?? "resolved in the review console",
  });
  if (resolved.error) return fail(resolved.error, 404);

  if (fieldIndex === 0 && !accepted) {
    // Rejected escalation: the read is withdrawn — this prescription can
    // never verify, so the published verdict stays confirm_queue.
    await db.prescription.update({
      where: { id: prescriptionId },
      data: { verdict: "confirm_queue" },
    });
    await Promise.all([
      bumpMetric("queue_resolved"),
      audit("queue.resolve", { prescriptionId, fieldIndex, accepted, verdict: "confirm_queue" }),
    ]);
    return ok({
      status: "resolved",
      verdict: "confirm_queue",
      confidence: prescription.confidence,
      findings: [],
      queue: await queueStatus(prescriptionId),
    });
  }

  // Re-screen on the SAME context the run started with (never an empty one).
  const report = runSafetyPlane({
    rawLines: lines.map((l) => l.raw),
    contexts,
    lineConfidence: extraction.engine === "llm" ? lines.map((l) => l.confidence) : undefined,
    thresholdSetId: prescription.thresholdSetId || DEFAULT_THRESHOLD_SET_ID,
  });
  const confidence = overallConfidence(
    report.confirmed.length,
    report.confirmQueue.length,
    lines.map((l) => l.confidence)
  );

  // The regimen escalation applies to the re-screened verdict too (same law
  // as verify). If the resolution happening right now is the escalation row
  // itself (fieldIndex 0), the human's acceptance stands — the fragility
  // queue must not immediately re-fire on the identical uncertainty.
  const { finalVerdict, confirmQueue, escalated } = await applyRegimenEscalation(
    report,
    { ...extraction, lines },
    contexts,
    prescription.thresholdSetId || DEFAULT_THRESHOLD_SET_ID,
    { zeroResolved: fieldIndex === 0 && accepted }
  );

  await db.prescription.update({
    where: { id: prescriptionId },
    data: {
      verdict: finalVerdict,
      confidence,
      extractionJson: JSON.stringify({ ...extraction, lines }),
      findingsJson: JSON.stringify(report.findings),
      engineSnapshot: report.snapshot,
      thresholdSetId: report.gate?.thresholdSetId ?? prescription.thresholdSetId,
      prescriptionFused: report.gate?.prescriptionFused ?? confidence,
      regimenJson: escalated ? prescription.regimenJson : "{}",
    },
  });
  await syncQueue(prescriptionId, confirmQueue);
  await Promise.all([
    bumpMetric("queue_resolved"),
    audit("queue.resolve", { prescriptionId, fieldIndex, accepted, verdict: finalVerdict, regimenEscalated: escalated }),
  ]);

  return ok({
    status: "resolved",
    verdict: finalVerdict,
    confidence,
    findings: report.findings,
    queue: await queueStatus(prescriptionId),
  });
}
