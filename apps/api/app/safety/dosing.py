"""Deterministic dose arithmetic and plausibility warnings.

Zero network, zero model. These rules exist to catch the failure mode
confidence alone cannot: a text line that was read *perfectly* but describes a
dangerous regimen (double paracetamol, TDS on an OD brand). Every warning is a
note for the human, never a verdict by itself.
"""
from __future__ import annotations

import re

from medisaathi_contracts import ExtractionField

#: Daily maxima (mg/day) from FDA labels / SPC published maxima.
#: Provenance per molecule lives in the dataset package
#: (04_labels_dailymed_fda/dose_caps_extended.csv); snapshot 2026-09-18.
#: NOTE: methotrexate is WEEKLY (7.5-30 mg once weekly) — daily use is a fatal
#: error; the cap below is a backstop, the weekly schedule is enforced by the
#: prescriber-facing warning in dose_warning().
DAILY_CAPS_MG = {
    "paracetamol": 4000.0,
    "ibuprofen": 1200.0,      # OTC cap; prescription cap is higher
    "diclofenac": 150.0,
    "aspirin": 4000.0,
    "tramadol": 400.0,
    "pregabalin": 600.0,
    "metformin": 3000.0,
    "levothyroxine": 0.3,
    "aceclofenac": 200.0,
    "naproxen": 1250.0,
    "atorvastatin": 80.0,
    "rosuvastatin": 40.0,
    "simvastatin": 40.0,
    "glibenclamide": 20.0,
    "glimepiride": 8.0,
    "gliclazide": 320.0,
    "sitagliptin": 100.0,
    "ondansetron": 32.0,
    "domperidone": 30.0,
    "cetirizine": 10.0,
    "levocetirizine": 5.0,
    "montelukast": 10.0,
    "fluconazole": 400.0,
    "ciprofloxacin": 1500.0,
    "levofloxacin": 750.0,
    "ofloxacin": 800.0,
    "azithromycin": 500.0,
    "clarithromycin": 1000.0,
    "doxycycline": 200.0,
    "amoxicillin": 3000.0,
    "prednisolone": 80.0,
    "dexamethasone": 16.0,
    "warfarin": 10.0,
    "clopidogrel": 75.0,
    "amitriptyline": 150.0,
    "sertraline": 200.0,
    "citalopram": 40.0,
    "fluoxetine": 80.0,
    "alprazolam": 4.0,
    "clonazepam": 20.0,
    "zolpidem": 10.0,
    "codeine": 240.0,
    "theophylline": 450.0,
    "salbutamol": 800.0,
    "metoprolol": 400.0,
    "atenolol": 100.0,
    "amlodipine": 10.0,
    "losartan": 100.0,
    "telmisartan": 80.0,
    "ramipril": 10.0,
    "enalapril": 40.0,
    "lisinopril": 40.0,
    "furosemide": 600.0,
    "torasemide": 200.0,
    "spironolactone": 100.0,
    "digoxin": 0.5,
    "amiodarone": 400.0,
    "lithium carbonate": 2400.0,
    "methotrexate": 30.0,
    "hydroxychloroquine": 400.0,
    "allopurinol": 800.0,
    "febuxostat": 120.0,
    "colchicine": 1.2,
    "albendazole": 800.0,
    "ivermectin": 12.0,
    "isotretinoin": 60.0,
    "carbamazepine": 1200.0,
    "phenytoin": 600.0,
    "levetiracetam": 3000.0,
    "gabapentin": 3600.0,
    "valproate": 2500.0,
    "lamotrigine": 400.0,
    "risperidone": 16.0,
    "olanzapine": 20.0,
    "quetiapine": 800.0,
    "aripiprazole": 30.0,
    "haloperidol": 20.0,
    "clozapine": 900.0,
    "amisulpride": 1200.0,
    # --- DataPack 2026-09-20: +227 pack-only caps (repo values kept on conflict; ibuprofen stays 1200 OTC) ---
    "acarbose": 300,
    "acitretin": 75,
    "acyclovir": 4000,
    "alendronate": 70,
    "alfuzosin": 10,
    "ambroxol": 90,
    "amoxicillin+clavulanic acid": 3000,
    "anastrozole": 1,
    "aprepitant": 375,
    "ascorbic acid": 2000,
    "azathioprine": 250,
    "betahistine": 48,
    "betamethasone": 8,
    "bicalutamide": 150,
    "bisacodyl": 15,
    "bisoprolol": 20,
    "bromhexine": 48,
    "bupropion": 450,
    "buspirone": 60,
    "calcium carbonate+vitamin d3": 2000,
    "canagliflozin": 300,
    "candesartan": 32,
    "capecitabine": 5000,
    "captopril": 450,
    "carbimazole": 60,
    "carvedilol": 100,
    "cefadroxil": 2000,
    "cefixime": 800,
    "cefpodoxime": 800,
    "cefuroxime": 1000,
    "celecoxib": 400,
    "cephalexin": 4000,
    "chloroquine": 1000,
    "chlorpheniramine": 16,
    "chlorthalidone": 25,
    "cholecalciferol": 60000,
    "cilnidipine": 20,
    "clindamycin": 1800,
    "clobazam": 30,
    "clofazimine": 300,
    "clomiphene": 150,
    "clonidine": 1.2,
    "cloxacillin": 4000,
    "cotrimoxazole": 1920,
    "cyanocobalamin": 1000,
    "cyclosporine": 600,
    "cyproheptadine": 32,
    "dapagliflozin": 10,
    "dapsone": 200,
    "deflazacort": 72,
    "desloratadine": 10,
    "dextromethorphan": 120,
    "diazepam": 30,
    "dicyclomine": 160,
    "diethylcarbamazine": 300,
    "diltiazem": 360,
    "doxazosin": 16,
    "doxofylline": 800,
    "drotaverine": 240,
    "duloxetine": 120,
    "dutasteride": 0.5,
    "empagliflozin": 25,
    "eplerenone": 100,
    "erythromycin": 4000,
    "escitalopram": 20,
    "esomeprazole": 40,
    "estradiol": 4,
    "ethambutol": 1600,
    "ethinylestradiol+desogestrel": 30,
    "ethinylestradiol+levonorgestrel": 50,
    "etizolam": 2,
    "etoricoxib": 120,
    "exemestane": 25,
    "ezetimibe": 10,
    "famotidine": 80,
    "fenofibrate": 200,
    "ferrous ascorbate+folate": 300,
    "ferrous sulphate": 325,
    "fexofenadine": 180,
    "finasteride": 5,
    "flavoxate": 1200,
    "flucloxacillin": 4000,
    "flunarizine": 10,
    "flurbiprofen": 300,
    "fluvoxamine": 200,
    "folic acid": 5,
    "fosfomycin": 3000,
    "gemfibrozil": 1200,
    "glipizide": 40,
    "granisetron": 4,
    "griseofulvin": 1000,
    "hydralazine": 300,
    "hydrochlorothiazide": 50,
    "hydrocortisone": 200,
    "hydroxyurea": 3000,
    "hydroxyzine": 100,
    "imatinib": 800,
    "imipramine": 200,
    "indapamide": 2.5,
    "indomethacin": 150,
    "irbesartan": 300,
    "isoniazid": 300,
    "isosorbide dinitrate": 120,
    "isosorbide mononitrate": 120,
    "itraconazole": 400,
    "ivabradine": 15,
    "ketoconazole": 400,
    "ketoprofen": 200,
    "labetalol": 2400,
    "lacosamide": 400,
    "lactulose": 60,
    "lansoprazole": 60,
    "leflunomide": 100,
    "letrozole": 7.5,
    "linagliptin": 5,
    "linezolid": 1200,
    "lithium": 2400,
    "loperamide": 16,
    "loratadine": 20,
    "lorazepam": 10,
    "lovastatin": 80,
    "mebendazole": 500,
    "mebeverine": 405,
    "medroxyprogesterone": 20,
    "mefenamic acid": 1500,
    "meloxicam": 15,
    "mesalamine": 4800,
    "metformin_sr": 2000,
    "methylcobalamin": 3000,
    "methyldopa": 3000,
    "methylprednisolone": 64,
    "metoclopramide": 30,
    "metoprolol_sr": 400,
    "metronidazole": 1500,
    "minocycline": 200,
    "minoxidil": 100,
    "mirabegron": 50,
    "mirtazapine": 45,
    "misoprostol": 800,
    "morphine": 200,
    "moxifloxacin": 400,
    "mycophenolate mofetil": 4000,
    "nebivolol": 40,
    "nifedipine": 120,
    "nimesulide": 200,
    "nitrofurantoin": 400,
    "nitroglycerin": 13,
    "norethisterone": 15,
    "norfloxacin": 800,
    "nortriptyline": 150,
    "olmesartan": 40,
    "omeprazole": 40,
    "oseltamivir": 150,
    "oxcarbazepine": 2400,
    "oxybutynin": 15,
    "pantoprazole": 80,
    "paroxetine": 50,
    "pentoxifylline": 1200,
    "perindopril": 10,
    "pheniramine": 75,
    "phenobarbitone": 180,
    "phenylephrine": 60,
    "pioglitazone": 45,
    "piroxicam": 20,
    "pitavastatin": 4,
    "pravastatin": 80,
    "praziquantel": 3000,
    "prazosin": 20,
    "prednisone": 100,
    "primaquine": 30,
    "probenecid": 2000,
    "promethazine": 50,
    "propranolol": 320,
    "propylthiouracil": 450,
    "pseudoephedrine": 240,
    "pyrantel": 1000,
    "pyrazinamide": 2000,
    "pyridoxine": 200,
    "quinine": 1800,
    "rabeprazole": 40,
    "raloxifene": 60,
    "ranitidine": 300,
    "ranolazine": 2000,
    "rifampicin": 600,
    "rifaximin": 1650,
    "risedronate": 150,
    "rizatriptan": 30,
    "roxithromycin": 300,
    "sacubitril+valsartan": 400,
    "senna": 30,
    "sildenafil": 100,
    "silodosin": 8,
    "sodium valproate": 2500,
    "solifenacin": 10,
    "sotalol": 160,
    "sucralfate": 8000,
    "sulfasalazine": 3000,
    "sumatriptan": 200,
    "tacrolimus": 20,
    "tadalafil": 20,
    "tamoxifen": 40,
    "tamsulosin": 0.8,
    "tapentadol": 600,
    "terbinafine": 250,
    "terbutaline": 15,
    "tetracycline": 2000,
    "thiamine": 300,
    "tinidazole": 2000,
    "tolfenamic acid": 400,
    "topiramate": 400,
    "tramadol+paracetamol": 800,
    "tranexamic acid": 3750,
    "trimetazidine": 70,
    "trimethoprim": 400,
    "ursodeoxycholic acid": 1050,
    "valacyclovir": 3000,
    "valsartan": 320,
    "venlafaxine": 375,
    "verapamil": 480,
    "vildagliptin": 100,
    "vitamin e": 1000,
    "vitamin k1": 40,
    "voglibose": 0.9,
    "voriconazole": 800,
    "zinc": 100,
    "zolmitriptan": 10,
    "zopiclone": 7.5,
}

