/**
 * Longitudinal regimen plane + read-uncertainty propagation (mechanisms A+B),
 * TypeScript side.
 *
 * Mirrors `apps/api/tests/test_regimen.py`. Each test names the failure mode
 * it guards:
 *
 * - a harm that exists only because two prescriptions were composed must be
 *   caught by the regimen plane and must remain invisible to the incumbent
 *   single-prescription law (that invisibility is the defect being fixed);
 * - read uncertainty that could *hide* a harm must force the confirm queue,
 *   and switching propagation off must remove the queue — the coupling's
 *   necessity;
 * - the field-gate semantics (refusal, queue) must be preserved unchanged.
 */
import { describe, expect, test } from "bun:test";
import { runSafetyPlane } from "@/lib/safety/engine";
import {
  DEFAULT_FRAGILITY_THRESHOLD,
  activeMedFromRow,
  brandCore,
  identityDistribution,
  regimenState,
  screenRegimen,
  similarity,
  unionVerdict,
  type ActiveMed,
  type RegimenFinding,
} from "@/lib/safety/regimen";
import { BRANDS } from "@/lib/safety/dataset";

const byBrand = (brand: string): (typeof BRANDS)[number] => {
  const row = BRANDS.find((b) => b.brand === brand);
  if (!row) throw new Error(`fixture brand not in formulary: ${brand}`);
  return row;
};

function active(...brands: string[]): ActiveMed[] {
  return brands.map((b) => activeMedFromRow(byBrand(b)));
}

/** The incumbent single-prescription verdict for the same fields. */
function singleRx(fields: { brandText: string; confidence: number }[], contexts: string[] = []): string {
  const report = runSafetyPlane({
    rawLines: fields.map((f) => `${f.brandText} mg OD 30 days`),
    contexts,
    lineConfidence: fields.map((f) => f.confidence),
  });
  return report.verdict;
}

// -------------------------------------------------------------- mechanism A

describe("mechanism A — regimen state composition", () => {
  test("a triple whammy assembled across two visits is caught", () => {
    // ARB + diuretic already active; a new NSAID completes the triple whammy.
    // No single prescription contains all three, so the incumbent law passes it.
    const fields = [{ brandText: "Brufen 400", confidence: 0.97 }];
    expect(singleRx(fields)).toBe("pass"); // the defect
    const screen = screenRegimen({ fields, active: active("Losar 50", "Lasix 40") });
    expect(screen.verdict).toBe("interaction");
    expect(screen.findings.some((f) => f.crossing && f.kind === "combination")).toBe(true);
  });

  test("a third QT-prolonger added later is caught", () => {
    const fields = [{ brandText: "Citalopram 20", confidence: 0.97 }];
    expect(singleRx(fields)).toBe("pass");
    const screen = screenRegimen({ fields, active: active("Azithral 500", "Ciplox 500") });
    expect(screen.verdict).toBe("interaction");
  });

  test("the same molecule via a different brand is a duplicate across visits", () => {
    const fields = [{ brandText: "Clopilet 75", confidence: 0.97 }];
    expect(singleRx(fields)).toBe("pass");
    expect(screenRegimen({ fields, active: active("Deplatt 75") }).verdict).toBe("duplicate_atc");
  });

  test("a clean continuation passes and is not queued", () => {
    const screen = screenRegimen({
      fields: [{ brandText: "Cetzine 10", confidence: 0.97 }],
      active: active("Pan 40"),
    });
    expect(screen.verdict).toBe("pass");
    expect(screen.queued).toBe(false);
  });

  test("an incoming-only harm is unchanged by regimen mode (no regression)", () => {
    const fields = [
      { brandText: "Warf 5", confidence: 0.97 },
      { brandText: "Ecosprin 75", confidence: 0.97 },
    ];
    expect(singleRx(fields)).toBe("interaction");
    expect(screenRegimen({ fields, active: [] }).verdict).toBe("interaction");
  });

  test("inactive regimen entries (expired window) do not screen", () => {
    // duration elapsed: the NSAID no longer composes with the ARB/diuretic
    const entries = [
      { brand: "Losar 50", startedDay: 0, durationDays: 5 },
      { brand: "Lasix 40", startedDay: 0, durationDays: 5 },
    ];
    const screen = screenRegimen({
      fields: [{ brandText: "Brufen 400", confidence: 0.97 }],
      active: entries,
      asOfDay: 10,
    });
    expect(screen.provenance.activeCount).toBe(0);
    expect(screen.verdict).toBe("pass");
  });

  test("regimenState drops unknown brands instead of inventing exposure", () => {
    const meds = regimenState([{ brand: "Fakezol 500" }, { brand: "Pan 40" }], 0);
    expect(meds.map((m) => m.brand)).toEqual(["Pan 40"]);
  });
});

// -------------------------------------------------------------- mechanism B

