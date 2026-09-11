# Prior-art matrix and differentiation

Technical prior-art analysis from the patent-readiness audit. **Not a legal
search, not legal advice.** Patent databases (INPADOC, Espacenet full families,
USPTO full text, WIPO PATENTSCOPE, IP India) must be searched professionally at
claim level before any filing decision — in particular the nearest granted
family below, whose claim text could not be fetched full-text in the audit
environment and is therefore marked `[REQUIRES VALIDATION]`.

## Threat matrix (nearest first)

| Reference | Status | Core idea | Overlap | Difference |
|---|---|---|---|---|
| Hybrid clinical layer — granted EP family (grantee announcement) `[REQUIRES VALIDATION at claim level]` | Granted (EP); family status unverified | LLM front-end ensembled with a deterministic/symbolic reasoning engine that "is always the decision-maker" | Closest to the two-plane law: model proposes, symbolic engine disposes, in a clinical consumer context | Domain is symptom assessment/triage, not prescription verification; no disclosed per-field typed confidence contract, no formulary-resolvability fusion, no three-band refuse/confirm routing, no persisted queue blocking downstream generation, no zero-network plane or measured outage behaviour |
| Layered AI conversational safety — granted US patent `[REQUIRES VALIDATION]` | Granted (US) | Layered safety LLMs, checklist compliance, real-time feedback on every call | Safety layer around an LLM in healthcare | Safety *agents* rather than a deterministic rule plane deciding domain facts; no medication rule engine, no formulary gate |
| LLM constraint/rule learning with a validation layer | Granted (US) | LLM proposes database constraints which a validation layer checks and applies | LLM-proposes / rules-validate pattern | Database-integrity domain; no confidence gating, no human queue, no safety verdicts |
| Attribution verification of LLM medical answers | Granted (US) | Verifying attribution of LLM-generated medical answers to sources | Overlaps the copilot citation contract (D6) | No extraction-confidence gate, no rule plane, no dose-ledger semantics — relevant to dependents only |
| Fact-checking LLM output (pipelined) | Published application | Post-generation fact-checking of LLM output | Generic post-generation validation | No medication domain, no gate law |
| Real-time drug interaction screening | Granted (US) | Comparing products against drug data for interaction alerts | The plane's pairwise stage | No LLM perception, no confidence gate, no consumer closed loop |
| Predicting DDIs from clinical side effects | Granted (US) | ML prediction of interactions | DDI knowledge generation | Predictive modelling vs deterministic table screening — different layer |
| Medication adherence device + caregiver app | Published / granted | Caregiver monitoring, reminders, adherence reporting | Family escalation (D11) | No verification gate, no safety plane, no replay-proof ledger |
| Pharmacy fulfilment / remote pill verification | Granted (US, several) | Image-based verification of dispensed products; remote pharmacist review | Human-in-the-loop verification queues | Verifies physical pills/fill workflow, not LLM prescription reading with confidence gating |
| Curated DDI knowledge bases (public data / commercial compendia) | Public data / commercial | Curated DDI knowledge and checkers | The plane's data inputs (already attributed snapshots) | Data, not mechanism; licensing care needed |
| Uncertainty-based abstention in LLMs | Preprint 2024 | Selective prediction / abstention when model uncertainty is high | The refusal band concept | General abstention methods; no medication rule plane, no fusion with database resolvability, no queue semantics. Answer: fusion + queue blocking + measured operating point |
| Deterministic integrity gates for LLM clinical writing | Preprint 2026 | Deterministic gates validating LLM output in clinical research writing | Deterministic post-validation of LLM output in a clinical workflow | Manuscript-integrity domain; no safety verdicts, no confidence bands, no closed loop |
| Confidence-based triage/escalation for RAG | Preprints 2026 | Confidence-threshold escalation routing | Confidence-threshold escalation criteria | Different task (retrieval triage / ED triage) |
| Class-combination CDS literature (triple whammy, QT stacks, alert tiering) | Peer-reviewed | Class-combination alerts and alert-fatigue tiering in CPOE/CDSS | The combination stage (D2) | Hospital CPOE context; no LLM perception, no patient-facing loop. High threat for C2 *standalone*, hence folded into the core claim |
| Consumer adherence/SMAP products and reviews | Public products / peer-reviewed reviews | Caregiver notifications, reminders, adherence features | Family escalation (D11) | No verification-first architecture |
| Ambient medical scribe review workflows (incl. confidence-routed review) | Products / studies 2025-26 | AI-drafted notes with clinician review-before-sign; some use confidence to route review | Confidence-routed human review in medical AI | Documentation drafting, not medication-safety verdicts; mechanism-level disclosure varies. Warrants a targeted claim-level search on "confidence threshold auto-finalize" `[REQUIRES VALIDATION]` |
| Prompt-injection containment design patterns | Preprints/studies 2025-26 | Architectural containment of what a compromised LLM can affect | Inert-perception design rationale | Security pattern, not claimed as such |
| Medication reconciliation / best-possible-medication-history systems | Clinical informatics literature + EHR vendors | Constructing and maintaining a patient's current medication list across encounters | The union/composition step of mechanism A | Reconciliation *assembles a list for a human*; it does not evaluate a deterministic rule graph over a time-composed union, and has no confidence-fused gate or queue-blocking semantics |
| Cross-prescription / whole-medication-list interaction checking in CPOE | Hospital pharmacy informatics | Screening a patient's orders against DDI data rather than one order at a time | Regimen-level screening (mechanism A) | Hospital-order context; typically pairwise tables, often overrideable alerts; no LLM-reading uncertainty, no per-field identity mass, no fragility-gated queueing, no consumer closed loop |
| Uncertainty quantification / conformal prediction for clinical ML | Peer-reviewed 2019-2026 | Calibrated confidence sets and abstention for clinical predictors | Mechanism B's uncertainty handling | Applied to *predictive models* (diagnosis/prognosis), not to the identity of extracted drug names propagated through a deterministic rule graph; typically produces a prediction set, not a queue-entry condition tied to downstream automation |
| Selective prediction / abstention (incl. LLM abstention) | Preprints + peer-reviewed | Abstain when model uncertainty is high | The refusal band and fragility routing | General abstention theory; no medication rule plane, no identity-mass enumeration over a formulary confusion neighbourhood, no coupling of fragility to a persisted confirmation queue |

