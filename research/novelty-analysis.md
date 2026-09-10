# Novelty Analysis — MediSaathi / Vaidya

**Status:** evidence-based prior-art scan + candidate-innovation framing.
**Not a legal opinion.** Nothing here asserts patentability; that requires
professional patent counsel and a formal prior-art search. This document's
job is to separate what is genuinely unusual about the system from what is a
standard engineering pattern, so claims made to judges, recruiters, and
reviewers stay honest.

---

## 1. What the system actually is

- **Two-plane law:** an LLM (perception) proposes structured fields with
  per-line confidence; a **deterministic, zero-network rule engine** (safety
  plane) decides. The model never decides; the rules never call a model.
- **Confidence gate:** refuse < 0.75, human-confirm 0.75–0.90,
  auto-confirm ≥ 0.90 — refusal is a first-class result with a live counter.
- **Combination-graph rules** beyond pairwise interactions: triple whammy,
  QT stack, serotonin stack, bleeding stack.
- **First-action-wins dose guardrail:** a dose row can be acted on exactly
  once; replay is refused and audited, making double-dose catch-up impossible
  at the data layer.
- **Grounded copilot with three deterministic gates** (emergency triage →
  scope refusal → retrieval-floor-gated generation with citations) and a
  post-check that strips stray dosage prescriptions.
- **Same safety law implemented twice** (Python `apps/api`, TypeScript
  `apps/web`) with independent test suites and an A1-vs-A4 counterfactual
  ablation showing the plane (not the reading) carries the safety.

## 2. Known prior art (public, documented)

| Artifact | What it does | Relationship to MediSaathi |
|---|---|---|
| DDInter (open drug-interaction DB) | Pairwise interaction evidence with mechanisms | MediSaathi consumes a snapshot as **one input table**, remapped to severity |
| Stockley's Drug Interactions / Lexicomp | Reference interaction compendia | Same role; the *combination* rules (triple whammy, QT stacks) are not simple pairwise rows |
| Reminder apps (Medisafe, Mango Health, Tata 1mg reminders) | Push reminders + adherence streaks | They schedule and remind; they do not verify a prescription against interactions before the first dose |
| Pharmacy/telemedicine apps (Netmeds, PharmEasy, 1mg) | Prescription upload for dispensing | Upload is for commerce; verification depth is not their surface |
| Clinical decision support (CDSS literature, e-prescribing alerts) | Rule-based alerts in hospital EHRs | Closest technical relative; MediSaathi's difference is the **confidence-gated LLM perception + rule decision split** and the **consumer/patient-facing closed loop** (verify→schedule→adhere→protect→explain→measure) |
| RAG chatbots (Med-PaLM and general RAG systems) | Retrieval-grounded generation | MediSaathi adds deterministic pre-gates (emergency, scope) *before* retrieval and refuses below a retrieval floor instead of improvising |
| Guideline-based antibiotic stewardship tools | Indication/guideline checks | Not drug-interaction verification; MediSaathi does not claim stewardship |

## 3. Candidate novel mechanisms (with honest differentiation)

1. **Confidence-gated perception → rule-plane decision boundary.** The
   *pattern* of "LLM proposes, rules dispose" exists in various forms, but
   the specific packaging — per-line confidence as a typed contract field
   (`ExtractionField.confidence`), a property-tested gate law, and a
   **live refusal counter** presented as a designed success state — is
   unusual in consumer health software.
   *Honest caveat:* the components (thresholding, rule engines, LLM JSON
   extraction) are each standard; the combination and product framing is the
   candidate novelty, not any single part.

2. **Combination-graph safety rules as a first-class engine stage.**
   Pairwise interaction tables miss harms that only appear when *three*
   classes co-occur (RAAS-blocker + diuretic + NSAID; ≥3 QT-prolonging
   agents; SSRI + ≥2 serotonergics). The graph stage is simple (set
   membership per class) but the *law* that it outranks pairwise evidence in
   verdict assembly is explicit and testable.
   *Honest caveat:* clinically, "triple whammy" AKI risk and QT stacking are
   established medical knowledge; the contribution is making them a
   deterministic, auditable, offline engine stage with source attribution —
   engineering, not medical novelty.

3. **First-action-wins dose accounting at the data layer.** Most adherence
   apps log events; MediSaathi makes the dose row a *single-transition state
   machine* (pending → taken|skipped|missed) enforced by a unique first
   action, with audit — so a double tap, a network replay, or a malicious
   script cannot manufacture a second intake. The "already_acted" response
   is a designed protocol, not an error.
   *Honest caveat:* idempotency/append-only patterns are standard in
   distributed systems; applying them to *medication dose rows* with a
   catch-up guardrail that persists a "skip" (so the dose can never be taken
   later) is the transferable idea.

4. **Honest-degradation architecture.** The demo has three named resilience
   tiers (full / degraded / offline), and the *degraded* tier is
   deliberately visible: when the language service is down, the copilot says
   so and refuses to improvise, while the deterministic safety plane keeps
   running at full strength. Transparent outage behavior as a *product
   feature* is rare in AI demos.
   *Honest caveat:* this is product/UX engineering, not a patentable
   mechanism on its own.

## 4. What is deliberately NOT claimed

- No clinical efficacy claims (no patient outcomes measured).
- No claim that the rule set is comprehensive or clinically validated.
- No claim of novelty for RAG, rule engines, or LLM extraction individually.
- No compliance claim (HIPAA/DPDP/FHIR are roadmap concepts, documented as
  "compliance considerations", not certifications).
- No claim that these mechanisms are patentable.

## 5. Questions requiring professional counsel (if ever pursued)

1. Is a "confidence-gated perception-to-rule plane for medication
   verification" a patentable method claim given CDSS prior art?
2. Does the first-action-wins dose ledger with persisted guarded-skips clear
   generic idempotency/audit-log prior art?
3. Software-method patentability in India (Section 3(k) of the Patents Act)
   and the jurisdictional strategy (India vs US provisional).
4. Prior-art search scope: CDSS patents, adherence-app patents, RAG
   personalization patents.

## 6. Recommended framing for judges and recruiters

Lead with the **measurable counterfactual** (A1 vs A4 ablation: verdict
agreement 1.00 → 0.17 without the gate/formulary) and the **offline
determinism** (engine self-test 18/18, zero network), not with novelty
rhetoric. Novelty is a question for counsel; *evidence of a designed
decision boundary* is something you can demonstrate live.