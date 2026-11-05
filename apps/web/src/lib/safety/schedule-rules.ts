/**
 * Schedule rules — mirror of `apps/api/app/safety/dosing.py` interval mandates.
 *
 * Two hazards that confidence-based routing structurally cannot see, because
 * both are properties of the *regimen* the line describes, not of how well the
 * line was read:
 *
 *  1. an interval-mandated molecule on a shorter interval than its label allows
 *     (oral methotrexate once-daily — an ISMP high-alert never-event);
 *  2. a stated strength that contradicts the formulary entry the brand resolved
 *     to ("Thyronorm 500 mcg" matching the brand `Thyronorm 50` — 10x apart).
 *
 * Neither is a warning. Both block: they route the line to the confirm queue so
 * no plan can be generated from a schedule the label forbids.
 */

import { parseFrequency, type Frequency } from "./frequency";

export interface IntervalMandate {
  molecule: string;
  /** the rule only bites at or above this strength, in mg */
  minMg: number;
  minIntervalDays: number;
  /** formulations where the error actually occurs; empty = any */
  forms: string[];
  source: string;
  /**
   * A rule written in IU instead of mg, for the preparations sold in IU (the
   * 60,000 IU vitamin-D sachet). IU is not mass-convertible, so a table that can
   * only state mg cannot describe them — and `minMg` is then ignored.
   * Mirror of `IntervalMandate.min_iu`.
   */
  minIu?: number | null;
}

/**
 * Molecules whose approved formulation at/above `minMg` (or `minIu`) is labeled
 * for interval dosing, where daily administration is a recognized never-event.
 *
 * These are NOT expressible as a mg/day cap: oral methotrexate 10 mg once-daily
 * is 10 mg/day, well under the 30 mg/day cap, and is a known fatal error. Only a
 * minimum-interval rule catches it.
 *
 * Sources: ISMP high-alert list (oral methotrexate — weekly, never daily);
 * approved Indian labels for the weekly bisphosphonate strengths (alendronate
 * 35/70 mg, risedronate 35 mg), monthly ibandronate, once-weekly semaglutide
 * injection, and the 60,000 IU weekly cholecalciferol sachet. `forms` keeps an
 * IV/oncology regimen from being flagged.
 */
export const INTERVAL_MANDATES: readonly IntervalMandate[] = [
  { molecule: "methotrexate", minMg: 0.001, minIntervalDays: 7, forms: ["tablet", "syrup"],
    source: "ISMP high-alert (oral methotrexate: weekly, never daily)" },
  { molecule: "alendronate", minMg: 35, minIntervalDays: 7, forms: ["tablet"],
    source: "approved label: 35/70 mg weekly strengths" },
  { molecule: "risedronate", minMg: 35, minIntervalDays: 7, forms: ["tablet"],
    source: "approved label: 35 mg weekly" },
  { molecule: "ibandronate", minMg: 100, minIntervalDays: 30, forms: ["tablet", "injection"],
    source: "approved label: 150 mg monthly" },
  { molecule: "semaglutide", minMg: 0.1, minIntervalDays: 7, forms: ["injection"],
    source: "approved label: once-weekly injectable" },
  // No form filter: what makes the schedule wrong is the size of the dose, not
  // the packaging word. A daily cholecalciferol line states 400-2,000 IU and is
  // untouched; at 60,000 IU the same molecule is the weekly sachet.
  { molecule: "cholecalciferol", minMg: 0, minIntervalDays: 7, forms: [],
    source: "approved label: 60,000 IU once weekly for 8-12 weeks", minIu: 60000 },
];

const UNIT_TO_MG: Record<string, number> = { mg: 1, mcg: 0.001, "µg": 0.001, ug: 0.001, g: 1000 };

export interface Strength {
  value: number;
  unit: "mg" | "mcg" | "g" | "iu";
  /** mg-equivalent; null for IU, which is not mass-convertible */
  mg: number | null;
}

const STRENGTH_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|iu|g)\b/i;

