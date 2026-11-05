/**
 * The administration-interval law, tested where it is decided — TypeScript side.
 *
 * Mirrors `apps/api/tests/test_interval_law.py`. The parity corpus pins that the
 * two planes agree; this file pins what they agree about, including the part the
 * raw-line parity harness cannot express (a *stated* frequency the law cannot
 * read, and the schedule the scheduler is allowed to generate from a code).
 *
 * Each test names the live defect it guards:
 * - `1/7` collapsed into one float rendered as one dose per day for a weekly
 *   drug; the scheduler is the code that turns the axes into dates, so that is
 *   where the bug class is proven dead;
 * - an unreadable frequency defaulted to `["09:00"]`, inventing a once-daily
 *   regimen the prescription never asked for;
 * - oral methotrexate written "daily" carried no frequency at all, so the
 *   never-event rule could not fire;
 * - a queued line and an interaction on the same line produced different
 *   verdicts in the two planes, and only `confirm_queue` blocks plan creation.
 */
import { describe, expect, test } from "bun:test";
import {
  LINE_FREQ_PROSE,
  LINE_FREQ_TOKENS,
  dailyFactor,
  extractLineFrequency,
  parseFrequency,
  preferredTimes,
} from "@/lib/safety/frequency";
import {
  brandLabelStrength,
  brandStrength,
  brandStrengths,
  intervalHazard,
  intervalMandateFor,
  parseStrength,
  strengthMismatch,
} from "@/lib/safety/schedule-rules";
import { BRANDS } from "@/lib/safety/dataset";
import { generateSlots, scheduleFor, slotDates, type MedSpec } from "@/lib/safety/adherence";
import { runSafetyPlane } from "@/lib/safety/engine";

const START = new Date(2026, 0, 1, 8, 0, 0, 0); // local, so date arithmetic is stable

/** One line, screened at auto-confirmed reading confidence. */
function plane(lines: string[], contexts: string[] = []) {
  return runSafetyPlane({
    rawLines: lines,
    contexts,
    lineConfidence: lines.map(() => 0.97),
  });
}

describe("the two axes a frequency code carries", () => {
  const cases: [string, number, number][] = [
    ["OD", 1, 1], ["DAILY", 1, 1], ["EVERY DAY", 1, 1], ["1-0-0", 1, 1],
    ["HS", 1, 1], ["BEDTIME", 1, 1], ["NOCTE", 1, 1],
    ["BD", 2, 1], ["BID", 2, 1], ["1-0-1", 2, 1], ["TWICE DAILY", 2, 1],
    ["TDS", 3, 1], ["1-1-1", 3, 1], ["QID", 4, 1], ["1-1-1-1", 4, 1],
    ["QOD", 1, 2], ["EVERY OTHER DAY", 1, 2], ["ALTERNATE DAYS", 1, 2],
    ["QWK", 1, 7], ["QW", 1, 7], ["WEEKLY", 1, 7], ["ONCE WEEKLY", 1, 7], ["7D", 1, 7],
    ["BIW", 2, 7], ["TWICE WEEKLY", 2, 7],
    ["Q2W", 1, 14], ["Q3W", 1, 21],
    ["QM", 1, 30], ["MONTHLY", 1, 30], ["EVERY MONTH", 1, 30],
  ];
  for (const [code, doses, interval] of cases) {
    test(`${code} keeps doses-per-administration-day and days-apart separate`, () => {
      const f = parseFrequency(code);
      expect(f).not.toBeNull();
      expect([f!.dosesPerDay, f!.intervalDays]).toEqual([doses, interval]);
    });
  }

  test("weekly is the exact fraction 1/7, never a rounded 0.14", () => {
    const f = parseFrequency("QWK")!;
    expect(dailyFactor(f)).toBe(1 / 7);
    expect(dailyFactor(f)).not.toBe(Math.round((1 / 7) * 100) / 100);
    expect(dailyFactor(parseFrequency("BIW")!)).toBe(2 / 7);
  });

  test("as-needed and single doses report the administration, not a rate", () => {
    expect(dailyFactor(parseFrequency("SOS")!)).toBe(1);
    expect(dailyFactor(parseFrequency("STAT")!)).toBe(1);
    expect(parseFrequency("STAT")!.single).toBe(true);
    expect(parseFrequency("PRN")!.asNeeded).toBe(true);
  });
});

