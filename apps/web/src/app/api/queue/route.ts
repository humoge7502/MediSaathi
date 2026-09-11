import { db } from "@/lib/db";
import { ok, fail, audit, bumpMetric } from "@/lib/api-helpers";
import { normalizeLine, runSafetyPlane, overallConfidence } from "@/lib/safety/engine";
import { DEFAULT_THRESHOLD_SET_ID } from "@/lib/safety/gate";
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
 * Handlers are typed `Request` (not `NextRequest`): they only read the URL and
 * the JSON body, and the narrower signature keeps them drivable from the
 * integration suite with a plain `Request`.
 */
export async function GET(req: Request) {
  // `new URL(req.url)` rather than `req.nextUrl` so the handler is testable with
  // a plain Request (the integration suite drives it directly).
  const id = new URL(req.url).searchParams.get("prescriptionId");
  if (id) {
    const status = await queueStatus(id);
    return ok({ ...status, blockedReason: await blockedReason(id) });
  }
  const open = await db.confirmQueueItem.findMany({
    where: { state: "pending" },
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
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  const { prescriptionId, fieldIndex, accepted } = body;
  if (!prescriptionId || typeof fieldIndex !== "number" || typeof accepted !== "boolean") {
    return fail("prescriptionId, fieldIndex and accepted are required");
  }

  const prescription = await db.prescription.findUnique({ where: { id: prescriptionId } });
  if (!prescription) return fail("Prescription not found", 404);

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

  const extraction = JSON.parse(prescription.extractionJson) as {
    lines?: { raw: string; confidence: number }[];
    engine?: string;
    note?: string | null;
  };
  let contexts: string[] = [];
  try {
    contexts = JSON.parse(prescription.contextsJson ?? "[]") as string[];
  } catch {
    contexts = [];
  }

  const lines = (extraction.lines ?? []).map((l) => ({ ...l }));
  const target = lines[fieldIndex - 1];
  if (!target) return fail("Queue row does not match a known line", 422);

  if (accepted) {
    // The human is the authority; their read is the highest confidence there is.
    // But an invented brand is never confirmed: the correction must resolve
    // against the formulary index before it can leave the queue.
    target.raw = (body.brandText ?? target.raw).trim();
    if (!normalizeLine(target.raw, fieldIndex).brand) {
      return fail("Brand not in the formulary map — supply the corrected brand name", 422);
    }
    target.confidence = 0.97;
  } else {
    // Rejected: the read is withdrawn and can never verify. The plan stays blocked.
    target.confidence = 0;
  }

  const resolved = await resolveQueueField(prescriptionId, fieldIndex, accepted, {
    resolvedBrand: accepted ? (body.brandText ?? target.raw) : null,
    actor: body.actor ?? "pharmacist",
    note: body.note ?? "resolved in the review console",
  });
  if (resolved.error) return fail(resolved.error, 404);

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

  await db.prescription.update({
    where: { id: prescriptionId },
    data: {
      verdict: report.verdict,
      confidence,
      extractionJson: JSON.stringify({ ...extraction, lines }),
      findingsJson: JSON.stringify(report.findings),
      engineSnapshot: report.snapshot,
      thresholdSetId: report.gate?.thresholdSetId ?? prescription.thresholdSetId,
      prescriptionFused: report.gate?.prescriptionFused ?? confidence,
    },
  });
  await syncQueue(prescriptionId, report.confirmQueue);
  await Promise.all([
    bumpMetric("queue_resolved"),
    audit("queue.resolve", { prescriptionId, fieldIndex, accepted, verdict: report.verdict }),
  ]);

  return ok({
    status: "resolved",
    verdict: report.verdict,
    confidence,
    findings: report.findings,
    queue: await queueStatus(prescriptionId),
  });
}
