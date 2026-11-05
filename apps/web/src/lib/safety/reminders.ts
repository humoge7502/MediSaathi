/**
 * Reminder scheduling law — pure, deterministic, no notification API.
 *
 * A medication product whose headline promise is "never miss a dose" that
 * cannot remind is a logbook, not a guardian. The scheduling decision belongs
 * here rather than in a component because it carries a clinical law, and a law
 * in `setTimeout` arithmetic is a law nobody can test.
 *
 * The laws this module holds, each against a failure mode that is easy to ship:
 *  - a dose that has been tapped is never announced again — "Time for Telma 40"
 *    arriving after the patient pressed *Taken* is the classic broken-reminder
 *    tell, and it destroys trust in the one feature that must be trusted;
 *  - opening the app late does not fire a burst of stale alerts. An upcoming
 *    nudge whose moment has already passed is dropped, not delivered: a queue of
 *    yesterday's reminders on a 23:00 launch reads as a malfunction;
 *  - quiet hours suppress the *early* nudge and never an alert at or after the
 *    scheduled time. Waking someone is a cost the patient chose by enabling
 *    reminders; silently dropping a dose because it fell at 03:00 is not theirs
 *    to have chosen by accident;
 *  - an alert whose moment a polling tick stepped past is still delivered
 *    (`DELIVERY_GRACE_MS`), because a reminder that depends on the page waking up
 *    on the exact second is a reminder that fails at random;
 *  - nothing here sends a message. The browser's Notification API is the only
 *    delivery channel in this build, so the module is testable with a clock
 *    argument and the app never claims a delivery it did not make.
 */

export interface QuietHours {
  /** local clock minutes from midnight, inclusive */
  startMinutes: number;
  /** exclusive; a value below `startMinutes` means the range wraps midnight */
  endMinutes: number;
}

export interface ReminderSettings {
  enabled: boolean;
  /** nudge this many minutes before the dose; 0 alerts at the dose time */
  leadMinutes: number;
  /** re-nudge a dose still pending this many minutes after it was due; 0 disables */
  lateMinutes: number;
  quiet: QuietHours | null;
  /** medication ids the patient muted; an unknown id simply never matches */
  mutedMedications: string[];
}

export const DEFAULT_SETTINGS: ReminderSettings = {
  enabled: true,
  leadMinutes: 10,
  lateMinutes: 30,
  quiet: null,
  mutedMedications: [],
};

export type ReminderDose = {
  doseId: string;
  medicationId: string;
  brand: string;
  detail: string;
  /** epoch ms, local clock */
  scheduledAt: number;
  status: "pending" | "taken" | "skipped" | "missed";
};

export type Alert = {
  /** stable identity for delivery dedupe: `doseId:kind` */
  key: string;
  doseId: string;
  kind: "upcoming" | "due" | "overdue";
  at: number;
  title: string;
  body: string;
};

const MINUTE = 60_000;

/**
 * Clamp a settings object that arrived from a client. These are the system's
 * boundaries: a `leadMinutes` of 1e9 turns every alert into a prehistoric
 * timestamp, and a negative quiet range would swallow the whole day.
 */
export function sanitizeSettings(raw: unknown): ReminderSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number, max: number): number => {
    // A number, or the default — never a coercion. `Number(null)` is 0 and
    // `Number("")` is 0, so a lenient cast turns a client bug into "reminders
    // off, quietly", which is the one outcome a patient must not get by accident.
    if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(Math.round(v), max));
  };
  const enabled = typeof o.enabled === "boolean" ? o.enabled : DEFAULT_SETTINGS.enabled;
  const quietRaw = o.quiet as Record<string, unknown> | null | undefined;
  let quiet: QuietHours | null = null;
  if (quietRaw && typeof quietRaw === "object") {
    const startMinutes = num(quietRaw.startMinutes, 0, 24 * 60 - 1);
    const endMinutes = num(quietRaw.endMinutes, 0, 24 * 60 - 1);
    // Equal bounds mean "no window": a zero-length quiet hour silences nothing,
    // and expressing that as null keeps `inQuiet` from having two true answers.
    quiet = startMinutes === endMinutes ? null : { startMinutes, endMinutes };
  }
  const muted = Array.isArray(o.mutedMedications)
    ? o.mutedMedications.filter((x): x is string => typeof x === "string").slice(0, 200)
    : [];
  return {
    enabled,
    leadMinutes: num(o.leadMinutes, DEFAULT_SETTINGS.leadMinutes, 180),
    lateMinutes: num(o.lateMinutes, DEFAULT_SETTINGS.lateMinutes, 720),
    quiet,
    mutedMedications: muted,
  };
}

