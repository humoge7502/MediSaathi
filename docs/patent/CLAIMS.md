# Claim-concept pack (working document for counsel)

**Not legal advice.** Concept drafts to be tested, narrowed or replaced by a
registered patent professional. Claim-level clearance around the nearest granted
family is a prerequisite, not an assumption.

The architecture centres on the minimum technical combination that produces the
measured effect: typed per-field confidence → fusion with formulary
resolvability → three-band routing → persisted queue blocking downstream
generation → deterministic plane with precedence assembly. Everything
medication-specific becomes a dependent limitation.

---

## 1. Independent system claim (concept draft)

A medication-verification system, comprising:

- a **perception subsystem** that receives a prescription artifact and emits
  structured medication fields, each field carrying a machine-generated
  **confidence value** indicating reliability of the read;
- a **deterministic decision plane**, isolated from network access during
  evaluation, that (a) normalises confirmed fields against a formulary index,
  (b) screens normalised medications by pairwise interaction, combination-class,
  contraindication-context, duplicate and aggregate-dose rules, and (c)
  assembles a verdict by a **fixed precedence order**;
- a **gating module** that combines, for each field, the confidence value with a
  **formulary-resolvability measure** into a fused score and routes the field
  into one of at least three bands: **refusal, human confirmation, or automatic
  confirmation**, wherein fields in the refusal band are never evaluated by the
  decision plane and never emitted as verified, and a field that fails to
  resolve against the formulary index is never auto-confirmed;
- a **persisted confirmation queue** storing fields routed to the
  human-confirmation band together with the reason for routing; and
- a **plan-blocking module** that, while the confirmation queue is non-empty,
  deterministically prevents generation of any downstream therapy plan derived
  from the prescription artifact, and records provenance of dataset snapshots,
  rule versions and per-field scores with each verdict.

## 2. Independent method claim (concept draft)

A computer-implemented method for verifying a prescription, comprising:

- receiving prescription text or an image thereof;
- extracting, by a language model constrained to a schema, structured medication
  fields each with a **per-field reading confidence**;
- **fusing** each field's reading confidence with a formulary-resolvability
  measure of the field against a drug formulary index to obtain a fused score;
- routing each field by fused score into a **refusal band, a human-confirmation
  band, or an automatic-confirmation band**; wherein all-below-refusal inputs
  produce a refusal verdict without rule evaluation, and any below-refusal field
  produces a queued verdict;
- screening only automatically-confirmed fields with a deterministic rule engine
  comprising pairwise interaction, combination-class, contraindication,
  duplicate and aggregate dose-cap checks, the engine performing **no network
  calls** during screening;
- assembling a verdict by **fixed precedence** over findings;
- persisting the verdict with provenance comprising dataset snapshot
  identifiers and per-field fused scores; and
- **withholding generation of a therapy plan while any field remains unresolved
  in a persisted confirmation queue**.

## 3. Dependent-claim feature ideas

| id | Feature | Evidence today |
|---|---|---|
| D1 | Fusion's documented form (formulary-confirmed ratio 0.4 + mean reading confidence 0.6) and the re-fitting protocol on calibration splits | implemented both tiers; E-D |
| D2 | Combination-class stage (RAAS+diuretic+NSAID; QT ≥ 3; serotonin; bleeding) emitted into the same finding stream as pairwise interactions | implemented + parity |
| D3 | **Asymmetric bands**: the refusal band consumes perception confidence only, while confirm/auto consume the fused score | implemented + tested both tiers |
| D4 | **Unmatched-brand fields always routed to the confirmation band** irrespective of reading confidence | implemented + tested both tiers |
| D5 | First-action-wins dose ledger: single-transition dose rows, replay refusal, persisted guarded skips, no-double-dose catch-up law | implemented + adversarial tests |
| D6 | Copilot gates: emergency-pattern triage and scope refusal preceding retrieval; retrieval-floor refusal; citation range validation; dosage post-check | implemented + eval |
| D7 | Schema-constrained vision embodiment (temperature 0, one retry, model refusal-reason enum as sensor report; the refusal verdict is assembled deterministically) | implemented, unbenchmarked |
| D8 | Cross-engine parity embodiment: the same rule law in two independent engines, gated in CI by a shared golden corpus | 110/110 measured |
| D9 | Provenance embodiment: per-verdict dataset snapshot SHA, rule source, engine version, threshold-set id and fused per-field scores | implemented |
| D10 | Model-egress kill switch: configuration that disables all outbound model calls while preserving full deterministic verification | implemented + egress test |
| D11 | Family-escalation embodiment: escalation when a plan originates with safety findings, and on adherence-decay thresholds | implemented |
| D12 | Slot-traceable multilingual spoken plan: output assembled only from verified slots by templates, never free generation | implemented |
| D13 | **Longitudinal regimen state**: the rule plane evaluated over the time-composed union of the incoming prescription and the patient's active regimen, findings tagged `crossing` | implemented + E-H (n=113) |
| D14 | **Verdict-level uncertainty propagation**: per-field identity mass over a confusion neighbourhood + unknown residual; exact enumeration to a verdict distribution; the `crossing`/fragility quantities | implemented + tested |
| D15 | **Fragility-to-queue coupling**: the confirm queue is entered when read uncertainty could *hide* harm and fragility exceeds a threshold, and deliberately not otherwise | implemented + E-H ablation |

## 4. Claim-strength matrix

