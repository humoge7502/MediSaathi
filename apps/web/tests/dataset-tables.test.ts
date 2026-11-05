/**
 * The generated table is the table the app ships with (ADR-0012, task TD-9).
 *
 * The API-tier twin (`apps/api/tests/test_web_dataset.py`) compares this module
 * against `SafetyEngine.load()`. This file checks the module against *itself*:
 * its own declared counts, its own hash recomputed from its own decoded rows,
 * and the shape invariants `tools/build_web_dataset.py` refuses to build over.
 * A generated artifact nobody re-verifies is a generated artifact that lies
 * quietly — which is exactly how the product tier ended up loading 99 of the
 * 2 836 catalog rows for a whole release.
 */
import { createHash } from "node:crypto";

import { BRANDS, CONTRAINDICATIONS, CONTEXT_CODES, INTERACTIONS, MOLECULE_GROUPS } from "@/lib/safety/dataset";
import { normalizeLine, runSafetyPlane } from "@/lib/safety/engine";
import {
  DATASET_ROW_COUNTS,
  DATASET_TABLE_HASH,
} from "@/lib/safety/tables.generated";
import { describe, expect, test } from "bun:test";

/** `_norm_key` in apps/api/app/safety/engine.py. */
const normKey = (s: string): string =>
  s.replace(/\u00a0/g, " ").trim().toLowerCase().replace(/\s+/g, " ").trim();

/**
 * `json.dumps(payload, sort_keys=True)` with Python's defaults: ", " / ": "
 * separators, ASCII-only escaping, sorted object keys. The table hash is taken
 * over this exact byte string, so a TS approximation would recompute a different
 * digest for identical data and the gate would be noise.
 */
