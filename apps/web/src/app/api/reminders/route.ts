import { db } from "@/lib/db";
import {
  ok, fail, audit, readJson, bodyError, parseStored, UnreadableRecordError,
} from "@/lib/api-helpers";
import {
  DEFAULT_SETTINGS, sanitizeSettings, settingsPatchErrors, type ReminderSettings,
} from "@/lib/safety/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Reminder preferences — the settings the scheduling law in
 * `src/lib/safety/reminders.ts` is evaluated against.
 *
 * The row is keyed by `patientId @unique`, so a client never presents an id for
 * it and there is no cross-patient write path to guard: the route always targets
 * the patient this build serves (the same single-tenant rule as every other
 * route, and the same TD-1 caveat — the guard stops a wrong-row write, not an
 * unauthorised one).
 *
 * What is answered is always what was stored, never what was asked for. A value
 * outside the system bound is refused with its field named: the controls send
 * numbers from their own option lists, so a 900-minute lead is a broken client or
 * an attacker, and quietly storing 180 instead lets the caller believe its own
 * lie. `sanitizeSettings` still clamps on the READ path — a row written by an
 * older build has to be made safe before the scheduler uses it, and rewriting it
 * from a GET is not a read.
 */

type Row = {
  enabled: boolean;
  leadMinutes: number;
  lateMinutes: number;
  quietStartMinutes: number | null;
  quietEndMinutes: number | null;
  mutedJson: string;
};

/** A stored row goes back through `sanitizeSettings`: rows outlive the build
 *  that wrote them, and the scheduler must not be handed a number it cannot
 *  bound (a negative lead would alert before the dose was scheduled at all). */
function rowToSettings(row: Row): ReminderSettings {
  const quiet =
    row.quietStartMinutes !== null && row.quietEndMinutes !== null
      ? { startMinutes: row.quietStartMinutes, endMinutes: row.quietEndMinutes }
      : null;
  return sanitizeSettings({
    enabled: row.enabled,
    leadMinutes: row.leadMinutes,
    lateMinutes: row.lateMinutes,
    quiet,
    mutedMedications: parseStored<unknown>(row.mutedJson, "muted medication list"),
  });
}

function settingsToData(settings: ReminderSettings) {
  return {
    enabled: settings.enabled,
    leadMinutes: settings.leadMinutes,
    lateMinutes: settings.lateMinutes,
    // Written as a pair, always: a start without an end is a window with no
    // shape, and the schema comment exists to say that it cannot be stored.
    quietStartMinutes: settings.quiet?.startMinutes ?? null,
    quietEndMinutes: settings.quiet?.endMinutes ?? null,
    mutedJson: JSON.stringify(settings.mutedMedications),
  };
}

/** GET /api/reminders — today's effective settings (defaults before the first save). */
export async function GET() {
  const patient = await db.patient.findFirst();
  if (!patient) return ok({ settings: DEFAULT_SETTINGS });

  const row = await db.reminderSetting.findUnique({ where: { patientId: patient.id } });
  if (!row) return ok({ settings: DEFAULT_SETTINGS });
  try {
    return ok({ settings: rowToSettings(row) });
  } catch (e) {
    if (e instanceof UnreadableRecordError) return fail(e.message, 409);
    throw e;
  }
}

/**
 * POST /api/reminders — patch the settings.
 * Body: any subset of { enabled, leadMinutes, lateMinutes, quiet, mutedMedications }.
 * Merged over the stored row, so a toggle can post one field without re-sending
 * the rest; fields the law does not know are refused rather than ignored.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await readJson<unknown>(req);
  } catch (e) {
    return bodyError(e);
  }

  const errors = settingsPatchErrors(body);
  if (errors.length > 0) return fail(errors[0]);

  const patient = await db.patient.findFirst();
  if (!patient) return fail("No patient profile yet — verify a prescription first");

  let current: ReminderSettings;
  try {
    const existing = await db.reminderSetting.findUnique({ where: { patientId: patient.id } });
    current = existing ? rowToSettings(existing) : DEFAULT_SETTINGS;
  } catch (e) {
    if (e instanceof UnreadableRecordError) return fail(e.message, 409);
    throw e;
  }
  const next = sanitizeSettings({ ...current, ...(body as Partial<ReminderSettings>) });
  const data = settingsToData(next);

  await db.reminderSetting.upsert({
    where: { patientId: patient.id },
    create: { patientId: patient.id, ...data },
    update: data,
  });

  await audit("reminders.updated", {
    enabled: next.enabled,
    leadMinutes: next.leadMinutes,
    lateMinutes: next.lateMinutes,
    quiet: next.quiet,
    mutedMedications: next.mutedMedications,
  });

  return ok({ settings: next });
}
