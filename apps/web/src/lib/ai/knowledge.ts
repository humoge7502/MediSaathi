/**
 * Curated health-literacy corpus for the grounded copilot.
 *
 * HONESTY CONTRACT:
 *  - Every chunk states its source registry (MedlinePlus/NIH, NHS, WHO).
 *  - Content is generic, textbook-level patient education — no invented
 *    statistics, no personalization, no dosage prescriptions.
 *  - The copilot may ONLY speak from these chunks. Anything outside the
 *    corpus must be refused, not improvised.
 */

export interface KnowledgeChunk {
  id: string;
  title: string;
  molecules: string[]; // indexed for med-context retrieval
  text: string;
  source: string;
}

export const KNOWLEDGE: KnowledgeChunk[] = [
  {
    id: "paracetamol",
    title: "Paracetamol (acetaminophen)",
    molecules: ["paracetamol"],
    text: "Paracetamol is used to treat mild-to-moderate pain and fever. It is one of the most commonly used medicines worldwide. Adults should not exceed 4 grams (4000 mg) in 24 hours from all sources, and people with liver problems are usually advised to stay well below this. Combining two brands that both contain paracetamol (for example a fever brand plus a multi-symptom cold brand) can accidentally exceed the daily limit. Paracetamol is generally gentler on the stomach than NSAIDs, but an overdose harms the liver and is a medical emergency.",
    source: "MedlinePlus (NIH)",
  },
  {
    id: "nsaid",
    title: "NSAIDs (ibuprofen, diclofenac, naproxen)",
    molecules: ["ibuprofen", "diclofenac", "naproxen", "aceclofenac"],
    text: "NSAIDs relieve pain, fever and inflammation. They can irritate the stomach lining, so they are best taken after food, and people with peptic ulcer, kidney disease, heart failure or aspirin-sensitive asthma should speak to a doctor before using them. NSAIDs can reduce the effect of blood-pressure medicines and increase bleeding risk, especially alongside anticoagulants or antiplatelet medicines. Using the lowest effective dose for the shortest time is the standard safety advice.",
    source: "MedlinePlus (NIH)",
  },
  {
    id: "aspirin",
    title: "Aspirin (low-dose antiplatelet)",
    molecules: ["aspirin"],
    text: "Low-dose aspirin is an antiplatelet: it makes the blood less sticky and is used to prevent heart attacks and strokes in people at high risk. It can cause stomach irritation and bleeding, so it is often taken with food. Doctors advise against starting or stopping low-dose aspirin on your own, because stopping it can raise clot risk. Aspirin should not be given to children with fever because of Reye syndrome, a rare but serious condition.",
    source: "NHS",
  },
  {
    id: "clopidogrel",
    title: "Clopidogrel (antiplatelet)",
    molecules: ["clopidogrel"],
    text: "Clopidogrel is an antiplatelet medicine used after heart attacks, stents and strokes to prevent new clots. It must usually be continued even when the person feels well, and stopping it suddenly can be dangerous, especially within the first months after a stent. Some acid-reducing medicines (omeprazole, esomeprazole) can slightly reduce how well clopidogrel is activated; pantoprazole is often preferred when a stomach-protecting medicine is needed. Report unusual bruising, black stools or prolonged bleeding to a doctor.",
    source: "NHS",
  },
  {
    id: "warfarin",
    title: "Warfarin (anticoagulant)",
    molecules: ["warfarin"],
    text: "Warfarin is an anticoagulant that prevents harmful clots in conditions like atrial fibrillation, deep vein thrombosis and mechanical heart valves. Its effect is measured by a blood test called INR, done regularly. Many antibiotics, NSAIDs and diet changes (especially vitamin K foods such as leafy greens) can shift INR, so any new medicine should be checked by the prescribing team. Warfarin is avoided in pregnancy. Signs of too much warfarin include unusual bruising, blood in urine or stool, and severe headache.",
    source: "NHS / MedlinePlus (NIH)",
  },
  {
    id: "metformin",
    title: "Metformin (type 2 diabetes)",
    molecules: ["metformin"],
    text: "Metformin is the first-line medicine for type 2 diabetes. It lowers glucose production in the liver and improves insulin sensitivity. Common side effects are nausea and loose stools, which often improve when taken with meals. It is stopped around iodinated-contrast scans and in severely reduced kidney function because of a rare lactic acidosis risk. Heavy alcohol use increases that risk. Metformin does not usually cause low blood sugar on its own.",
    source: "MedlinePlus (NIH)",
  },
  {
    id: "sulfonylurea",
    title: "Glimepiride and other sulfonylureas",
    molecules: ["glimepiride", "gliclazide"],
    text: "Sulfonylureas help the pancreas release more insulin and can cause low blood sugar (hypoglycemia), especially if meals are skipped or after heavy activity. Warning signs include shakiness, sweating, confusion and a fast heartbeat; fast sugar (glucose tablets, juice) treats it. Some antifungals such as fluconazole can raise sulfonylurea levels and increase hypoglycemia risk. Regular meals, glucose monitoring and carrying a fast-sugar source are the standard precautions.",
    source: "MedlinePlus (NIH)",
  },
  {
    id: "statins",
    title: "Statins (atorvastatin, simvastatin, rosuvastatin)",
    molecules: ["atorvastatin", "simvastatin", "rosuvastatin"],
    text: "Statins lower LDL cholesterol and reduce cardiovascular risk. Muscle aches are the most commonly reported side effect; severe muscle pain with dark urine is uncommon but needs urgent attention. Certain antibiotics (clarithromycin, erythromycin) and grapefruit juice raise statin levels — simvastatin is the most sensitive. Statins are usually taken in the evening and are avoided in pregnancy. Liver function is checked before and during therapy.",
    source: "NHS",
  },
  {
    id: "ccb",
    title: "Amlodipine (calcium-channel blocker)",
    molecules: ["amlodipine"],
    text: "Amlodipine relaxes blood vessels to lower blood pressure and treat angina. Ankle swelling and flushing are the most common side effects. It interacts with simvastatin (which is usually capped at 20 mg daily with amlodipine) and with certain antibiotics. Do not stop it suddenly without medical advice, and stand up slowly in the first weeks because of dizziness.",
    source: "NHS",
  },
  {
    id: "raas",
    title: "ACE inhibitors and ARBs (blood-pressure protectors)",
    molecules: ["enalapril", "ramipril", "lisinopril", "losartan", "telmisartan"],
    text: "ACE inhibitors and ARBs lower blood pressure and protect the kidneys and heart, especially in diabetes and heart failure. A persistent dry cough is typical with ACE inhibitors and may lead to a switch to an ARB. They raise potassium, so potassium supplements and salt substitutes need doctor supervision, and they are combined carefully with potassium-sparing diuretics. NSAIDs can blunt their effect and strain the kidneys. Kidney function and potassium are monitored after starting or dose changes. They are avoided in pregnancy.",
    source: "NHS / MedlinePlus (NIH)",
  },
  {
    id: "diuretics",
    title: "Furosemide and thiazide diuretics",
    molecules: ["furosemide", "torasemide", "hydrochlorothiazide", "spironolactone"],
    text: "Diuretics remove excess fluid and are used in heart failure, hypertension and edema. They are usually taken in the morning to avoid night-time urination. They can lower potassium (loop and thiazide diuretics) or raise it (spironolactone), so blood tests monitor salts and kidney function. Thiazides can raise urate and trigger gout. Weight tracking and ankle-swelling checks help catch fluid changes early.",
    source: "MedlinePlus (NIH)",
  },
  {
    id: "ppi",
    title: "Omeprazole and pantoprazole (acid reducers)",
    molecules: ["omeprazole", "pantoprazole"],
    text: "Proton-pump inhibitors reduce stomach acid and are used for ulcers, reflux and to protect the stomach during NSAID use. Omeprazole can interfere with clopidogrel activation, so pantoprazole is often chosen instead. They are best taken 30-60 minutes before breakfast. Long-term use is associated with lower vitamin B12 and magnesium absorption, so doctors review whether continued use is needed.",
    source: "NHS",
  },
  {
    id: "levothyroxine",
    title: "Levothyroxine (thyroid hormone)",
    molecules: ["levothyroxine"],
    text: "Levothyroxine replaces thyroid hormone in hypothyroidism. It is taken on an empty stomach, 30-60 minutes before breakfast, because food, calcium, iron and antacids markedly reduce absorption; those are best separated by about 4 hours. Thyroid blood tests (TSH) guide dose adjustments, usually 6-8 weeks after a change. Consistency of brand and timing matters. Overdose signs include palpitations, tremor and weight loss.",
    source: "NHS",
  },
  {
    id: "ssri",
    title: "SSRIs (sertraline, fluoxetine, citalopram)",
    molecules: ["sertraline", "fluoxetine", "citalopram"],
    text: "SSRIs are antidepressants used for depression and anxiety. Benefit builds over 2-4 weeks, and courses typically continue for at least six months after improvement. Early side effects (nausea, sleep change) often settle. SSRIs can increase bleeding risk with NSAIDs or anticoagulants and can interact with tramadol or triptans toward serotonin syndrome (agitation, fever, tremor). Do not stop suddenly — discontinuation symptoms are common; tapering is planned with the prescriber.",
    source: "NHS",
  },
  {
    id: "benzos",
    title: "Benzodiazepines and zolpidem (sleep/anxiety)",
    molecules: ["alprazolam", "clonazepam", "zolpidem"],
    text: "Benzodiazepines and zolpidem are short-term medicines for severe anxiety or sleep difficulty. They cause sedation and impair coordination, so alcohol, opioids and tramadol should be avoided alongside them — combining them depresses breathing. Dependence develops with regular use, so courses are kept short and stopped by tapering. Older adults are at higher risk of falls and confusion. Never drive after taking a dose.",
    source: "NHS",
  },
  {
    id: "tramadol",
    title: "Tramadol (pain)",
    molecules: ["tramadol"],
    text: "Tramadol is an opioid-type painkiller used when simpler painkillers are insufficient. It can cause nausea, dizziness and constipation, and lowers the seizure threshold, so it is used carefully in epilepsy. It interacts with SSRIs, amitriptyline and benzodiazepines. Constipation prevention (fluids, fibre) and not driving are standard advice. Unused tramadol should be returned to a pharmacy, not kept at home.",
    source: "NHS",
  },
  {
    id: "metronidazole",
    title: "Metronidazole (anaerobic/amoebic infections)",
    molecules: ["metronidazole"],
    text: "Metronidazole treats anaerobic bacterial and amoebic infections. Alcohol must be avoided during the course and for at least 48 hours after finishing it, because of a disulfiram-like reaction (flushing, vomiting, palpitations). A metallic taste and dark urine are harmless but common. The full course should be completed even when feeling better.",
    source: "NHS",
  },
  {
    id: "macrolides",
    title: "Azithromycin and clarithromycin (macrolides)",
    molecules: ["azithromycin", "clarithromycin"],
    text: "Macrolides are antibiotics for respiratory and other infections. Azithromycin is often given as a short 3-5 day course. Clarithromycin strongly inhibits the CYP3A4 enzyme, raising levels of statins (especially simvastatin) and some heart medicines, so the prescriber reviews the full medicine list first. Both can modestly prolong the QT interval. Take with or without food as the label says, and complete the course.",
    source: "NHS",
  },
  {
    id: "fluoroquinolones",
    title: "Ciprofloxacin and levofloxacin (fluoroquinolones)",
    molecules: ["ciprofloxacin", "levofloxacin", "ofloxacin"],
    text: "Fluoroquinolones are antibiotics for urinary, gut and other infections. Calcium, iron and antacids block their absorption — separate by about 2 hours before or 6 hours after. They can prolong QT, lower the seizure threshold, and (rarely) cause tendon pain or rupture, especially in older adults and with steroid use; tendon pain during treatment needs medical attention. Avoid caffeinated drinks if jitteriness appears. Fluoroquinolones are WHO Watch-list antibiotics to be used judiciously.",
    source: "NHS / WHO AWaRe",
  },
  {
    id: "amoxicillin",
    title: "Amoxicillin and Augmentin (penicillins)",
    molecules: ["amoxicillin", "clavulanic acid"],
    text: "Penicillin-class antibiotics treat a wide range of common infections. A rash may indicate allergy — penicillin allergy should be recorded and reported. Complete the prescribed course; stopping early can let the infection return. Diarrhoea is common; probiotic yogurt may help. Antibiotics do not work against viral colds and flu.",
    source: "NHS",
  },
  {
    id: "doxycycline",
    title: "Doxycycline (tetracycline)",
    molecules: ["doxycycline"],
    text: "Doxycycline treats infections and is used for malaria prevention. It must be taken with a full glass of water and the person should stay upright for 30 minutes to avoid throat irritation. Milk, antacids and iron reduce absorption. Sun sensitivity rises, so sunscreen and covering up matter. It is avoided in children under 12 and in pregnancy because of tooth and bone effects.",
    source: "NHS",
  },
  {
    id: "digoxin",
    title: "Digoxin (heart rate control)",
    molecules: ["digoxin"],
    text: "Digoxin controls heart rate in atrial fibrillation and strengthens contraction in heart failure. It has a narrow safety window: low potassium (often from diuretics), kidney decline, and some antibiotics raise digoxin levels toward toxicity. Warning signs are nausea, visual halos, slow or irregular pulse. Pulse is checked regularly and blood tests monitor potassium and kidney function. Report a pulse below 60 or new visual symptoms.",
    source: "MedlinePlus (NIH)",
  },
  {
    id: "steroids",
    title: "Prednisolone and other steroids",
    molecules: ["prednisolone", "dexamethasone"],
    text: "Oral steroids reduce inflammation in asthma, arthritis and many conditions. They are usually taken once daily in the morning with food to mimic the body's rhythm and protect the stomach. Blood sugar rises during courses — people with diabetes monitor more often. Courses longer than a few weeks must not be stopped abruptly; the dose is tapered under medical advice. Longer use raises infection risk, bone thinning and eye pressure, so reviews are scheduled.",
    source: "NHS",
  },
  {
    id: "salbutamol",
    title: "Salbutamol inhaler (rescue bronchodilator)",
    molecules: ["salbutamol"],
    text: "Salbutamol is a reliever inhaler that opens airways quickly during wheeze or breathlessness. Tremor and a fast heartbeat for a short while after use are common. If the reliever is needed more than three times a week, asthma control should be reviewed — a preventer inhaler may be needed. Inhaler technique matters: shake, breathe out, seal lips, press and inhale slowly. Rinse the mouth after use.",
    source: "NHS",
  },
  {
    id: "antihistamines",
    title: "Cetirizine and levocetirizine (allergy)",
    molecules: ["cetirizine", "levocetirizine"],
    text: "Second-generation antihistamines treat allergy symptoms with less drowsiness than older antihistamines, though cetirizine can still make some people sleepy. Dose reduction is needed in reduced kidney function. Avoid alcohol and check whether cough-cold products already contain an antihistamine to prevent double dosing.",
    source: "MedlinePlus (NIH)",
  },
  {
    id: "ondansetron",
    title: "Ondansetron (anti-nausea)",
    molecules: ["ondansetron"],
    text: "Ondansetron prevents nausea and vomiting from infections, motion or treatment. Constipation and headache are the most common effects. It can prolong the QT interval, so it is combined carefully with other QT-prolonging medicines such as certain antibiotics. Dissolvable tablets are placed on the tongue; do not push through the foil.",
    source: "MedlinePlus (NIH)",
  },
  {
    id: "missed-dose",
    title: "Missed doses — the general rule",
    molecules: [],
    text: "For most long-term medicines the general rule is: take the missed dose as soon as remembered unless it is nearly time for the next one — then skip the missed dose and continue as usual. Never take a double dose to catch up. Specific medicines (levothyroxine, warfarin, insulin, statins) have their own patterns, so the pharmacist's advice wins. Setting phone alarms, keeping a visible pill box, and linking doses to a daily habit (breakfast, brushing teeth) measurably reduces missed doses.",
    source: "NHS / WHO patient guidance",
  },
  {
    id: "alcohol",
    title: "Alcohol and medicines",
    molecules: [],
    text: "Alcohol interacts with many medicines: with metronidazole it causes a flushing-and-vomiting reaction for up to two days after the course; with metformin it raises lactic acidosis risk; with benzodiazepines, opioids and sleep medicines it dangerously deepens sedation; with paracetamol overuse it stresses the liver; with diabetes medicines it can cause delayed hypoglycemia. The safe default during any treatment course is to avoid alcohol unless the prescriber explicitly clears it.",
    source: "NHS / NIAAA",
  },
  {
    id: "adherence",
    title: "Why adherence matters",
    molecules: [],
    text: "Stopping medicines when symptoms fade is one of the most common reasons chronic conditions worsen — blood pressure, diabetes and epilepsy medicines control the disease but do not cure it, so they usually continue even when the person feels well. Simple aids work: fixed daily times, weekly pill boxes, phone reminders, and involving a family member. Missing several doses in a row is a signal to contact the care team, not to restart at full dose alone. Pharmacists can simplify regimens (for example combining timing) when adherence is hard.",
    source: "WHO adherence guidance",
  },
  {
    id: "antibiotic-stewardship",
    title: "Using antibiotics responsibly",
    molecules: [],
    text: "Antibiotics work only against bacteria, not viruses. Completing the exact prescribed course, never sharing leftovers, never pressuring a doctor for antibiotics for colds, and never buying them without a prescription all slow antibiotic resistance — one of WHO's top-ten global health threats. WHO classifies antibiotics as Access, Watch and Reserve: Access antibiotics are the first choice, Watch antibiotics need tighter control, and Reserve antibiotics are last-line for resistant infections.",
    source: "WHO AWaRe",
  },
];

/** Groups referenced by the copilot's safety rules. */
export const EMERGENCY_PATTERNS: RegExp[] = [
  /chest pain/i,
  /can'?t breathe|difficulty breathing|breathless and (worse|sudden)/i,
  /heavy bleeding|bleeding (a lot|won'?t stop)/i,
  /unconscious|fainted|seizure now/i,
  /suicid/i,
  /overdose|took (two|double|extra) (doses?|pills?|tablets?)/i,
];

/** Deterministic refusal patterns for personal dosage changes. */
export const DOSAGE_ADVICE_PATTERNS: RegExp[] = [
  /how (much|many) (should|can) i take/i,
  /should i (increase|decrease|double|stop|halve)/i,
  /(increase|decrease|change) my dose/i,
  /can i take (two|2|double)/i,
  /what dose should/i,
  /instead of (my|the) (medicine|tablet|drug)/i,
  /can i (stop|skip|miss|quit) (taking )?my (medicines?|medications?|tablets?|drugs?|pills?)/i,
  /(stop|quit) (taking )?(my )?(medicines?|medications?) (now|today|altogether|completely)/i,
];
