# Judge Q&A Bank (condensed - full 26-question bank in the Master Plan)

Rule: concede what is true, pivot to what is built, never bluff.

- **Why not just ChatGPT?** Raw LLMs hallucinate doses fluently. We demo the
  side-by-side and the benchmark where raw fails normalization and refusal.
  The model is our sensor, never our judge.
- **Dose misread but confident?** The deterministic plane re-checks plausibility
  and interactions regardless of model confidence; inconsistencies queue or refuse.
- **Handwriting?** Severe scrawl -> confirm queue or refusal, by design, and it
  is measured per-field on the labeled set.
- **DDInter is non-Indian?** Interaction pharmacology is population-general;
  versioned snapshot, severity cited, ambiguous cases routed to the pharmacist.
- **Liability?** Information layer; never recommends or adjusts; refusal is the
  default under uncertainty; framing in footer + audio outro.
- **n=50 is small.** It is honest: codebook published, per-field metrics,
  results JSON committed; roadmap to 300 cases written.
- **Moat?** The labeled Indian prescription dataset, refusal-precision
  discipline, provenance UX - assets that compound.
- **Why SQLite?** Zero-dependency, zero-failure at event scale; Postgres
  migration scripted; boring-on-purpose was a risk decision.
- **What breaks at scale?** Vision quota economics -> fine-tuned small model
  is on the roadmap; the safety plane is sensor-agnostic.
- **Proudest code?** The refusal gate + verdict assembly: small, property-
  tested, the product thesis in one file. `apps/api/app/verdict.py`.
