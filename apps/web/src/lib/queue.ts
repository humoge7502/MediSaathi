/**
 * Persisted confirmation queue (MED-002) — web tier.
 *
 * Mirror of `apps/api/app/queue.py`: every field the gate routes to the
 * human-confirmation band becomes a single-transition row
 *
 *     pending --resolve(accepted)--> confirmed
 *     pending --resolve(rejected)--> rejected
 *     confirmed | rejected            -> terminal (replays refused)
 *
 * and a prescription with any `pending` row cannot generate a therapy plan.
 * The block is evaluated *inside* the plan transaction (see `assertPlanAllowed`),
 * so two concurrent plan starts cannot race past an empty queue.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export class PlanBlockedError extends Error {
  pending: number;
  constructor(pending: number) {
    super(
      `${pending} field(s) awaiting human confirmation. Resolve the confirm queue to unlock the plan.`
    );
    this.name = "PlanBlockedError";
    this.pending = pending;
  }
}

export interface QueueSyncItem {
  line: number;
  rawText: string;
  reason?: string;
  band?: string;
  fused?: number;
  why?: string;
}

export type QueueStatus = {
  prescriptionId: string;
  pending: number;
  confirmed: number;
  rejected: number;
  blocked: boolean;
  items: {
    id: string;
    fieldIndex: number;
    rawText: string;
    readingConfidence: number;
    fused: number;
    band: string;
    why: string;
    reason: string;
    state: string;
    resolvedBrand: string | null;
    actor: string;
    note: string;
    createdAt: Date;
    updatedAt: Date;
  }[];
};

/**
 * Reconcile the DB queue with the fields the engine just queued. Idempotent.
 *
 * fieldIndex 0 is reserved for the cross-prescription regimen escalation
 * (TD-12): real parsed lines are 1-based, so a 0 row can never collide with a
 * human-confirmed field read. Its lifecycle is value-driven:
 *
 * - escalation fires  -> ensure a pending field-0 row exists (create or keep);
 * - escalation clears -> delete a still-PENDING field-0 row (the uncertainty
 *   it recorded no longer exists); a terminal (human-resolved) row is never
 *   deleted — the recorded decision outlives the run that triggered it.
 */
export async function syncQueue(prescriptionId: string, items: QueueSyncItem[]): Promise<void> {
  const regimenEscalation = items.find((i) => i.line === 0);
  const fieldItems = items.filter((i) => i.line !== 0);

  const existingZero = await db.confirmQueueItem.findUnique({
    where: { prescriptionId_fieldIndex: { prescriptionId, fieldIndex: 0 } },
  });
  if (regimenEscalation) {
    if (!existingZero) {
      await db.confirmQueueItem.create({
        data: {
          prescriptionId,
          fieldIndex: 0,
          rawText: regimenEscalation.rawText,
          readingConfidence: 0,
          fused: regimenEscalation.fused ?? 0,
          band: regimenEscalation.band ?? "confirm",
          why: regimenEscalation.why ?? regimenEscalation.reason ?? "",
          state: "pending",
        },
      });
      await db.queueTransition.create({
        data: {
          prescriptionId,
          fieldIndex: 0,
          fromState: "none",
          toState: "pending",
          actor: "system",
          note: "regimen screen escalated this read to the human queue",
        },
      });
    }
    // pending row exists: keep it (metadata refresh is unnecessary — the why
    // text is diagnostic only). Terminal row: stays, human decision recorded.
  } else if (existingZero && existingZero.state === "pending") {
    await db.$transaction([
      db.confirmQueueItem.delete({ where: { id: existingZero.id } }),
      db.queueTransition.create({
        data: {
          prescriptionId,
          fieldIndex: 0,
          fromState: "pending",
          toState: "cleared",
          actor: "system",
          note: "re-run resolved the read uncertainty; escalation withdrawn",
        },
      }),
    ]);
  }

  for (const item of fieldItems) {
    const existing = await db.confirmQueueItem.findUnique({
      where: { prescriptionId_fieldIndex: { prescriptionId, fieldIndex: item.line } },
    });
    if (!existing) {
      await db.confirmQueueItem.create({
        data: {
          prescriptionId,
          fieldIndex: item.line,
          rawText: item.rawText,
          readingConfidence: 0,
          fused: item.fused ?? 0,
          band: item.band ?? "confirm",
          why: item.why ?? item.reason ?? "",
          state: "pending",
        },
      });
      await db.queueTransition.create({
        data: {
          prescriptionId,
          fieldIndex: item.line,
          fromState: "none",
          toState: "pending",
          actor: "system",
          note: "gate law routed the field to the human-confirmation band",
        },
      });
    } else if (existing.state === "pending") {
      // A re-run refreshes metadata but never resurrects a human decision.
      await db.confirmQueueItem.update({
        where: { id: existing.id },
        data: {
          rawText: item.rawText,
          fused: item.fused ?? existing.fused,
          band: item.band ?? existing.band,
          why: item.why ?? item.reason ?? existing.why,
        },
      });
    }
  }
}

