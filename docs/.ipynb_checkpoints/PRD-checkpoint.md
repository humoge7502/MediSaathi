# MediSaathi PRD (condensed)

## Personas

1. **The patient / caregiver** (primary): holds a paper prescription at a
   pharmacy counter or at home. Often non-English-preferred. Cannot verify
   interactions, cannot tell a duplicate from a complement, cannot judge
   generics. Needs: understand, hear, afford, and know when *not* to trust.
2. **The pharmacist** (secondary): 3-minute counter interaction, needs to catch
   prescribing errors fast and document ADRs with zero friction.
3. **The judge / evaluator** (demo persona): needs to see honesty under
   pressure - refusal behavior, provenance, measurement.

## Jobs to be done

- When I hold a prescription, I want every medicine explained in my language,
  so I can take the right thing at the right time.
- When two medicines are risky together, I want it flagged from public data with
  the source shown, so I can ask my pharmacist the right question.
- When the system cannot read the paper, I want it to say so plainly, so I never
  act on a guess.
- When I experience a side effect, I want a PvPI-ready report in one tap, so the
  report actually gets filed.

## Product laws (inviolable)

1. **The model reads; the rules decide.** No LLM ever produces or modifies a
   safety verdict.
2. **Nothing below the gate is spoken or rendered.** Fields < 0.90 confidence go
   to a human confirm queue; < 0.75 refuses.
3. **Refusal is a designed success state** with a measured counter.
4. **Every spoken word traces to a verified slot** (NLG templates only; tested).
5. **Every verdict carries provenance** (snapshot, source, engine).
6. **Patient context is declared, never inferred** (privacy by construction).

## Success metrics

- Verdict agreement and refusal precision on the labeled benchmark (see README).
- Refusal counter > 0 in any honest demo - the system shows its discipline.
- Confirm-queue resolution time (post-event: instrumented queue console).
- ADR drafts reviewed-and-submitted (post-event funnel).

## Non-goals (event build)

- Diagnosing, dosing advice, or any recommendation - information layer only.
- Selling or substituting medicines (price check is informational).
- Storing identifiable patient data (store holds pipeline state only).
- Online connectivity as a dependency (three-tier offline-first design).