export function parseStrength(text: string | null | undefined): Strength | null {
  const m = STRENGTH_RE.exec((text ?? "").toLowerCase());
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2];
  if (unit === "iu") return { value, unit: "iu", mg: null };
  if (unit === "mg") return { value, unit: "mg", mg: value };
  if (unit === "g") return { value, unit: "g", mg: value * 1000 };
  return { value, unit: "mcg", mg: value * 0.001 };
}

/**
 * The strictest interval rule for this (molecule, form, dose). Mirror of
 * `interval_mandate_for`.
 *
 * Two units because the table names a preparation sold in IU: passing only mg
 * left the 60,000 IU sachet unscreenable, since an IU strength has no mg
 * equivalent and the cap rules abstain on purpose. A row reads one unit or the
 * other, never both.
 */
export function intervalMandateFor(
  molecule: string,
  form: string,
  mg: number | null,
  iu: number | null = null
): IntervalMandate | null {
  if (mg === null && iu === null) return null;
  const mol = (molecule ?? "").toLowerCase();
  const f = (form ?? "").toLowerCase();
  for (const rule of INTERVAL_MANDATES) {
    if (rule.molecule !== mol) continue;
    if (rule.forms.length && !rule.forms.some((k) => f.includes(k))) continue;
    if (rule.minIu != null) {
      if (iu !== null && iu >= rule.minIu) return rule;
      continue;
    }
    if (mg !== null && mg >= rule.minMg) return rule;
  }
  return null;
}

/** A never-event schedule: mandated interval not respected. Null when clean. */
export function intervalHazard(
  frequency: string,
  strength: string,
  molecule: string,
  form: string
): { rule: IntervalMandate; freq: Frequency } | null {
  const f = parseFrequency(frequency);
  if (!f || f.asNeeded || f.single) return null;
  const st = parseStrength(strength);
  const rule = intervalMandateFor(
    molecule,
    form,
    st?.mg ?? null,
    st && st.unit === "iu" ? st.value : null
  );
  if (!rule) return null;
  return f.intervalDays < rule.minIntervalDays ? { rule, freq: f } : null;
}

export function intervalHazardNote(
  brand: string,
  molecule: string,
  strengthText: string,
  frequency: string,
  rule: IntervalMandate
): string {
  return (
    `${brand} (${molecule}${strengthText ? ` ${strengthText}` : ""}) is prescribed ` +
    `${frequency.trim()}, but this formulation is labeled for administration no more ` +
    `often than every ${rule.minIntervalDays} days. A daily schedule here is a known ` +
    `never-event, so the plan is blocked until a human confirms the interval.`
  );
}

const BRAND_STRENGTH_RE = /(?<![A-Za-z])(\d+(?:\.\d+)?)\s*([kK])?\s*(mg|mcg|µg|ug|iu|g)?\s*$/i;

/**
 * A combination brand states one strength per component
 * ("Levodopa+carbidopa 100/10", "Amoxicillin+clavulanic acid 500/125"), and 25
 * catalog rows are written that way. Reading only the trailing half as *the*
 * brand strength made a correct 100 mg levodopa line look tenfold wrong.
 * Mirror of `_BRAND_RATIO_STRENGTH_RE` in apps/api/app/safety/dosing.py.
 */
const BRAND_RATIO_STRENGTH_RE = /(?<![A-Za-z])(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|iu|g)?\s*$/i;

function normUnit(raw: string | undefined): string {
  const u = (raw ?? "").toLowerCase().replace("µg", "mcg").replace("ug", "mcg");
  return u === "units" || u === "unit" ? "iu" : u;
}

