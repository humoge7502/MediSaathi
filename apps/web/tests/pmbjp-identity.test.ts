/**
 * A brand row may not name a drug its own name denies — TypeScript side, the
 * mirror of apps/api/tests/test_pmbjp_identity.py.
 *
 * WHY THIS FILE EXISTS: the product tier decides from `tables.generated.ts`, a
 * compiled copy of data/brands.csv. 226 Jan Aushadhi rows were filed under the
 * molecule representative of the class they were shelved in — apixaban under
 * warfarin, cholecalciferol 60K under calcium carbonate, escitalopram under
 * citalopram — so the app screened a different drug than the strip says, and
 * cited the wrong drug's mechanism to the patient. The Python gate would have
 * caught a stale artifact; it would not have caught the product tier loading a
 * row the API tier repaired, which is the same asymmetry TD-15 was closed for.
 *
 * The law is data, not a list duplicated here: the expectations are read from
 * data/reference/pmbjp_molecule_repairs.csv, the ledger the repair tool writes.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BRANDS } from "@/lib/safety/dataset";

type Repair = { brand: string; before: string; after: string; stated: string };

function readLedger(): Repair[] {
  const path = new URL("../../../data/reference/pmbjp_molecule_repairs.csv", import.meta.url);
  const lines = readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((line) => {
    // Quote-aware: the PMBJP source column carries commas inside the citation.
    const fields: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { fields.push(cur); cur = ""; }
      else cur += ch;
    }
    fields.push(cur);
    const [brand, before, after, , ,] = fields;
    return { brand, before, after, stated: fields[3] };
  });
}

const LEDGER = readLedger();

// The identity law on this side, and it is not "lowercase". apps/api keys rows
// through _norm_key (NBSP folded, ends stripped, runs of whitespace collapsed);
// tools/build_web_dataset.py applies the same fold at build time, because the
// PMBJP catalog carries U+00A0 inside 11 brand names. The repair ledger is a
// copy of the SOURCE csv, so it still carries them — comparing a ledger brand
// to a compiled brand without folding says the product tier lost a row when it
// in fact gained the fold.
const norm = (s: string) =>
  s.replace(/\u00a0/g, " ").toLowerCase().replace(/_/g, " ").trim().replace(/\s+/g, " ");
const byBrand = new Map(BRANDS.map((r) => [norm(r.brand), r]));

describe("the compiled formulary carries the repaired identity", () => {
  test("the ledger is present and non-trivial", () => {
    expect(LEDGER.length).toBe(226);
  });

  test("the compiled table folded the catalog's exotic whitespace", () => {
    // The fold is why the lookup below can work at all, and it is a build-time
    // claim: nothing in the artifact may still carry a non-breaking space.
    const raw = readFileSync(
      new URL("../src/lib/safety/tables.generated.ts", import.meta.url), "utf8");
    expect(raw.includes("\u00a0")).toBe(false);
    expect(BRANDS.filter((r) => r.brand !== r.brand.trim()).length).toBe(0);
  });

  test("every recorded repair is what the product tier actually loads", () => {
    for (const entry of LEDGER) {
      const row = byBrand.get(norm(entry.brand));
      expect(row, `${entry.brand} vanished from the compiled table`).toBeDefined();
      expect(norm(row!.molecule)).toBe(norm(entry.after));
    }
  });

  test("no row still carries the class representative it was filed under", () => {
    const stale = LEDGER.filter((e) => norm(byBrand.get(norm(e.brand))!.molecule) !== norm(e.after));
    expect(stale).toEqual([]);
  });
});

describe("the four measured consequences, in the plane that shows them to a patient", () => {
  test("apixaban is not keyed to warfarin", () => {
    expect(byBrand.get("jan aushadhi apixaban tablets 5mg")!.molecule).toBe("apixaban");
  });

  test("the 60K cholecalciferol brand is not keyed to calcium carbonate", () => {
    expect(byBrand.get("jan aushadhi cholecalciferol soft gelatin capsule 60000 iu")!.molecule)
      .toBe("cholecalciferol");
  });

  test("escitalopram is not keyed to citalopram", () => {
    // citalopram is licensed to 40 mg/day, escitalopram to 20: the wrong key
    // screened a double dose of one drug against the ceiling of the other.
    expect(byBrand.get("jan aushadhi escitalopram tablets ip 10 mg")!.molecule).toBe("escitalopram");
  });

  test("heparin injection is not keyed to warfarin", () => {
    expect(byBrand.get("jan aushadhi heparin sodium injection ip 25000 iu")!.molecule).toBe("heparin");
  });
});
