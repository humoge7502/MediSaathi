/**
 * Adherence engine — deterministic schedule & analytics.
 *
 * Turns a verified plan into dose slots, computes adherence analytics
 * (MPR, streaks, heatmap), and produces *conservative, generic* catch-up
 * guidance for missed doses (never double-dose advice; always points to
 * the pharmacist/doctor for specifics).
 *
 * Three laws, in order of how much they cost to get wrong:
 *  1. a schedule is only ever generated from a parsed frequency code, never
 *     guessed at (see `scheduleFor`);
 *  2. catch-up guidance refuses to invent drug-specific advice it does not have
 *     (`catchUpGuidance`, whose "ask" branch is the default, not the exception);
 *  3. a dose slot whose day has closed with no answer is a missed dose
 *     (`effectiveStatus`) — because every adherence fraction built on the rows
 *     silently treats "pending" as "not counted", which is how an unanswered
 *     history reads as perfect adherence.
 */

import { parseFrequency, preferredTimes } from "./frequency";

export interface MedSpec {
  id: string;
  brand: string;
  molecule: string;
  doseMg: number | null;
  frequencyCode: string;
  times: string[]; // HH:MM
  durationDays: number;
  instructions: string;
}

export interface DoseSlot {
  medicationId: string;
  scheduledAt: Date;
  status: "pending" | "taken" | "skipped" | "missed";
}

/**
 * The schedule law, delegated to the same interval parser the safety plane
 * uses. A frequency code carries two axes — doses per administration day AND
 * days between administration days — and a generator that only iterates days
 * silently collapses them. That collapse is what made a weekly methotrexate
 * prescription render as one dose every day.
 */
export interface ScheduleSpec {
  /** clock times on one administration day */
  times: string[];
  /** days between administration days; 1 = daily */
  intervalDays: number;
  dosesPerDay: number;
  /** taken when needed: no fixed slot must ever be invented */
  asNeeded: boolean;
  /** one administration total */
  single: boolean;
}

/**
 * Null means "this code cannot be scheduled" — an unrecognised frequency, or an
 * as-needed one that has no fixed slot. Callers must surface that to a human;
 * the previous fallback of `["09:00"]` invented a once-daily regimen the
 * prescription never asked for.
 */
export function scheduleFor(frequencyCode: string): ScheduleSpec | null {
  const f = parseFrequency(frequencyCode);
  if (!f) return null;
  if (f.asNeeded) return { times: [], intervalDays: f.intervalDays, dosesPerDay: f.dosesPerDay, asNeeded: true, single: false };
  return { times: preferredTimes(f), intervalDays: f.intervalDays, dosesPerDay: f.dosesPerDay, asNeeded: false, single: f.single };
}

/**
 * Administration dates over a course, honouring the interval. A weekly code
 * over 30 days yields 5 dates, not 30. `single` yields exactly one.
 */
export function slotDates(spec: ScheduleSpec, durationDays: number, start: Date): Date[] {
  if (spec.asNeeded || spec.times.length === 0) return [];
  const days = Math.max(1, Math.min(Math.round(durationDays || 7), 365));
  const out: Date[] = [];
  for (let d = 0; d < days; d++) {
    if (d % spec.intervalDays !== 0) continue;
    for (const t of spec.times) {
      const [hh, mm] = t.split(":").map((x) => parseInt(x, 10));
      const when = new Date(start);
      when.setDate(when.getDate() + d);
      when.setHours(hh, mm, 0, 0);
      out.push(when);
      if (spec.single) return out;
    }
  }
  return out;
}

/** @deprecated use `scheduleFor()`; this returned `["09:00"]` for unknown codes. */
export function defaultTimes(frequencyCode: string): string[] {
  return scheduleFor(frequencyCode)?.times ?? [];
}

/** Generate dose slots for one medication over its duration, from `start`. */
export function generateSlots(spec: MedSpec, start: Date): DoseSlot[] {
  const schedule = scheduleFor(spec.frequencyCode);
  if (!schedule) return [];
  return slotDates(schedule, spec.durationDays, start).map((scheduledAt) => ({
    medicationId: spec.id,
    scheduledAt,
    status: "pending" as const,
  }));
}

/** Catch-up guidance for an overdue dose. Conservative by design. */
export function catchUpGuidance(
  scheduledAt: Date,
  nextDoseAt: Date | null,
  now: Date = new Date()
): { action: "take_now" | "skip_and_continue" | "ask"; text: string } {
  const lateMs = now.getTime() - scheduledAt.getTime();
  const lateH = lateMs / 3600000;
  const hoursToNext = nextDoseAt ? (nextDoseAt.getTime() - now.getTime()) / 3600000 : null;

  if (lateH < 2) {
    return { action: "take_now", text: "Less than 2 hours late — take it now and carry on with your normal schedule." };
  }
  if (hoursToNext !== null && hoursToNext >= 4) {
    return { action: "take_now", text: "Overdue, but your next dose is far away — take it now. Never take two doses together." };
  }
  if (hoursToNext !== null && hoursToNext < 4) {
    return { action: "skip_and_continue", text: "Very close to your next dose — skip the missed one and continue. Never double up to catch up." };
  }
  return {
    action: "ask",
    text: "This medicine's missed-dose window depends on the drug and your condition — confirm with your pharmacist before taking it late.",
  };
}

// ---------------------------------------------------------------- analytics

export interface DayCount {
  date: string; // YYYY-MM-DD
  taken: number;
  skipped: number;
  missed: number;
  pending: number;
}

