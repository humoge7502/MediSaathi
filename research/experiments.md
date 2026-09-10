# Experiments — MediSaathi / Vaidya

Research question: **Can a confidence-gated perception plane plus a
deterministic, source-attributed safety plane reduce unsafe software outputs
relative to a raw-read baseline, while increasing transparent human-review
opportunities?**

Everything below is split into **RUN** (measured, reproducible in this
repository) and **PROPOSED** (designed but not executed — no fabricated
results).

---

## RUN — the A1 vs A4 ablation (measured)

| Pipeline | What runs | Verdict agreement with labels (n=12) |
|---|---|---|
| A1 "raw read" | extracted fields → verdict, **no confidence gate, no formulary/rule screen** | **0.17** |
| A4 full | schema-constrained extraction → confidence gate → deterministic rules → verified-only NLG | **1.00** |

Also measured (A4): brand recall 1.00, frequency recall 0.94, refusal
precision 1.00. Reproduce with `make ablation` and `make eval`.

**Interpretation (claimed, defensible):** the safety plane, not the reading,
carries the verdict correctness on this corpus. The A1 counterfactual
demonstrates the gate/formulary contribute ~0.83 agreement — that number is
the product's engineering thesis, not a clinical claim.

**Limitations of the RUN set:**
- n=12 synthetic-curated fixtures; not a clinical corpus.
- Fixture parsing uses a narrow line grammar (OCR simulation), so recall
  numbers do not generalize to free text.
- Single model (fixtures are text; live vision path is key-gated and not
  part of the sealed benchmark).

---

## PROPOSED — experiment protocol (not yet run)

### E1. Confidence-gate calibration study
- **Question:** at what per-line confidence thresholds do refusal precision
  and recall trade off optimally on a labeled corpus?
- **Method:** sweep gate thresholds (0.60–0.95) across a labeled corpus with
  per-field labels; plot precision-recall for auto-confirm vs human-confirm.
- **Metrics:** refusal precision/recall, confirm-queue precision, false-
  negative rule findings, calibration (ECE-style bins of extraction
  confidence vs actual brand-match accuracy).
- **Dataset needed:** 300-case labeled set with per-field + adjudicated
  safety labels (currently 12; roadmap).

### E2. Retrieval evaluation for the grounded copilot
- **Question:** how well does the zero-dependency BM25 retrieval satisfy
  answer-groundedness vs a dense-embedding baseline?
- **Method:** on a held-out QA set with labeled relevant chunks: hit@k,
  MRR, and answer-level *groundedness* (every claim traceable to a cited
  chunk) scored by the rubric judge + human spot-check.
- **Metrics:** hit@3, MRR, groundedness rate, refusal rate on out-of-scope
  probes (deterministic floor behavior), hallucination rate.
- **Note:** the retrieval floor (2.2) is currently a hand-set constant;
  E2 would make it evidence-based.

### E3. Cross-tier parity test (Python vs TypeScript safety planes)
- **Question:** do the two independent implementations of the same law agree
  on every case?
- **Method:** run the union of both corpora through both engines; diff
  verdicts and findings.
- **Metrics:** verdict agreement rate, finding-level agreement, divergence
  report.
- **Current status:** both suites exist independently (93/96 Python tests,
  18-case TS suite); a shared parity harness is proposed.

### E4. Hallucination / refusal behavior suite
- **Question:** under adversarial prompts and low-retrieval questions, how
  often does the system fabricate vs refuse?
- **Method:** extend `EVAL_CASES` with prompt-injection, out-of-scope,
  and ambiguous-dosing probes; automated rubric + manual review.
- **Metrics:** refusal rate on traps (target 100%), fabrication rate on
  out-of-scope (target 0%), safe-dosing violations (target 0).

### E5. Human-in-the-loop confirmation study (product-level)
- **Question:** does the confirm queue improve user task accuracy vs
  auto-approval or blanket refusal?
- **Method:** randomized user study with synthetic prescriptions (task:
  "is this prescription safe to start?"), three arms: raw read, auto-gate,
  confirm-queue.
- **Metrics:** task accuracy, time-to-decision, perceived trust, refusal
  acceptance.

---

## Dataset plan (PROPOSED — no dataset is claimed to exist yet)

1. Extend the 12-case sealed corpus to a **50-case labeled set** with
   per-field labels (brand/molecule/strength/frequency) and adjudicated
   safety labels (verdict + finding-level).
2. Publish a codebook; track inter-annotator agreement.
3. Replace synthetic-curated rule tables with **versioned snapshots**
   (DDInter / RxNorm / DailyMed) pinned by git SHA, so every verdict is
   reproducible against a specific dataset version.
4. Hold out a fixed 20% eval split; never tune against it.

## Reproducibility guarantees

- The RUN results are reproducible from a clean clone: `make test`,
  `make eval`, `make ablation`, `make demo-check`, `make web-check`,
  `make web-e2e` — no keys, no network.
- Dataset provenance is recorded per table in `data/sources.json` and shown
  in-product wherever data is displayed.
- No experimental result in this file (or any doc) is invented; anything
  not yet executed is explicitly labeled PROPOSED.