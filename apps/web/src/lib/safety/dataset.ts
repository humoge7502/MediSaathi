/**
 * Vaidya — curated seed dataset (snapshot 2026-09, "vm3").
 *
 * Provenance & honesty:
 *  - Brand → molecule map: Jan Aushadhi price list + Indian market brands
 *    (ported from MediSaathi seed, extended). Prices in INR per unit (approx).
 *  - Interaction pairs: textbook-level, widely documented interactions,
 *    ported from MediSaathi's DDInter-derived seed and extended with
 *    well-established pairs only. NO fabricated entries.
 *  - Contraindication rules: standard public-health guidance.
 *  - Production replaces this with versioned snapshots of DDInter / RxNorm /
 *    DailyMed with full citation chains (see docs/BLUEPRINT.md §Research).
 *
 * This file is data, not logic. The engine never "knows" a drug; it only
 * consults these tables. Snapshot tag is embedded in every verdict.
 */

export interface BrandRow {
  brand: string;
  molecule: string; // may be combination "a+b"
  form: string;
  atc: string;
  aware: "Access" | "Watch" | "Reserve" | "-";
  priceInr: number;
}

export interface InteractionRow {
  a: string;
  b: string;
  severity: "mild" | "moderate" | "severe";
  mechanism: string;
  source: string;
}

export interface ContraindicationRow {
  molecule: string;
  condition: string; // context code
  severity: "absolute" | "relative";
  note: string;
}

export const SNAPSHOT = "2026-09-vm3";

export const CONTEXT_CODES: { code: string; label: string }[] = [
  { code: "pregnancy", label: "Pregnant" },
  { code: "age_under_12", label: "Child under 12" },
  { code: "age_under_16", label: "Child under 16" },
  { code: "age_under_18", label: "Child under 18" },
  { code: "peptic_ulcer", label: "Peptic ulcer" },
  { code: "renal_severe", label: "Severe kidney disease" },
  { code: "hepatic_severe", label: "Severe liver disease" },
  { code: "asthma_aspirin_sensitive", label: "Aspirin-sensitive asthma" },
  { code: "myasthenia_gravis", label: "Myasthenia gravis" },
  { code: "hyperkalemia", label: "High potassium" },
  { code: "active_bleeding", label: "Active bleeding" },
  { code: "heart_failure", label: "Heart failure" },
  { code: "epilepsy", label: "Epilepsy" },
  { code: "gout", label: "Gout" },
];

