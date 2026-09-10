# Literature and Standards Review

**Access date for web sources:** 2026-09-10  
**Scope:** medication safety, adherence, responsible AI, interoperability, and privacy context. This is a project research record, not a systematic review.

## Sources

1. **Tolley et al. (2023), “Interventions to promote medication adherence for chronic diseases in India: a systematic review.”** PubMed: <https://pubmed.ncbi.nlm.nih.gov/37397765/>; PMC: <https://pmc.ncbi.nlm.nih.gov/articles/PMC10311913/>.  
   **Relevance:** supports treating adherence as a meaningful downstream problem in India.  
   **Limitation:** the current MediSaathi fixture build does not measure adherence behavior and should not claim an adherence effect.

2. **World Health Organization, Medication Without Harm.** <https://www.who.int/initiatives/medication-without-harm>, accessed 2026-09-10.  
   **Relevance:** frames medication errors, polypharmacy, transitions, and patient engagement as safety priorities; motivates verification and escalation.  
   **Limitation:** WHO program goals are not evidence that this prototype reduces harm.

3. **NIST AI RMF Generative AI Profile (AI 600-1, 2024).** <https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence>, accessed 2026-09-10.  
   **Relevance:** supports documenting risks, provenance, evaluation, human oversight, and failure behavior for generative components.  
   **Limitation:** framework guidance is not a product certification.

4. **HL7 FHIR R5 specification.** <https://www.hl7.org/fhir/>, accessed 2026-09-10.  
   **Relevance:** provides a possible future vocabulary for Patient, Medication, MedicationRequest, MedicationStatement, Provenance, and Consent exchange.  
   **Decision:** do not add superficial FHIR endpoints to the event MVP; map only after identity/consent and domain ownership exist.

5. **India Digital Personal Data Protection Act, 2023 (MeitY official copy).** <https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf>, accessed 2026-09-10.  
   **Relevance:** reinforces purpose limitation, governance, and the need to distinguish synthetic demo data from personal data processing.  
   **Limitation:** legal applicability and implementation require qualified counsel; this project does not claim compliance.

6. **Ayushman Bharat Digital Mission public materials.** <https://abdm.gov.in/> and consent/privacy pages, accessed 2026-09-10.  
   **Relevance:** future consent-aware longitudinal health exchange should be designed around explicit user control rather than inferred sharing.  
   **Decision:** ABDM integration remains roadmap work, not a claimed integration.

## Research question

Can a confidence-gated perception plane plus deterministic, source-attributed safety plane reduce unsafe *software outputs* relative to a raw-read baseline while increasing transparent human-review opportunities?

## Proposed experiment

- Baseline A1: raw extracted fields, no confidence gate, no formulary/rule screen.
- Proposed A4: schema-constrained extraction, confidence gate, deterministic rules, verified-only NLG.
- Dataset: expand from the current 12 synthetic-curated cases to a held-out, versioned corpus with per-field labels and adjudicated safety labels.
- Metrics: field accuracy, calibration, refusal precision/recall, false-negative rule findings, confirmation accuracy, latency, cost, and slot traceability.
- Ablations: schema-only, gate-only, rules-only, and full pipeline.
- Limitation: even a strong software benchmark would not establish clinical effectiveness or liability safety.