/** Every strength a brand label states, in label order. */
export function brandStrengths(brand: string): [number, string][] {
  const b = (brand ?? "").trim();
  const ratio = BRAND_RATIO_STRENGTH_RE.exec(b);
  if (ratio) {
    const unit = normUnit(ratio[3]);
    return [[parseFloat(ratio[1]), unit], [parseFloat(ratio[2]), unit]];
  }
  const m = BRAND_STRENGTH_RE.exec(b);
  if (!m) return [];
  let value = parseFloat(m[1]);
  if (m[2]) value *= 1000; // "60K" -> 60,000
  const unit = normUnit(m[3]);
  // A bare trailing INTEGER of 1-2 is a strip count or a serial ("Ecosprin 1",
  // "Pan 1"), not a strength. A DECIMAL is never a count: "Alprax 0.5",
  // "Digoxin 0.25" are doses, and rejecting them by magnitude alone blinded the
  // different-strength guard for the whole sub-2 mg class. Mirror of
  // `brand_strengths` in apps/api/app/safety/dosing.py.
  if (value <= 2 && !unit && Number.isInteger(value)) return [];
  return [[value, unit]];
}

/**
 * (value, unit) encoded in a brand label, or null when it carries none.
 *
 * Null covers both "states no strength" and "states a ratio": no single number
 * stands for "500/125", so a caller that needs one must abstain rather than
 * promote one component and call it the brand.
 */
export function brandStrength(brand: string): [number, string] | null {
  const items = brandStrengths(brand);
  return items.length === 1 ? items[0] : null;
}

/**
 * Molecules whose Indian brand labels state a bare trailing number in MCG.
 * A closed list, not a guess: reading "Thyronorm 50" as 50 mg is a 1000x error
 * on a narrow therapeutic index drug. Everything else takes the bare number
 * as mg. Mirror of `_MCG_BRAND_MOLECULES` in apps/api/app/safety/dosing.py.
 */
const MCG_BRAND_MOLECULES = new Set(["levothyroxine", "desmopressin", "calcitriol", "thyroxine sodium"]);

/**
 * Molecules whose Indian brand labels state a bare trailing number in IU: the
 * vitamin-D sachet class is sold as "60K" meaning 60 000 IU, and inheriting the
 * mg default asserted a 60 000 mg cholecalciferol dose against a formulary
 * entry that does not exist in those units. Mirror of `_IU_BRAND_MOLECULES`.
 */
const IU_BRAND_MOLECULES = new Set(["cholecalciferol", "colecalciferol", "ergocalciferol", "calcifediol"]);

/**
 * The strength a brand label itself states, unit included ("Cap. Folitrax 10"
 * -> "10 mg"). Used when the prescription line names no strength: without it,
 * neither the interval mandates nor the daily caps can screen the line.
 */
export function brandLabelStrength(brand: string, molecule?: string | null): string | null {
  const bs = brandStrength(brand);
  if (!bs) return null;
  const [value, unit] = bs;
  if (unit) return `${value} ${unit}`;
  const mol = (molecule ?? "").toLowerCase();
  return `${value} ${IU_BRAND_MOLECULES.has(mol) ? "iu" : MCG_BRAND_MOLECULES.has(mol) ? "mcg" : "mg"}`;
}

/** Case- and whitespace-folded name, NBSP included. Mirror of `_fold`. */
function fold(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/ /g, " ").trim().replace(/\s+/g, " ");
}

/** A drug name that ends in a bare number: "thyronorm 500". Mirror of `_CORE_NUMBER_RE`. */
const CORE_NUMBER_RE = /^(.*?[a-z])\s*(\d+(?:\.\d+)?)\s*$/i;

function coreAndNumber(text: string): [string, number] | null {
  const m = CORE_NUMBER_RE.exec(text);
  if (!m) return null;
  return [m[1].trim(), parseFloat(m[2])];
}

/**
 * The decade ratio between two numbers, or null. Ten and a hundred are the two
 * mis-read distances that matter — what a dropped or invented decimal point does
 * to a strength. A 2x difference is a different error class and is not claimed.
 */
function decadeApart(a: number, b: number): number | null {
  if (a <= 0 || b <= 0) return null;
  const ratio = a / b;
  for (const decade of [10, 100]) {
    if (Math.abs(ratio - decade) < 1e-9 || Math.abs(ratio - 1 / decade) < 1e-9) return decade;
  }
  return null;
}