## Differentiation — second mechanism

The second mechanism's differentiation is *not* "check more than one drug".
Hospital CPOE already screens whole order sets, and medication reconciliation
already composes lists. What is not located is the specific conjunction:

1. a deterministic, zero-network medication rule plane evaluated over the
   **time-composed union** of an incoming artifact and the active regimen, with
   findings tagged as crossing the composition boundary;
2. each incoming field carrying an **explicit identity-mass distribution** with a
   residual `unknown` mass that can only ever demote (never promote) a field;
3. **exact enumeration** of read-identity assignments to a verdict distribution,
   producing a `fragility` measure; and
4. **fragility used as a queue-entry condition** restricted to the
   could-hide-harm case, coupling uncertainty to the same blocking queue that the
   first mechanism already persists.

Elements 1 and 2 exist separately in the art; element 3 is a standard
probabilistic technique applied to an unusual object (reading uncertainty over a
rule graph); element 4 is the coupling whose necessity is measured by the E-H
ablation. As with the first mechanism, the argument rests on the *measured
operating characteristic* (cross-prescription catch 0.000 → 0.949 → 1.000 at a
3.5% marginal queue cost) rather than on the novelty of any single element.

## Differentiation

No single located reference discloses the specific combination, and — more
importantly for inventive step — no located reference documents the *measured
operating characteristic* that the combination produces:

1. LLM reading with a typed **per-field confidence contract**;
2. a **deterministic, zero-network decision plane** with combination rules and a
   fixed precedence law;
3. a **refusal/confirm gate that blocks downstream plan creation** until a human
   resolves uncertainty;
4. a **longitudinal closed loop** with replay-proof dose accounting.

The combination, not any single element, is the differentiation opportunity —
and it must be evidenced experimentally to be persuasive. That is what
`EXPERIMENTS.md` and `EVIDENCE_BINDER.md` exist to provide.

## Strongest rejection arguments and the answers

1. *"The nearest granted family anticipates model-proposes/rules-decides in
   clinical software."* → Its disclosed domain and mechanism do not disclose a
   per-field extraction-confidence contract fused with a formulary-resolvability
   factor, three-band routing into a persisted queue that blocks downstream plan
   generation, a zero-network plane, or verdict precedence combining pairwise and
   combination rules. Reply on the specific inter-working, and commission a
   claim-level family search before drafting.
2. *"Confidence-routed human review is common general knowledge in medical AI
   documentation and pharmacy verification."* → Concede the generic concept and
   rely on the measured operating characteristic (unsafe auto-confirm elimination
   at bounded review load) plus the closed-loop consequences.
3. *"Uncertainty-based abstention is published, so refusing below a threshold is
   obvious."* → Same answer: the invention is not the threshold, it is the fusion
   with database resolvability plus the queue-blocking coupling and its measured
   curve.
4. *"The combination is an aggregation of individually known elements without a
   demonstrated synergistic effect."* → The A1→A4 and `-gate`/`-formulary_fusion`
   /`-queue_blocking` ablations are precisely synergy evidence: decouple the gate
   from the plane and agreement collapses and unsafe auto-confirmations
   reappear.
5. *"The only evidence offered is twelve synthetic cases."* → Answered only by
   executing E-A..E-G on the 300-case corpus before filing; the archived runs and
   the binder are that answer, with their limitations stated.

None of this guarantees allowance. It defines the fight.
