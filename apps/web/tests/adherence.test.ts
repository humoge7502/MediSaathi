/**
 * The adherence engine's three laws, tested as pure functions.
 *
 * `computeAnalytics` produces every number on the Insights panel and
 * `catchUpGuidance` is what the dose button shows a patient who is late; both
 * were only ever exercised through a route, which is why the defect below
 * survived: the streak loop's comment said "trailing perfect days up to the
 * last resolved day" while its code stopped at the first *un*resolved one. Since
 * the seeded demo course ends today, that meant today's still-untaken doses
 * zeroed the streak — the panel reported `0d` at 10:00 and `3d` at 22:00 for
 * identical history.
 *
 * The third law is the overdue sweep, and it is the one that decides what an
 * unanswered dose *is*. Everything here pins it from both sides: the closed day
 * that must count, and the open day that must not.
 */
import { describe, expect, test } from "bun:test";
import {
  catchUpGuidance,
  computeAnalytics,
  dateKey,
  effectiveStatus,
  type AnalyticsDoseRow,
} from "@/lib/safety/adherence";

/** `dayOffset` days from today at `hh:mm`, so the 14-day window always contains the row. */
function at(dayOffset: number, hh: number, mm = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d;
}

/** One dose per `[day, status]` entry, all on the same medication. */
function history(...entries: [number, "taken" | "skipped" | "missed" | "pending"][]): AnalyticsDoseRow[] {
  return entries.map(([day, status]) => ({
    medicationId: "m1",
    brand: "Telma 40",
    scheduledAt: at(day, 9),
    status,
  }));
}

describe("the current streak", () => {
  test("counts back from the last day that has an outcome, through a day still open", () => {
    // Yesterday and the day before were perfect; today's single dose is pending.
    const a = computeAnalytics(history([-2, "taken"], [-1, "taken"], [0, "pending"]));
    expect(a.currentStreak).toBe(2);
    expect(a.bestStreak).toBe(2);
  });

  test("a perfect day completed earlier today keeps counting today", () => {
    // Two doses scheduled today: taken, and one still pending. `taken === resolved`
    // so the day is perfect *so far* — the run is alive, not broken.
    const rows: AnalyticsDoseRow[] = [
      { medicationId: "m1", brand: "Telma 40", scheduledAt: at(-1, 9), status: "taken" },
      { medicationId: "m1", brand: "Telma 40", scheduledAt: at(0, 9), status: "taken" },
      { medicationId: "m1", brand: "Telma 40", scheduledAt: at(0, 21), status: "pending" },
    ];
    expect(computeAnalytics(rows).currentStreak).toBe(2);
  });

  test("a missed dose ends it, and the day before it ends the run", () => {
    const a = computeAnalytics(history([-3, "taken"], [-2, "missed"], [-1, "taken"], [0, "pending"]));
    expect(a.currentStreak).toBe(1);
    expect(a.bestStreak).toBe(1);
    expect(a.riskEvents).toBe(1);
  });

  test("a fully pending window has no streak rather than a fake one", () => {
    expect(computeAnalytics(history([-1, "pending"], [0, "pending"])).currentStreak).toBe(0);
  });
});

describe("the adherence denominators", () => {
  test("count closed slots only, never a dose that has not happened yet", () => {
    const a = computeAnalytics(history([-1, "taken"], [-1, "taken"], [0, "taken"], [0, "pending"], [0, "pending"]));
    expect(a.adherencePct).toBe(100);
    expect(a.mprPct).toBe(100);
  });

  test("a deliberate skip counts against the day but not as a risk event", () => {
    const a = computeAnalytics(history([-1, "taken"], [-1, "skipped"]));
    expect(a.adherencePct).toBe(50);
    expect(a.riskEvents).toBe(0);
  });

  test("no closed slot is null, not zero", () => {
    // `0%` on a plan whose doses are all still pending would tell the patient
    // they had failed rather than that nothing had happened yet.
    expect(computeAnalytics(history([0, "pending"])).adherencePct).toBeNull();
  });
});