/**
 * Flag a line whose own brand name is a decade away from the row it matched.
 *
 * "Tab Thyronorm 500" states no unit, the substring resolver answers with the
 * catalog row "Thyronorm 50", and the strength is then read from THAT row — so
 * the field comparison above sees a perfect agreement with a label the
 * prescription never wrote, and a thousandfold dose passes. The line's number is
 * anchored to the resolved brand core, not taken from the end of the line, since
 * a prescription line ends in a duration. Mirror of `brand_core_mismatch`.
 */
export function brandCoreMismatch(lineText: string | null, brand: string | null): string | null {
  if (!brand || !lineText) return null;
  const row = coreAndNumber(fold(brand));
  if (!row) return null;
  const [rowCore, rowNum] = row;
  const escaped = rowCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(escaped + "\\s*(\\d+(?:\\.\\d+)?)").exec(fold(lineText));
  if (!m) return null;
  const lineNum = parseFloat(m[1]);
  const decade = decadeApart(lineNum, rowNum);
  if (decade === null) return null;
  return (
    `names ${lineNum}, but the formulary entry for ${brand} is ${rowNum}` +
    ` — a ${decade}x difference in the brand name itself` +
    ". Same brand core, different strength: confirm which was prescribed."
  );
}
/**
 * Flag a line whose stated strength contradicts the formulary brand it resolved
 * to. Mirror of `strength_mismatch`.
 *
 * This is the look-alike / different-strength error class: "Thyronorm 50" and
 * "Thyronorm 500" share a brand core tenfold apart, and the substring resolver
 * matches either one. The mismatch itself is the uncertainty, so it belongs in
 * the confirm queue.
 *
 * lineText is the raw prescription line: the mis-read sometimes lives inside the
 * brand name and never reaches readStrength, because enrichment takes the
 * strength from the row that was matched.
 *
 * Returns a sentence when they disagree, null when either side is unstated or
 * the units are not comparable.
 */
export function strengthMismatch(
  readStrength: string,
  brand: string | null,
  lineText?: string | null
): string | null {
  if (!brand) return null;
  const core = brandCoreMismatch(lineText ?? null, brand);
  if (core) return core;
  const read = parseStrength(readStrength);
  if (!read) return null;
  const items = brandStrengths(brand);
  if (items.length === 0) return null;

  const lineUnit = read.unit;
  const lineCanon = read.mg ?? read.value;
  const canonIsIu = lineUnit === "iu";

  const candidates: number[] = [];
  for (const [bValueRaw, bUnit] of items) {
    if (bValueRaw <= 0) continue;
    if (!bUnit) {
      // Unit-less brand number ("Dolo 650", "Thyronorm 50") inherits the line's
      // unit — which is how the label is read in practice.
      candidates.push(canonIsIu ? bValueRaw : bValueRaw * (UNIT_TO_MG[lineUnit] ?? 1));
    } else if ((bUnit === "iu") !== canonIsIu) {
      continue; // IU vs mass: not comparable
    } else if (bUnit === "iu") {
      candidates.push(bValueRaw);
    } else {
      const factor = UNIT_TO_MG[bUnit];
      if (factor !== undefined) candidates.push(bValueRaw * factor);
    }
  }
  if (candidates.length === 0) return null;

  // Any component matching the line means the prescription is legible: for a
  // "500/125" label, a "500 mg" line names the amoxicillin half and is right.
  if (candidates.some((c) => Math.abs(lineCanon - c) < 1e-9)) return null;
  const closest = candidates.reduce(
    (best, c) => (Math.abs(c - lineCanon) < Math.abs(best - lineCanon) ? c : best),
    candidates[0]
  );
  const ratio = Math.min(lineCanon, closest) > 0
    ? Math.max(lineCanon, closest) / Math.min(lineCanon, closest)
    : 0;
  const stated = items.map(([v]) => v).join("/") + (items[0][1] ? ` ${items[0][1]}` : "");
  return (
    `states ${read.value} ${lineUnit}, but the formulary entry for ${brand} is ` +
    `${stated}` +
    (ratio ? ` — a ${Math.round(ratio * 100) / 100}x difference` : "") +
    ". Same brand core, different strength: confirm which was prescribed."
  );
}
