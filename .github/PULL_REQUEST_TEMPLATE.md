## What does this PR change?

<!-- One paragraph: the problem, the fix, and why the fix is the simplest
     thing that genuinely solves it. -->

## Which laws does this touch?

MediSaathi has laws that must not bend silently. Tick every one your change
interacts with, and state how it is preserved (or deliberately amended):

- [ ] The gate law: refuse < 0.75 · confirm 0.75–0.90 · auto-confirm ≥ 0.90
- [ ] The safety plane is deterministic and zero-network
- [ ] Refusal is a designed success state, never a hidden failure
- [ ] The double-dose guardrail (first action wins)
- [ ] Unverified fields never reach spoken/rendered safety output
- [ ] Declared context survives confirm / plan-start re-screening
- [ ] No fabricated numbers, no claimed compliance, no medical claims

## Evidence (required)

- [ ] `make test` (API suite) passes — N tests
- [ ] `make web-check` (lint + typecheck + selftest + integration + build) passes
- [ ] New behavior is covered by a test that fails without this change
- [ ] If a claim changed (README/docs), the number is measured, not aspirational

## Notes for reviewers

<!-- Anything surprising: tradeoffs made, alternatives rejected, follow-up
     debt filed in docs/TECH_DEBT.md. -->