function pyJson(value: unknown): string {
  if (typeof value === "string") {
    let out = '"';
    for (const ch of value) {
      const code = ch.codePointAt(0) as number;
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\b") out += "\\b";
      else if (ch === "\f") out += "\\f";
      else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`;
      else if (code > 0x7e) {
        for (const unit of ch) out += `\\u${unit.codePointAt(0)!.toString(16).padStart(4, "0")}`;
      } else out += ch;
    }
    return out + '"';
  }
  if (Array.isArray(value)) return `[${value.map(pyJson).join(", ")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries.map(([k, v]) => `${pyJson(k)}: ${pyJson(v)}`).join(", ")}}`;
}

/** Mirror of `table_hash` in tools/build_web_dataset.py, over decoded rows. */
function recomputeHash(): string {
  const decided = {
    brands: BRANDS.map((b) => [normKey(b.brand), b.molecule, b.aware, b.priceInr.toFixed(2)]),
    interactions: INTERACTIONS.map((r) => [r.a, r.b, r.severity]),
    contraindications: CONTRAINDICATIONS.map((r) => [r.molecule, r.condition, r.severity, r.note]),
    groups: MOLECULE_GROUPS,
  };
  return createHash("sha256").update(pyJson(decided)).digest("hex").slice(0, 16);
}

describe("generated dataset — self-consistency", () => {
  test("the module's counts are its own rows", () => {
    expect(BRANDS.length).toBe(DATASET_ROW_COUNTS.brands);
    expect(INTERACTIONS.length).toBe(DATASET_ROW_COUNTS.interactions);
    expect(CONTRAINDICATIONS.length).toBe(DATASET_ROW_COUNTS.contraindications);
  });

  test("the module's hash is recomputable from the rows it decodes", () => {
    expect(recomputeHash()).toBe(DATASET_TABLE_HASH);
  });

  test("the whole catalog is loaded, not a curated copy of it", () => {
    // The bug this gate exists for: the product tier shipped 99 brands while
    // data/brands.csv carried 2 836, and every verdict-level test stayed green
    // because none of them named a brand the small copy was missing.
    expect(BRANDS.length).toBeGreaterThanOrEqual(2800);
    expect(INTERACTIONS.length).toBeGreaterThanOrEqual(9600);
    expect(CONTRAINDICATIONS.length).toBeGreaterThanOrEqual(1260);
    const molecules = new Set(
      BRANDS.flatMap((b) => b.molecule.split("+").map((m) => m.trim()))
    );
    expect(molecules.size).toBeGreaterThanOrEqual(580);
  });
});

describe("generated dataset — shape invariants the resolver assumes", () => {
  test("brand keys are unique, folded and non-empty", () => {
    const keys = BRANDS.map((b) => normKey(b.brand));
    expect(new Set(keys).size).toBe(BRANDS.length);
    const bad = keys.filter((k) => !k.length || /\s\s|^\s|\s$/.test(k));
    expect(bad).toEqual([]);
  });

  test("display names carry no exotic whitespace", () => {
    // U+00A0 in 11 catalog rows is folded at build time (and at load in
    // apps/api). Left in place, `toLowerCase()` would not fold it and the two
    // planes would resolve the same line to different rows.
    // JS \s already covers U+00A0, so a fold-and-compare is enough to prove
    // nothing exotic survived the build.
    const fold = (s: string) => s.trim().split(/\s+/).join(" ");
    const offenders = BRANDS.map((b) => b.brand).filter((n) => n !== fold(n));
    expect(offenders).toEqual([]);
  });

  test("molecule cells are already lowercase and space-free", () => {
    // The TS resolver splits on "+" without re-folding; a cell reading
    // "Ibuprofen + Paracetamol" would key differently from the API tier's.
    const brands = BRANDS.filter((b) =>
      b.molecule !== b.molecule.split("+").map((m) => m.trim().toLowerCase()).join("+"));
    expect(brands.map((b) => `${b.brand}:${b.molecule}`)).toEqual([]);
    const pairs = INTERACTIONS.filter((r) => r.a !== r.a.trim().toLowerCase()
      || r.b !== r.b.trim().toLowerCase());
    expect(pairs.length).toBe(0);
    const contras = CONTRAINDICATIONS.filter((r) => r.molecule !== r.molecule.trim().toLowerCase());
    expect(contras.length).toBe(0);
  });

  test("no interaction is documented against itself", () => {
    // Python keys a pair as a frozenset (collapses a self-pair to one element);
    // TS sorts and joins, producing "a|a". A self-pair would be reachable in
    // exactly one plane.
    expect(INTERACTIONS.filter((r) => r.a === r.b).length).toBe(0);
  });

  test("pair keys are unique", () => {
    const pairs = INTERACTIONS.map((r) => [r.a, r.b].sort().join("|"));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test("contraindication conditions are declarable", () => {
    // A rule whose condition code no client can send is dead data pretending to
    // be a safeguard.
    const declarable = new Set(CONTEXT_CODES.map((c) => c.code));
    const orphans = [...new Set(CONTRAINDICATIONS.filter((r) => !declarable.has(r.condition))
      .map((r) => r.condition))];
    expect(orphans).toEqual([]);
  });

  test("vocabularies are closed", () => {
    const aware = new Set(["Access", "Watch", "Reserve", "-"]);
    expect([...new Set(BRANDS.map((b) => b.aware))].filter((a) => !aware.has(a))).toEqual([]);
    const sev = new Set(["mild", "moderate", "severe"]);
    expect([...new Set(INTERACTIONS.map((r) => r.severity))].filter((s) => !sev.has(s))).toEqual([]);
    const cSev = new Set(["absolute", "relative"]);
    expect([...new Set(CONTRAINDICATIONS.map((r) => r.severity))]
      .filter((s) => !cSev.has(s))).toEqual([]);
    expect(CONTRAINDICATIONS.filter((r) => !r.note.length).length).toBe(0);
    expect(BRANDS.filter((b) => !Number.isFinite(b.priceInr)).length).toBe(0);
  });

  test("combination-granularity rules survive the compile", () => {
    // 176 interaction rows and 17 contraindication rows are written for a
    // combination ("sacubitril+valsartan"), and moleculeIdentities() reaches
    // them by screening components AND the joined string. Splitting them here
    // would delete the rule while the row count still looked right.
    expect(INTERACTIONS.filter((r) => r.a.includes("+") || r.b.includes("+")).length)
      .toBeGreaterThanOrEqual(176);
    expect(CONTRAINDICATIONS.filter((r) => r.molecule.includes("+")).length)
      .toBeGreaterThanOrEqual(17);
  });

  test("the graph-rule groups are loaded", () => {
    const groups = Object.entries(MOLECULE_GROUPS);
    expect(groups.length).toBe(8);
    expect(groups.filter(([, members]) => members.length < 2)).toEqual([]);
  });
});

describe("resolver law — one engine, one table", () => {
  test("a strength written in the line resolves to that strength's row", () => {
    // The core-scan fallback used to take the first row whose name started with
    // the same letters, which turned "Brufen 400" into Brufen 200 and then
    // queued a line the perception layer had read perfectly.
    expect(normalizeLine("Tab Brufen 400 mg BD x5d", 0).brand).toBe("Brufen 400");
    expect(normalizeLine("Citalopram 40 mg OD", 0).brand).toBe("Citalopram 40");
  });

  test("a line nothing contains stays unbranded and queues", () => {
    const med = normalizeLine("Tab Zylopent-DR 1 tab HS", 0);
    expect(med.brand).toBeNull();
    expect(med.brandConfidence).toBe(0);
  });

  test("a generic name that is also a brand key resolves by containment", () => {
    // With the whole catalog loaded, "warfarin 5mg" contains the formulary key
    // "warfarin 5", so it lands on a real row at the containment confidence
    // rather than the guess confidence. The API tier resolves the same line the
    // same way; the resolver sweep that proves it is described in engine.ts.
    const med = normalizeLine("warfarin 5mg OD", 0);
    expect(med.brand).toBe("Warfarin 5");
    expect(med.molecule).toBe("warfarin");
    expect(med.brandConfidence).toBe(0.92);
  });

  test("a generic name in no brand key guesses, and the guess never decides", () => {
    // P149: the guess is kept on the record (it helps a pharmacist) but it is
    // not a formulary match, so the line queues in BOTH planes at any
    // perception confidence. Before this, a 0.97 read of an unconfirmable
    // ingredient name auto-passed here while the API tier queued it.
    const med = normalizeLine("ferrous sulfate 500 mg OD", 0);
    expect(med.molecule).toBe("ferrous sulfate");
    expect(med.resolvedBy).toBe("molecule");
    expect(med.brandConfidence).toBe(0.85);
    expect(med.brand).not.toBeNull();

    const report = runSafetyPlane({
      rawLines: ["ferrous sulfate 500 mg OD"],
      contexts: [],
      lineConfidence: [0.97],
    });
    expect(report.verdict).toBe("confirm_queue");
    expect(report.confirmed.length).toBe(0);
    expect(report.confirmQueue[0].reason).toBe("Not in formulary — needs human confirmation");
  });

  test("a brand the formulary does hold still auto-confirms at the same reading", () => {
    // The control: the stricter rule must not widen into "everything queues".
    const report = runSafetyPlane({
      rawLines: ["Tab Autrin 1 BD x30d"],
      contexts: [],
      lineConfidence: [0.97],
    });
    expect(report.verdict).toBe("pass");
    expect(report.confirmQueue.length).toBe(0);
  });
});
