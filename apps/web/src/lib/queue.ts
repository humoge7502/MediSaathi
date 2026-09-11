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

/** Reconcile the DB queue with the fields the engine just queued. Idempotent. */
export async function syncQueue(prescriptionId: string, items: QueueSyncItem[]): Promise<void> {
  for (const item of items) {
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
