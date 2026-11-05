import { db } from "@/lib/db";
import { ok, fail, audit, readJson, bodyError } from "@/lib/api-helpers";
import { CODE_RE, codeHint, familyCode } from "@/lib/join-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The join code is the ONLY credential in this surface: whoever presents it
 *  reads a relative's medication escalations. So it is drawn uniformly (see
 *  `lib/join-code`), never echoed back to a caller that did not already
 *  present it, and never written to the audit log in full. */
// Event ids are cuids; anything else is malformed input, not a lookup.
const EVENT_ID_RE = /^[a-z0-9]{20,36}$/i;

/** GET /api/family?code=XXXX — caregiver feed by join code (or unfiltered for the patient view). */
export async function GET(req: Request) {
  // `new URL(req.url)` rather than `req.nextUrl`, so the handler is testable
  // with a plain Request (same law as the queue routes).
  const code = new URL(req.url).searchParams.get("code");
  const patient = await db.patient.findFirst();
  if (!patient) return ok({ patient: null, links: [], events: [] });

  let asCaregiver = false;
  if (code) {
    if (!CODE_RE.test(code)) return fail("Invalid family code", 403);
    const link = await db.caregiverLink.findUnique({ where: { code } });
    if (!link || link.patientId !== patient.id) return fail("Invalid family code", 403);
    asCaregiver = true;
  }

  const links = await db.caregiverLink.findMany({
    where: { patientId: patient.id },
    orderBy: { createdAt: "desc" },
  });
  const events = await db.escalationEvent.findMany({
    where: { patientId: patient.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  // The code is the capability, and there is no authentication in front of this
  // route — so "the caller is the owner" is not a thing the server can know. The
  // previous version reasoned that the no-code view was the patient's own and
  // returned `joinCode` plus every `links[].code` there, which meant any caller
  // who simply did not send a code collected the whole circle's credentials.
  // A code is now disclosed exactly once, to the caller that created the link
  // (POST below), and every read path returns only the hint.
  return ok({
    patient: { name: patient.name, contexts: patient.contexts },
    links: links.map((l) => ({
      id: l.id,
      caregiverName: l.caregiverName,
      relation: l.relation,
      hint: codeHint(l.code),
      ...(asCaregiver ? {} : { createdAt: l.createdAt }),
    })),
    events,
  });
}

/** POST /api/family — link a caregiver { caregiverName, relation } (generates join code). */
export async function POST(req: Request) {
  let body: { caregiverName?: string; relation?: string; action?: string; eventId?: string; code?: string };
  try {
    body = await readJson<typeof body>(req);
  } catch (e) {
    return bodyError(e);
  }

  const patient = await db.patient.findFirst();
  if (!patient) return fail("No patient profile yet — verify a prescription first");

  const eventIdOk = typeof body.eventId === "string" && EVENT_ID_RE.test(body.eventId);

  // acknowledge an event from the patient's own view
  if (body.action === "acknowledge" && body.eventId) {
    if (!eventIdOk) return fail("Malformed eventId");
    // Scoped by patient: an event id is a cuid, but a cuid from another
    // patient's row must not be writable from this one.
    const updated = await db.escalationEvent.updateMany({
      where: { id: body.eventId, patientId: patient.id },
      data: { acknowledged: true },
    });
    if (updated.count === 0) return fail("No such escalation for this patient", 404);
    await audit("family.acknowledged", { eventId: body.eventId });
    return ok({ acknowledged: true });
  }

  // caregiver view acknowledges via code
  if (body.action === "acknowledge_by_code" && body.eventId && body.code) {
    if (!eventIdOk) return fail("Malformed eventId");
    if (!CODE_RE.test(body.code)) return fail("Invalid family code", 403);
    const link = await db.caregiverLink.findUnique({ where: { code: body.code } });
    if (!link) return fail("Invalid family code", 403);
    // The code authenticated a CAREGIVER, not a write of anyone's row: the
    // event has to belong to the patient that link points at.
    const updated = await db.escalationEvent.updateMany({
      where: { id: body.eventId, patientId: link.patientId },
      data: { acknowledged: true },
    });
    if (updated.count === 0) return fail("No such escalation for this caregiver's patient", 404);
    await audit("family.acknowledged_by_caregiver", { eventId: body.eventId, code: codeHint(body.code) });
    return ok({ acknowledged: true });
  }

  // `caregiverName?: string` describes the intent, not the wire: a JSON number
  // or object would reach `.trim()` and answer 500.
  const rawName = typeof body.caregiverName === "string" ? body.caregiverName : "";
  const name = rawName.trim().slice(0, 60);
  if (!name) return fail("caregiverName is required");

  // One row per caregiver, one code per row: the previous version reused the
  // first link and only wrote an audit line, so linking a second relative
  // answered `ok` with a code while the circle list stayed at one name.
  // Per-link codes are also what makes a single caregiver revocable later.
  const link = await db.caregiverLink.create({
    data: {
      patientId: patient.id,
      caregiverName: name,
      relation: (typeof body.relation === "string" ? body.relation : "family").slice(0, 40),
      code: familyCode(),
    },
  });

  await audit("family.linked", { caregiverName: name, code: codeHint(link.code) });
  return ok({ joinCode: link.code, caregiverName: name });
}
