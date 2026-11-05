/**
 * Vaidya — the safety tables, and what the product is allowed to ask about.
 *
 * The three rule tables and the graph-rule groups are GENERATED, not curated
 * here: they are the whole of data/brands.csv, data/interactions.csv and
 * data/contraindications.csv, compiled by tools/build_web_dataset.py into
 * ./tables.generated.ts with the API tier's own key rules (fold the brand cell,
 * keep combination granularity, copy severity verbatim). See that file's header
 * for the law and the numbers.
 *
 * What the curated extract cost: the product tier could name 86 molecules and
 * address 865 of 9 660 documented interaction rows, while the API tier decided
 * over 583 and 9 290. Parity never noticed, because the shared corpus only names
 * brands the small copy happened to hold — which is the definition of a test that
 * pins the wrong thing.
 *
 * What is still hand-maintained here, on purpose:
 *  - SNAPSHOT: the tag every verdict carries. It is the API tier's tag, because
 *    both tiers now read the same rows.
 *  - CONTEXT_CODES: the conditions the product collects from a patient. The
 *    codes are the contracts vocabulary (`medisaathi_contracts.CONTEXT_CODES`)
 *    and apps/api/tests/test_dose_caps.py fails if a contraindication row names
 *    a code outside it; the labels are UI text, so they stay here.
 *
 * Provenance of the rows themselves is in the CSVs' `source` column, carried
 * into the generated table and reported by /api/evidence — including the rows
 * whose mechanism was authored from the DDInter coverage pattern rather than
 * copied from a DDInter pair page (CC BY-NC-SA 4.0: non-commercial).
 */

export {
  BRANDS,
  CONTRAINDICATIONS,
  INTERACTIONS,
  MOLECULE_GROUPS,
  type BrandRow,
  type ContraindicationRow,
  type InteractionRow,
} from "./tables.generated";

export const SNAPSHOT = "2026-09";

export const CONTEXT_CODES: { code: string; label: string }[] = [
  { code: "pregnancy", label: "Pregnant" },
  { code: "lactation", label: "Breastfeeding" },
  { code: "age_under_2", label: "Child under 2" },
  { code: "age_under_4", label: "Child under 4" },
  { code: "age_under_12", label: "Child under 12" },
  { code: "age_under_16", label: "Child under 16" },
  { code: "age_under_18", label: "Child under 18" },
  { code: "age_over_65", label: "Adult over 65" },
  { code: "peptic_ulcer", label: "Peptic ulcer" },
  { code: "renal_severe", label: "Severe kidney disease" },
  { code: "renal_moderate", label: "Moderate kidney disease" },
  { code: "hepatic_severe", label: "Severe liver disease" },
  { code: "hepatic_moderate", label: "Moderate liver disease" },
  { code: "asthma_aspirin_sensitive", label: "Aspirin-sensitive asthma" },
  { code: "myasthenia_gravis", label: "Myasthenia gravis" },
  { code: "hyperkalemia", label: "High potassium" },
  { code: "hypokalemia", label: "Low potassium" },
  { code: "active_bleeding", label: "Active bleeding" },
  { code: "heart_failure", label: "Heart failure" },
  { code: "hf_refduced", label: "Heart failure (reduced EF)" },
  { code: "heart_block", label: "Heart block" },
  { code: "epilepsy", label: "Epilepsy" },
  { code: "gout", label: "Gout" },
  { code: "glaucoma", label: "Glaucoma" },
  { code: "bph", label: "Enlarged prostate (BPH)" },
  { code: "bradycardia", label: "Slow heartbeat" },
  { code: "diabetes", label: "Diabetes" },
  { code: "thyroid_disease", label: "Thyroid disease" },
  { code: "osteoporosis", label: "Osteoporosis" },
  { code: "porphyria", label: "Porphyria" },
  { code: "g6pd_deficiency", label: "G6PD deficiency" },
  { code: "glucose_6_pd_deficiency", label: "G6PD deficiency (alias)" },
  { code: "long_qt_history", label: "Long QT history" },
  { code: "qt_prolongation_history", label: "QT prolongation history" },
  { code: "alcohol", label: "Alcohol use" },
  { code: "alcohol_use_disorder", label: "Alcohol use disorder" },
  { code: "grapefruit", label: "Grapefruit interaction risk" },
  { code: "hypothyroid_uncontrolled", label: "Uncontrolled hypothyroidism" },
  { code: "hypoglycemia_unaware", label: "Hypoglycemia unawareness" },
  { code: "hypersensitivity", label: "Drug hypersensitivity" },
  { code: "diabetes_insipidus", label: "Diabetes insipidus" },
  { code: "pheochromocytoma", label: "Pheochromocytoma" },
  { code: "iodinated_contrast_48h", label: "Contrast scan within 48h" },
];