export interface Analytics {
  /** taken ÷ slots whose day has closed; null while nothing has closed yet */
  adherencePct: number | null;
  /** days with every slot taken ÷ closed days (the dose-level PDC); null if no day has closed */
  mprPct: number | null;
  currentStreak: number;
  bestStreak: number;
  /** missed slots in the window, including the ones the sweep just closed */
  riskEvents: number;
  days: DayCount[];
  perMedication: { medicationId: string; brand: string; adherencePct: number | null }[];
}

export interface AnalyticsDoseRow {
  medicationId: string;
  brand: string;
  scheduledAt: Date;
  status: string;
}

export type DoseOutcome = "taken" | "skipped" | "missed" | "pending";

/**
 * The overdue sweep: a dose slot whose *day* has closed is a missed dose,
 * whatever the row says.
 *
 * Nothing in this build writes a dose status on a timer — there is no worker, and
 * a read route that mutates the timeline is its own class of bug — so the
 * transition is applied here, at read time, in front of every number that divides
 * by it. The alternative reading of the rows ("pending means we do not know yet")
 * is what inflated the score: an unanswered slot from six days ago is not unknown,
 * it is a dose that did not happen, and leaving it out of the denominator lets a
 * patient who answers one slot in five read as perfectly adherent — or, if they
 * answer nothing at all, as having no adherence figure rather than a 0%.
 *
 * The boundary is the calendar day, not the clock hour, and it is deliberately
 * conservative in the patient's favour: today's unanswered slots are still ahead
 * of them. A metric that charges a patient for a dose that has not happened yet is
 * not strict, it is wrong — and it would make the panel disagree at 09:00 and at
 * 22:00 about the same history.
 *
 * The same boundary runs the other way for days that have not arrived: an outcome
 * recorded against them is seeded data or a row written by a clock that moved, and
 * counting it would hand back the flattering reading this function exists to take
 * away. So a row is only ever answered for a day that is today or already closed.
 */
export function effectiveStatus(scheduledAt: Date, status: string, now: Date): DoseOutcome {
  const day = dateKey(scheduledAt);
  if (day > dateKey(now)) return "pending";
  if (status === "taken" || status === "skipped" || status === "missed") return status;
  // Anything else — including a status this build does not recognise — is treated
  // as unanswered, the only reading that can add a dose to the denominator rather
  // than silently drop one from it.
  return day < dateKey(now) ? "missed" : "pending";
}

export function computeAnalytics(rows: AnalyticsDoseRow[], windowDays = 14): Analytics {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - windowDays);
  cutoff.setHours(0, 0, 0, 0);
  const today = dateKey(now);

  const byDay: Map<string, DayCount> = new Map();
  const byMed: Map<string, { taken: number; total: number }> = new Map();
  let risk = 0;

  for (const r of rows) {
    if (r.scheduledAt < cutoff) continue;
    const status = effectiveStatus(r.scheduledAt, r.status, now);
    const key = dateKey(r.scheduledAt);
    const day = byDay.get(key) ?? { date: key, taken: 0, skipped: 0, missed: 0, pending: 0 };
    if (status === "taken") day.taken++;
    else if (status === "skipped") day.skipped++;
    else if (status === "missed") day.missed++;
    else day.pending++;
    byDay.set(key, day);

    const med = byMed.get(r.medicationId) ?? { taken: 0, total: 0 };
    if (status !== "pending") {
      med.total++;
      if (status === "taken") med.taken++;
    }
    byMed.set(r.medicationId, med);
    if (status === "missed") risk++;
  }

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  // The denominator is every slot whose day has closed — answered or not.
  const expected = days.reduce((acc, d) => acc + d.taken + d.skipped + d.missed, 0);
  const taken = days.reduce((acc, d) => acc + d.taken, 0);
  const adherence = expected ? (taken / expected) * 100 : null;

  // MPR here is the dose-level *proportion of days covered*, which is what a
  // dose-event dataset can honestly produce (the refill-based medication
  // possession ratio needs dispensing data this app never sees). A day counts as
  // covered only when every slot scheduled for it was taken, and today is never
  // in either side of the fraction while it is still in progress.
  let coveredDays = 0;
  let evaluableDays = 0;
  for (const d of days) {
    const scheduled = d.taken + d.skipped + d.missed;
    if (scheduled === 0 || d.date === today) continue;
    evaluableDays++;
    if (d.taken === scheduled) coveredDays++;
  }
  const mpr = evaluableDays ? (coveredDays / evaluableDays) * 100 : null;

  // streaks over days where everything scheduled was taken
  let currentStreak = 0;
  let bestStreak = 0;
  let run = 0;
  for (const d of days) {
    const scheduled = d.taken + d.skipped + d.missed;
    const perfect = scheduled > 0 && d.taken === scheduled;
    if (perfect) {
      run++;
      bestStreak = Math.max(bestStreak, run);
    } else if (d.missed > 0) {
      run = 0;
    }
  }
  // current streak = trailing perfect days, walking back from the most recent
  // day that has an outcome. A day whose doses are all still pending is
  // in progress, not broken: skipping it rather than stopping there is what
  // keeps today's still-untaken doses from zeroing a run the patient is inside.
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    const scheduled = d.taken + d.skipped + d.missed;
    if (scheduled === 0) continue;
    if (d.taken === scheduled) currentStreak++;
    else break;
  }

  return {
    adherencePct: adherence === null ? null : Math.round(adherence),
    mprPct: mpr === null ? null : Math.round(mpr),
    currentStreak,
    bestStreak,
    riskEvents: risk,
    days,
    perMedication: [...byMed.entries()].map(([id, m]) => ({
      medicationId: id,
      brand: rows.find((r) => r.medicationId === id)?.brand ?? "",
      adherencePct: m.total ? Math.round((m.taken / m.total) * 100) : null,
    })),
  };
}

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}
