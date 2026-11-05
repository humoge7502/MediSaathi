import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shared helpers for Vaidya API routes. */

export function ok(data: unknown, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export async function bumpMetric(key: string, by = 1) {
  try {
    await db.metric.upsert({
      where: { key },
      update: { value: { increment: by } },
      create: { key, value: by },
    });
  } catch {
    // metrics must never break the request path
  }
}

export async function audit(action: string, meta: Record<string, unknown> = {}) {
  try {
    await db.auditLog.create({ data: { action, metaJson: JSON.stringify(meta) } });
  } catch {
    // audit failures must not break the request path
  }
}

export async function readMetric(key: string): Promise<number> {
  const m = await db.metric.findUnique({ where: { key } });
  return m?.value ?? 0;
}

/** The identity this build serves. There is no authentication (TD-1), so the
 *  single demo patient — the first Patient row, which every read route already
 *  resolves the same way — is the tenant. A route that takes a row id from the
 *  request has to compare it against this before it reads or writes: without
 *  that, a cuid belonging to someone else's rows is a valid instruction to
 *  them, and the 200 that follows confirms the id was real. */
export async function scopePatient() {
  return await db.patient.findFirst();
}

/** Whether a prescription row may be used by `scopeId`. NULL is not a hole in
 *  the predicate, it is a state: a prescription verified on a fresh install
 *  predates the first Patient row, and the plan that adopts it stamps the
 *  column (see /api/plans). A NON-NULL id that names someone else is foreign. */
export function prescriptionInScope(
  prescription: { patientId: string | null },
  scopeId: string | null,
): boolean {
  return prescription.patientId === null || prescription.patientId === scopeId;
}

/** A stored JSON column is a system boundary: rows outlive the build that wrote
 *  them, and a truncated or superseded payload is data the current code cannot
 *  read. Letting `JSON.parse` throw there answers the user with a 500 and a
 *  stack trace, and says nothing about what to do — while the *silent*
 *  alternative (`catch { contexts = [] }`) is worse, because it re-screens with
 *  the context the patient actually declared dropped (see RES-1 in
 *  docs/TECH_DEBT.md). So: refuse, and name the repair. */
export class UnreadableRecordError extends Error {}

export function parseStored<T>(raw: string, what: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new UnreadableRecordError(
      `This record's ${what} was written by an older build and cannot be read. Re-verify the prescription to rebuild it.`,
    );
  }
}

/** Request bodies: `req.json()` buffers the whole payload before it decodes it,
 *  and the App Router applies no size limit (the `sizeLimit` knob belongs to the
 *  Pages API). The proxy counts requests per minute, not bytes — so 60
 *  legal requests a minute were 60 unbounded allocations, and one of them is
 *  enough to exhaust a small container. Read the stream instead and refuse
 *  past the cap, so the bound is enforced while the bytes arrive.
 *
 *  64 KB is not a guess: the largest legitimate body on this surface is a
 *  verification of a 4 000-character prescription (the cap `verify` already
 *  enforces on the field itself) with room for the context list around it. */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`request body exceeds ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export const MAX_BODY_BYTES = Math.max(1, Number(process.env.MEDISAATHI_MAX_BODY_KB) || 64) * 1024;

export async function readJson<T>(req: Request, maxBytes = MAX_BODY_BYTES): Promise<T> {
  // Fail fast on a declared length; the running total below is what actually
  // holds, because a client can lie about this header.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!req.body) throw new SyntaxError("request has no body");

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > maxBytes) {
      // Stop pulling; the rest of the stream is not this process's problem.
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(maxBytes);
    }
    // `stream: true` so a multi-byte character split across two chunks survives.
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text) as T;
}

/** Every route maps a body failure the same way, and a 413 with a stack trace
 *  in the response is how an unbounded body announces itself. */
export function bodyError(e: unknown): Response {
  if (e instanceof BodyTooLargeError) {
    return fail(`Request body is too large (max ${Math.round(e.maxBytes / 1024)} KB)`, 413);
  }
  return fail("Invalid JSON body");
}
