/**
 * The daily-dose-cap law, TypeScript side — mirror of apps/api/tests/test_dose_caps.py.
 *
 * The parity corpus (eval/parity/golden.json, v8) pins that the two planes reach
 * the same verdict on the same read; this file pins the numbers and the shape of
 * the reasoning, including the two things a verdict cannot express:
 * - a label that prints two figures has to be executed with both. Blocking
 *   ibuprofen at 2400 while saying nothing at 1600 lost the 1200 self-care
 *   number entirely;
 * - a ceiling the patient lowers is not a ceiling the engine guessed. 4600
 *   mg/day of paracetamol across two brands is advisory in a healthy adult and
 *   a blocked regimen in a patient who declared severe liver disease.
 *
 * It also pins the generated table against drift: `dose-caps.generated.ts` is
 * built from data/reference/dose_caps.csv by tools/build_dose_caps.py, and a
 * hand-edit here would resurrect the exact bug class that made theophylline 450
 * verdict a routine 800 mg/day course as a fatal overdose.
 */
import { describe, expect, test } from "bun:test";
import { CONTEXT_CODES } from "@/lib/safety/dataset";
import {
  ADVISORY_MG,
  CAP_BASIS,
  CAP_LOWERED_BY,
  DAILY_CAPS_MG,
  DOSE_CAPS_TABLE_HASH,
  HARD_CAP_MG,
} from "@/lib/safety/dose-caps.generated";
import { CAP_SOURCE, capCheck, effectiveCap, runSafetyPlane } from "@/lib/safety/engine";

const DOLOROUS = ["Tab Dolo 650 650 mg QID x 3 days",
  "Tab Crocin Advance 500 mg QID x 3 days"];

function plane(lines: string[], contexts: string[] = []) {
  return runSafetyPlane({
    rawLines: lines,
    contexts,
    lineConfidence: lines.map(() => 0.97),
  });
}

function haystack(report: ReturnType<typeof plane>): string {
  return [
    ...report.findings.map((f) => ("note" in f ? f.note : "") + ("mechanism" in f ? ` ${f.mechanism}` : "")),
    ...report.doseHazards.map((h) => `${h.note} ${h.required}`),
    ...report.confirmQueue.map((c) => `${c.reason} ${c.why ?? ""}`),
  ].join(" | ").toLowerCase();
}

describe("one table of record, both tiers", () => {
  test("the generated copy is what the build produces", () => {
    // Python's drift test asserts the same 16 hex characters against
    // app.safety.dosing.CAP_TABLE_HASH; edit the CSV and rebuild, never this.
    expect(DOSE_CAPS_TABLE_HASH).toMatch(/^[0-9a-f]{16}$/);
    // 305, not 306: "lithium" and "lithium carbonate" each carried a 2400 mg row.
    expect(Object.keys(DAILY_CAPS_MG).length).toBe(305);
    expect(new Set(Object.keys(CAP_BASIS))).toEqual(new Set(Object.keys(DAILY_CAPS_MG)));
  });

  test("one identity per drug: the salt spellings are retired from the table", () => {
    expect(DAILY_CAPS_MG["ferrous sulfate"]).toBe(325);
    expect(DAILY_CAPS_MG["lithium"]).toBe(2400);
    // Each of these was a separate identity with its own ceiling, which is how a
    // brand printed as "ferrous sulfate" reached no iron cap at all.
    expect(DAILY_CAPS_MG["ferrous sulphate"]).toBeUndefined();
    expect(DAILY_CAPS_MG["lithium carbonate"]).toBeUndefined();
    expect(DAILY_CAPS_MG["vitamin d3"]).toBeUndefined();
  });

  test("the 17 adjudicated conflicts hold their decided values", () => {
    expect(DAILY_CAPS_MG.theophylline).toBe(900);   // was 450: level-guided
    expect(DAILY_CAPS_MG.ondansetron).toBe(24);     // was 32: a withdrawn IV figure
    expect(DAILY_CAPS_MG.ibuprofen).toBe(2400);     // was 1200: the OTC cap
    expect(DAILY_CAPS_MG.cetirizine).toBe(10);      // curated said 20
    expect(DAILY_CAPS_MG.levocetirizine).toBe(5);   // curated said 10
  });

  test.each([
    "warfarin", "digoxin", "theophylline", "lithium", "valproate",
    "clopidogrel", "isotretinoin", "ivermectin", "prednisolone", "torasemide",
  ])("%s is dosed to a value the engine does not have, so it may not block", (mol) => {
    // A molecule missing from the table also "never blocks", which is how this
    // test kept passing for an identity that had just stopped existing.
    expect(Object.keys(DAILY_CAPS_MG)).toContain(mol);
    expect(HARD_CAP_MG.has(mol)).toBe(false);
  });
});