export const BRANDS: BrandRow[] = [
  { brand: "Dolo 650", molecule: "paracetamol", form: "tablet", atc: "N02BE01", aware: "Access", priceInr: 1.2 },
  { brand: "Crocin Advance", molecule: "paracetamol", form: "tablet", atc: "N02BE01", aware: "Access", priceInr: 1.2 },
  { brand: "Calpol", molecule: "paracetamol", form: "syrup", atc: "N02BE01", aware: "Access", priceInr: 2.1 },
  { brand: "Combiflam", molecule: "paracetamol+ibuprofen", form: "tablet", atc: "N02BE01+M01AE01", aware: "Access", priceInr: 3.4 },
  { brand: "Brufen 400", molecule: "ibuprofen", form: "tablet", atc: "M01AE01", aware: "Access", priceInr: 1.6 },
  { brand: "Voveran 50", molecule: "diclofenac", form: "tablet", atc: "M01AB01", aware: "Access", priceInr: 2.3 },
  { brand: "Zerodol P", molecule: "aceclofenac+paracetamol", form: "tablet", atc: "M01AB16+N02BE01", aware: "Access", priceInr: 3.8 },
  { brand: "Naprosyn", molecule: "naproxen", form: "tablet", atc: "M01AE02", aware: "Access", priceInr: 4.1 },
  { brand: "Aspirin 75", molecule: "aspirin", form: "tablet", atc: "B01AC06", aware: "Access", priceInr: 0.6 },
  { brand: "Ecosprin 75", molecule: "aspirin", form: "tablet", atc: "B01AC06", aware: "Access", priceInr: 0.6 },
  { brand: "Ecospirin AV 75", molecule: "aspirin+atorvastatin", form: "capsule", atc: "B01AC06+C10AA05", aware: "Access", priceInr: 4.2 },
  { brand: "Augmentin 625", molecule: "amoxicillin+clavulanic acid", form: "tablet", atc: "J01CR02", aware: "Access", priceInr: 12.4 },
  { brand: "Mox 500", molecule: "amoxicillin", form: "capsule", atc: "J01CA04", aware: "Access", priceInr: 3.2 },
  { brand: "Azithral 500", molecule: "azithromycin", form: "tablet", atc: "J01FA10", aware: "Watch", priceInr: 8.9 },
  { brand: "Ciplox 500", molecule: "ciprofloxacin", form: "tablet", atc: "J01MA02", aware: "Watch", priceInr: 3.1 },
  { brand: "Levoflox 500", molecule: "levofloxacin", form: "tablet", atc: "J01MA12", aware: "Watch", priceInr: 6.2 },
  { brand: "Ofloxacin 200", molecule: "ofloxacin", form: "tablet", atc: "J01MA01", aware: "Watch", priceInr: 3.4 },
  { brand: "Taxim-O 200", molecule: "cefixime", form: "tablet", atc: "J01DD08", aware: "Watch", priceInr: 7.8 },
  { brand: "Doxy-1", molecule: "doxycycline", form: "capsule", atc: "J01AA02", aware: "Access", priceInr: 1.9 },
  { brand: "Flagyl 400", molecule: "metronidazole", form: "tablet", atc: "J01XD01", aware: "Access", priceInr: 1.5 },
  { brand: "O2 500", molecule: "ornidazole+ofloxacin", form: "tablet", atc: "J01XD01+J01MA01", aware: "Watch", priceInr: 8.2 },
  { brand: "Glycomet 500", molecule: "metformin", form: "tablet", atc: "A10BA02", aware: "Access", priceInr: 1.1 },
  { brand: "Glimep 2", molecule: "glimepiride", form: "tablet", atc: "A10BB12", aware: "Access", priceInr: 2.4 },
  { brand: "Gliclazide 60", molecule: "gliclazide", form: "tablet", atc: "A10BB09", aware: "Access", priceInr: 3.3 },
  { brand: "Januvia 50", molecule: "sitagliptin", form: "tablet", atc: "A10BH01", aware: "Access", priceInr: 21.6 },
  { brand: "Lantus SoloStar", molecule: "insulin glargine", form: "pen", atc: "A10AE04", aware: "Access", priceInr: 310 },
  { brand: "Storvas 20", molecule: "atorvastatin", form: "tablet", atc: "C10AA05", aware: "Access", priceInr: 2.9 },
  { brand: "Rozavel 10", molecule: "rosuvastatin", form: "tablet", atc: "C10AA07", aware: "Access", priceInr: 4.6 },
  { brand: "Simvotin 20", molecule: "simvastatin", form: "tablet", atc: "C10AA01", aware: "Access", priceInr: 2.8 },
  { brand: "Fenlor-XL", molecule: "fenofibrate", form: "tablet", atc: "C10AB05", aware: "Access", priceInr: 3.1 },
  { brand: "Amlong 5", molecule: "amlodipine", form: "tablet", atc: "C08CA01", aware: "Access", priceInr: 1.0 },
  { brand: "Losar 50", molecule: "losartan", form: "tablet", atc: "C09CA01", aware: "Access", priceInr: 2.2 },
  { brand: "Telma 40", molecule: "telmisartan", form: "tablet", atc: "C09CA07", aware: "Access", priceInr: 3.0 },
  { brand: "Envas 5", molecule: "enalapril", form: "tablet", atc: "C09AA02", aware: "Access", priceInr: 1.4 },
  { brand: "Ramistar 5", molecule: "ramipril", form: "tablet", atc: "C09AA05", aware: "Access", priceInr: 1.7 },
  { brand: "Lisinopril 10", molecule: "lisinopril", form: "tablet", atc: "C09AA03", aware: "Access", priceInr: 1.3 },
  { brand: "Lasix 40", molecule: "furosemide", form: "tablet", atc: "C03CA01", aware: "Access", priceInr: 0.9 },
  { brand: "Aldactone 25", molecule: "spironolactone", form: "tablet", atc: "C03DA01", aware: "Access", priceInr: 2.6 },
  { brand: "Dytor 10", molecule: "torasemide", form: "tablet", atc: "C03CA04", aware: "Access", priceInr: 3.2 },
  // E-E drift fix: the source-of-truth CSV maps Hydroquin 200 to
  // hydroxychloroquine (P01BA02). The TS plane had it as hydrochlorothiazide,
  // so a hydroxychloroquine QT/pairwise rule silently did not fire here.
  { brand: "Hydroquin 200", molecule: "hydroxychloroquine", form: "tablet", atc: "P01BA02", aware: "Access", priceInr: 3.9 },
  { brand: "Aten 50", molecule: "atenolol", form: "tablet", atc: "C07AB03", aware: "Access", priceInr: 0.8 },
  { brand: "Metolar 25", molecule: "metoprolol", form: "tablet", atc: "C07AB02", aware: "Access", priceInr: 1.3 },
  { brand: "Concor 5", molecule: "bisoprolol", form: "tablet", atc: "C07AB07", aware: "Access", priceInr: 3.4 },
  { brand: "Clopilet 75", molecule: "clopidogrel", form: "tablet", atc: "B01AC04", aware: "Access", priceInr: 3.9 },
  { brand: "Deplatt 75", molecule: "clopidogrel", form: "tablet", atc: "B01AC04", aware: "Access", priceInr: 3.9 },
  { brand: "Warf 5", molecule: "warfarin", form: "tablet", atc: "B01AA03", aware: "Access", priceInr: 2.1 },
  { brand: "Pan 40", molecule: "pantoprazole", form: "tablet", atc: "A02BC02", aware: "Access", priceInr: 2.7 },
  { brand: "Omez 20", molecule: "omeprazole", form: "capsule", atc: "A02BC01", aware: "Access", priceInr: 1.9 },
  { brand: "Rantac 150", molecule: "ranitidine", form: "tablet", atc: "A02BA02", aware: "Access", priceInr: 0.7 },
  { brand: "Cetzine 10", molecule: "cetirizine", form: "tablet", atc: "R06AE07", aware: "Access", priceInr: 0.8 },
  { brand: "Teczine 5", molecule: "levocetirizine", form: "tablet", atc: "R06AE09", aware: "Access", priceInr: 0.9 },
  { brand: "Montair LC", molecule: "montelukast+levocetirizine", form: "tablet", atc: "R03DC03+R06AE09", aware: "Access", priceInr: 6.1 },
  { brand: "Asthalin Inhaler", molecule: "salbutamol", form: "inhaler", atc: "R03AC02", aware: "Access", priceInr: 98 },
  { brand: "Wysolone 10", molecule: "prednisolone", form: "tablet", atc: "H02AB06", aware: "Access", priceInr: 1.6 },
  { brand: "Decadron", molecule: "dexamethasone", form: "tablet", atc: "H02AB02", aware: "Access", priceInr: 1.2 },
  { brand: "Thyronorm 50", molecule: "levothyroxine", form: "tablet", atc: "H03AA01", aware: "Access", priceInr: 1.8 },
  { brand: "Neomercazole 5", molecule: "carbimazole", form: "tablet", atc: "H03BB01", aware: "Access", priceInr: 1.4 },
  { brand: "Albenza", molecule: "albendazole", form: "tablet", atc: "P02CA03", aware: "Access", priceInr: 3.6 },
  { brand: "Nervup PG", molecule: "pregabalin+methylcobalamin", form: "capsule", atc: "N03AX16+B03BA", aware: "Access", priceInr: 7.2 },
  { brand: "Lyrica 75", molecule: "pregabalin", form: "capsule", atc: "N03AX16", aware: "Access", priceInr: 8.1 },
  { brand: "Zolfresh 5", molecule: "zolpidem", form: "tablet", atc: "N05CF02", aware: "Access", priceInr: 4.9 },
  { brand: "Tramazac 50", molecule: "tramadol", form: "capsule", atc: "N02AX02", aware: "Access", priceInr: 3.8 },
  { brand: "Udiliv 300", molecule: "ursodeoxycholic acid", form: "tablet", atc: "A05AA02", aware: "Access", priceInr: 9.3 },
  { brand: "Mesacol 400", molecule: "mesalamine", form: "tablet", atc: "A07EC02", aware: "Access", priceInr: 11.2 },
  { brand: "Folitrax 10", molecule: "methotrexate", form: "tablet", atc: "L01BA01", aware: "Access", priceInr: 5.4 },
  { brand: "Eptoin 100", molecule: "phenytoin", form: "tablet", atc: "N03AB02", aware: "Access", priceInr: 1.1 },
  { brand: "Tegrital 200", molecule: "carbamazepine", form: "tablet", atc: "N03AF01", aware: "Access", priceInr: 2.3 },
  { brand: "Levipil 500", molecule: "levetiracetam", form: "tablet", atc: "N03AX14", aware: "Access", priceInr: 6.8 },
  { brand: "Digoxin 0.25", molecule: "digoxin", form: "tablet", atc: "C01AA05", aware: "Access", priceInr: 0.7 },
  { brand: "Theophylline 200", molecule: "theophylline", form: "tablet", atc: "R03DA04", aware: "Access", priceInr: 1.6 },
  { brand: "Ondavell 4", molecule: "ondansetron", form: "tablet", atc: "A04AA01", aware: "Access", priceInr: 4.5 },
  { brand: "Citalopram 20", molecule: "citalopram", form: "tablet", atc: "N06AB04", aware: "Access", priceInr: 3.2 },
  { brand: "Sertraline 50", molecule: "sertraline", form: "tablet", atc: "N06AB06", aware: "Access", priceInr: 4.1 },
  { brand: "Fludac 20", molecule: "fluoxetine", form: "capsule", atc: "N06AB03", aware: "Access", priceInr: 3.4 },
  { brand: "Alprax 0.5", molecule: "alprazolam", form: "tablet", atc: "N05BA12", aware: "Access", priceInr: 1.9 },
  { brand: "Rivotril 2", molecule: "clonazepam", form: "tablet", atc: "N03AE01", aware: "Access", priceInr: 2.1 },
  { brand: "Simvotin 20mg", molecule: "simvastatin", form: "tablet", atc: "C10AA01", aware: "Access", priceInr: 2.8 },
  { brand: "Claribid 500", molecule: "clarithromycin", form: "tablet", atc: "J01FA09", aware: "Access", priceInr: 9.1 },
  { brand: "HCQS 200", molecule: "hydroxychloroquine", form: "tablet", atc: "P01BA02", aware: "Access", priceInr: 3.9 },
  { brand: "Potassium Chloride SR", molecule: "potassium chloride", form: "tablet", atc: "B05XA01", aware: "Access", priceInr: 2.4 },
  { brand: "Tizan 2", molecule: "tizanidine", form: "tablet", atc: "M03BX02", aware: "Access", priceInr: 2.2 },
  { brand: "Shellcal 500", molecule: "calcium carbonate", form: "tablet", atc: "A12AA04", aware: "Access", priceInr: 1.1 },
  { brand: "Codicough", molecule: "codeine", form: "syrup", atc: "R05DA04", aware: "Access", priceInr: 3.1 },
  { brand: "Amlopres AT", molecule: "amlodipine+atenolol", form: "tablet", atc: "C08CA01+C07AB03", aware: "Access", priceInr: 2.1 },
  { brand: "Cordarone 200", molecule: "amiodarone", form: "tablet", atc: "C01BD01", aware: "Watch", priceInr: 5.8 },
  { brand: "Sorbitrate 5", molecule: "isosorbide dinitrate", form: "tablet", atc: "C01DA08", aware: "Access", priceInr: 0.9 },
  { brand: "Manforce 50", molecule: "sildenafil", form: "tablet", atc: "G04BE03", aware: "Access", priceInr: 12.0 },
  { brand: "Suminat 50", molecule: "sumatriptan", form: "tablet", atc: "N02CC01", aware: "Access", priceInr: 14.0 },
  { brand: "Lithosun 300", molecule: "lithium carbonate", form: "tablet", atc: "N05AN01", aware: "Watch", priceInr: 3.6 },
  { brand: "Fefol", molecule: "ferrous sulfate", form: "capsule", atc: "B03AA07", aware: "Access", priceInr: 2.8 },
  { brand: "Forcan 150", molecule: "fluconazole", form: "tablet", atc: "J02AC01", aware: "Watch", priceInr: 6.4 },
  { brand: "Lopid 600", molecule: "gemfibrozil", form: "tablet", atc: "C10AB04", aware: "Access", priceInr: 5.2 },
  { brand: "Zofran ODT", molecule: "ondansetron", form: "tablet", atc: "A04AA01", aware: "Access", priceInr: 5.1 },
  { brand: "Amitone 10", molecule: "amitriptyline", form: "tablet", atc: "N06AA09", aware: "Access", priceInr: 1.4 },
  { brand: "Warfone 5", molecule: "warfarin", form: "tablet", atc: "B01AA03", aware: "Watch", priceInr: 1.1 },
  { brand: "Cotrimoxazole DS", molecule: "cotrimoxazole", form: "tablet", atc: "J01EE01", aware: "Watch", priceInr: 1.8 },
  // --- parity drift fix (E-E): these three rows exist in data/brands.csv (the
  // Python plane's formulary) but were missing here, so the TS plane queued
  // reads the Python plane resolved (Zental/albendazole double-dosing,
  // Hydroquin/hydroxychloroquine QT, Digoxin Tab). One law, one dataset.
  { brand: "Zental", molecule: "albendazole", form: "chewable", atc: "P02CA03", aware: "Access", priceInr: 3.6 },
  { brand: "Monocef 1g", molecule: "ceftriaxone", form: "injection", atc: "J01DD04", aware: "Watch", priceInr: 28.5 },
  { brand: "Digoxin Tab", molecule: "digoxin", form: "tablet", atc: "C01AA05", aware: "Access", priceInr: 0.7 },
];

