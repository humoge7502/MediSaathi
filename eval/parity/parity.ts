/**
 * Cross-engine parity runner — TypeScript side (ADR-0012, audit finding TD-D).
 *
 * Runs the SHARED golden corpus `eval/parity/golden.json` through the
 * TypeScript safety plane and prints per-case agreement. CI runs both sides:
 *   - Python: pytest apps/api/tests/test_parity.py  (via make test)
 *   - TS:     bun run parity  (via make web-check)
 * Any disagreement blocks the merge, so the two planes cannot drift again.
 *
 * The corpus lives in ONE file read by both runners (MED-015): at 25 cases the
 * per-language in-code duplication was tolerable, at 100+ it would itself be a
 * drift source. The engines remain fully independent (separate code, separate
 * data tables); only the test vectors are shared, and they are versioned.
 */
import { runSafetyPlane, type VerdictKind } from "../../apps/web/src/lib/safety/engine";

interface GoldenCase {
  id: string;
  lines: string[];
  confidences: number[];
  contexts: string[];
  expect: "pass" | "interaction" | "contraindication" | "duplicate_atc" | "confirm_queue" | "refused";
  expect_finding?: string;
}

interface GoldenFile {
  parity_version: number;
  vocabulary: string[];
  cases: GoldenCase[];
}

/**
 * TS-side verdict vocabulary: the TS plane distinguishes "combination" and
 * "duplicate" kinds; the parity vocabulary folds them into "interaction" and
 * "duplicate_atc" respectively (the Python VerdictKind). Severity travels in
 * the findings.
 */
function mapVerdict(v: VerdictKind): GoldenCase["expect"] {
  switch (v) {
    case "pass": return "pass";
    case "interaction":
    case "combination": return "interaction";
    case "contraindication": return "contraindication";
    case "duplicate": return "duplicate_atc";
    case "confirm_queue": return "confirm_queue";
    case "refused": return "refused";
  }
}

const goldenUrl = new URL("./golden.json", import.meta.url);

export const GOLDEN: GoldenFile = JSON.parse(await Bun.file(goldenUrl).text());

export const PARITY_CASES: GoldenCase[] = GOLDEN.cases;

export function corpusSummary(): string {
  const counts: Record<string, number> = {};
  for (const c of PARITY_CASES) counts[c.expect] = (counts[c.expect] ?? 0) + 1;
  const parts = Object.keys(counts).sort().map((k) => `${k}=${counts[k]}`);
  return `n=${PARITY_CASES.length} ${parts.join(" ")}`;
}

export interface ParityRow {
  id: string;
  expect: GoldenCase["expect"];
  actual: GoldenCase["expect"];
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
    const findingHit = !c.expect_finding || allText.includes(c.expect_finding.toLowerCase());
    rows.push({ id: c.id, expect: c.expect, actual, findingHit, ok: actual === c.expect && findingHit });
  }
  const passRate = rows.filter((r) => r.ok).length / rows.length;
  return { rows, passRate };
}

if (import.meta.main) {
  const { rows, passRate } = runParityTs();
  const failed = rows.filter((r) => !r.ok);
  console.log(`TS parity: ${rows.length - failed.length}/${rows.length} agree (${corpusSummary()})`);
  for (const f of failed) {
    console.log(`  FAIL ${f.id}: expect=${f.expect} got=${f.actual} findingHit=${f.findingHit}`);
  }
  if (failed.length > 0) process.exit(1);
  console.log("PARITY PASSED");
}
