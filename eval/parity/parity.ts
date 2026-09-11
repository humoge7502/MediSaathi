/**
 * Cross-engine parity runner — TypeScript side (ADR-0012, audit finding TD-D).
 *
 * Runs the SAME 25-case golden corpus as eval/parity/parity.py through the
 * TypeScript safety plane and prints per-case agreement. CI runs both sides:
 *   - Python: pytest apps/api/tests/test_parity.py  (via make test)
 *   - TS:     bun run parity  (via make web-check)
 * Any disagreement blocks the merge, so the two planes cannot drift again.
 *
 * The corpus is intentionally DUPLICATED in code (not imported across
 * languages): the whole point of the two-plane law is independent evidence,
 * and a shared file would be a third language coupling. CI enforces that both
 * copies agree with their engines; a corpus edit must land in both.
 */
import { runSafetyPlane, type VerdictKind } from "../../apps/web/src/lib/safety/engine";

interface ParityCase {
  id: string;
  lines: string[];
  confidences: number[];
  contexts: string[];
  expect: "pass" | "interaction" | "contraindication" | "duplicate" | "confirm_queue" | "refused";
  expectFinding?: string;
}

/**
 * TS-side verdict vocabulary: the TS plane distinguishes "combination" and
 * "duplicate" kinds; the parity vocabulary folds them into "interaction" and
 * "duplicate" respectively (Python's VerdictKind uses duplicate_atc — the
 * python runner maps that side). Severity travels in the findings.
 */
function mapVerdict(v: VerdictKind): ParityCase["expect"] {
  switch (v) {
    case "pass": return "pass";
    case "interaction":
    case "combination": return "interaction";
    case "contraindication": return "contraindication";
    case "duplicate": return "duplicate";
    case "confirm_queue": return "confirm_queue";
    case "refused": return "refused";
  }
}