describe("a slot code and an interval word are one instruction", () => {
  for (const [code, doses, interval] of [
    ["0-0-1 weekly", 1, 7], ["1-0-1 alternate day", 2, 2],
    ["1-1-0 every 3 weeks", 2, 21], ["1-0-0 daily", 1, 1],
  ] as [string, number, number][]) {
    test(`'${code}' keeps both halves`, () => {
      const f = parseFrequency(code);
      expect(f).not.toBeNull();
      expect([f!.dosesPerDay, f!.intervalDays]).toEqual([doses, interval]);
    });
  }

  test("the code alone still means daily", () => {
    expect([parseFrequency("1-0-0")!.dosesPerDay, parseFrequency("1-0-0")!.intervalDays])
      .toEqual([1, 1]);
  });

  test("an unreadable qualifier does not fall back to daily", () => {
    expect(parseFrequency("0-0-1 after food")).toBeNull();
  });

  test("a PRN qualifier on a code is still PRN", () => {
    expect(parseFrequency("0-1-1 SOS")!.asNeeded).toBe(true);
  });

  test("the line carries the qualifier with the code", () => {
    // RX-038 is written this way and the extractor dropped the word, which made
    // a correct weekly course read as a daily never-event.
    expect(extractLineFrequency("Tab Calcirol 60K - 0-0-1 weekly x 8 weeks"))
      .toBe("0-0-1 WEEKLY");
    // A duration is not a qualifier.
    expect(extractLineFrequency("Tab Dolo 650 - 1-0-0 x 30 days")).toBe("1-0-0");
  });

  test("a spaced dash separates the dose from the regimen", () => {
    // "Amlong 5 - 1-0-0" otherwise starts a legal slot code at the 5 and reads
    // 1+5 = 6 administrations a day, which invented a 30 mg/day amlodipine
    // course out of a 5 mg prescription.
    expect(extractLineFrequency("Tab Amlong 5 - 1-0-0 x 90 days")).toBe("1-0-0");
    expect(extractLineFrequency("Tab Lyrica 75 - 1-0-1 x 30 days")).toBe("1-0-1");
    expect(extractLineFrequency("Tab Crocin 650 - 1 - 0 - 1 SOS")).toBe("1-0-1 SOS");
    expect(extractLineFrequency("Tab Storvas 20 - 0-0-1 x 90 days")).toBe("0-0-1");
  });
});

describe("the parser refuses to invent a schedule", () => {
  for (const code of ["", "QODS", "TDS??", "OWC", "8-8-8", "75-1-0", "0-0-0",
    "every 999 days", "3x daily x", "DUBL"]) {
    test(`'${code}' is unreadable -> null, never a once-daily default`, () => {
      expect(parseFrequency(code)).toBeNull();
    });
  }

  test("a TAC slot count is one digit: '1-0-1' is a schedule, '75-1-0' is a dose", () => {
    expect(parseFrequency("1-0-1")!.dosesPerDay).toBe(2);
    expect(parseFrequency("1-1-1-1")!.dosesPerDay).toBe(4);
    expect(parseFrequency("75-1-0")).toBeNull();
  });

  test("prose intervals convert weeks and months instead of dropping them", () => {
    const gaps: [string, number][] = [
      ["every 3 days", 3], ["q 3 days", 3], ["every 2 weeks", 14],
      ["q 4 weeks", 28], ["every 3 weeks", 21], ["every 2 months", 60],
      ["q3d", 3], ["q2w", 14], ["q30d", 30],
    ];
    for (const [prose, gap] of gaps) expect(parseFrequency(prose)!.intervalDays).toBe(gap);
  });

  test("hourly codes become administrations per day; one that cannot divide a day is refused", () => {
    expect(parseFrequency("6 hourly")!.dosesPerDay).toBe(4);
    expect(parseFrequency("Q6H")!.dosesPerDay).toBe(4);
    expect(parseFrequency("5 hourly")).toBeNull();
  });

  test("bedtime words canonicalize to HS and schedule at night", () => {
    for (const word of ["AT NIGHT", "NOCTE", "NIGHTLY", "BEDTIME", "AT BEDTIME"]) {
      const f = parseFrequency(word)!;
      expect(f.code).toBe("HS");
      expect(preferredTimes(f)).toEqual(["21:30"]);
    }
  });
});

