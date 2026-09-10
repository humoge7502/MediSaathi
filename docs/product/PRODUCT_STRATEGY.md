# MediSaathi Product Strategy

**Product thesis:** a verification layer between a paper prescription and a patient or caregiver. MediSaathi does not diagnose, prescribe, substitute, or silently fill gaps. It extracts legible fields, checks them against versioned rules, explains verified results in the user's language, and routes uncertainty to a human.

## Primary user

**Patient/caregiver at a pharmacy or home.** They need to understand what was written, hear it in English/Tamil/Hindi, spot a safety question, and know when the system cannot safely read the document.

## Secondary users

- **Pharmacist:** receives a structured confirmation queue and a concise interaction/provenance summary.
- **Judge/reviewer:** sees a resilient 90-second demonstration where the safety claim is measurable and refusal is visible.

Doctors, hospitals, and longitudinal care teams are intentionally outside the event MVP. They require identity, consent, interoperability, governance, and workflow validation that this prototype does not yet have.

## Jobs to be done

1. When I receive a prescription I cannot confidently read, help me understand its fields without inventing missing information.
2. When several medicines appear together, help me identify rule-based safety questions to discuss with a qualified professional.
3. When the image is not reliable, stop me from acting on a fluent guess.
4. When I experience a suspected reaction, help me prepare a reviewable pharmacovigilance draft.

## Current journey

```text
choose sample/capture → extract with confidence → deterministic screen
→ pass / interaction / contraindication / duplicate / confirmation / refusal
→ verified spoken plan + price information + provenance
```

## Value proposition

**For a patient or caregiver:** understand, hear, and question a prescription.  
**For a safety-conscious engineer:** the model is replaceable because it cannot author the verdict.  
**For a reviewer:** the system demonstrates a falsifiable distinction between reading and deciding through A1/A4 ablation.

## Differentiation priorities

1. Confidence gate with refusal and human confirmation as first-class outcomes.
2. Deterministic interaction, contraindication, duplicate-ATC, and dose-cap checks.
3. Slot-traceable multilingual speech, with no free-form dose generation.
4. Data/provenance shown at the verdict rather than hidden in a backend log.
5. Offline fixture and cache tiers that make the demo resilient without disguising live-model dependencies.
6. Privacy-conscious scope: synthetic data only, declared context, no user identifiers.

## Feature prioritization

| Feature | Value | Risk | Complexity | Decision |
|---|---:|---:|---:|---|
| Verified extraction + safety verdict | Very high | High | Medium | Shipped |
| Confirmation queue | High | Medium | Medium | Shipped |
| Multilingual spoken plan | High | Medium | Medium | Shipped with templates |
| Interaction/provenance/price surfaces | High | Medium | Medium | Shipped |
| ADR draft | Medium | Medium | Low | Shipped; review-only |
| Live vision provider | High | High | Medium | Shipped key-gated; not benchmarked |
| Authentication/ownership/consent | Very high | High | High | P1 before real data |
| Longitudinal adherence and caregiver workflows | High | High | High | P2/post-event; archive contains an alternative snapshot |
| FHIR exchange | Medium | High | High | P3 after domain model and consent |
| Vector RAG/agent tools | Low for current job | High | High | Rejected for MVP |

## Success measures

- Fixture verdict agreement, refusal precision, and field/frequency recall on a labeled corpus.
- Confirmation queue completion and time-to-resolution once an authenticated pharmacist workflow exists.
- Percentage of spoken plan slots backed by verified fields (current invariant: all emitted slots are verified).
- Live extraction accuracy, latency, and cost on a separately labeled dataset (not yet measured).

## Boundaries

MediSaathi is an information and workflow prototype. It is not a diagnosis engine, prescribing system, clinical decision support validation, medical device, or compliance certification. Every future expansion must preserve the rule that uncertainty is surfaced and qualified human review is required for consequential decisions.

## Roadmap

- **P1:** authentication, ownership, consent artifacts, audit events, retention/deletion/export policies.
- **P1:** licensed/versioned Indian medication sources and a larger independently labeled corpus.
- **P2:** browser E2E, accessibility automation, pharmacist confirmation console, persistent operational metrics.
- **P2:** longitudinal dose events and caregiver escalation, borrowing the archive's model only after identity/consent design.
- **P3:** standards-based exchange such as FHIR, model routing, richer retrieval, and on-prem deployment profiles.