/**
 * What a settings PATCH got wrong, as messages that name the field.
 *
 * Kept separate from `sanitizeSettings` because they answer different questions:
 * sanitising is the clamp that makes a stored row safe to schedule against,
 * while a request body that says `leadMinutes: "soon"` is a client bug the
 * patient can be told about. Letting it pass would quietly write the default and
 * the toggle they just moved would snap back with no explanation — so the route
 * refuses, and this function is what lets that law be tested without a database.
 */
export function settingsPatchErrors(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return ["The body must be a settings object"];
  }
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];
  const bounds: Record<string, number> = { leadMinutes: 180, lateMinutes: 720, startMinutes: 1439, endMinutes: 1439 };

  for (const key of ["enabled"] as const) {
    if (key in o && typeof o[key] !== "boolean") errors.push(`${key} must be true or false`);
  }
  for (const key of ["leadMinutes", "lateMinutes"] as const) {
    if (!(key in o)) continue;
    const n = o[key];
    if (typeof n !== "number" || !Number.isFinite(n)) errors.push(`${key} must be a finite number`);
    else if (n < 0 || n > bounds[key]) errors.push(`${key} must be between 0 and ${bounds[key]}`);
  }
  if ("mutedMedications" in o) {
    const m = o.mutedMedications;
    if (!Array.isArray(m)) errors.push("mutedMedications must be an array of medication ids");
    else if (m.length > 200) errors.push("mutedMedications lists too many medications");
    else if (m.some((x) => typeof x !== "string")) errors.push("mutedMedications must contain only strings");
  }
  if ("quiet" in o && o.quiet !== null && o.quiet !== undefined) {
    const q = o.quiet;
    if (typeof q !== "object" || Array.isArray(q)) errors.push("quiet must be null or {startMinutes, endMinutes}");
    else {
      const qq = q as Record<string, unknown>;
      for (const key of ["startMinutes", "endMinutes"] as const) {
        const n = qq[key];
        if (typeof n !== "number" || !Number.isFinite(n)) errors.push(`quiet.${key} must be a finite number`);
        else if (n < 0 || n > bounds[key]) errors.push(`quiet.${key} must be between 0 and ${bounds[key]}`);
      }
    }
  }
  // A key the law does not know about is not a preference: it is a client that
  // has drifted from the server, and silently dropping it is how a renamed field
  // stops working without anyone noticing.
  for (const key of Object.keys(o)) {
    if (!["enabled", "leadMinutes", "lateMinutes", "quiet", "mutedMedications"].includes(key)) {
      errors.push(`unknown settings field: ${key}`);
    }
  }
  return errors;
}

/** Half-open clock range, wrapping midnight when `end <= start`. */
export function inQuiet(clockMs: number, quiet: QuietHours | null): boolean {
  if (!quiet) return false;
  const d = new Date(clockMs);
  const m = d.getHours() * 60 + d.getMinutes();
  const { startMinutes, endMinutes } = quiet;
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return m >= startMinutes && m < endMinutes;
  return m >= startMinutes || m < endMinutes;
}

/**
 * How long an alert stays deliverable after its moment passed.
 *
 * The delivery loop re-evaluates on a timer, so a tick lands *near* a scheduled
 * moment, never on it. Without a grace window, a nudge due at 08:50:00 is planned
 * on the 08:49:52 tick and already dropped on the one at 08:50:07 — the reminder
 * vanishes because of when the page happened to wake up, which is the kind of bug
 * a reminder app is not allowed to have. It has to stay short: a patient who
 * opens the app an hour late is not served by an "in 10 minutes" alert.
 */
export const DELIVERY_GRACE_MS = 60_000;

