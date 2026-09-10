# Testing Strategy & Results

**Latest run: 90 passed in <1s** (64 original + 26 red-team/regression). All
numbers in this file are from actual runs; nothing is aspirational.

```bash
make test          # full API suite (safety properties + API + perception + red-team)
make demo-check    # offline demo gate: six verdict kinds + plan + price + metrics
make eval          # benchmark: brand/frequency recall, verdict agreement, refusal precision
make ablation      # A1-vs-A4 counterfactual (the gate IS the product)
python3 tools/bench.py   # latency p50/p95/p99 (see PERFORMANCE.md)
cd apps/web && npx tsc --noEmit && npm run build   # frontend gate (CI-enforced)
```

## The pyramid (as implemented)

| Layer | Location | What it pins | Count |
|---|---|---|---|
| Property/unit | `tests/test_safety*.py` | gate-law properties, interaction shuffles (no false positives across the pair graph), NLG slot traceability, dose arithmetic | 30+ |
| Parser regression | `tests/test_vision.py` | the original scaffold's regexes were silent no-ops; every pattern is pinned | 13 |
| API golden paths | `tests/test_api.py`, `test_api_v2.py` | pipeline→plan→price, upload gating, envelope invariants, judge cache | 21 |
| Red-team + regression | `tests/test_redteam.py` | see below | 26 |
| Offline E2E | `tools/demo_check.py` | all six verdict kinds through real HTTP + plan + price + refusal counter | 1 gate |
| Frontend | CI | `tsc --noEmit` + `next build` | 2 gates |

## Red-team coverage (`tests/test_redteam.py`) — what each test protects

| Test | Failure mode it forecloses |
|---|---|
| `test_confirm_rescreens_with_declared_context` | **Verified regression:** confirm endpoint used to re-screen with an empty context — pregnancy/child contraindications silently vanished after any human confirmation. Now the context persists on `PrescriptionState` and the child-doxycycline canary fails loudly if the law breaks. |
| `test_security_headers_present_on_every_response` | missing `nosniff`/`DENY`/CSP on any route |
| `test_request_id_*` | log-correlation gaps; CRLF/unicode/oversize id injection |
| `test_upload_rejects_non_image_magic_bytes` | JSON/HTML payload wearing `image/jpeg` reaching the vision path |
| `test_upload_rejects_wrong_declared_mime` | content-type confusion |
| `test_rate_limit_429_and_recovery` | unbounded write abuse; 429 must be an Envelope, not a raw string |
| `test_metrics_schema_fail_counter_is_real` | **Verified regression:** `llm_schema_fail_total` was hardcoded `0` — now bound to the real counter |
| `test_confirm_rejects_out_of_range_field` / `_unknown_brand` / `_unknown_prescription` | IDOR-adjacent input abuse on the confirm endpoint |
| `test_context_garbage_keys_are_dropped_silently` | unknown context codes influencing rules |
| `test_formulary_search_unicode_and_injection_safe` | injection/unicode/oversize search abuse |
| `test_prompt_injection_in_fixture_lines_never_captures_verdict` | injected instructions in extracted text must be inert: never reach verdict fields, never fabricate kinds — decisions stay rule-derived |
| `test_plan_blocked_for_refused_and_queued` | unverified fields leaking into the spoken plan |

## Regression law

Every bug found during audit or red-team gets a test that fails before the fix
and passes after. Do not loosen a red-team test to make a merge green — fix the
system; the test documents a real attack or failure.

## Known gaps (honest)

- E2E browser automation (Playwright) not yet added; the offline demo gate +
  typecheck + build are the current UI gates. `TODO` in TECH_DEBT.md.
- Accessibility is built to WCAG 2.2 AA conventions (semantic landmarks,
  aria-live verdict, labeled inputs, focus-visible, reduced-motion, contrast
  mode) but not yet audited by axe-core in CI. Same TODO.
- No performance tests beyond the latency bench (no sustained-load rig).
