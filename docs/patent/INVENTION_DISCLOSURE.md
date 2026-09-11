# Invention disclosure (working draft)

**Status:** technical draft for counsel. Not legal advice. Not a filed document.
**Prepared:** 2026-09-11 · **Engine freeze reference:** see `EVIDENCE_BINDER.md` §0.

This disclosure fixes the story, the embodiments and the inventor-contribution
record. It is written so that a patent professional can draft a specification
from it without reading source code.

---

## 1. Title (working)

Confidence-gated perception-to-rule-plane boundary for medication verification,
with a persisted human-confirmation queue that blocks downstream plan generation.

## 2. Technical field

Computer-implemented medication-safety verification: systems that read a
prescription artifact with a machine-learning perception layer and produce a
safety verdict, where the perception layer's errors would otherwise propagate
silently into safety-relevant output.

## 3. Technical problem

In medication pipelines that read prescriptions with a language model:

1. **Extraction errors and hallucinated drug names propagate silently.** A model
   that misreads a brand, or invents one, produces output that looks exactly as
   authoritative as a correct read. The system cannot distinguish *read
   correctly* from *read confidently*.
2. **Hard refusal alone destroys usability; blanket acceptance destroys safety.**
   There is no principled, auditable operating point between the two.
3. **Class-level harms are invisible to pairwise-only screening** — the
   "triple whammy" (RAAS blocker + diuretic + NSAID), three or more QT
   prolongers, serotonin and bleeding stacks — none of which appear in a
   molecule-pair table.
4. **A reading that is under review must not silently unlock downstream
   automation.** Dose scheduling, adherence accounting and caregiver escalation
   must not run on unverified fields.

## 4. Summary of the invention

A medication-verification system in which machine-read prescription fields carry
**per-field confidence** across a typed contract into a **deterministic,
network-isolated safety plane** that **fuses formulary resolvability with reading
confidence** under a **three-band gate** (refuse / human-confirm / auto-confirm);
unresolvable or uncertain fields are routed to a **persisted confirmation queue
that deterministically blocks downstream therapy-plan generation** until a human
resolves them; and the plane assembles verdicts under a **fixed precedence law**
that includes **pairwise-invisible combination-class rules**, with **full
provenance** preserved per verdict.

The mechanism is not "an AI that advises". It is a **measurable decision
boundary**: reading confidence never crosses into safety output unless fused and
banded; uncertainty deterministically halts downstream automation; and the
verdict is assembled by a rule engine that performs no network calls.

## 5. Elements and inter-working

| # | Element | Function | Inter-working |
|---|---|---|---|
| a | Typed per-field perception contract | reader emits fields + confidence, no verdict channel | the only value crossing into the plane is a confidence number + a text field |
| b | Fusion function | `0.4 · formulary_resolvability + 0.6 · reading_conf` | makes an invented brand mathematically unable to auto-confirm (≤ 0.6 < 0.90) |
| c | Three-band gate | refuse < `r`; confirm `[r, c)`; auto ≥ `c` | refusal consumes perception confidence only; fusion can only demote |
| d | Deterministic rule plane | normalize → pairwise → combination-graph → contraindications → duplicates → aggregate caps | zero network; identical verdicts offline |
| e | Fixed verdict precedence | contraindication > severe interaction/combination > duplicate > moderate > dose breach > queue > pass | makes the combination stage verdict-relevant and testable |
| f | Persisted confirmation queue | single-transition state machine, first-action-wins, audit trail | non-empty queue blocks plan generation |
| g | Plan-blocking module | transactional check inside plan creation | the block cannot be raced or bypassed by the UI |
| h | Provenance persistence | threshold-set id, fused values, dataset snapshot SHA, rule source, engine SHA | the verdict can be re-derived |
| i | Refusal as a designed outcome | counted and displayed as success, not failure | makes the operating point auditable |

The inventive combination is **(b)+(c)+(f)+(g)** inside **(d)**: a fused score
routes fields into a persisted queue whose mere non-emptiness deterministically
prevents downstream generation, with the plane — not the model — assembling the
verdict.

## 6. Embodiments

**Essential**
- perception-confidence contract; formulary normalization index; three-band gate
  with fixed thresholds (values may vary); persisted confirm queue;
  queue-blocking of plan generation; deterministic rule plane; provenance.

**Optional (dependent-claim material)**
- combination-graph stage; aggregate dose caps; first-action-wins dose ledger
  with guarded skips; citation-contract copilot; cross-engine parity gate;
  family escalation on plan-start findings; model-egress kill switch;
  slot-traceable multilingual NLG.

**Alternative implementations**
- **Input modality:** pasted/typed text · schema-constrained vision (photo) ·
  spoken plans assembled from verified slots only.
- **Deployment:** client-only offline tier · server tier · both, in parallel,
  with a shared conformance corpus.
- **Thresholds:** fixed audited values · per-corpus fitted values with a
  calibration protocol and a frozen threshold-set id.
- **Banding:** on reading confidence (default) · on the fused score
  (asymmetric-band refinement) · with a fuzzy/unresolvable brand always demoted
  regardless of confidence.
- **Knowledge source:** curated snapshot · versioned RxNorm / DDInter /
  DailyMed snapshots with hash pinning.

**Fallback ladder (survival embodiments, narrowest last)**
- **F1** the full pipeline claim;
- **F2** gate law + queue blocking, without the combination stage;
- **F3** the fusion formula + bands together with the calibration protocol;
- **F4** queue-blocking semantics alone, tied to perception confidence.

## 7. Public-disclosure status (inventorship-critical)

`master` is already public and already discloses: the "model reads, rules
decide" law, the numeric thresholds, and a 12-case ablation. That public
material is prior art against later filings from its publication date —
including by the team. Everything added since (this package, the 300-case
corpus, the run manifests, the calibration result, the binder) is **not** public
until it is pushed. See `README.md` in this directory.

## 8. Inventor contribution records

To be completed and signed by the team, with commit references. The commit
history is the factual basis; `git log --oneline` and the run manifests
(`eval/runs/`) date every increment. At minimum record, per named inventor:

- the conception contribution (which claimed element, with dates);
- the reduction-to-practice contribution (which code path, which commit);
- the experimental contribution (which experiment, which run id).

Do **not** name contributors who did not make an inventive contribution, and do
not omit one who did — inventorship is a legal determination made on these
facts. Students affiliated with an institute must also check the institute's IP
policy for ownership/assignment before filing.

## 9. What is deliberately not claimed

A diagnosis or triage system; commerce/fulfilment; wearable integration;
microservices; a vector database; a generic "AI + healthcare" framing; the
public drug-interaction data itself; clinical efficacy. Any of these would
weaken the claim story and invite easy rejection.

## 10. Conclusions requiring professional review

Patentability of the claim concepts in `CLAIMS.md`; Section 3(k)/technical-effect
characterisation; claim-level clearance around the nearest granted family;
inventorship, applicant and ownership; provisional-versus-complete and PCT
geography; and the effect of the repository's existing public disclosure.