/**
 * The alert plan for one day of doses, evaluated at `now`.
 *
 * Returns the alerts still to come AND the one the caller missed by being
 * closed, subject to `delivered` — the keys the caller has already announced.
 * That set is the only dedupe point in the system: every branch passes through
 * `add`, so a reload cannot re-arm anything and no kind can slip past it.
 *
 * Each dose gets at most one *live* alert at a time. The at-time announcement and
 * the late re-nudge are two ends of the same conversation — if the app was open at
 * the dose time it says "Time for X" now and "X is 30 min late" later; if it was
 * closed, the first thing it says when it reopens is "Time for X", and only then
 * earns the right to call the dose late.
 */
export function planAlerts(
  doses: ReminderDose[],
  settings: ReminderSettings,
  now: number,
  delivered: ReadonlySet<string> = new Set()
): Alert[] {
  if (!settings.enabled) return [];
  const muted = new Set(settings.mutedMedications);
  const alerts: Alert[] = [];
  const add = (alert: Alert) => {
    if (!delivered.has(alert.key)) alerts.push(alert);
  };
  /** Anywhere in the future, or just passed and still inside the grace. */
  const live = (at: number) => at + DELIVERY_GRACE_MS >= now;

  for (const dose of doses) {
    // A resolved dose is never announced. This single guard is what stops the
    // post-*Taken* notification, and it holds for every kind below.
    if (dose.status !== "pending" || muted.has(dose.medicationId)) continue;

    const when = dose.scheduledAt;
    const lateAt = when + settings.lateMinutes * MINUTE;

    // The early nudge: dropped once its grace has passed (a late launch must not
    // inherit yesterday) and whenever it lands in quiet hours. The at-time and
    // late alerts are never quiet-suppressed — see the law above.
    if (settings.leadMinutes > 0) {
      const early = when - settings.leadMinutes * MINUTE;
      if (live(early) && !inQuiet(early, settings.quiet)) {
        add({
          key: `${dose.doseId}:upcoming`,
          doseId: dose.doseId,
          kind: "upcoming",
          at: early,
          title: `${dose.brand} in ${settings.leadMinutes} min`,
          body: dose.detail || "Dose coming up.",
        });
      }
    }

    // The dose itself stays announced while the patient is still inside the late
    // window: "Time for X" said ten minutes late is still true, and it is the only
    // thing that tells someone who opens the app after the dose what to do next.
    // With the re-nudge off, the window closes at the dose time — so "off" means
    // a past dose is never announced, rather than announced as late.
    if (when >= now || lateAt >= now) {
      add({
        key: `${dose.doseId}:due`,
        doseId: dose.doseId,
        kind: "due",
        // A dose whose time already went by is announced at the moment of opening,
        // not with a timestamp in the past the panel would have to explain.
        at: when >= now ? when : now,
        title: `Time for ${dose.brand}`,
        body: dose.detail ? `${dose.detail} — take it now.` : "Take it now.",
      });
    }

    // Earned only after the at-time alert was actually delivered, and only while
    // its own moment is live: past that the dose is a *missed* dose, and the
    // panel — not a notification — owns that conversation. Announcing a dose from
    // six hours ago is how a reminder app teaches a patient to ignore it.
    if (settings.lateMinutes > 0 && delivered.has(`${dose.doseId}:due`) && live(lateAt)) {
      add({
        key: `${dose.doseId}:overdue`,
        doseId: dose.doseId,
        kind: "overdue",
        at: lateAt,
        title: `${dose.brand} is ${settings.lateMinutes} min late`,
        body: "Open Today — the app will tell you whether to take it or skip it.",
      });
    }
  }

  return alerts.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

/** The next dose the patient is waiting on, for the countdown in the panel. */
export function nextDue(doses: ReminderDose[], now: number): ReminderDose | null {
  let best: ReminderDose | null = null;
  for (const d of doses) {
    if (d.status !== "pending") continue;
    if (d.scheduledAt < now) return d; // already overdue: it wins the conversation
    if (!best || d.scheduledAt < best.scheduledAt) best = d;
  }
  return best;
}

/** "in 2 h 05 min" / "41 min late" — one formatter so the panel and the alert agree. */
export function describeGap(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / MINUTE);
  if (mins < 1) return diff >= 0 ? "now" : "just now";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const span = h > 0 ? `${h} h ${`${m}`.padStart(2, "0")} min` : `${m} min`;
  return diff >= 0 ? `in ${span}` : `${span} late`;
}