describe("raw-line vocabulary: the law must be reachable from written text", () => {
  const lines: [string, string][] = [
    ["T. Folitrax 10 10 mg daily x 28d", "DAILY"],
    ["T. Folitrax 10 10 mg once weekly x 28d", "ONCE WEEKLY"],
    ["T. Folitrax 10 10 mg every other day x 28d", "EVERY OTHER DAY"],
    ["T. Folitrax 10 10 mg alternate days x 28d", "ALTERNATE DAYS"],
    ["T. Folitrax 10 10 mg every 3 days x 28d", "EVERY 3 DAYS"],
    ["T. Folitrax 10 10 mg q 3 weeks x 28d", "Q 3 WEEKS"],
    ["T. Folitrax 10 10 mg Q2W x 28d", "Q2W"],
    ["T. Folitrax 10 10 mg 6 hourly x 2d", "6 HOURLY"],
    ["T. Folitrax 10 10 mg bedtime x 28d", "BEDTIME"],
    ["Tab Dolo 650 - 1-0-1 x 5 days", "1-0-1"],
    ["Tab Lyrica 75 - 1-0-1", "1-0-1"],
  ];
  for (const [line, code] of lines) {
    test(`${code} is read out of '${line}'`, () => {
      expect(extractLineFrequency(line)).toBe(code);
      expect(parseFrequency(code)).not.toBeNull();
    });
  }

  test("the multi-word form wins over the short form inside it", () => {
    // Alternation is first-match-wins, so "DAILY" ahead of "ONCE DAILY" in the
    // ordered list would misread "once daily" as "daily" — a 7x schedule error
    // on a weekly drug.
    expect(extractLineFrequency("T. Folitrax 10 once daily x 28d")).toBe("ONCE DAILY");
    const idx = (t: string) => LINE_FREQ_TOKENS.indexOf(t);
    expect(idx("ONCE DAILY")).toBeLessThan(idx("DAILY"));
    expect(idx("TWICE DAILY")).toBeLessThan(idx("DAILY"));
    expect(idx("ONCE WEEKLY")).toBeLessThan(idx("WEEKLY"));
    expect(idx("EVERY OTHER DAY")).toBeLessThan(idx("OD"));
  });

  test("every token the line parser offers is a code the law can read", () => {
    for (const token of LINE_FREQ_TOKENS) expect(parseFrequency(token)).not.toBeNull();
  });

  test("the prose pattern mirrors the Python tier verbatim", () => {
    // apps/api/app/safety/dosing.py::_LINE_FREQ_PROSE. A mirror that drifts by one
    // character changes which lines carry a frequency, which changes verdicts.
    expect(LINE_FREQ_PROSE).toBe(
      String.raw`\d+\s*(?:HOURLY|HOURS?)|Q\d+[DHWM]|(?:EVERY|Q)\s+\d+\s+(?:DAYS?|WEEKS?|MONTHS?)`
    );
  });
});