export const PARITY_CASES: ParityCase[] = [
  // ---- clean plans: the plane must NOT cry wolf -------------------------
  { id: "P01", lines: ["Telma 40 mg OD 30 days", "Glycomet 500 mg BD 30 days"], confidences: [0.97, 0.97], contexts: [], expect: "pass" },
  { id: "P02", lines: ["Glycomet 500 mg TDS 30 days", "Amlong 5 mg OD 30 days", "Storvas 20 mg HS 30 days"], confidences: [0.97, 0.97, 0.97], contexts: [], expect: "pass" },
  { id: "P03", lines: ["Pan 40 mg OD 15 days"], confidences: [0.97], contexts: [], expect: "pass" },
  { id: "P04", lines: ["Azithral 500 mg OD 3 days", "Omez 20 mg OD 5 days"], confidences: [0.97, 0.97], contexts: [], expect: "pass" },
  { id: "P05", lines: ["Thyronorm 50 mcg OD 30 days"], confidences: [0.97], contexts: [], expect: "pass" },
  // ---- severe pairwise interactions -------------------------------------
  { id: "P06", lines: ["Warf 5 mg OD 30 days", "Ecosprin 75 mg OD 30 days"], confidences: [0.97, 0.97], contexts: [], expect: "interaction", expectFinding: "bleeding" },
  { id: "P07", lines: ["Digoxin 0.25 mg OD 30 days", "Cordarone 200 mg OD 30 days"], confidences: [0.97, 0.97], contexts: [], expect: "interaction", expectFinding: "digoxin" },
  { id: "P08", lines: ["Simvotin 20 mg HS 30 days", "Claribid 500 mg BD 7 days"], confidences: [0.97, 0.97], contexts: [], expect: "interaction", expectFinding: "statin" },
  { id: "P09", lines: ["Lithosun 300 mg BD 30 days", "Brufen 400 mg TDS 5 days"], confidences: [0.97, 0.97], contexts: [], expect: "interaction", expectFinding: "lithium" },
  { id: "P10", lines: ["Manforce 50 mg SOS 2 days", "Sorbitrate 5 mg TDS 30 days"], confidences: [0.97, 0.97], contexts: [], expect: "interaction", expectFinding: "hypotension" },
  // ---- contraindications against declared contexts ----------------------
  { id: "P11", lines: ["Doxy-1 100 mg BD 5 days"], confidences: [0.97], contexts: ["age_under_12"], expect: "contraindication", expectFinding: "staining" },
  { id: "P12", lines: ["Warf 5 mg OD 30 days"], confidences: [0.97], contexts: ["pregnancy"], expect: "contraindication", expectFinding: "teratogenic" },
  { id: "P13", lines: ["Glycomet 500 mg TDS 30 days"], confidences: [0.97], contexts: ["renal_severe"], expect: "contraindication", expectFinding: "lactic" },
  // ---- duplicates -------------------------------------------------------
  { id: "P14", lines: ["Dolo 650 mg TDS 5 days", "Crocin Advance 650 mg TDS 5 days"], confidences: [0.97, 0.97], contexts: [], expect: "duplicate" },
  { id: "P15", lines: ["Dolo 650 mg TDS 5 days", "Calpol 650 mg TDS 5 days"], confidences: [0.97, 0.97], contexts: [], expect: "duplicate" },
  // ---- combination (graph) rules ----------------------------------------
  { id: "P16", lines: ["Losar 50 mg OD 30 days", "Lasix 40 mg OD 30 days", "Brufen 400 mg TDS 5 days"], confidences: [0.97, 0.97, 0.97], contexts: [], expect: "interaction", expectFinding: "whammy" },
  { id: "P17", lines: ["Ciplox 500 mg BD 7 days", "Azithral 500 mg OD 3 days", "Zofran ODT 4 mg TDS 3 days"], confidences: [0.97, 0.97, 0.97], contexts: [], expect: "interaction", expectFinding: "QT" },
  // ---- confirm queue: unknown brand / low confidence ---------------------
  { id: "P18", lines: ["asdkjh 123 asd"], confidences: [0.97], contexts: [], expect: "confirm_queue" },
  { id: "P19", lines: ["Warf 5 mg OD 30 days", "Xenomol 500 mg BD 5 days"], confidences: [0.97, 0.97], contexts: [], expect: "confirm_queue" },
  { id: "P20", lines: ["Warf 5 mg OD 30 days"], confidences: [0.4], contexts: [], expect: "refused" },
  // ---- moderate interactions + ATC-level duplicates + bleeding stack -----
  { id: "P21", lines: ["Clopilet 75 mg OD 30 days", "Omez 20 mg OD 30 days"], confidences: [0.97, 0.97], contexts: [], expect: "interaction", expectFinding: "CYP2C19" },
  { id: "P22", lines: ["Envas 5 mg BD 30 days", "Aldactone 25 mg OD 30 days"], confidences: [0.97, 0.97], contexts: [], expect: "interaction", expectFinding: "hyperkalemia" },
  { id: "P23", lines: ["Warf 5 mg OD 30 days", "Sertraline 50 mg OD 30 days", "Brufen 400 mg TDS 5 days"], confidences: [0.97, 0.97, 0.97], contexts: [], expect: "interaction", expectFinding: "bleeding" },
  { id: "P24", lines: ["Dolo 650 mg TDS 5 days", "Zerodol P 650 mg TDS 5 days"], confidences: [0.97, 0.97], contexts: [], expect: "duplicate" },
  { id: "P25", lines: ["Warf 5 mg OD 30 days", "Warfone 5 mg OD 30 days"], confidences: [0.97, 0.97], contexts: [], expect: "duplicate" },
];

export interface ParityRow {
  id: string;
  expect: ParityCase["expect"];
  actual: ParityCase["expect"];
  findingHit: boolean;
  ok: boolean;
}

export function runParityTs(): { rows: ParityRow[]; passRate: number } {
  const rows: ParityRow[] = [];
  for (const c of PARITY_CASES) {
    const report = runSafetyPlane({ rawLines: c.lines, contexts: c.contexts, lineConfidence: c.confidences });
    const allText = report.findings
      .map((f) => ["mechanism" in f ? f.mechanism : "", "note" in f ? f.note : "", "rule" in f ? f.rule : ""].join(" "))
      .join(" ")
      .toLowerCase();
    const actual = mapVerdict(report.verdict);
    const findingHit = !c.expectFinding || allText.includes(c.expectFinding.toLowerCase());
    rows.push({ id: c.id, expect: c.expect, actual, findingHit, ok: actual === c.expect && findingHit });
  }
  const passRate = rows.filter((r) => r.ok).length / rows.length;
  return { rows, passRate };
}

if (import.meta.main) {
  const { rows, passRate } = runParityTs();
  const failed = rows.filter((r) => !r.ok);
  console.log(`TS parity: ${rows.length - failed.length}/${rows.length} agree`);
  for (const f of failed) {
    console.log(`  FAIL ${f.id}: expect=${f.expect} got=${f.actual} findingHit=${f.findingHit}`);
  }
  if (failed.length > 0) process.exit(1);
  console.log("PARITY PASSED");
}
