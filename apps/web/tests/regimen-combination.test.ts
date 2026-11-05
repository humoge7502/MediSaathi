/**
 * Combination granularity in the product tier's longitudinal screen.
 *
 * The single-prescription screen matches a medication under its whole
 * combination identity as well as each component; the regimen screen now
 * imports that same function, so this file pins what the composition *reaches*
 * rather than trusting that two copies still agree:
 *
 * - a documented harm carried by a combination brand and a drug from a later
 *   visit must be caught across the visit boundary;
 * - an absolute contraindication written at combination granularity must fire;
 * - one brand must never report an interaction between its own halves — the
 *   pooled walk this replaces did, and the single-Rx plane refuses to;
 * - the counts that justified the change are recomputed from the shipped table.
 */
import { describe, expect, test } from "bun:test";
import { moleculeIdentities, runSafetyPlane } from "@/lib/safety/engine";
import {
  activeMedFromRow,
  screenRegimen,
  type ActiveMed,
} from "@/lib/safety/regimen";
import { BRANDS, CONTRAINDICATIONS, INTERACTIONS } from "@/lib/safety/dataset";

const byBrand = (brand: string): (typeof BRANDS)[number] => {
  const row = BRANDS.find((b) => b.brand === brand);
  if (!row) throw new Error(`fixture brand not in formulary: ${brand}`);
  return row;
};

function active(...brands: string[]): ActiveMed[] {
  return brands.map((b) => activeMedFromRow(byBrand(b)));
}

/** The incumbent single-prescription verdict for the same fields. */
function singleRx(brand: string, contexts: string[] = []): string {
  return runSafetyPlane({
    rawLines: [brand],
    contexts,
    lineConfidence: [0.97],
  }).verdict;
}

const splitMols = (cell: string): string[] =>
  cell
    .replace(/,/g, "+")
    .split("+")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);

// ------------------------------------------------------------- the identity law

describe("one identity law, two screens", () => {
  test("every catalog molecule cell expands to components then the whole", () => {
    // The Python tier expands the raw cell (_molecule_identities); the product
    // tier expands the already-split tuple. Both must land on the same set for
    // the same row, or a combination brand is one drug here and two drugs there.
    const offenders: string[] = [];
    for (const row of BRANDS) {
      const comps = splitMols(row.molecule);
      const want = comps.length > 1 ? [...comps, comps.join("+")] : comps;
      const got = moleculeIdentities(comps);
      if (got.join("|") !== want.join("|")) offenders.push(row.brand);
    }
    expect(offenders).toEqual([]);
    expect(moleculeIdentities(["aspirin"])).toEqual(["aspirin"]);
    expect(moleculeIdentities(["artemether", "lumefantrine"])).toEqual([
      "artemether",
      "lumefantrine",
      "artemether+lumefantrine",
    ]);
  });
});

// ------------------------------------------------ harms that cross two visits

describe("a combination harm assembled across two visits", () => {
  const cases: { activeBrand: string; incoming: string; whole: string }[] = [
    // No valproate x imipenem and no valproate x cilastatin row exists; the
    // severe warning is written against the antibiotic as it is actually sold.
    { activeBrand: "Cilanem 500", incoming: "Encorate Chrono 300", whole: "imipenem+cilastatin" },
    // Enzyme induction against a combined oral contraceptive: the failure is
    // unintended pregnancy, documented on the combination, not on either hormone.
    { activeBrand: "Duoluton-L", incoming: "Carbamazepine 200", whole: "ethinylestradiol+levonorgestrel" },
    // Two QT-prolonging courses from two visits, one of them a fixed combination.
    { activeBrand: "Lumether 80/480", incoming: "Cordarone 200", whole: "artemether+lumefantrine" },
  ];

  for (const c of cases) {
    test(`${c.activeBrand} + ${c.incoming} is caught`, () => {
      expect(singleRx(c.incoming)).toBe("pass");
      const screen = screenRegimen({
        fields: [{ brandText: c.incoming, confidence: 0.97 }],
        active: active(c.activeBrand),
      });
      expect(screen.verdict).toBe("interaction");
      const hits = screen.findings.filter((f) => f.molecules.includes(c.whole));
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((f) => f.crossing)).toBe(true);
    });
  }
});