describe("the scheduler: one slot per administration day, not per calendar day", () => {
  test("a weekly code over 28 days yields 4 dates, not 28", () => {
    const spec = scheduleFor("QWK")!;
    expect(spec.intervalDays).toBe(7);
    const dates = slotDates(spec, 28, START);
    expect(dates.length).toBe(4);
    for (let i = 1; i < dates.length; i++) {
      const gap = (dates[i].getTime() - dates[i - 1].getTime()) / 86400000;
      expect(gap).toBe(7);
    }
    expect(dates[0].getHours()).toBe(9);
  });

  test("interval arithmetic holds for the other mandated gaps", () => {
    expect(slotDates(scheduleFor("OD")!, 28, START).length).toBe(28);
    expect(slotDates(scheduleFor("QID")!, 5, START).length).toBe(20);
    expect(slotDates(scheduleFor("QOD")!, 8, START).length).toBe(4);
    expect(slotDates(scheduleFor("BIW")!, 14, START).length).toBe(4);
    expect(slotDates(scheduleFor("QM")!, 90, START).length).toBe(3);
  });

  test("bedtime codes land at 21:30 and weekly codes at 09:00", () => {
    const hs = slotDates(scheduleFor("HS")!, 3, START);
    expect(hs.map((d) => d.getHours())).toEqual([21, 21, 21]);
    expect(slotDates(scheduleFor("QWK")!, 3, START).length).toBe(1);
  });

  test("an unreadable frequency yields no schedule at all", () => {
    // The old fallback was ["09:00"] for any unknown code: a line the reading
    // layer could not resolve still produced a daily reminder.
    expect(scheduleFor("QODS")).toBeNull();
    expect(scheduleFor("")).toBeNull();
    expect(scheduleFor("OWC")).toBeNull();
    expect(generateSlots(med({ frequencyCode: "QODS" }), START)).toEqual([]);
  });

  test("as-needed generates no slots, stat generates exactly one", () => {
    expect(scheduleFor("SOS")!.times).toEqual([]);
    expect(slotDates(scheduleFor("SOS")!, 30, START)).toEqual([]);
    expect(slotDates(scheduleFor("STAT")!, 30, START).length).toBe(1);
  });

  test("weekly methotrexate produces four pending doses over a 28-day course", () => {
    const slots = generateSlots(med({
      id: "mtx", brand: "Folitrax 10", molecule: "methotrexate",
      doseMg: 10, frequencyCode: "QWK", times: ["09:00"], durationDays: 28,
    }), START);
    expect(slots.length).toBe(4);
    expect(slots.every((s) => s.status === "pending")).toBe(true);
  });

  test("duration is clamped rather than left to run away", () => {
    expect(slotDates(scheduleFor("OD")!, 0, START).length).toBe(7);
    expect(slotDates(scheduleFor("OD")!, 400, START).length).toBe(365);
  });
});

function med(patch: Partial<MedSpec>): MedSpec {
  return {
    id: "m1", brand: "Dolo 650", molecule: "paracetamol", doseMg: 650,
    frequencyCode: "1-0-1", times: ["08:00", "21:00"], durationDays: 5,
    instructions: "after food", ...patch,
  };
}