describe("the overdue sweep", () => {
  const now = new Date();

  test("a slot on a day that has closed with no answer is a missed dose", () => {
    expect(effectiveStatus(at(-1, 23, 30), "pending", now)).toBe("missed");
    expect(effectiveStatus(at(-14, 9), "pending", now)).toBe("missed");
  });

  test("today's unanswered slots are still in flight, at any hour", () => {
    // The boundary is the calendar day, not the clock: read at 22:00 this is two
    // pending slots, and read at 08:00 it is the same two. Either way the panel
    // must not charge the patient for a dose that has not happened yet.
    expect(effectiveStatus(at(0, 9), "pending", now)).toBe("pending");
    expect(effectiveStatus(at(0, 21), "pending", now)).toBe("pending");
    expect(effectiveStatus(at(1, 9), "pending", now)).toBe("pending");
  });

  test("an answer is never rewritten", () => {
    for (const status of ["taken", "skipped", "missed"] as const) {
      expect(effectiveStatus(at(-9, 9), status, now)).toBe(status);
    }
  });

  test("a status this build does not recognise is treated as unanswered", () => {
    // The only reading that can add a slot to the denominator rather than drop it
    // silently: an unknown status on a closed day is a dose nobody accounted for.
    expect(effectiveStatus(at(-2, 9), "acknowledged", now)).toBe("missed");
    expect(effectiveStatus(at(0, 9), "acknowledged", now)).toBe("pending");
  });

  test("an unanswered history is 0%, not an absent figure", () => {
    // This is the inflation the sweep exists to close: with `pending` outside the
    // denominator, a patient who never answers anything has no number at all, and
    // one who answers a single slot reads as perfectly adherent.
    const a = computeAnalytics(history([-2, "pending"], [-1, "pending"]));
    expect(a.adherencePct).toBe(0);
    expect(a.riskEvents).toBe(2);
    expect(a.mprPct).toBe(0);

    // A dose answered today shares the denominator with the closed days, so the
    // same patient who takes one dose of the three they could be charged for is a
    // third of the way to perfect — the open slot today is the one not yet counted.
    const b = computeAnalytics(history([-2, "pending"], [-1, "pending"], [0, "pending"], [0, "taken"]));
    expect(b.adherencePct).toBe(33);
    expect(b.riskEvents).toBe(2);
    expect(b.mprPct).toBe(0);
  });

  test("a day that has not arrived yet has no outcomes", () => {
    // The boundary cuts both ways. Tomorrow's row cannot be a fact about the past,
    // so an answer recorded against it — however the write happened — is worth
    // neither a point on the score nor a risk event on the panel.
    expect(effectiveStatus(at(1, 9), "taken", now)).toBe("pending");
    expect(effectiveStatus(at(1, 9), "missed", now)).toBe("pending");
    const a = computeAnalytics(history([-1, "taken"], [1, "taken"], [1, "pending"]));
    expect(a.adherencePct).toBe(100);
    expect(a.mprPct).toBe(100);
    expect(a.riskEvents).toBe(0);
  });

  test("the per-medication rows see the same denominator", () => {
    const a = computeAnalytics(history([-1, "pending"], [-1, "taken"]));
    expect(a.perMedication).toHaveLength(1);
    expect(a.perMedication[0].adherencePct).toBe(50);
  });

  test("the heatmap bucket for a closed day is no longer empty", () => {
    const a = computeAnalytics(history([-1, "pending"]));
    const day = a.days.find((d) => d.date === dateKey(at(-1, 9)));
    expect(day?.missed).toBe(1);
    expect(day?.pending).toBe(0);
  });
});