describe("contraindications written at combination granularity", () => {
  test("artemether+lumefantrine in pregnancy is a contraindication, not a pass", () => {
    const screen = screenRegimen({
      fields: [{ brandText: "Lumether 80/480", confidence: 0.97 }],
      active: [],
      contexts: ["pregnancy"],
    });
    expect(screen.verdict).toBe("contraindication");
    expect(
      screen.findings.some(
        (f) =>
          f.kind === "contraindication" &&
          f.molecules.join("|") === "artemether+lumefantrine" &&
          f.severity === "severe"
      )
    ).toBe(true);
    // Context-driven, not always-on: the same read with no declared pregnancy
    // must not be reported as a contraindication.
    expect(
      screenRegimen({
        fields: [{ brandText: "Lumether 80/480", confidence: 0.97 }],
        active: [],
      }).verdict
    ).toBe("pass");
  });
});

// ------------------------------------------------------------------ screen laws

describe("the union screen's finding law", () => {
  test("a combination brand meets its partner through each identity, once each", () => {
    const screen = screenRegimen({
      fields: [{ brandText: "Folitrax 10", confidence: 0.97 }],
      active: active("Augmentin 625"),
    });
    const pairs = screen.findings
      .filter((f) => f.kind === "interaction")
      .map((f) => [...f.molecules].sort().join("|"));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs).toContain(["methotrexate", "amoxicillin+clavulanic acid"].sort().join("|"));
  });

  test("a fixed-dose combination never interacts with its own halves", () => {
    // A pooled molecule walk pairs everything with everything, including the two
    // halves of one tablet. Four catalog rows carry an internal documented pair,
    // so the regimen plane reported a self-interaction the single-Rx plane
    // refuses to report: same patient, two answers.
    const brand =
      "Jan Aushadhi Benedipine (4mg) + Telmisartan (40mg) + Chlorthalidone (6.25mg) Tablets";
    const comps = splitMols(byBrand(brand).molecule);
    expect(comps).toEqual(["telmisartan", "chlorthalidone"]);
    const documented = INTERACTIONS.some(
      (r) => [r.a, r.b].sort().join("|") === [...comps].sort().join("|")
    );
    expect(documented).toBe(true); // only worth keeping while the pair is documented
    const screen = screenRegimen({
      fields: [{ brandText: "Cetzine 10", confidence: 0.97 }],
      active: active(brand),
    });
    expect(
      screen.findings.some(
        (f) => f.kind === "interaction" && [...f.molecules].sort().join("|") === [...comps].sort().join("|")
      )
    ).toBe(false);
    expect(screen.verdict).toBe("pass");
  });
});

describe("reachability measured, not assumed", () => {
  test("176 interaction rows and 17 contraindications are keyed on a whole combination", () => {
    const combo = INTERACTIONS.filter((r) => r.a.includes("+") || r.b.includes("+"));
    expect(combo.length).toBe(176);
    expect(CONTRAINDICATIONS.filter((r) => r.molecule.includes("+")).length).toBe(17);

    // 89 of them have no component-level counterpart for the same partner, so a
    // component-only walk could not have reached them from any brand pair.
    const key = (a: string, b: string) => [a, b].sort().join("|");
    const comboKeys = new Set(combo.map((r) => key(r.a, r.b)));
    expect(comboKeys.size).toBe(combo.length);
    const byKey = new Map(INTERACTIONS.map((r) => [key(r.a, r.b), r]));
    let orphan = 0;
    for (const r of combo) {
      const [big, small] = r.a.includes("+") ? [r.a, r.b] : [r.b, r.a];
      if (r.a.includes("+") && r.b.includes("+")) {
        orphan += 1;
        continue;
      }
      if (splitMols(big).some((comp) => byKey.has(key(comp, small)))) continue;
      orphan += 1;
    }
    expect(orphan).toBe(89);

    // and every whole string a row is keyed on is carried by at least one brand,
    // so "reachable" is a property of the screen, not of a name nobody sells.
    const wholes = new Set<string>();
    for (const r of combo) {
      if (r.a.includes("+")) wholes.add(r.a);
      if (r.b.includes("+")) wholes.add(r.b);
    }
    const carried = new Set<string>();
    for (const row of BRANDS) {
      for (const ident of moleculeIdentities(splitMols(row.molecule))) {
        if (ident.includes("+")) carried.add(ident);
      }
    }
    expect([...wholes].filter((w) => !carried.has(w))).toEqual([]);
  });
});