export const INTERACTIONS: InteractionRow[] = [
  // --- warfarin cluster (anticoagulation) ---
  { a: "warfarin", b: "aspirin", severity: "severe", mechanism: "Additive anticoagulant and antiplatelet effect; major bleeding risk", source: "DDInter" },
  { a: "warfarin", b: "ibuprofen", severity: "severe", mechanism: "NSAID antiplatelet effect plus GI mucosal injury; bleeding risk", source: "DDInter" },
  { a: "warfarin", b: "diclofenac", severity: "severe", mechanism: "NSAID-anticoagulant interaction; GI bleeding risk", source: "DDInter" },
  { a: "warfarin", b: "naproxen", severity: "severe", mechanism: "NSAID-anticoagulant interaction; bleeding risk", source: "DDInter" },
  { a: "warfarin", b: "amoxicillin", severity: "moderate", mechanism: "Antibiotic gut-flora disruption reduces vitamin K synthesis; INR rise", source: "DDInter" },
  { a: "warfarin", b: "doxycycline", severity: "moderate", mechanism: "Antibiotic potentiation of warfarin effect; INR rise", source: "DDInter" },
  { a: "warfarin", b: "metronidazole", severity: "severe", mechanism: "CYP2C9 inhibition raises warfarin exposure", source: "DDInter" },
  { a: "warfarin", b: "levofloxacin", severity: "moderate", mechanism: "Fluoroquinolone potentiation of warfarin effect; INR rise", source: "DDInter" },
  { a: "warfarin", b: "paracetamol", severity: "moderate", mechanism: "Sustained high-dose paracetamol can raise INR", source: "DDInter" },
  { a: "warfarin", b: "amiodarone", severity: "severe", mechanism: "CYP2C9/CYP3A4 inhibition raises warfarin exposure; INR rise", source: "Stockley" },
  { a: "warfarin", b: "ciprofloxacin", severity: "moderate", mechanism: "Fluoroquinolone potentiation of warfarin effect; INR rise", source: "Stockley" },
  // --- antiplatelets ---
  { a: "clopidogrel", b: "omeprazole", severity: "moderate", mechanism: "CYP2C19 inhibition reduces clopidogrel activation", source: "DDInter" },
  { a: "clopidogrel", b: "aspirin", severity: "moderate", mechanism: "Additive antiplatelet effect; bleeding risk (often intentional in ACS)", source: "DDInter" },
  { a: "aspirin", b: "ibuprofen", severity: "moderate", mechanism: "NSAID competes for platelet COX-1; reduces aspirin cardioprotection", source: "DDInter" },
  { a: "aspirin", b: "diclofenac", severity: "moderate", mechanism: "Additive GI toxicity and platelet effect", source: "DDInter" },
  // --- RAAS blockers ---
  { a: "ibuprofen", b: "lisinopril", severity: "moderate", mechanism: "NSAID blunts ACE-inhibitor effect; renal risk", source: "DDInter" },
  { a: "ibuprofen", b: "enalapril", severity: "moderate", mechanism: "NSAID-ACEi interaction; reduced antihypertensive effect", source: "DDInter" },
  { a: "ibuprofen", b: "ramipril", severity: "moderate", mechanism: "NSAID-ACEi interaction; renal risk", source: "DDInter" },
  { a: "diclofenac", b: "losartan", severity: "moderate", mechanism: "NSAID reduces angiotensin-blocker efficacy; renal risk", source: "DDInter" },
  { a: "diclofenac", b: "telmisartan", severity: "moderate", mechanism: "NSAID-ARB interaction; renal and BP effects", source: "DDInter" },
  { a: "diclofenac", b: "enalapril", severity: "moderate", mechanism: "NSAID-ACEi interaction; renal risk", source: "DDInter" },
  { a: "aspirin", b: "enalapril", severity: "moderate", mechanism: "NSAID may blunt ACE-inhibitor effect in heart failure", source: "Stockley" },
  { a: "enalapril", b: "spironolactone", severity: "severe", mechanism: "Additive hyperkalemia risk (ACEi + K-sparing diuretic)", source: "DDInter" },
  { a: "ramipril", b: "spironolactone", severity: "severe", mechanism: "Additive hyperkalemia risk", source: "DDInter" },
  { a: "losartan", b: "spironolactone", severity: "moderate", mechanism: "RAAS blocker + K-sparing diuretic; monitor potassium", source: "DDInter" },
  { a: "telmisartan", b: "spironolactone", severity: "moderate", mechanism: "Additive hyperkalemia risk", source: "DDInter" },
  { a: "lisinopril", b: "potassium chloride", severity: "severe", mechanism: "Additive hyperkalemia", source: "DDInter" },
  { a: "ramipril", b: "potassium chloride", severity: "severe", mechanism: "Additive hyperkalemia", source: "DDInter" },
  { a: "telmisartan", b: "potassium chloride", severity: "severe", mechanism: "Additive hyperkalemia", source: "DDInter" },
  { a: "losartan", b: "potassium chloride", severity: "severe", mechanism: "Additive hyperkalemia", source: "DDInter" },
  { a: "spironolactone", b: "potassium chloride", severity: "severe", mechanism: "Potent additive hyperkalemia; contraindicated combination", source: "DDInter" },
  // --- digoxin ---
  { a: "furosemide", b: "digoxin", severity: "moderate", mechanism: "Diuretic hypokalemia predisposes to digoxin toxicity", source: "DDInter" },
  { a: "hydrochlorothiazide", b: "digoxin", severity: "moderate", mechanism: "Thiazide hypokalemia predisposes to digoxin toxicity", source: "Stockley" },
  { a: "digoxin", b: "amiodarone", severity: "severe", mechanism: "Amiodarone reduces digoxin clearance; toxicity risk", source: "Stockley" },
  { a: "digoxin", b: "clarithromycin", severity: "moderate", mechanism: "P-glycoprotein inhibition raises digoxin levels", source: "Stockley" },
  { a: "digoxin", b: "spironolactone", severity: "moderate", mechanism: "Spironolactone raises digoxin levels; monitor", source: "Stockley" },
  // --- antibiotics & QT ---
  { a: "ciprofloxacin", b: "theophylline", severity: "severe", mechanism: "CYP1A2 inhibition raises theophylline to toxic levels", source: "DDInter" },
  { a: "ciprofloxacin", b: "tizanidine", severity: "severe", mechanism: "CYP1A2 inhibition; contraindicated with tizanidine", source: "DDInter" },
  { a: "ciprofloxacin", b: "caffeine", severity: "moderate", mechanism: "Reduced caffeine clearance; jitteriness, insomnia", source: "DDInter" },
  { a: "ciprofloxacin", b: "calcium carbonate", severity: "moderate", mechanism: "Chelation reduces fluoroquinolone absorption; separate dosing", source: "DDInter" },
  { a: "levofloxacin", b: "calcium carbonate", severity: "moderate", mechanism: "Chelation reduces absorption; separate dosing", source: "DDInter" },
  { a: "azithromycin", b: "hydroxychloroquine", severity: "moderate", mechanism: "Additive QT prolongation", source: "DDInter" },
  { a: "ofloxacin", b: "ondansetron", severity: "moderate", mechanism: "Additive QT prolongation", source: "DDInter" },
  { a: "ciprofloxacin", b: "ondansetron", severity: "moderate", mechanism: "Additive QT prolongation", source: "CredibleMeds" },
  { a: "levofloxacin", b: "ondansetron", severity: "moderate", mechanism: "Additive QT prolongation", source: "CredibleMeds" },
  { a: "azithromycin", b: "ondansetron", severity: "moderate", mechanism: "Additive QT prolongation", source: "CredibleMeds" },
  { a: "ondansetron", b: "citalopram", severity: "moderate", mechanism: "Additive QT prolongation", source: "DDInter" },
  { a: "clarithromycin", b: "simvastatin", severity: "severe", mechanism: "CYP3A4 inhibition raises statin levels; rhabdomyolysis risk", source: "DDInter" },
  { a: "clarithromycin", b: "atorvastatin", severity: "moderate", mechanism: "CYP3A4 inhibition raises statin exposure", source: "DDInter" },
  { a: "clarithromycin", b: "theophylline", severity: "moderate", mechanism: "CYP3A4 inhibition raises theophylline exposure", source: "Stockley" },
  // --- metronidazole / alcohol ---
  { a: "metronidazole", b: "alcohol", severity: "moderate", mechanism: "Disulfiram-like reaction: flushing, vomiting, tachycardia", source: "DDInter" },
  { a: "metformin", b: "alcohol", severity: "moderate", mechanism: "Increased lactic acidosis risk", source: "DDInter" },
  // --- CNS ---
  { a: "alprazolam", b: "tramadol", severity: "severe", mechanism: "Additive CNS and respiratory depression", source: "DDInter" },
  { a: "clonazepam", b: "tramadol", severity: "severe", mechanism: "Additive CNS depression; sedation and respiratory risk", source: "DDInter" },
  { a: "sertraline", b: "tramadol", severity: "moderate", mechanism: "Serotonin syndrome risk and bleeding tendency", source: "DDInter" },
  { a: "fluoxetine", b: "tramadol", severity: "moderate", mechanism: "Serotonin syndrome risk", source: "DDInter" },
  { a: "amitriptyline", b: "tramadol", severity: "severe", mechanism: "Serotonin syndrome and seizure threshold risk", source: "Stockley" },
  { a: "amitriptyline", b: "fluoxetine", severity: "moderate", mechanism: "CYP2D6 inhibition raises TCA levels; cardiac risk", source: "Stockley" },
  { a: "sertraline", b: "sumatriptan", severity: "severe", mechanism: "Serotonin syndrome risk (SSRI + triptan)", source: "FDA" },
  { a: "fluoxetine", b: "sumatriptan", severity: "severe", mechanism: "Serotonin syndrome risk (SSRI + triptan)", source: "FDA" },
  { a: "sertraline", b: "aspirin", severity: "moderate", mechanism: "SSRI impairs platelet function; GI bleeding risk", source: "BMJ" },
  { a: "sertraline", b: "ibuprofen", severity: "moderate", mechanism: "SSRI + NSAID additive GI bleeding risk", source: "BMJ" },
  { a: "fluoxetine", b: "aspirin", severity: "moderate", mechanism: "SSRI impairs platelet function; GI bleeding risk", source: "BMJ" },
  { a: "lithium carbonate", b: "ibuprofen", severity: "severe", mechanism: "NSAID reduces lithium clearance; toxicity risk", source: "Stockley" },
  { a: "lithium carbonate", b: "lisinopril", severity: "moderate", mechanism: "ACEi raises lithium levels; monitor", source: "Stockley" },
  { a: "lithium carbonate", b: "hydrochlorothiazide", severity: "severe", mechanism: "Thiazide raises lithium levels; toxicity risk", source: "Stockley" },
  // --- statins & lipids ---
  { a: "simvastatin", b: "amlodipine", severity: "moderate", mechanism: "Simvastatin dose cap 20mg/day with amlodipine", source: "FDA" },
  { a: "simvastatin", b: "amiodarone", severity: "moderate", mechanism: "Simvastatin dose cap 20mg/day with amiodarone", source: "FDA" },
  { a: "gemfibrozil", b: "simvastatin", severity: "severe", mechanism: "Additive myopathy/rhabdomyolysis risk; combination not recommended", source: "FDA" },
  { a: "gemfibrozil", b: "atorvastatin", severity: "moderate", mechanism: "Additive myopathy risk", source: "FDA" },
  // --- diabetes ---
  { a: "glimepiride", b: "fluconazole", severity: "severe", mechanism: "CYP2C9 inhibition raises sulfonylurea levels; hypoglycemia", source: "Stockley" },
  // --- absorption / chelation ---
  { a: "methotrexate", b: "aspirin", severity: "severe", mechanism: "Salicylates reduce methotrexate clearance; toxicity", source: "DDInter" },
  { a: "methotrexate", b: "ibuprofen", severity: "severe", mechanism: "NSAID reduces renal methotrexate clearance", source: "DDInter" },
  { a: "methotrexate", b: "cotrimoxazole", severity: "severe", mechanism: "Antifolate synergy; severe myelosuppression risk", source: "Stockley" },
  // Added for cross-tier parity (ADR-0012): pairs that existed only in the API corpus
  { a: "warfarin", b: "cotrimoxazole", severity: "severe", mechanism: "CYP2C9 inhibition plus protein binding displacement", source: "DDInter" },
  { a: "metformin", b: "furosemide", severity: "moderate", mechanism: "Diuretic may affect renal function and lactate clearance", source: "DDInter" },
  { a: "levothyroxine", b: "calcium carbonate", severity: "moderate", mechanism: "Chelation impairs levothyroxine absorption; separate by 4h", source: "DDInter" },
  { a: "levothyroxine", b: "omeprazole", severity: "moderate", mechanism: "Reduced gastric acidity impairs levothyroxine absorption", source: "DDInter" },
  { a: "levothyroxine", b: "ferrous sulfate", severity: "moderate", mechanism: "Chelation impairs levothyroxine absorption; separate by 4h", source: "Stockley" },
  { a: "levofloxacin", b: "omeprazole", severity: "moderate", mechanism: "Possible QT-pharmacodynamic interaction; monitor in high-risk patients", source: "DDInter" },
  // --- nitrates ---
  { a: "sildenafil", b: "isosorbide dinitrate", severity: "severe", mechanism: "Profound hypotension; nitrate + PDE5 inhibitor is contraindicated", source: "FDA" },
];

