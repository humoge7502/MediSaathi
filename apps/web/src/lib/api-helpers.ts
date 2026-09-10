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
