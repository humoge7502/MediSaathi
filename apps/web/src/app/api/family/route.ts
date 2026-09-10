import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, audit } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/family?code=XXXX — caregiver feed by join code (or unfiltered for the patient view). */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const patient = await db.patient.findFirst();
  if (!patient) return ok({ patient: null, links: [], events: [] });

  if (code) {
    const link = await db.caregiverLink.findUnique({ where: { code } });
    if (!link || link.patientId !== patient.id) return fail("Invalid family code", 403);
  }

  const [links, events] = await Promise.all([
    db.caregiverLink.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: "desc" } }),
    db.escalationEvent.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);

  return ok({
    patient: { name: patient.name, contexts: patient.contexts },
    joinCode: links[0]?.code ?? null,
    links,
    events,
  });
}

/** POST /api/family — link a caregiver { caregiverName, relation } (generates join code). */
export async function POST(req: NextRequest) {
  let body: { caregiverName?: string; relation?: string; action?: string; eventId?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const patient = await db.patient.findFirst();
  if (!patient) return fail("No patient profile yet — verify a prescription first");

  // acknowledge an event from the family view
  if (body.action === "acknowledge" && body.eventId) {
    await db.escalationEvent.update({ where: { id: body.eventId }, data: { acknowledged: true } });
    await audit("family.acknowledged", { eventId: body.eventId });
    return ok({ acknowledged: true });
  }

  // caregiver view acknowledges via code
  if (body.action === "acknowledge_by_code" && body.eventId && body.code) {
    const link = await db.caregiverLink.findUnique({ where: { code: body.code } });
    if (!link) return fail("Invalid family code", 403);
    await db.escalationEvent.update({ where: { id: body.eventId }, data: { acknowledged: true } });
    await audit("family.acknowledged_by_caregiver", { eventId: body.eventId, code: body.code });
    return ok({ acknowledged: true });
  }

  const name = (body.caregiverName ?? "").trim();
  if (!name) return fail("caregiverName is required");

  let link = await db.caregiverLink.findFirst({ where: { patientId: patient.id } });
  if (!link) {
    const code = familyCode();
    link = await db.caregiverLink.create({
      data: { patientId: patient.id, caregiverName: name, relation: (body.relation ?? "family").slice(0, 40), code },
    });
  } else {
    // reuse the existing family code; just record interest in the audit trail
    await audit("family.caregiver_added", { caregiverName: name });
  }

  await audit("family.linked", { caregiverName: name, code: link.code });
  return ok({ joinCode: link.code, caregiverName: name });
}

function familyCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