describe("the two figures a label prints", () => {
  test("a self-care breach advises, a prescription breach is a breach", () => {
    expect(capCheck("ibuprofen", 1200, [])).toEqual({ outcome: "clean", limit: 0, lowering: null });
    expect(capCheck("ibuprofen", 1600, [])).toEqual({ outcome: "advise", limit: 1200, lowering: null });
    expect(capCheck("ibuprofen", 2600, [])).toEqual({ outcome: "breach", limit: 2400, lowering: null });
    expect(ADVISORY_MG.naproxen).toBe(660);
    expect(ADVISORY_MG.loperamide).toBe(8);
  });

  test("1600 mg/day of ibuprofen is said out loud and changes no verdict", () => {
    const report = plane(["Tab Brufen 400 400 mg QID x 3 days"]);
    expect(report.verdict).toBe("pass");
    expect(report.doseHazards.length).toBe(0);
    expect(haystack(report)).toContain("is above the 1200 mg/day ibuprofen self-care limit");
  });

  test("exactly at a figure is not over it", () => {
    expect(capCheck("loperamide", 8, [])).toEqual({ outcome: "clean", limit: 0, lowering: null });
    expect(capCheck("loperamide", 10, [])).toEqual({ outcome: "advise", limit: 8, lowering: null });
  });
});

describe("the ceiling the patient lowers", () => {
  test("effectiveCap takes the declared condition into account", () => {
    expect(effectiveCap("paracetamol", [])).toEqual({ limit: 4000, lowering: null });
    expect(effectiveCap("paracetamol", ["hepatic_severe"])).toEqual({
      limit: 2000, lowering: "hepatic_severe",
    });
    expect(effectiveCap("cetirizine", ["hepatic_severe"])).toEqual({ limit: 10, lowering: null });
  });

  test("a lowered ceiling is the number the block measures, at 1.5x of the lowered figure", () => {
    expect(capCheck("tramadol", 320, [])).toEqual({ outcome: "clean", limit: 0, lowering: null });
    expect(capCheck("tramadol", 320, ["age_over_65"])).toEqual({
      outcome: "breach", limit: 300, lowering: "age_over_65",
    });
  });

  test("4600 mg/day of paracetamol: advisory alone, blocked under liver disease", () => {
    const plain = plane(DOLOROUS);
    expect(plain.doseHazards.length).toBe(0);
    expect(haystack(plain)).toContain("exceeds the 4000 mg/day paracetamol cap");

    const liver = plane(DOLOROUS, ["hepatic_severe"]);
    expect(liver.verdict).toBe("confirm_queue");
    expect(liver.doseHazards[0].required).toBe("no more than 2000 mg/day");
    expect(liver.doseHazards[0].source).toBe(CAP_SOURCE);
    expect(liver.doseHazards[0].note).toContain("lower it from 4000 mg/day");
    expect(liver.confirmQueue.length).toBe(2);
  });

  test("lowering a ceiling does not lower the escalation line", () => {
    const report = plane(["Tab Dolo 650 650 mg QID x 3 days"], ["hepatic_severe"]);
    expect(report.doseHazards.length).toBe(0);
    expect(report.confirmQueue.map((c) => c.reason)).not.toContain(
      "Daily dose exceeds the label maximum");
    expect(haystack(report)).toContain("aggregate 2600 mg/day exceeds the 2000 mg/day");
  });

  test("citalopram 60 mg/day: boundary case with nothing declared, block over 65", () => {
    expect(plane(["Tab Citalopram 20 20 mg TID x 14 days"]).verdict).toBe("pass");
    const elderly = plane(["Tab Citalopram 20 20 mg TID x 14 days"], ["age_over_65"]);
    expect(elderly.verdict).toBe("confirm_queue");
    expect(elderly.doseHazards[0].required).toBe("no more than 20 mg/day");
  });

  test("every lowered ceiling names a context the product can actually declare", () => {
    // CONTEXT_CODES is the vocabulary the UI collects. A `lowered_by` code
    // outside it is dead data in a clinical table — the same class of bug that
    // let a withdrawn IV ondansetron figure screen oral tablets for a year.
    const declarable = new Set(CONTEXT_CODES.map((c) => c.code));
    for (const [mol, byContext] of Object.entries(CAP_LOWERED_BY)) {
      for (const code of Object.keys(byContext)) {
        expect(declarable.has(code), `${mol} is lowered by ${code}, which is not declarable`).toBe(true);
        expect(byContext[code] < DAILY_CAPS_MG[mol], `${mol}: ${code} must be lower`).toBe(true);
      }
    }
    expect(Object.keys(CAP_LOWERED_BY).length).toBeGreaterThanOrEqual(4);
  });
});
