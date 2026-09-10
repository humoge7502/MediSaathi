/**
 * Engine self-test suite — the "Evidence" tab benchmark.
 *
 * Deterministic: no LLM, no network. Each case feeds prescription lines +
 * context into the safety plane and compares the verdict against an
 * expert-labeled expectation. This is the counterfactual the A1 ablation
 * in MediSaathi proved matters: the rules, not the reading, carry safety.
 */

import { runSafetyPlane, type VerdictKind } from "./engine";

export interface EngineTestCase {
  id: string;
  label: string;
  lines: string[];
  contexts: string[];
  expect: VerdictKind;
  expectFinding?: string; // substring to find in mechanism/note
}

export const ENGINE_TEST_CASES: EngineTestCase[] = [
  {
    id: "T01",
    label: "Clean hypertension + T2DM plan",
    lines: ["Telma 40 mg OD 30 days", "Glycomet 500 mg BD 30 days"],
    contexts: [],
    expect: "pass",
  },
  {
    id: "T02",
    label: "Warfarin + aspirin (severe)",
    lines: ["Warf 5 mg OD 30 days", "Ecosprin 75 mg OD 30 days"],
    contexts: [],
    expect: "interaction",
    expectFinding: "bleeding",
  },
  {
    id: "T03",
    label: "Duplicate paracetamol brands (double dose)",
    lines: ["Dolo 650 mg TDS 5 days", "Crocin Advance 650 mg TDS 5 days"],
    contexts: [],
    expect: "duplicate",
    expectFinding: "double-dosing",
  },
  {
    id: "T04",
    label: "Clopidogrel + omeprazole (moderate)",
    lines: ["Clopilet 75 mg OD 30 days", "Omez 20 mg OD 30 days"],
    contexts: [],
    expect: "interaction",
    expectFinding: "CYP2C19",
  },
  {
    id: "T05",
    label: "Doxycycline for a child (contraindication)",
    lines: ["Doxy-1 100 mg BD 5 days"],
    contexts: ["age_under_12"],
    expect: "contraindication",
    expectFinding: "Dental staining",
  },
  {
    id: "T06",
    label: "ACEi + spironolactone (hyperkalemia)",
    lines: ["Envas 5 mg BD 30 days", "Aldactone 25 mg OD 30 days"],
    contexts: [],
    expect: "interaction",
    expectFinding: "hyperkalemia",
  },
  {
    id: "T07",
    label: "Triple whammy (ARB + diuretic + NSAID)",
    lines: ["Losar 50 mg OD 30 days", "Lasix 40 mg OD 30 days", "Brufen 400 mg TDS 5 days"],
    contexts: [],
    expect: "interaction",
    expectFinding: "triple whammy",
  },
  {
    id: "T08",
    label: "QT stack (fluoroquinolone + macrolide + ondansetron)",
    lines: ["Ciplox 500 mg BD 7 days", "Azithral 500 mg OD 3 days", "Zofran ODT 4 mg TDS 3 days"],
    contexts: [],
    expect: "interaction",
    expectFinding: "QT",
  },
  {
    id: "T09",
    label: "Metformin in severe renal disease",
    lines: ["Glycomet 500 mg TDS 30 days"],
    contexts: ["renal_severe"],
    expect: "contraindication",
    expectFinding: "Lactic acidosis",
  },
  {
    id: "T10",
    label: "Simvastatin + clarithromycin (rhabdo risk)",
    lines: ["Simvotin 20 mg HS 30 days", "Claribid 500 mg BD 7 days"],
    contexts: [],
    expect: "interaction",
    expectFinding: "rhabdomyolysis",
  },
  {
    id: "T11",
    label: "SSRI + triptan (serotonin syndrome)",
    lines: ["Sertraline 50 mg OD 30 days", "Suminat 50 mg SOS 5 days"],
    contexts: [],
    expect: "interaction",
    expectFinding: "Serotonin",
  },
  {
    id: "T12",
    label: "Nitrate + PDE5 inhibitor (contraindicated combo)",
    lines: ["Sorbitrate 5 mg TDS 30 days", "Manforce 50 mg SOS 2 days"],
    contexts: [],
    expect: "interaction",
    expectFinding: "hypotension",
  },
  {
    id: "T13",
    label: "Aggregate paracetamol cap breach via combination brands",
    lines: ["Dolo 650 mg TDS 3 days", "Zerodol P 650 mg TDS 3 days"],
    contexts: [],
    expect: "duplicate",
    expectFinding: "paracetamol",
  },
  {
    id: "T14",
    label: "Levothyroxine + calcium (absorption)",
    lines: ["Thyronorm 50 mcg OD 30 days", "Shellcal 500 mg BD 30 days"],
    contexts: [],
    expect: "interaction",
    expectFinding: "absorption",
  },
  {
    id: "T15",
    label: "Ibuprofen in aspirin-sensitive asthma",
    lines: ["Brufen 400 mg TDS 5 days"],
    contexts: ["asthma_aspirin_sensitive"],
    expect: "contraindication",
    expectFinding: "NSAID-exacerbated",
  },
  {
    id: "T16",
    label: "Unparseable input refuses",
    lines: ["asdkjh 123 asd"],
    contexts: [],
    expect: "confirm_queue",
  },
  {
    id: "T17",
    label: "Warfarin in pregnancy",
    lines: ["Warf 5 mg OD 30 days"],
    contexts: ["pregnancy"],
    expect: "contraindication",
    expectFinding: "Teratogenic",
  },
  {
    id: "T18",
    label: "Bleeding stack (anticoagulant + SSRI + NSAID)",
    lines: ["Warf 5 mg OD 30 days", "Sertraline 50 mg OD 30 days", "Brufen 400 mg TDS 5 days"],
    contexts: [],
    expect: "interaction",
    expectFinding: "bleeding",
  },
];

export interface EngineTestResult {
  id: string;
  label: string;
  expected: VerdictKind;
  actual: VerdictKind;
  pass: boolean;
  findingHit: boolean;
  engineMs: number;
}

export function runEngineSuite(): { results: EngineTestResult[]; passRate: number; totalMs: number } {
  const results: EngineTestResult[] = [];
  let t0 = performance.now();
  for (const tc of ENGINE_TEST_CASES) {
    const tcT0 = performance.now();
    const report = runSafetyPlane({ rawLines: tc.lines, contexts: tc.contexts, skipGate: true });
    const allText = report.findings.map((f) =>
      ["mechanism" in f ? f.mechanism : "", "note" in f ? f.note : "", "molecule" in f ? f.molecule : "", "molecules" in f ? f.molecules.join(" ") : "", "brands" in f ? f.brands.join(" ") : ""].join(" ")
    ).join(" ").toLowerCase();
    const findingHit = !tc.expectFinding || allText.includes(tc.expectFinding.toLowerCase());
    results.push({
      id: tc.id,
      label: tc.label,
      expected: tc.expect,
      actual: report.verdict,
      pass: report.verdict === tc.expect && findingHit,
      findingHit,
      engineMs: Math.round((performance.now() - tcT0) * 100) / 100,
    });
  }
  const totalMs = Math.round((performance.now() - t0) * 100) / 100;
  t0 = 0; // silence unused warnings in strict builds
  void t0;
  const passRate = results.filter((r) => r.pass).length / results.length;
  return { results, passRate, totalMs };
}
