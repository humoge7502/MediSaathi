# Dual-annotator protocol (MED-005)

Target: two independent pharmacist annotators label every case verdict, then a
third (or senior) annotator adjudicates disagreements. Compute agreement with
`python kappa_check.py <sheet.csv>`; target Cohen's kappa >= 0.70.

## Steps
1. Ship `cases_annotation_sheet.csv` (300 rows) and `regimen_annotation_sheet.csv`
   (113 rows) to two annotators. They must label independently - no discussion
   until adjudication.
2. Each annotator fills `annotatorN_verdict` with one of:
   `pass | interaction | contraindication | duplicate_atc | confirm_queue | refused`
   and `annotatorN_findings` with a short free-text reason (e.g. "warfarin+NSAID bleeding").
3. Rows where the two annotators disagree go to adjudication: the adjudicator
   writes `adjudicated_verdict` and `adjudicator_note`.
4. Run kappa. Below 0.70 -> review the codebook (data/corpus/codebook.json),
   re-calibrate on 20 sample cases, re-annotate.
5. Archive the final sheets under data/annotation/ and reference them in
   docs/EXPERIMENTS.md (MED-005 close-out), then rebuild evidence:
   `python tools/run_experiments.py --all && python tools/export_evidence.py`.

## Honesty contract
- The sheet ships with the corpus text only; no engine verdicts are pre-filled.
  Annotators must not run the engine first - the point is human agreement.
- Adjudicated labels (not engine outputs) become the corpus labels for the
  kappa claim. Record annotator identities in the run manifest, not in the
  public sheet (pseudonymous IDs are fine).