describe("mechanism B — verdict-level uncertainty propagation", () => {
  test("a confusable read forces the queue and the ablation removes it", () => {
    // Reading "Ecosprin 75" while gemfibrozil is active: the resolved read is
    // bare aspirin (pass), but the look-alike "Ecospirin AV 75" carries
    // atorvastatin, which interacts. The incumbent auto-confirms; propagation
    // must queue, and switching propagation off must return the auto-confirm.
    const fields = [{ brandText: "Ecosprin 75", confidence: 0.93 }];
    expect(singleRx(fields)).toBe("pass");
    const on = screenRegimen({ fields, active: active("Lopid 600"), propagate: true });
    expect(on.nominalVerdict).toBe("pass");
    expect(on.worstVerdict).toBe("interaction");
    expect(on.fragility).toBeGreaterThan(DEFAULT_FRAGILITY_THRESHOLD);
    expect(on.queued).toBe(true);
    expect(on.verdict).toBe("confirm_queue");
    const off = screenRegimen({ fields, active: active("Lopid 600"), propagate: false });
    expect(off.fragility).toBe(0);
    expect(off.queued).toBe(false);
    expect(off.verdict).toBe("pass");
  });

  test("identity distributions normalise and stay formulary-grounded", () => {
    const dist = identityDistribution("Amlong 5", 0.93);
    expect(dist.reduce((a, c) => a + c.mass, 0)).toBeCloseTo(1.0, 6);
    const resolved = dist.filter((c) => c.kind === "resolved");
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved[0].brand).toBe("Amlong 5");
    expect(resolved[0].mass).toBeCloseTo(0.93, 6);
    // the amlodipine/amitriptyline look-alike must be in the neighbourhood
    expect(dist.some((c) => c.brand === "Amitone 10")).toBe(true);
  });

  test("an unresolvable read stays queued by the field gate even in regimen mode", () => {
    // mechanism B never auto-confirms an invented read
    const screen = screenRegimen({ fields: [{ brandText: "Xenomol 500", confidence: 0.99 }], active: [] });
    expect(screen.verdict).toBe("confirm_queue");
  });

  test("a low-confidence field still refuses in regimen mode", () => {
    const screen = screenRegimen({
      fields: [{ brandText: "Brufen 400", confidence: 0.4 }],
      active: active("Losar 50"),
    });
    expect(screen.verdict).toBe("refused");
    expect(screen.gateBand).toBe("refused");
  });

  test("uncertainty that cannot hide harm does not tax the reviewer", () => {
    // "Warf 5" at 0.93 sits in the auto band, but its confusion neighbourhood
    // (Warfone 5) carries the SAME molecule — every world is warfarin, so the
    // verdict cannot flip. Fragility is real but can hide no harm: queuing
    // would buy nothing, so the coupling must stay silent.
    const dist = identityDistribution("Warf 5", 0.93);
    expect(dist.length).toBeGreaterThan(1);
    expect(dist.every((c) => c.molecules.includes("warfarin"))).toBe(true);
    const screen = screenRegimen({
      fields: [{ brandText: "Warf 5", confidence: 0.93 }],
      active: [],
    });
    expect(screen.gateBand).toBe("auto");
    expect(screen.fragility).toBeGreaterThan(DEFAULT_FRAGILITY_THRESHOLD);
    expect(screen.provenance.couldHideHarm).toBe(false);
    expect(screen.queued).toBe(false);
    expect(screen.verdict).toBe("pass");
  });
});

// -------------------------------------------------------------- determinism

describe("determinism and mass invariants", () => {
  test("the screen is deterministic", () => {
    const input = {
      fields: [{ brandText: "Amlong 5", confidence: 0.93 }],
      active: active("Sertraline 50", "Tramazac 50"),
    };
    expect(JSON.stringify(screenRegimen(input))).toBe(JSON.stringify(screenRegimen(input)));
  });

  test("verdict mass sums to one", () => {
    const screen = screenRegimen({
      fields: [{ brandText: "Amlong 5", confidence: 0.93 }],
      active: active("Sertraline 50", "Tramazac 50"),
    });
    expect(Object.values(screen.verdictMass).reduce((a, v) => a + v, 0)).toBeCloseTo(1.0, 6);
  });

  test("finding mass never exceeds one and never goes negative", () => {
    const screen = screenRegimen({
      fields: [{ brandText: "Amlong 5", confidence: 0.93 }],
      active: active("Sertraline 50", "Tramazac 50"),
    });
    for (const f of screen.findings as RegimenFinding[]) {
      expect(f.mass).toBeGreaterThanOrEqual(0);
      expect(f.mass).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  test("union verdict precedence mirrors the single-Rx law", () => {
    const f = (
      kind: RegimenFinding["kind"],
      severity: RegimenFinding["severity"]
    ): RegimenFinding => ({
      kind,
      severity,
      molecules: [],
      mechanism: "test",
      source: "test",
      crossing: false,
      mass: 1,
    });
    expect(unionVerdict([f("duplicate", "moderate"), f("interaction", "severe")])).toBe("interaction");
    expect(unionVerdict([f("duplicate", "moderate"), f("interaction", "moderate")])).toBe("duplicate_atc");
    expect(unionVerdict([f("interaction", "moderate")])).toBe("interaction");
    expect(unionVerdict([])).toBe("pass");
  });
});

// -------------------------------------------------------------- similarity

describe("confusion neighbourhood primitives", () => {
  test("brandCore strips strength and case", () => {
    expect(brandCore("Levipil 500")).toBe("levipil");
    expect(brandCore("Ecosprin AV 75")).toBe("ecosprinav");
  });

  test("similarity is 1 for identical cores and symmetric", () => {
    expect(similarity("Ecosprin 75", "Ecospirin AV 75")).toBeGreaterThan(0.55);
    expect(similarity("Amlong 5", "Amitone 10")).toBeGreaterThan(0.3);
    const a = similarity("Dolo 650", "Pan 40");
    const b = similarity("Pan 40", "Dolo 650");
    expect(a).toBe(b);
  });
});