| Claim | Novelty | Inventive step | Technical contribution | Evidence today | Design-around risk |
|---|---|---|---|---|---|
| Independent system (§1) | Medium-High, given claim-level clearance | Medium — needs E-A/E-B | Strong: measurable safety-burden operating point | n=44 test split, A4 unsafe 0.000 / agreement 1.000 | Medium — queue blocking is hard to avoid in a verifying system |
| Independent method (§2) | Same | Same | Same | Same | Medium |
| D1 fusion | Medium | Medium | Medium | implemented; E-D | High — weights are tunable, keep dependent |
| D2 combination stage | Low-Medium | Low-Medium | Medium | implemented + parity | High standalone |
| D3 asymmetric bands | Medium | Medium | Medium | implemented + tested | Medium |
| D4 unmatched-brand queueing | Medium | Medium | Medium | implemented + tested | Medium-High |
| D5 dose ledger | Medium | Medium | Medium | implemented + adversarial | Medium |
| D6 copilot gates | Low-Medium | Low | Medium | implemented + eval | High |
| D7 vision embodiment | Low | Low | Supporting | implemented, unbenchmarked | High |
| D8 parity embodiment | Medium (packaging) | Medium | Supporting | 110/110 measured | High |
| D9 provenance | Medium | Medium | Supporting | implemented | Medium-High |
| D10 kill switch | Low | Low | Supporting | implemented | High |
| D11 escalation | Low | Low | Product | implemented | High |
| D12 spoken plans | Low-Medium | Low-Medium | Supporting | implemented | Medium-High |
| D13 regimen-state composition | Medium | Medium | Strong | n=113, cross-catch 0.000 → 0.949 | Medium — union screening is a natural extension once the problem is recognised |
| D14 verdict uncertainty propagation | Medium-High | Medium | Strong | implemented; E-H | Medium — the exact-enumeration + unknown-residual form is specific |
| D15 fragility→queue coupling | Medium | Medium | Strong: bounded review cost | E-H ablation (0.949 → 1.000 at 3.5% queue) | Medium |

## 5. Ten-question red-team on the independent claim

1. **What prior art could anticipate it?** Nearest granted family on
   model-proposes/rules-decides in clinical software (claim-level unverified);
   pharmacy verification-queue practice; ambient-scribe confidence routing;
   abstention literature for the refusal band.
2. **Most vulnerable limitation?** "Persisted confirmation queue" — review
   queues are old. Wording that reads on *human review of low-confidence output
   generically* is vulnerable.
3. **Hardest limitation for prior art to satisfy?** The conjunction: a fused
   score of formulary resolvability × reading confidence **and** three bands
   **and** a queue whose non-emptiness deterministically blocks downstream plan
   generation **and** a zero-network plane assembling the verdict itself.
4. **Is it implemented?** Yes — the plan route returns 409 on a non-empty queue;
   contracts, routes and tests exist in both tiers.
5. **Can it be experimentally demonstrated?** Yes — E-B's `-queue_blocking` and
   `-gate` ablations show the safety property disappears when the coupling is
   removed; E-A shows the operating characteristic.
6. **Does removing it destroy the advantage?** Yes — unblocking plans under
   uncertainty re-exposes downstream dose scheduling to unverified fields, the
   exact harm class the system exists to prevent.
7. **Could a competitor design around it?** By not blocking (advisory warnings
   only) or by not fusing formulary resolvability. The F2/F3 fallbacks catch the
   first; D1/D4 catch the second.
8. **Is there a narrower fallback?** F4: queue blocking tied to
   perception-confidence bands without fusion.
9. **A broader defensible formulation?** Replace "three bands" with "a plurality
   of disposition bands including refusal and human confirmation, selected by a
   fused score of machine confidence and database resolvability"; replace "plan"
   with "downstream safety-relevant action item". Breadth here must be tested
   against the nearest family by counsel.
10. **What evidence before filing?** E-A operating characteristic; E-B ablations
    including queue-blocking removal; E-D calibration; a claim-level search of
    the nearest family.

## 6. Second independent claim concept (added 2026-09-11)

A medication-verification method, comprising:

- receiving a prescription artifact and extracting medication fields each with a
  machine-generated reading confidence;
- **composing a time-scoped regimen state** from one or more previously verified
  medications active at a stated time, together with the incoming fields;
- for each incoming field, computing a **distribution over database identities**
  comprising the resolved identity at the reading confidence, a residual mass
  distributed over a **confusion neighbourhood** of the resolved identity, and an
  explicit residual `unknown` mass that cannot promote a field;
- **enumerating assignments** of identities across the incoming fields and
  evaluating a deterministic rule plane over the union of each assignment with
  the regimen state, thereby obtaining a **distribution of verdicts**;
- computing, from that distribution, a **fragility** = the mass of assignments
  whose verdict differs from the assignment of highest mass;
- **routing to a persisted confirmation queue** when (i) fragility exceeds a
  threshold and (ii) a reachable verdict is of greater harm than the nominal
  verdict, and otherwise publishing the nominal verdict;
- and blocking downstream therapy-plan generation while the queue is non-empty.

**Most vulnerable limitation.** "Medication reconciliation" and "uncertainty
quantification" are both old. The defence is the *conjunction*: a rule plane
over a time-composed union **and** an explicit identity-mass distribution with an
unknown residual **and** the fragility-to-queue coupling restricted to the
could-hide-harm condition **and** the measured operating curve. Any one alone is
anticipated; the coupling and its measurement are the novelty claim.

**Hardest limitation for prior art to satisfy.** Uncertainty that can only ever
*demote* (an unknown residual cannot promote an identity), propagated exactly
through a deterministic medication rule graph, and used as a queue-entry
condition rather than an advisory score.

## 7. What must not be claimed

- The generic pattern "LLM proposes, rules decide" (broad prior art).
- Human review of low-confidence machine output as such.
- Refusing below a confidence threshold as such (published abstention methods).
- The drug-interaction data itself.
- Anything reading as diagnosis, dosage advice, or clinical validation.
- A laundry list of app features: the claim must show a **single inter-working
  technical solution** with a measured technical effect.
