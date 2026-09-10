/**
 * Adherence engine — deterministic schedule & analytics.
 *
 * Turns a verified plan into dose slots, computes adherence analytics
 * (MPR, streaks, heatmap), and produces *conservative, generic* catch-up
 * guidance for missed doses (never double-dose advice; always points to
 * the pharmacist/doctor for specifics).
 */

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

const FREQ_TIMES: Record<string, string[]> = {
  OD: ["09:00"],
  HS: ["21:30"],
  BD: ["09:00", "21:00"],
  TDS: ["08:00", "14:00", "21:00"],
  QID: ["08:00", "12:00", "16:00", "21:00"],
  QWK: ["09:00"],
  SOS: ["12:00"], // placeholder slot; SOS doses are taken as-needed
};

export function defaultTimes(frequencyCode: string): string[] {
  return FREQ_TIMES[frequencyCode.toUpperCase()] ?? ["09:00"];
}

/** Generate dose slots for one medication over its duration, from `start`. */
export function generateSlots(spec: MedSpec, start: Date): DoseSlot[] {
  const slots: DoseSlot[] = [];
  const days = Math.max(1, Math.min(spec.durationDays || 7, 60));
  for (let d = 0; d < days; d++) {
    for (const t of spec.times) {
      const [hh, mm] = t.split(":").map((x) => parseInt(x, 10));
      const when = new Date(start);
      when.setDate(when.getDate() + d);
      when.setHours(hh, mm, 0, 0);
      slots.push({ medicationId: spec.id, scheduledAt: when, status: "pending" });
    }
  }
  return slots;
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
  adherencePct: number | null;
  mprPct: number | null;
  currentStreak: number;
  bestStreak: number;
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

export function computeAnalytics(rows: AnalyticsDoseRow[], windowDays = 14): Analytics {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  cutoff.setHours(0, 0, 0, 0);

  const byDay: Map<string, DayCount> = new Map();
  const byMed: Map<string, { taken: number; total: number }> = new Map();
  let risk = 0;

  for (const r of rows) {
    if (r.scheduledAt < cutoff) continue;
    const key = dateKey(r.scheduledAt);
    const day = byDay.get(key) ?? { date: key, taken: 0, skipped: 0, missed: 0, pending: 0 };
    if (r.status === "taken") day.taken++;
    else if (r.status === "skipped") day.skipped++;
    else if (r.status === "missed") day.missed++;
    else day.pending++;
    byDay.set(key, day);

    const med = byMed.get(r.medicationId) ?? { taken: 0, total: 0 };
    if (r.status !== "pending") {
      med.total++;
      if (r.status === "taken") med.taken++;
    }
    byMed.set(r.medicationId, med);
    if (r.status === "missed") risk++;
  }

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const resolved = days.reduce((acc, d) => acc + d.taken + d.skipped + d.missed, 0);
  const adherence = resolved ? (days.reduce((acc, d) => acc + d.taken, 0) / resolved) * 100 : null;

  // MPR: taken / expected over resolved days, capped at 100
  const mpr = resolved ? Math.min(100, (days.reduce((a, d) => a + d.taken, 0) / resolved) * 100) : null;

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
  // current streak = trailing perfect days up to the last resolved day
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    const scheduled = d.taken + d.skipped + d.missed;
    if (scheduled === 0) break;
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
