# References — MediSaathi / Vaidya

Consolidated reference list. Access dates recorded; every source listed here
was actually consulted via the recorded URL or is a project-internal dataset
record. No citation is fabricated.

## Medication safety & adherence

1. World Health Organization, *Medication Without Harm*.
   https://www.who.int/initiatives/medication-without-harm (accessed 2026-09-10).
   Used for: the ~$42B annual medication-error cost framing; see
   `research/who.json` for the captured snippet.
2. Tolley A et al. (2023), "Interventions to promote medication adherence for
   chronic diseases in India: a systematic review." PMC:
   https://pmc.ncbi.nlm.nih.gov/articles/PMC10311913/ ; PubMed
   https://pubmed.ncbi.nlm.nih.gov/37397765/ (accessed 2026-09-10).
   Used for: the ~51% average adherence across 2,840 patients with NCDs;
   see `research/adherence.json`.
3. Patel S et al. (2025), "Understanding Treatment Adherence in Chronic
   Diseases." MDPI. https://www.mdpi.com (snippet in `research/adherence.json`).
   Used for: electronically-reported vs self-reported adherence range
   (44%–77%) as context; not claimed as a MediSaathi metric.
4. AHRQ PSNet, "Medication Errors and Adverse Drug Events."
   https://psnet.ahrq.gov (snippet in `research/who.json`). Used for: the
   "~half of ADEs are preventable" context line.
5. Parekh N et al. (2018), "Incidence and cost of medication harm in older
   adults." PMC: https://pmc.ncbi.nlm.nih.gov (snippet in `research/who.json`).
   Used for: polypharmacy harm context.

## Interaction / pharmacology data sources (as recorded in `data/sources.json`)

6. DDInter open drug-interaction database (snapshot, remapped severity):
   the primary interaction-pair table. Source recorded in
   `apps/web/src/lib/safety/dataset.ts` and `data/sources.json`.
7. Stockley's Drug Interactions — mechanism/seriousness framing for several
   combination rules (source field on the finding cards).
8. CredibleMeds — QT-prolongation grouping for the QT-stack rule.
9. BMJ / AKI guidance — triple-whammy (RAAS-blocker + diuretic + NSAID) rule
   framing.
10. Jan Aushadhi product price lists (September 2026 snapshot) — the price
    table in `apps/api/app/data` and the brand formulary.

## Responsible AI & health-data governance

11. NIST AI RMF Generative AI Profile (AI 600-1, 2024).
    https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
    (accessed 2026-09-10). Used for: documenting risks, provenance,
    evaluation, and human-oversight of the generative components.
12. India Digital Personal Data Protection Act, 2023 (MeitY copy).
    https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
    (accessed 2026-09-10). Used for: purpose limitation and synthetic-data
    framing. **Compliance is not claimed**; see docs/security/SECURITY_AUDIT.md.
13. Ayushman Bharat Digital Mission public materials. https://abdm.gov.in/
    (accessed 2026-09-10). Used for: consent-aware longitudinal health
    exchange as a **roadmap** concept, not a claimed integration.
14. HL7 FHIR R5 specification. https://www.hl7.org/fhir/ (accessed
    2026-09-10). Used for: possible future vocabulary (Patient,
    MedicationRequest, MedicationStatement, Provenance, Consent). Decision:
    no superficial FHIR endpoints in the event build — see
    docs/DECISIONS.md / docs/ARCHITECTURE.md.

## Patient-education knowledge base (copilot grounding)

15. MedlinePlus / NIH (medlineplus.gov), NHS (nhs.uk), and WHO consumer
    pages — the curated 30-chunk knowledge base in
    `apps/web/src/lib/ai/knowledge.ts`, each chunk carrying its own source
    label surfaced as citations.

## Competitor / market context

16. Public product surfaces of Medisafe, Mango Health, Tata 1mg, PharmEasy,
    Netmeds, and 1mg reminders — feature-matrix comparison in
    `docs/research/COMPETITIVE_ANALYSIS.md` and `research/competitors.json`
    (public UI/documentation only; no proprietary technical information).

---

### Honesty note

Web snippets in `research/*.json` were captured by search at the recorded
date and reflect the page content at that moment. Where a claim in the README
or docs rests on a source, the source is named next to the claim; no
statistics are fabricated in-product. Anything labeled "snapshot 2026-09"
refers to the project's own curated dataset snapshot tag, not an external
release.