export const CONTRAINDICATIONS: ContraindicationRow[] = [
  { molecule: "warfarin", condition: "pregnancy", severity: "absolute", note: "Teratogenic; use heparin-class alternatives" },
  { molecule: "warfarin", condition: "active_bleeding", severity: "absolute", note: "Contraindicated during active hemorrhage" },
  { molecule: "warfarin", condition: "peptic_ulcer", severity: "absolute", note: "Bleeding risk in ulcerated GI mucosa" },
  { molecule: "methotrexate", condition: "pregnancy", severity: "absolute", note: "Teratogenic and abortifacient" },
  { molecule: "doxycycline", condition: "age_under_12", severity: "absolute", note: "Dental staining and enamel hypoplasia in children" },
  { molecule: "ciprofloxacin", condition: "age_under_18", severity: "relative", note: "Arthropathy risk in growing children; specialist decision" },
  { molecule: "levofloxacin", condition: "age_under_18", severity: "relative", note: "Arthropathy risk in pediatrics" },
  { molecule: "ciprofloxacin", condition: "myasthenia_gravis", severity: "absolute", note: "Fluoroquinolones exacerbate myasthenia" },
  { molecule: "aspirin", condition: "age_under_16", severity: "absolute", note: "Reye syndrome risk in febrile children" },
  { molecule: "aspirin", condition: "peptic_ulcer", severity: "relative", note: "GI bleeding risk; use enteric coat or alternatives" },
  { molecule: "aspirin", condition: "gout", severity: "relative", note: "Low-dose aspirin can raise urate; monitor" },
  { molecule: "ibuprofen", condition: "peptic_ulcer", severity: "relative", note: "NSAID GI toxicity" },
  { molecule: "ibuprofen", condition: "asthma_aspirin_sensitive", severity: "absolute", note: "NSAID-exacerbated respiratory disease" },
  { molecule: "ibuprofen", condition: "heart_failure", severity: "relative", note: "NSAIDs worsen heart failure volume status" },
  { molecule: "ibuprofen", condition: "renal_severe", severity: "relative", note: "NSAID renal risk when eGFR is low" },
  { molecule: "diclofenac", condition: "peptic_ulcer", severity: "relative", note: "NSAID GI toxicity" },
  { molecule: "diclofenac", condition: "heart_failure", severity: "relative", note: "NSAIDs worsen heart failure volume status" },
  { molecule: "diclofenac", condition: "renal_severe", severity: "relative", note: "NSAID renal risk when eGFR is low" },
  { molecule: "naproxen", condition: "peptic_ulcer", severity: "relative", note: "NSAID GI toxicity" },
  { molecule: "metformin", condition: "renal_severe", severity: "absolute", note: "Lactic acidosis risk when eGFR below 30" },
  { molecule: "metformin", condition: "hepatic_severe", severity: "relative", note: "Lactic acidosis risk with hepatic impairment" },
  { molecule: "spironolactone", condition: "hyperkalemia", severity: "absolute", note: "Further potassium elevation; arrhythmia risk" },
  { molecule: "spironolactone", condition: "renal_severe", severity: "relative", note: "Hyperkalemia risk when eGFR is low" },
  { molecule: "simvastatin", condition: "pregnancy", severity: "absolute", note: "Contraindicated in pregnancy" },
  { molecule: "simvastatin", condition: "hepatic_severe", severity: "relative", note: "Active liver disease; discontinue" },
  { molecule: "atorvastatin", condition: "pregnancy", severity: "relative", note: "Discontinue unless lipid disorder essential" },
  { molecule: "tramadol", condition: "age_under_12", severity: "absolute", note: "Respiratory depression risk in children" },
  { molecule: "tramadol", condition: "epilepsy", severity: "relative", note: "Lowers seizure threshold" },
  { molecule: "codeine", condition: "age_under_12", severity: "absolute", note: "Ultra-rapid metabolizer toxicity; banned in pediatrics" },
  { molecule: "zolpidem", condition: "pregnancy", severity: "relative", note: "Neonatal sedation risk" },
  { molecule: "paracetamol", condition: "hepatic_severe", severity: "relative", note: "Hepatotoxicity risk; dose cap 2g/day" },
  { molecule: "cetirizine", condition: "renal_severe", severity: "relative", note: "Dose reduction required" },
  { molecule: "ciprofloxacin", condition: "epilepsy", severity: "relative", note: "Seizure-threshold lowering in CNS disorders" },
  { molecule: "lithium carbonate", condition: "pregnancy", severity: "relative", note: "Ebstein anomaly risk; specialist decision" },
  // --- parity drift fix (E-E): rows present in data/contraindications.csv but
  // missing here (Python plane flagged them, TS plane did not).
  { molecule: "diclofenac", condition: "hf_refduced", severity: "relative", note: "NSAIDs worsen heart failure volume status" },
  { molecule: "metformin", condition: "iodinated_contrast_48h", severity: "relative", note: "Hold around contrast administration" },
  { molecule: "insulin glargine", condition: "hypoglycemia_unaware", severity: "relative", note: "Specialist titration; CGM advised" },
];