/**
 * First transition wins. Returns `replayed: true` when the row was already
 * terminal — a protocol outcome, never a second mutation.
 */
export async function resolveQueueField(
  prescriptionId: string,
  fieldIndex: number,
  accepted: boolean,
  opts: { resolvedBrand?: string | null; actor?: string; note?: string } = {}
): Promise<{ replayed: boolean; error?: string }> {
  const row = await db.confirmQueueItem.findUnique({
    where: { prescriptionId_fieldIndex: { prescriptionId, fieldIndex } },
  });
  if (!row) return { replayed: false, error: "no queue row for that field" };
  if (row.state !== "pending") return { replayed: true };

  const toState = accepted ? "confirmed" : "rejected";
  await db.$transaction([
    db.confirmQueueItem.update({
      where: { id: row.id },
      data: {
        state: toState,
        resolvedBrand: opts.resolvedBrand ?? null,
        actor: opts.actor ?? "pharmacist",
        note: opts.note ?? "",
      },
    }),
    db.queueTransition.create({
      data: {
        prescriptionId,
        fieldIndex,
        fromState: "pending",
        toState,
        actor: opts.actor ?? "pharmacist",
        note: opts.note ?? "human resolved the queued field",
      },
    }),
  ]);
  return { replayed: false };
}

export async function queueStatus(prescriptionId: string): Promise<QueueStatus> {
  const rows = await db.confirmQueueItem.findMany({
    where: { prescriptionId },
    orderBy: { fieldIndex: "asc" },
  });
  const count = (s: string) => rows.filter((r) => r.state === s).length;
  return {
    prescriptionId,
    pending: count("pending"),
    confirmed: count("confirmed"),
    rejected: count("rejected"),
    blocked: count("pending") > 0,
    items: rows.map((r) => ({
      id: r.id,
      fieldIndex: r.fieldIndex,
      rawText: r.rawText,
      readingConfidence: r.readingConfidence,
      fused: r.fused,
      band: r.band,
      why: r.why,
      reason: r.why,
      state: r.state,
      resolvedBrand: r.resolvedBrand,
      actor: r.actor,
      note: r.note,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
}

export async function queueHistory(prescriptionId: string) {
  return db.queueTransition.findMany({
    where: { prescriptionId },
    orderBy: { createdAt: "asc" },
  });
}

/** Deterministic block reason for a description of record (used by the UI/API). */
export async function blockedReason(prescriptionId: string): Promise<string | null> {
  const pending = await db.confirmQueueItem.count({
    where: { prescriptionId, state: "pending" },
  });
  if (!pending) return null;
  return (
    `${pending} field(s) awaiting human confirmation. ` +
    `Resolve the confirm queue to unlock the plan.`
  );
}

/**
 * Transactional plan gate. Call INSIDE the same `$transaction` that creates the
 * plan so the pending-count read and the plan write share one write lock.
 *
 * The regimen escalation (TD-12) is enforced through the SAME persisted queue:
 * verify writes a pending row (fieldIndex 0) when the cross-prescription
 * screen queues, so this count covers it with no separate mechanism. A
 * terminal field-0 row is a recorded human acceptance of the residual
 * uncertainty (the E-G reviewed arm) and lifts the block — re-screening here
 * would deadlock that decision behind an unchanged fragility.
 */
export async function assertPlanAllowed(
  tx: Prisma.TransactionClient,
  prescriptionId: string
): Promise<void> {
  const pending = await tx.confirmQueueItem.count({
    where: { prescriptionId, state: "pending" },
  });
  if (pending > 0) throw new PlanBlockedError(pending);
}