describe("never-event interval mandates", () => {
  for (const freq of ["OD", "DAILY", "BD", "TDS", "QID", "1-0-1", "QOD", "every 3 days", "6 hourly"]) {
    test(`oral methotrexate on '${freq}' is a hazard`, () => {
      const got = intervalHazard(freq, "10 mg", "methotrexate", "tablet");
      expect(got).not.toBeNull();
      expect(got!.rule.minIntervalDays).toBe(7);
      expect(got!.freq.intervalDays).toBeLessThan(7);
    });
  }

  for (const freq of ["QWK", "WEEKLY", "ONCE WEEKLY", "q 3 weeks", "Q2W", "every 14 days"]) {
    test(`oral methotrexate on '${freq}' is the labeled schedule, not a hazard`, () => {
      expect(intervalHazard(freq, "10 mg", "methotrexate", "tablet")).toBeNull();
    });
  }

  test("PRN and one-off doses have no steady-state schedule to violate", () => {
    expect(intervalHazard("SOS", "10 mg", "methotrexate", "tablet")).toBeNull();
    expect(intervalHazard("STAT", "10 mg", "methotrexate", "tablet")).toBeNull();
  });

  test("the oral mandate does not claim the injectable form", () => {
    expect(intervalMandateFor("methotrexate", "injection", 15)).toBeNull();
    expect(intervalMandateFor("methotrexate", "tablet", 15)).not.toBeNull();
  });

  test("each mandate carries its own label minimum", () => {
    expect(intervalMandateFor("alendronate", "tablet", 70)!.minIntervalDays).toBe(7);
    expect(intervalMandateFor("risedronate", "tablet", 35)!.minIntervalDays).toBe(7);
    expect(intervalMandateFor("ibandronate", "tablet", 150)!.minIntervalDays).toBe(30);
    expect(intervalMandateFor("semaglutide", "injection", 1)!.minIntervalDays).toBe(7);
    // Below the strength the label covers, the rule must not invent a schedule.
    expect(intervalMandateFor("alendronate", "tablet", 10)).toBeNull();
  });

  test("monthly mandate bites on a weekly bisphosphonate dose", () => {
    const got = intervalHazard("QWK", "150 mg", "ibandronate", "tablet");
    expect(got).not.toBeNull();
    expect(got!.rule.minIntervalDays).toBe(30);
  });

  test("an IU mandate is reachable although IU is not mass", () => {
    // The 60,000 IU sachet is labeled once weekly. Keyed on mg alone, the table
    // could never see it, because an IU strength has no mg equivalent.
    expect(intervalMandateFor("cholecalciferol", "capsule", null, 60000)).not.toBeNull();
    expect(intervalMandateFor("cholecalciferol", "sachet", null, 60000)).not.toBeNull();
    expect(intervalMandateFor("cholecalciferol", "drops", null, 2000)).toBeNull();
    // A mass rule must not fire on an IU dose, and vice versa.
    expect(intervalMandateFor("alendronate", "tablet", null, 60000)).toBeNull();
    expect(intervalMandateFor("cholecalciferol", "capsule", 60000)).toBeNull();
  });

  test("a daily 60,000 IU course is a hazard and a weekly one is not", () => {
    expect(intervalHazard("1-0-0", "60000 iu", "cholecalciferol", "capsule")).not.toBeNull();
    expect(intervalHazard("ONCE WEEKLY", "60000 iu", "cholecalciferol", "capsule")).toBeNull();
    expect(intervalHazard("1-0-0", "2000 iu", "cholecalciferol", "drops")).toBeNull();
  });
});