/** Daily dose caps (mg/day) used by the dose-plausibility checker. */
export const DAILY_CAPS_MG: Record<string, number> = {
  paracetamol: 4000,
  ibuprofen: 1200, // OTC cap; prescription cap is higher
  diclofenac: 150,
  aspirin: 4000,
  tramadol: 400,
  pregabalin: 600,
  metformin: 3000,
  levothyroxine: 0.3,
  simvastatin: 40,
  atorvastatin: 80,
  lisinopril: 40,
  amlodipine: 10,
  ondansetron: 32,
  citalopram: 40,
  glimepiride: 8,
  furosemide: 600,
  spironolactone: 100,
};

/** Molecule groups used by the combination (graph) rules. */
export const MOLECULE_GROUPS: Record<string, string[]> = {
  nsaid: ["ibuprofen", "diclofenac", "naproxen", "aceclofenac", "aspirin"],
  raas_blocker: ["enalapril", "ramipril", "lisinopril", "losartan", "telmisartan"],
  loop_or_thiazide: ["furosemide", "torasemide", "hydrochlorothiazide"],
  qt_prolonging: ["azithromycin", "ciprofloxacin", "levofloxacin", "ofloxacin", "ondansetron", "citalopram", "amiodarone", "hydroxychloroquine"],
  ssri: ["sertraline", "fluoxetine", "citalopram"],
  serotonergic: ["tramadol", "sumatriptan", "amitriptyline"],
  anticoagulant_or_antiplatelet: ["warfarin", "aspirin", "clopidogrel"],
  benzodiazepine: ["alprazolam", "clonazepam"],
};