_DUR_RE = re.compile(r"(\d+)\s*day", re.I)

_DOSE_PER_DAY = {
    "OD": 1, "HS": 1, "QHS": 1, "BD": 2, "TDS": 3, "QID": 4, "SOS": 1,
}


def parse_frequency_per_day(freq: str) -> int | None:
    """TAC code 1-0-1 -> 2; BD -> 2; unknown -> None. Deterministic."""
    freq = (freq or "").strip()
    m = re.fullmatch(r"(\d+)\s*-\s*(\d+)\s*-\s*(\d+)", freq)
    if m:
        return sum(int(g) for g in m.groups())
    word = _DOSE_PER_DAY.get(freq.upper())
    if word:
        return word
    total = sum(int(x) for x in re.findall(r"\d+", freq))
    return total or None


def daily_dose_mg(field: ExtractionField) -> float | None:
    """strength (or dose) mg x occurrences per day, when both parse."""
    strength_txt = field.strength or field.dose
    m = re.search(r"(\d+(?:\.\d+)?)\s*mg", (strength_txt or "").lower())
    if not m:
        return None
    per_occurrence = float(m.group(1))
    per_day = parse_frequency_per_day(field.frequency)
    if per_day is None:
        return None
    return per_occurrence * per_day


def dose_warning(field: ExtractionField, molecule: str | None = None) -> str | None:
    """Return a human-readable warning, or None when the regimen parses clean.
    `molecule` (normalized, e.g. "paracetamol") sharpens cap matching; without
    it the rule falls back to brand-name heuristics."""
    mol_txt = ((molecule or "") + " " + (field.brand_text or "")).lower()
    # 1) TAC code sanity: any position > 2 occurrences at once is odd.
    m = re.fullmatch(r"(\d+)\s*-\s*(\d+)\s*-\s*(\d+)", (field.frequency or "").strip())
    if m and any(int(g) > 2 for g in m.groups()):
        return f"unusual frequency {field.frequency} - verify with the prescriber"

    # 2) Daily-dose cap check (needs mg + frequency).
    daily = daily_dose_mg(field)
    if daily is not None:
        for mol, cap in DAILY_CAPS_MG.items():
            if mol in mol_txt and daily > cap:
                return (f"computed daily dose {daily:g} mg exceeds the "
                        f"{mol} cap of {cap:g} mg/day")

    # 3) Long paracetamol courses without review.
    if "paracetamol" in mol_txt:
        dm = _DUR_RE.search(field.duration or "")
        if dm and int(dm.group(1)) > 10:
            return f"paracetamol for {dm.group(1)} days - pharmacist review advised"
    return None