describe("strength reading laws", () => {
  test("mcg converts and IU stays out of mass arithmetic", () => {
    expect(parseStrength("50 mcg")!.mg).toBeCloseTo(0.05, 6);
    expect(parseStrength("60000 IU")!.mg).toBeNull();
    expect(parseStrength("1 g")!.mg).toBe(1000);
  });

  test("a brand label states the strength the line omitted", () => {
    expect(brandLabelStrength("Folitrax 10")).toBe("10 mg");
    expect(brandLabelStrength("Thyronorm 50", "levothyroxine")).toBe("50 mcg");
    expect(brandLabelStrength("Dolo 650")).toBe("650 mg");
  });

  test("a bare number in the vitamin-D class is IU, never mg", () => {
    // "Calcirol 60K" is a 60 000 IU sachet. Inheriting the mg default asserted a
    // 60 000 mg cholecalciferol dose against a formulary entry that does not
    // exist in those units, and queued a routine weekly supplement.
    expect(brandLabelStrength("Calcirol 60K", "cholecalciferol")).toBe("60000 iu");
    expect(brandLabelStrength("D-Rise 60K", "cholecalciferol")).toBe("60000 iu");
    // IU is not mg-convertible: the cap rule abstains instead of inventing.
    expect(parseStrength("60000 iu")!.mg).toBeNull();
  });

  test("a letter-glued digit is a name, not a strength", () => {
    // "Uprise-D3" is cholecalciferol named after the vitamin, not a 3 mg dose.
    expect(brandStrength("Uprise-D3")).toBeNull();
    expect(brandLabelStrength("Uprise-D3", "cholecalciferol")).toBeNull();
    // separated numerals are still strengths
    expect(brandStrength("Uprise D3 2000 IU")).toEqual([2000, "iu"]);
  });

  test("a combination label states one strength per component", () => {
    // Reading only the trailing half made a correct 100 mg levodopa line look
    // tenfold wrong. No scalar stands for "100/10", so brandStrength abstains
    // and brandStrengths carries both.
    expect(brandStrength("Levodopa+carbidopa 100/10")).toBeNull();
    expect(brandStrengths("Levodopa+carbidopa 100/10")).toEqual([
      [100, ""],
      [10, ""],
    ]);
    expect(brandLabelStrength("Levodopa+carbidopa 100/10", "levodopa+carbidopa")).toBeNull();
  });

  test("look-alike different strength is the uncertainty, and it queues", () => {
    expect(strengthMismatch("500 mcg", "Thyronorm 50")).not.toBeNull();
    expect(strengthMismatch("50 mcg", "Thyronorm 50")).toBeNull();
    expect(strengthMismatch("650 mg", "Dolo 650")).toBeNull();
  });

  test("a ratio label matches either component and rejects neither", () => {
    expect(strengthMismatch("100 mg", "Levodopa+carbidopa 100/10")).toBeNull();
    expect(strengthMismatch("10 mg", "Levodopa+carbidopa 100/10")).toBeNull();
    const m = strengthMismatch("875 mg", "Amoxicillin+clavulanic acid 500/125");
    expect(m).not.toBeNull();
    expect(m).toContain("is 500/125");
  });
});

describe("the closed unit lists against the whole catalog", () => {
  // The mcg/IU defaults are the one place the engine asserts a unit the label
  // never printed. They are only defensible while the catalog agrees with them,
  // so the agreement is measured over every row rather than assumed.
  const MCG = new Set(["levothyroxine", "desmopressin", "calcitriol", "thyroxine sodium"]);
  const IU = new Set(["cholecalciferol", "colecalciferol", "ergocalciferol", "calcifediol"]);

  test("no brand row's default unit contradicts its molecule", () => {
    // The closed lists govern *bare* numbers only. A label that prints its own
    // unit wins: "Jan Aushadhi Desmopressin Tablets 0.1 mg" is correct as mg.
    const offenders: string[] = [];
    for (const row of BRANDS) {
      const bs = brandStrength(row.brand);
      if (!bs) continue;
      const [value, unit] = bs;
      if (unit) continue;
      const label = brandLabelStrength(row.brand, row.molecule) ?? "";
      const mol = row.molecule.toLowerCase();
      const got = label.split(" ")[1];
      const want = IU.has(mol) ? "iu" : MCG.has(mol) ? "mcg" : "mg";
      if (got !== want) offenders.push(`${row.brand} -> ${value} ${got}, want ${want}`);
    }
    expect(offenders).toEqual([]);
  });

  test("every strength the catalog states is positive and finite", () => {
    for (const row of BRANDS) {
      for (const [value, unit] of brandStrengths(row.brand)) {
        expect(Number.isFinite(value) && value > 0).toBe(true);
        expect(["", "mg", "mcg", "g", "iu"].includes(unit)).toBe(true);
      }
    }
  });

  test("ratio-labelled combination brands are counted, not assumed", () => {
    const ratio = BRANDS.filter((r) => brandStrengths(r.brand).length > 1);
    expect(ratio.length).toBeGreaterThan(0);
    // none of them may collapse to a single scalar strength
    for (const row of ratio) expect(brandStrength(row.brand)).toBeNull();
  });
});

