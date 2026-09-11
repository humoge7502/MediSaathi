/**
 * Gate-law + fusion tests (MED-003), TypeScript side.
 *
 * These mirror `apps/api/tests/test_gate.py`. The two suites pin the SAME
 * boundaries so a divergence in the law shows up as a test failure in one tier
 * even before the cross-engine parity corpus runs.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_THRESHOLD_SET_ID,
  FUSION_WEIGHTS,
  THRESHOLD_SETS,
  allBelowRefusal,
  bandOf,
  fuseField,
  fusePrescription,
  getThresholdSet,
} from "@/lib/safety/gate";
import { runSafetyPlane, overallConfidence } from "@/lib/safety/engine";

describe("fusion", () => {
  test("weights are the documented 0.4 / 0.6 pair summing to 1", () => {
    expect(FUSION_WEIGHTS).toEqual({ formulary: 0.4, reading: 0.6 });
  });

  test("an unresolvable read can never exceed the reading weight", () => {
    expect(fuseField(1, false)).toBe(0.6);
    expect(fuseField(0, false)).toBe(0);
    expect(fuseField(1, true)).toBe(1);
    expect(fuseField(2, true)).toBe(1); // clamped
  });

  test("prescription-level boundaries", () => {
    expect(fusePrescription(0, 0, [])).toBe(0);
    expect(fusePrescription(2, 0, [1, 1])).toBe(1);
    expect(fusePrescription(0, 2, [1, 1])).toBe(0.6);
    expect(fusePrescription(2, 0, [0.5, 0.5])).toBe(0.7);
  });

  test("overallConfidence is the same function (kept for compatibility)", () => {
    expect(overallConfidence(1, 1, [1, 1])).toBe(fusePrescription(1, 1, [1, 1]));
  });
});

describe("threshold sets", () => {
  test("the frozen default reproduces the audited operating point", () => {
    const ts = getThresholdSet();
    expect(ts.setId).toBe(DEFAULT_THRESHOLD_SET_ID);
    expect(ts.refuseBelow).toBe(0.75);
    expect(ts.confirmBelow).toBe(0.9);
    expect(ts.banding).toBe("reading");
    expect(Object.keys(THRESHOLD_SETS)).toContain("fused-2026-09");
  });

  test("an unknown set fails loudly instead of guessing", () => {
    expect(() => getThresholdSet("nope")).toThrow(/unknown threshold set/);
  });
});

describe("band law", () => {
  test("boundaries are inclusive at auto, exclusive at refuse", () => {
    expect(bandOf(0.7499, true).band).toBe("refused");
    expect(bandOf(0.75, true).band).toBe("confirm");
    expect(bandOf(0.8999, true).band).toBe("confirm");
    expect(bandOf(0.9, true).band).toBe("auto");
    expect(bandOf(1, true).band).toBe("auto");
  });

  test("unresolvable never auto-confirms, even at full confidence", () => {
    const d = bandOf(1, false);
    expect(d.band).toBe("confirm");
    expect(d.fused).toBe(0.6);
    expect(d.reason).toContain("not in formulary");
  });

  test("the refusal band consumes perception confidence only", () => {
    expect(bandOf(0.4, true).band).toBe("refused");
    expect(bandOf(0.4, false).band).toBe("refused");
  });

  test("the alternative fused banding can only demote", () => {
    const ts = getThresholdSet("fused-2026-09");
    // fused = 0.4 + 0.6*0.8 = 0.88 < 0.90 -> confirm (demoted, not promoted)
    expect(bandOf(0.8, true, ts).band).toBe("confirm");
    // a strong read stays auto under both sets
    expect(bandOf(0.97, true, ts).band).toBe("auto");
  });

  test("allBelowRefusal needs a non-empty, fully-refused set", () => {
    expect(allBelowRefusal([bandOf(0.4, true), bandOf(0.5, false)])).toBe(true);
    expect(allBelowRefusal([bandOf(0.4, true), bandOf(0.97, true)])).toBe(false);
    expect(allBelowRefusal([])).toBe(false);
  });
});

describe("engine plumbing", () => {
  test("a clean prescription carries gate provenance and threshold-set id", () => {
    const report = runSafetyPlane({
      rawLines: ["Dolo 650 mg TDS 5 days", "Pan 40 mg OD 10 days"],
      contexts: [],
      lineConfidence: [0.97, 0.97],
    });
    expect(report.gate).toBeDefined();
    expect(report.gate!.thresholdSetId).toBe(DEFAULT_THRESHOLD_SET_ID);
    expect(report.gate!.prescriptionBand).toBe("auto");
    expect(report.gate!.prescriptionFused).toBe(0.98);
    expect(report.gate!.decisions.length).toBe(2);
  });

  test("an invented brand queues with a why-queued explanation and fused score", () => {
    const report = runSafetyPlane({
      rawLines: ["Zzqxwv 999 mg OD 3 days"],
      contexts: [],
      lineConfidence: [0.97],
    });
    expect(report.verdict).toBe("confirm_queue");
    expect(report.confirmQueue.length).toBe(1);
    expect(report.confirmQueue[0].band).toBe("confirm");
    expect(report.confirmQueue[0].fused).toBeCloseTo(0.582, 3);
    expect(report.confirmQueue[0].why).toContain("not in formulary");
  });

  test("all lines below the refusal band refuses before any rule evaluation", () => {
    const report = runSafetyPlane({
      rawLines: ["Warf 5 mg OD 30 days"],
      contexts: [],
      lineConfidence: [0.4],
    });
    expect(report.verdict).toBe("refused");
    expect(report.gate!.prescriptionBand).toBe("refused");
  });
});