describe("MPR counts whole days, not whole doses", () => {
  test("a day with one dose out of two is half adherent and not covered at all", () => {
    const rows: AnalyticsDoseRow[] = [
      { medicationId: "m1", brand: "Telma 40", scheduledAt: at(-1, 9), status: "taken" },
      { medicationId: "m1", brand: "Telma 40", scheduledAt: at(-1, 21), status: "missed" },
    ];
    const a = computeAnalytics(rows);
    expect(a.adherencePct).toBe(50);
    expect(a.mprPct).toBe(0);
  });

  test("two perfect days and one half day is 83% of doses and 67% of days", () => {
    const rows: AnalyticsDoseRow[] = [];
    for (const day of [-3, -2, -1]) {
      rows.push({ medicationId: "m1", brand: "Telma 40", scheduledAt: at(day, 9), status: "taken" });
      rows.push({ medicationId: "m2", brand: "Glycomet 500", scheduledAt: at(day, 21), status: day === -1 ? "skipped" : "taken" });
    }
    const a = computeAnalytics(rows);
    expect(a.adherencePct).toBe(83); // 5 of 6
    expect(a.mprPct).toBe(67); // 2 of 3 days
    expect(a.adherencePct).not.toBe(a.mprPct);
  });

  test("today is in neither side of the fraction", () => {
    const rows: AnalyticsDoseRow[] = [
      { medicationId: "m1", brand: "Telma 40", scheduledAt: at(-1, 9), status: "taken" },
      { medicationId: "m1", brand: "Telma 40", scheduledAt: at(0, 9), status: "taken" },
      { medicationId: "m1", brand: "Telma 40", scheduledAt: at(0, 21), status: "pending" },
    ];
    const a = computeAnalytics(rows);
    expect(a.mprPct).toBe(100);
    expect(a.adherencePct).toBe(100);
  });

  test("a window with no closed day has no MPR rather than a zero", () => {
    expect(computeAnalytics(history([0, "pending"], [0, "taken"])).mprPct).toBeNull();
  });
});

