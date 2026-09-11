# Normative pseudocode of the inventive mechanism

This document is the language-neutral statement of the mechanism claimed in
`CLAIMS.md`. It is normative: `apps/api/app/gate.py`,
`apps/web/src/lib/safety/gate.ts`, `apps/api/app/queue.py` and
`apps/web/src/lib/queue.ts` implement exactly this, and the cross-engine parity
gate (`eval/parity/golden.json`, 110 cases) fails the build on any divergence.

Frozen parameter set for the evidence runs: `v1-2026-09`
(`refuse_below = 0.75`, `confirm_below = 0.90`, fusion weights `0.4/0.6`).

---

## 1. Typed perception contract

```
perceive(artifact) -> Field[]
Field := {
  raw_text        : string        # exactly what is visible on the line
  brand_text      : string | null # the reader's best brand/molecule read
  strength, dose,
  frequency,
  duration        : nullable
  confidence      : float in [0, 1]   # the reader's own reliability estimate
}
```

The reader may only *propose* fields. It has no channel to a verdict.

## 2. Formulary resolvability

```
resolvable(field) -> bool
    row := normalize(field.brand_text or field.raw_text)
    return row is not None            # exact match, else longest-substring fallback
```

`normalize` is deterministic, network-free and reads a local formulary index.

## 3. Fusion function

```
fuse(confidence, resolvable, w = {formulary: 0.4, reading: 0.6}) -> float
    return w.formulary * (1 if resolvable else 0)
         + w.reading   * clamp01(confidence)
```

Constraints enforced at construction: `w.formulary + w.reading = 1`,
both weights ≥ 0. A confidently-read but unresolvable field therefore scores at
most `w.reading = 0.6`, strictly below both band thresholds. **Fusion can only
demote a field, never promote it.**

Prescription-level fused score (provenance only):

```
fuse_prescription(confirmed, queued, confidences, w) -> float
    total := confirmed + queued
    if total = 0 or confidences is empty: return 0
    return round(w.formulary * (confirmed / total)
               + w.reading   * mean(confidences), 2)
```

## 4. The three-band gate law

```
band_of(confidence, resolvable, ts) -> {band, fused, reason}
    fused := fuse(confidence, resolvable, ts.fusion)

    # Design law 1: the refusal band consumes PERCEPTION confidence only.
    if confidence < ts.refuse_below:
        return {band: "refused", fused, reason: "confidence below refusal threshold"}

    gate_value := (ts.banding == "fused") ? fused : confidence

    # Design law 2: an unresolvable read never auto-confirms, at any confidence.
    if not resolvable:
        return {band: "confirm", fused, reason: "brand not in formulary"}

    if gate_value < ts.confirm_below:
        return {band: "confirm", fused, reason: "below auto-confirm threshold"}

    return {band: "auto", fused, reason: "resolvable above auto-confirm threshold"}
```

Aggregate routing (unchanged from the audited default):

```
if every field is in the refusal band  -> verdict := REFUSED   # never guess
if any field is in the confirm band    -> verdict := CONFIRM_QUEUE
otherwise                              -> verdict := deterministic plane verdict
```

`banding = "reading"` is the frozen default. `banding = "fused"` is an
alternative embodiment, measured by E-D; the default is promoted only if a
fitted point strictly reduces review burden at equal-or-better safety (see E-D).

## 5. Deterministic safety plane (zero network)

Only auto-confirmed fields are screened, in this fixed order:

```
plane(fields) -> findings
    normalized := [normalize(f) for f in fields if f.auto_confirmed]
    1. pairwise interactions           interactions_by_pair[{mol_a, mol_b}]
    2. combination-class graph rules   set membership over the active molecule set
                                       (RAAS+diuretic+NSAID "triple whammy";
                                        >= 3 QT-prolonging; serotonin stack;
                                        bleeding stack)
    3. contraindications               molecule x declared patient context code
    4. duplicate detection             shared ATC class across lines
    5. aggregate daily dose caps       sum per molecule; compare to the cap table
```

The plane imports no model client and opens no socket. If every model vanished,
verification, scheduling, adherence, family escalation and the evidence tab
would still run; verdicts are unchanged (E-F offline proof).

## 6. Verdict precedence

First match wins, in this order:

```
contraindication  >  severe interaction | severe combination  >
duplicate         >  moderate interaction  >
severe dose breach >  confirm_queue  >  pass
```

Every finding carries mechanism + source; every verdict carries the non-empty
set of findings that produced it.

## 7. Persisted confirmation queue (single-transition state machine)

```
QueueRow := {prescription_id, field_index, raw_text, reading_confidence,
             fused, band, why, state, resolved_brand, actor, note, timestamps}
             UNIQUE(prescription_id, field_index)

state ∈ {pending, confirmed, rejected};  terminal states never transition again

sync(prescription_id, queued_fields):
    for each queued field
        if row absent                  -> insert state = pending
        elif row.state = pending       -> refresh metadata only
        else                           -> leave the human's decision untouched

resolve(prescription_id, field_index, accepted):
    BEGIN IMMEDIATE
        row := select ... for (prescription_id, field_index)
        if row.state != pending: return (row, replayed = true)   # protocol, not error
        row.state := accepted ? confirmed : rejected
        append transition(pending -> state, actor, note)
    COMMIT
```

## 8. Plan blocking (the downstream-effect clause)

```
blocked_reason(prescription_id) -> string | null
    pending := count(rows where state = pending)
    return pending == 0 ? null : "<n> field(s) awaiting human confirmation"

assert_plan_allowed(tx, prescription_id):
    BEGIN IMMEDIATE                      # same write lock as the plan insert
        if count(pending rows) > 0: ROLLBACK; raise BLOCKED
    COMMIT
```

The block is evaluated *inside* the plan-creation transaction, so two concurrent
plan starts cannot both observe an empty queue and race past each other. The
human's corrected read replaces the field, the plane **re-screens against the
run's original declared context** (never an empty context), and the verdict is
re-assembled and persisted with provenance.

## 9. Provenance persisted with every verdict

```
provenance := {
  threshold_set_id,            # which frozen parameters produced this decision
  prescription_fused,          # 0.4 * formulary ratio + 0.6 * mean reading conf
  per_field: { band, fused, resolvable, reading_confidence, reason },
  dataset_snapshot_sha256,     # data/manifest.json snapshot id
  rule_source,                 # per-finding source (DDInter, Stockley, FDA, ...)
  engine_git_sha
}
```

A verdict without its threshold set and dataset snapshot cannot be re-derived,
so it is not persisted as a verdict.