describe("the plane's routing: a queued interval is never a pass", () => {
  test("confidently-read daily methotrexate queues rather than passing", () => {
    // 0.97 reading confidence, a real formulary brand, no interaction partner.
    // Confidence-based routing cannot see this line at all; only the interval
    // rule can, and it must block.
    const r = plane(["Tab Folitrax 10 - 10 mg - OD - 28 days"]);
    expect(r.doseHazards.length).toBe(1);
    expect(r.doseHazards[0].required).toBe("no more often than every 7 days");
    expect(r.confirmQueue.some((c) => c.reason === "Never-event dosing interval")).toBe(true);
    expect(r.confirmQueue.every((c) => c.band !== undefined)).toBe(true);
    expect(r.verdict).toBe("confirm_queue");
  });

  test("the same course written weekly passes", () => {
    const r = plane(["Tab Folitrax 10 - 10 mg - QWK - 28 days"]);
    expect(r.doseHazards).toEqual([]);
    expect(r.confirmQueue).toEqual([]);
    expect(r.verdict).toBe("pass");
  });

  test("the queue outranks a real interaction on the same prescription", () => {
    // Methotrexate QID + aspirin: the interaction is genuine and is still
    // reported, but the verdict is confirm_queue — the only verdict that blocks
    // plan creation, because a finding computed on an unconfirmed schedule is not
    // the last word. Mirrors apps/api/app/verdict.py order.
    const r = plane([
      "Tab Folitrax 10 - 10 mg - QID - 28 days",
      "Tab Ecosprin 75 - 75 mg - 1-0-1 - 28 days",
    ]);
    expect(r.findings.some((f) => f.kind === "interaction")).toBe(true);
    expect(r.doseHazards.length).toBe(1);
    expect(r.verdict).toBe("confirm_queue");
  });

  test("weekly methotrexate plus aspirin is an interaction, not a queue", () => {
    const r = plane([
      "Tab Folitrax 10 - 10 mg - QWK - 28 days",
      "Tab Ecosprin 75 - 75 mg - 1-0-1 - 28 days",
    ]);
    expect(r.doseHazards).toEqual([]);
    expect(r.confirmQueue).toEqual([]);
    expect(r.findings.some((f) => f.kind === "interaction")).toBe(true);
    expect(r.verdict).toBe("interaction");
  });

  test("a mis-read tenfold strength queues ahead of the dose-cap finding", () => {
    // "Thyronorm 500 mcg" resolves to the formulary brand Thyronorm 50. The
    // identity is unresolved, so the aggregate-cap finding cannot be the verdict.
    const r = plane(["Tab Thyronorm 500 mcg OD 30 days"]);
    expect(r.verdict).toBe("confirm_queue");
    expect(r.confirmQueue.some((c) => c.reason === "Strength does not match the formulary entry")).toBe(true);
    // The 0.5 mg/day read does breach the 0.3 mg/day levothyroxine ceiling, and
    // since v6 that breach is a hazard plus a queue item — but the line is
    // already queued for its identity, so the cap rule must not spend the one
    // human look it gets on a second reason. One item, and it asks the real
    // question.
    expect(r.findings.some((f) => f.kind === "dose")).toBe(false);
    expect(r.confirmQueue.length).toBe(1);
    expect(r.doseHazards[0].observed).toBe("0.5 mg/day");
  });

  test("a stated-but-unreadable frequency queues instead of scheduling", () => {
    // The rule needs a code the *line parser* offers and the *interval law*
    // refuses: "Q5H" is five hours apart, which no generator can lay out over a
    // day (24 % 5 != 0), and "every 999 days" is outside any course. Both are
    // stated, neither is legible, so the line queues with its band set rather
    // than falling back to the old ["09:00"] default.
    for (const line of ["Tab Dolo 650 Q5H x 5 days", "Tab Dolo 650 every 999 days x 5 days"]) {
      const r = plane([line]);
      expect(r.verdict).toBe("confirm_queue");
      const item = r.confirmQueue.find((c) => c.reason === "Dosing frequency is not a recognized code");
      expect(item).toBeDefined();
      expect(item!.band).toBe("confirm");
      expect(r.confirmed[0].frequencyParsed).toBeNull();
    }
  });
});
