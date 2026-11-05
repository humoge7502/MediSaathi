/**
 * The reminder scheduling law, tested as arithmetic on a pinned clock.
 *
 * Each test here corresponds to a failure mode a shipping reminder app is
 * known for, because every one of them is a one-line omission in a `setTimeout`:
 *  - announcing a dose the patient already pressed *Taken* on (the tell that
 *    destroys trust in the feature that has to be trusted);
 *  - firing yesterday's queue of stale nudges on a late launch;
 *  - saying "Time for X" and "X is 30 min late" in the same second;
 *  - being silenced by quiet hours at the moment the dose is actually due —
 *    a patient losing a dose because they had the sense to set a night window;
 *  - re-arming an alert the browser already showed after a page reload.
 *
 * No database and no `Notification` object: `planAlerts` returns what *should*
 * happen, and the delivery hook is a thin loop over it (docs/TESTING.md, the
 * two-plane law — decide in pure code, do in the thin one).
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS,
  DELIVERY_GRACE_MS,
  describeGap,
  inQuiet,
  nextDue,
  planAlerts,
  sanitizeSettings,
  settingsPatchErrors,
  type ReminderDose,
  type ReminderSettings,
} from "@/lib/safety/reminders";

const MINUTE = 60_000;

// Pinned clock (the same law as adherence.test.ts): a test that writes "today at
// 09:00" computes a dose in the future or the past depending on when the suite
// ran, which is a flake with a nice name.
const DAY = { year: 2026, month: 5, date: 15 };
const at = (hh: number, mm = 0) => new Date(DAY.year, DAY.month, DAY.date, hh, mm).getTime();

function dose(doseId: string, hh: number, mm = 0, over: Partial<ReminderDose> = {}): ReminderDose {
  return {
    doseId,
    medicationId: `med-${doseId}`,
    brand: "Telma 40",
    detail: "40 mg",
    scheduledAt: at(hh, mm),
    status: "pending",
    ...over,
  };
}

function settings(over: Partial<ReminderSettings> = {}): ReminderSettings {
  return { ...DEFAULT_SETTINGS, ...over };
}

const keys = (alerts: { key: string }[]) => alerts.map((a) => a.key);
const kinds = (alerts: { kind: string }[]) => alerts.map((a) => a.kind);

describe("an alert plan for one dose", () => {
  test("carries the early nudge and the at-time call, in that order", () => {
    const plan = planAlerts([dose("d1", 9)], settings({ leadMinutes: 10 }), at(6));
    expect(keys(plan)).toEqual(["d1:upcoming", "d1:due"]);
    expect(plan[0].at).toBe(at(8, 50));
    expect(plan[1].at).toBe(at(9));
    expect(plan[0].title).toContain("10 min");
  });

  test("has no nudge at all when the lead is off", () => {
    const plan = planAlerts([dose("d1", 9)], settings({ leadMinutes: 0 }), at(6));
    expect(kinds(plan)).toEqual(["due"]);
  });

  test("is empty when reminders are off, whatever the clock says", () => {
    expect(planAlerts([dose("d1", 9)], settings({ enabled: false }), at(8, 55))).toEqual([]);
  });
});

describe("a dose the patient already answered is silent", () => {
  for (const status of ["taken", "skipped", "missed"] as const) {
    test(`a ${status} dose plans nothing, even before its time`, () => {
      const plan = planAlerts([dose("d1", 9, 0, { status })], settings(), at(6));
      expect(plan).toEqual([]);
    });
  }

  test("the nudge for a dose taken early is gone, not deferred", () => {
    // The tap lands at 08:40; the 08:50 nudge must not arrive from a queue.
    const plan = planAlerts([dose("d1", 9, 0, { status: "taken" })], settings(), at(8, 55));
    expect(plan).toEqual([]);
  });
});

describe("opening the app late", () => {
  test("drops the nudge whose moment passed instead of firing it", () => {
    // Dose at 09:00, nudge was due 08:50, app opens at 08:58.
    const plan = planAlerts([dose("d1", 9)], settings(), at(8, 58));
    expect(kinds(plan)).not.toContain("upcoming");
  });

  test("announces the missed at-time once, at the moment of opening", () => {
    const plan = planAlerts([dose("d1", 9)], settings(), at(9, 5));
    expect(keys(plan)).toEqual(["d1:due"]);
    expect(plan[0].at).toBe(at(9, 5));
  });

  test("does not call a dose late before it has said it was due", () => {
    // Both alerts at 09:00 would read as a malfunction: one message per moment.
    const plan = planAlerts([dose("d1", 9)], settings({ lateMinutes: 30 }), at(9, 0));
    expect(keys(plan)).toEqual(["d1:due"]);
  });

  test("earns the re-nudge only after the at-time alert was delivered", () => {
    const plan = planAlerts([dose("d1", 9)], settings({ lateMinutes: 30 }), at(9, 5), new Set(["d1:due"]));
    expect(keys(plan)).toEqual(["d1:overdue"]);
    expect(plan[0].at).toBe(at(9, 30));
    expect(plan[0].title).toContain("30 min late");
  });

  test("says nothing once the dose is outside the late window", () => {
    // 22:00 launch, a 09:00 dose: the panel owns that conversation, not a badge.
    const plan = planAlerts([dose("d1", 9)], settings({ lateMinutes: 30 }), at(22));
    expect(plan).toEqual([]);
  });

  test("with the re-nudge off, a past dose is never announced", () => {
    expect(planAlerts([dose("d1", 9)], settings({ lateMinutes: 0 }), at(9, 5))).toEqual([]);
  });
});

describe("a tick that steps over an alert's moment", () => {
  // The delivery loop polls; it never lands on 08:50:00.000. Without a grace
  // window the alert is planned on one tick and dropped on the next, so the
  // reminder depends on when the page happened to wake up.
  const atSecond = (hh: number, mm: number, ss: number) => at(hh, mm) + ss * 1000;

  test("the early nudge is still delivered a few seconds on", () => {
    const plan = planAlerts([dose("d1", 9)], settings({ leadMinutes: 10 }), atSecond(8, 50, 30));
    expect(kinds(plan)).toContain("upcoming");
  });

  test("and is forgotten once the grace has passed", () => {
    const plan = planAlerts([dose("d1", 9)], settings({ leadMinutes: 10 }), atSecond(8, 52, 0));
    expect(kinds(plan)).not.toContain("upcoming");
  });

  test("the late re-nudge survives a tick landing past it", () => {
    const plan = planAlerts([dose("d1", 9)], settings({ lateMinutes: 30 }), atSecond(9, 30, 20), new Set(["d1:due"]));
    expect(keys(plan)).toEqual(["d1:overdue"]);
  });

  test("and is gone for good once its own window closed", () => {
    const plan = planAlerts([dose("d1", 9)], settings({ lateMinutes: 30 }), atSecond(9, 35, 0), new Set(["d1:due"]));
    expect(plan).toEqual([]);
  });

  test("the polling interval is inside the grace it depends on", () => {
    // 15 s is what `useReminders` ticks at; four chances per grace window is the
    // invariant that makes the two tests above hold in the browser.
    expect(DELIVERY_GRACE_MS / 4).toBe(15_000);
  });
});

describe("the delivered set", () => {
  test("suppresses every kind, not just the at-time alert", () => {
    // The three kinds are not all plan-able in one call — the re-nudge is only
    // earned once the at-time alert was delivered — so each is filtered in the
    // state where it would otherwise appear.
    expect(keys(planAlerts([dose("d1", 9)], settings({ lateMinutes: 30 }), at(8), new Set(["d1:upcoming"]))))
      .toEqual(["d1:due"]);
    // One hour before the dose, with the at-time already delivered, the plan
    // holds the nudge *and* the re-nudge: both are future `at`s, and the loop
    // that consumes this array only announces once `at <= now`. A full day of
    // alerts is visible ahead of time — which is what the panel renders.
    expect(keys(planAlerts([dose("d1", 9)], settings({ lateMinutes: 30 }), at(8), new Set(["d1:due"]))))
      .toEqual(["d1:upcoming", "d1:overdue"]);
    expect(keys(planAlerts([dose("d1", 9)], settings({ lateMinutes: 30 }), at(9, 1), new Set(["d1:due"]))))
      .toEqual(["d1:overdue"]);
    expect(planAlerts([dose("d1", 9)], settings({ lateMinutes: 30 }), at(9, 1), new Set(["d1:due", "d1:overdue"])))
      .toEqual([]);
  });

  test("a reload cannot re-arm what this browser already showed", () => {
    // 09:05 with the dose missed at source: the at-time alert is still inside its
    // window and the re-nudge is scheduled at 09:30, so a fresh page would offer
    // both again. Passing the delivered keys is what stops that.
    expect(keys(planAlerts([dose("d1", 9)], settings(), at(9, 5)))).toContain("d1:due");
    const fired = new Set(["d1:upcoming", "d1:due", "d1:overdue"]);
    expect(planAlerts([dose("d1", 9)], settings(), at(9, 5), fired)).toEqual([]);
  });
});

describe("quiet hours", () => {
  const night = { startMinutes: 22 * 60, endMinutes: 7 * 60 };

  test("hold back the early nudge that would land at night", () => {
    // A 23:00 dose nudges at 22:50 — inside the window, so the nudge is dropped.
    const plan = planAlerts([dose("d1", 23)], settings({ quiet: night }), at(20));
    expect(kinds(plan)).toEqual(["due"]);
  });

  test("never silence the dose that is due, or one already late", () => {
    // The patient chose to be woken by turning reminders on; they did not choose
    // to lose the 23:00 dose because it fell inside a night window.
    expect(kinds(planAlerts([dose("d1", 23)], settings({ quiet: night }), at(23)))).toEqual(["due"]);
    const late = planAlerts([dose("d1", 23)], settings({ quiet: night, lateMinutes: 30 }), at(23, 5), new Set(["d1:due"]));
    expect(kinds(late)).toEqual(["overdue"]);
  });

  test("a dose just after the window keeps its nudge", () => {
    // 07:30 dose, nudge at 07:20: outside 22:00-07:00 (the end is exclusive).
    const plan = planAlerts([dose("d1", 7, 30)], settings({ quiet: night }), at(5));
    expect(kinds(plan)).toEqual(["upcoming", "due"]);
  });

  test("inQuiet reads a half-open, midnight-wrapping range", () => {
    expect(inQuiet(at(22), night)).toBe(true);
    expect(inQuiet(at(23, 59), night)).toBe(true);
    expect(inQuiet(at(3), night)).toBe(true);
    expect(inQuiet(at(6, 59), night)).toBe(true);
    expect(inQuiet(at(7), night)).toBe(false);
    expect(inQuiet(at(12), night)).toBe(false);
    expect(inQuiet(at(21, 59), night)).toBe(false);
  });

  test("a window that does not wrap is read the same way", () => {
    const nap = { startMinutes: 13 * 60, endMinutes: 14 * 60 };
    expect(inQuiet(at(13, 30), nap)).toBe(true);
    expect(inQuiet(at(12, 30), nap)).toBe(false);
    expect(inQuiet(at(14), nap)).toBe(false);
  });

  test("no window silences anything", () => {
    expect(inQuiet(at(3), null)).toBe(false);
    // An equal-bounds window is a zero-length one: it is not "all day".
    expect(inQuiet(at(3), { startMinutes: 300, endMinutes: 300 })).toBe(false);
  });
});

describe("muting one medicine", () => {
  test("silences that medicine and nothing else", () => {
    const doses = [dose("d1", 9), dose("d2", 21)];
    const plan = planAlerts(doses, settings({ mutedMedications: ["med-d1"] }), at(6));
    expect(new Set(plan.map((a) => a.doseId))).toEqual(new Set(["d2"]));
  });

  test("an id nobody recognises simply never matches", () => {
    const plan = planAlerts([dose("d1", 9)], settings({ mutedMedications: ["ghost"] }), at(6));
    expect(keys(plan)).toEqual(["d1:upcoming", "d1:due"]);
  });
});

describe("a day of doses", () => {
  test("is planned in time order across medicines", () => {
    const doses = [dose("d3", 21), dose("d1", 9), dose("d2", 14)];
    const plan = planAlerts(doses, settings({ leadMinutes: 0 }), at(6));
    expect(plan.map((a) => a.at)).toEqual([at(9), at(14), at(21)]);
  });

  test("a resolved dose in the middle of the day does not disturb its neighbours", () => {
    const doses = [dose("d1", 9), dose("d2", 14, 0, { status: "taken" }), dose("d3", 21)];
    expect(keys(planAlerts(doses, settings({ leadMinutes: 0 }), at(6)))).toEqual(["d1:due", "d3:due"]);
  });
});

describe("settings sanitising", () => {
  test("clamps every number to the system bound", () => {
    const s = sanitizeSettings({ leadMinutes: 900, lateMinutes: 5000 });
    expect(s.leadMinutes).toBe(180);
    expect(s.lateMinutes).toBe(720);
    expect(sanitizeSettings({ leadMinutes: -5, lateMinutes: -1 })).toEqual(
      expect.objectContaining({ leadMinutes: 0, lateMinutes: 0 })
    );
  });

  test("a value that is not a number falls back to the default", () => {
    const s = sanitizeSettings({ leadMinutes: "soon", lateMinutes: null, enabled: "yes" });
    expect(s.leadMinutes).toBe(DEFAULT_SETTINGS.leadMinutes);
    expect(s.lateMinutes).toBe(DEFAULT_SETTINGS.lateMinutes);
    expect(s.enabled).toBe(true);
  });

  test("an empty or absent settings object is the default, not a crash", () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  test("a quiet window with equal bounds is no window", () => {
    expect(sanitizeSettings({ quiet: { startMinutes: 600, endMinutes: 600 } }).quiet).toBeNull();
    expect(sanitizeSettings({ quiet: { startMinutes: 1440, endMinutes: 900 } }).quiet)
      .toEqual({ startMinutes: 1439, endMinutes: 900 });
  });

  test("the mute list is strings only, and bounded", () => {
    const s = sanitizeSettings({ mutedMedications: ["a", 1, null, "b", {}] });
    expect(s.mutedMedications).toEqual(["a", "b"]);
    expect(sanitizeSettings({ mutedMedications: Array.from({ length: 500 }, (_, i) => `m${i}`) }).mutedMedications.length).toBe(200);
    expect(sanitizeSettings({ mutedMedications: "not-an-array" }).mutedMedications).toEqual([]);
  });
});

describe("settings patch validation", () => {
  test("accepts a partial patch and an empty one", () => {
    expect(settingsPatchErrors({})).toEqual([]);
    expect(settingsPatchErrors({ enabled: false })).toEqual([]);
    expect(settingsPatchErrors({ quiet: null })).toEqual([]);
    expect(settingsPatchErrors({ leadMinutes: 0, lateMinutes: 0, mutedMedications: [] })).toEqual([]);
  });

  test("refuses a body that is not an object", () => {
    for (const raw of [null, "on", 7, [1, 2], true]) {
      expect(settingsPatchErrors(raw).length).toBe(1);
    }
  });

  test("refuses a number that is not a number", () => {
    expect(settingsPatchErrors({ leadMinutes: "soon" })).toHaveLength(1);
    expect(settingsPatchErrors({ leadMinutes: Number.NaN })).toHaveLength(1);
    expect(settingsPatchErrors({ leadMinutes: null })).toHaveLength(1);
    expect(settingsPatchErrors({ lateMinutes: -1 })).toHaveLength(1);
    expect(settingsPatchErrors({ leadMinutes: 181 })).toHaveLength(1);
  });

  test("refuses a quiet window without two clock minutes", () => {
    expect(settingsPatchErrors({ quiet: {} })).toHaveLength(2);
    expect(settingsPatchErrors({ quiet: { startMinutes: 1320 } })).toHaveLength(1);
    expect(settingsPatchErrors({ quiet: { startMinutes: 1320, endMinutes: "morning" } })).toHaveLength(1);
    expect(settingsPatchErrors({ quiet: [22, 7] })).toHaveLength(1);
    expect(settingsPatchErrors({ quiet: { startMinutes: 1440, endMinutes: 420 } })).toHaveLength(1);
  });

  test("refuses a boolean that is not one", () => {
    expect(settingsPatchErrors({ enabled: 1 })).toHaveLength(1);
  });

  test("refuses a field the law does not know", () => {
    // Silently dropping it is how a renamed setting stops working with a 200 on it.
    expect(settingsPatchErrors({ leadTimeMinutes: 10 })).toEqual(["unknown settings field: leadTimeMinutes"]);
  });
});

describe("the next dose", () => {
  test("an overdue dose wins the conversation", () => {
    const doses = [dose("d1", 9), dose("d2", 21)];
    expect(nextDue(doses, at(10))?.doseId).toBe("d1");
  });

  test("otherwise it is the soonest pending one", () => {
    // 10:00 with the 09:00 dose already taken: the wait is the 14:00 slot, not
    // the 21:00 one, and not the resolved dose that sits between them.
    const doses = [dose("d3", 21), dose("d1", 9, 0, { status: "taken" }), dose("d2", 14)];
    expect(nextDue(doses, at(6))?.doseId).toBe("d2");
    expect(nextDue([dose("d3", 21), dose("d1", 9), dose("d2", 14)], at(6))?.doseId).toBe("d1");
  });

  test("resolved doses are not waited on", () => {
    const doses = [dose("d1", 9, 0, { status: "taken" }), dose("d2", 14, 0, { status: "skipped" })];
    expect(nextDue(doses, at(6))).toBeNull();
  });

  test("an empty day has no next dose", () => {
    expect(nextDue([], at(6))).toBeNull();
  });
});

describe("the gap label", () => {
  test("counts forward in hours and minutes", () => {
    expect(describeGap(at(11, 5), at(9))).toBe("in 2 h 05 min");
    expect(describeGap(at(9, 41), at(9))).toBe("in 41 min");
    expect(describeGap(at(9), at(9))).toBe("now");
  });

  test("counts backward as late", () => {
    expect(describeGap(at(9), at(9, 41))).toBe("41 min late");
    expect(describeGap(at(7), at(9))).toBe("2 h 00 min late");
    expect(describeGap(at(9) - 20_000, at(9))).toBe("just now");
  });
});
