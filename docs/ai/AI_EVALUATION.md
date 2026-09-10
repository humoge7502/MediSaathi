# AI Evaluation Plan

**Status:** fixture evaluation is implemented; live-model evaluation is proposed and not yet run.  
**Safety position:** this is an information prototype, not clinical validation.

## What is evaluated today

`eval/eval.py` runs 12 sealed synthetic-curated cases through the actual fixture pipeline. It reports brand recall, frequency recall, verdict agreement, refusal precision, and latency. The A1 raw-read versus A4 full-pipeline ablation tests the architectural claim that reading and deciding are separate concerns.

Latest verified local results:

- A4: brand recall 1.0, frequency recall 0.9444, verdict agreement 1.0, refusal precision 1.0, n=12.
- A1: verdict agreement 0.1667, n=12.

These results are corpus-specific and must not be generalized to clinical performance.

## Live-vision evaluation protocol (proposed)

Create a held-out, consented or synthetic corpus with per-field labels for:

- brand, molecule, strength, dose, frequency, duration;
- image quality and script/language;
- prescription/non-prescription status;
- ambiguity and expected human review outcome.

For every provider/model version, record model ID, prompt version, schema version, dataset hash, latency, token/cost metadata, and failure category. Never include patient identifiers in evaluation logs.

## Metrics

### Perception

- exact and normalized brand recall/precision;
- field-level exact match and edit distance;
- confidence calibration (reliability curve, Brier score where labels support it);
- refusal recall/precision for unusable and non-prescription images;
- schema validity and retry rate;
- latency p50/p95 and error rate.

### Safety boundary

- false-negative rate for seeded interactions/contraindications/duplicates;
- false-positive rate on a shuffled no-interaction set;
- percentage of unverified fields blocked from plan output;
- human-confirmation rate and resolution accuracy.

### User-facing output

- citation/provenance presence and correctness;
- slot traceability: every medication/dose claim must map to a verified field;
- translation review by fluent speakers; do not treat automated fluency as clinical correctness;
- harmful-request refusal and escalation behavior.

## Adversarial cases

1. Prompt injection in raw prescription text.
2. A model returning a fabricated verdict field.
3. High-confidence but unknown brands.
4. Conflicting dose/frequency strings.
5. Empty, blurred, non-prescription, and malformed images.
6. Oversized and MIME-spoofed uploads.
7. Requests to change or recommend a dose.
8. A retrieved/source document containing instructions to ignore system policy.
9. Sensitive data in model output or error messages.
10. Provider timeouts, schema failures, and duplicate submissions.

## Acceptance rules

- The model may propose extraction fields only.
- A failed schema or provider call is observable and fails closed.
- Unknown or below-threshold fields cannot unlock speech or price output.
- No evaluation result is promoted to a clinical claim without an appropriate human/clinical validation program.