describe("property: every number matches a recount done a different way", () => {
  // A deterministic generator, so a failure is reproducible from the seed alone.
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SLOTS = [9, 14, 21];
  const STATUSES = ["taken", "taken", "taken", "skipped", "missed", "pending"] as const;

  function randomRows(rand: () => number): AnalyticsDoseRow[] {
    const rows: AnalyticsDoseRow[] = [];
    // -16 and +1 are deliberate: one day outside the window on each side, so the
    // recount has to agree about the boundary and not just about the middle.
    for (let day = -16; day <= 1; day++) {
      if (rand() < 0.15) continue;
      for (const hh of SLOTS.slice(0, 1 + Math.floor(rand() * 3))) {
        rows.push({
          medicationId: "m1",
          brand: "Telma 40",
          scheduledAt: at(day, hh),
          status: STATUSES[Math.floor(rand() * STATUSES.length)],
        });
      }
    }
    return rows;
  }

  /**
   * A deliberately naive recount: local days as `toDateString()` keys rather than
   * this module's `dateKey`, statuses decided inline rather than through
   * `effectiveStatus`, fractions built with plain loops. Same laws, no shared
   * code — which is the only way an oracle can disagree with an implementation.
   */
  function recount(rows: AnalyticsDoseRow[]) {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const windowStart = new Date(startOfToday);
    windowStart.setDate(windowStart.getDate() - 14);

    const days = new Map<string, { taken: number; closed: number; missed: number; first: Date }>();
    const nowKey = now.toDateString();
    let kept = 0;
    for (const r of rows) {
      if (r.scheduledAt < windowStart) continue;
      kept++;
      const key = r.scheduledAt.toDateString();
      const bucket = days.get(key) ?? { taken: 0, closed: 0, missed: 0, first: r.scheduledAt };
      const answered = r.status === "taken" || r.status === "skipped" || r.status === "missed";
      // "Closed" is decided against midnight, not against the clock: today's
      // morning slot is in the past but the day has not, and a future one is
      // neither. Both must stay out of every denominator.
      const dayHasClosed = r.scheduledAt < startOfToday;
      const isToday = key === nowKey;
      // "Counted" is decided against midnight, not against the clock: today's
      // morning slot is in the past but the day has not, and a future day has no
      // outcomes at all — an answered row there is seeded data, not a fact about
      // the past. Both must stay out of every denominator.
      const counted = dayHasClosed || (isToday && answered);
      if (!counted) {
        // in neither fraction: still in flight
      } else if (answered) {
        bucket.closed++;
        if (r.status === "taken") bucket.taken++;
        if (r.status === "missed") bucket.missed++;
      } else {
        // the sweep: a closed day with no answer is a missed dose
        bucket.closed++;
        bucket.missed++;
      }
      days.set(key, bucket);
    }

    let taken = 0;
    let closed = 0;
    let missed = 0;
    let covered = 0;
    let evaluable = 0;
    for (const { taken: t, closed: c, missed: m, first } of days.values()) {
      taken += t;
      closed += c;
      missed += m;
      if (c > 0 && first < startOfToday) {
        evaluable++;
        if (t === c) covered++;
      }
    }
    return {
      adherencePct: closed ? Math.round((taken / closed) * 100) : null,
      mprPct: evaluable ? Math.round((covered / evaluable) * 100) : null,
      riskEvents: missed,
      dayCount: days.size,
      kept,
    };
  }

  test("200 generated histories, every number checked against the recount", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rows = randomRows(mulberry32(seed));
      const a = computeAnalytics(rows, 14);
      const o = recount(rows);
      expect({ seed, adherence: a.adherencePct, oracle: o.adherencePct }).toEqual({
        seed,
        adherence: o.adherencePct,
        oracle: o.adherencePct,
      });
      expect({ seed, mpr: a.mprPct, oracle: o.mprPct }).toEqual({ seed, mpr: o.mprPct, oracle: o.mprPct });
      expect({ seed, risk: a.riskEvents, oracle: o.riskEvents }).toEqual({ seed, risk: o.riskEvents, oracle: o.riskEvents });
      expect({ seed, days: a.days.length, oracle: o.dayCount }).toEqual({ seed, days: o.dayCount, oracle: o.dayCount });

      // The accounting identity: every row in the window lands in exactly one
      // bucket, so the heatmap can neither lose a dose nor invent one.
      const summed = a.days.reduce((acc, d) => acc + d.taken + d.skipped + d.missed + d.pending, 0);
      expect({ seed, summed, kept: o.kept }).toEqual({ seed, summed: o.kept, kept: o.kept });

      // One direction only, and it is worth pinning: no closed slot means no
      // closed day, so an absent adherence figure always takes the MPR with it.
      // The converse fails by design — a plan with today's doses answered has a
      // dose-level figure and no day-level one yet.
      if (a.adherencePct === null) expect(a.mprPct).toBeNull();
      for (const pct of [a.adherencePct, a.mprPct]) {
        if (pct !== null) expect(pct).toBeGreaterThanOrEqual(0);
        if (pct !== null) expect(pct).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("catch-up guidance", () => {
  // `catchUpGuidance` is pure, so the three inputs are pinned to a fixed
  // afternoon rather than to the wall clock: built from "today at 20:00" the
  // 18:00 dose below would be in the future when the suite runs at 15:00, and
  // the branch under test would not be the one reached.
  const day = new Date(2026, 5, 15);
  const atHour = (h: number, m = 0, dayShift = 0) => {
    const d = new Date(day);
    d.setDate(d.getDate() + dayShift);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const now = atHour(20);

  test("under two hours late is take-now", () => {
    const g = catchUpGuidance(atHour(18, 30), null, now);
    expect(g.action).toBe("take_now");
  });

  test("late with the next dose far away is take-now", () => {
    const g = catchUpGuidance(atHour(9), atHour(9, 0, 1), now);
    expect(g.action).toBe("take_now");
    expect(g.text).toContain("Never take two doses together");
  });

  test("late with the next dose imminent is skip, and never a double intake", () => {
    const g = catchUpGuidance(atHour(18), atHour(22), now);
    expect(g.action).toBe("skip_and_continue");
    expect(g.text).toContain("Never double up");
  });

  test("a last dose of the course is asked about, not assumed", () => {
    const g = catchUpGuidance(atHour(9), null, now);
    expect(g.action).toBe("ask");
    expect(g.text).toContain("pharmacist");
  });
});

test("dateKey is the local calendar day the heatmap buckets by", () => {
  const d = at(0, 23, 30);
  expect(dateKey(d)).toBe(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`);
});
