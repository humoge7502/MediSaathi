# Testing Strategy & Results

**Latest runs (both actual, nothing aspirational):**
- API tier: **93 passed in 1.01s** (safety-plane properties + API golden paths + perception + red-team).
- Web tier: **18/18 engine self-test (100%) + 3/3 copilot refusal gates** (pure TS, zero network), typecheck clean, `next build` green.

```bash
make test          # API suite (safety properties + API + perception + red-team)
make demo-check    # offline demo gate: six verdict kinds + plan + price + metrics
make eval          # API benchmark: brand/frequency recall, verdict agreement, refusal precision
make ablation      # A1-vs-A4 counterfactual (the gate IS the product)
make web-check     # web gate: typecheck + selftest + build
cd apps/web && bun run selftest   # deterministic engine suite + copilot gates (CI-enforced)
```

## The pyramid (as implemented)

| Layer | Location | What it pins | Count |
|---|---|---|---|
| Property/unit | `tests/test_safety*.py` | gate-law properties, interaction shuffles, NLG slot traceability, dose arithmetic | 30+ |
| Parser regression | `tests/test_vision.py` | every parser pattern pinned (they were silent no-ops in the scaffold) | 13 |
| API golden paths | `tests/test_api.py`, `test_api_v2.py` | pipeline→plan→price, upload gating, envelope invariants, judge cache | 21 |
| Red-team + regression | `tests/test_redteam.py` | see table below | 29 |
| Offline E2E | `tools/demo_check.py` | all six verdict kinds through real HTTP + plan + price + refusal counter | 1 gate |
| **Web: deterministic engine** | `apps/web/scripts/selftest.ts` + `lib/safety/selftest.ts` | **18 expert-labeled cases** — the same counterfactual the A1 ablation proves: the rules, not the reading, carry safety | 18 cases |
| **Web: copilot gates** | `scripts/selftest.ts` → `lib/ai/copilot.ts` | emergency triage and scope refusal fire deterministically, **before any generation** (the same `copilotGate()` path the API uses) | 3 gates |
| **Web: typecheck + build** | `bun run typecheck` + `bun run build` | strict TS, standalone production build with all 13 routes | 2 gates |
| **Web: smoke** | manual E2E (single command) | verify → plan → dose → catch-up guardrail → family → analytics → metrics | 15 checks |

## API red-team coverage (`tests/test_redteam.py`) — what each test protects

| Test | Failure mode it forecloses |
|---|---|
| `test_confirm_rescreens_with_declared_context` | **Verified regression:** confirm used to re-screen with an empty context — contraindications silently vanished after human confirmation. Context persists on the row; the child-doxycycline canary fails loudly if the law breaks. |
| `test_security_headers_present_on_every_response` | missing `nosniff`/`DENY`/CSP on any route |
| `test_request_id_*` | log-correlation gaps; CRLF/unicode/oversize id injection |
| `test_upload_*` (magic bytes, MIME mismatch, ISO-BMFF, oversized) | spoofed/mismatched/oversized uploads reaching the vision path |
| `test_rate_limit_429_and_recovery` | unbounded write abuse; 429 must be an Envelope, not a raw string |
| `test_metrics_schema_fail_counter_is_real` | **Verified regression:** `llm_schema_fail_total` was hardcoded `0` — now bound to the real counter |
| `test_confirm_rejects_*` | IDOR-adjacent input abuse on the confirm endpoint |
| `test_context_garbage_keys_are_dropped_silently` | unknown context codes influencing rules |
| `test_formulary_search_unicode_and_injection_safe` | injection/unicode/oversize search abuse |
| `test_prompt_injection_in_fixture_lines_never_captures_verdict` | injected instructions in extracted text must be inert — decisions stay rule-derived |
| `test_plan_blocked_for_refused_and_queued` | unverified fields leaking into the spoken plan |

## Web-tier regressions fixed during integration (each verified live)

| Finding | Fix | Verified |
|---|---|---|
| Degraded tier (no LLM) queued *everything* at a flat 70% confidence, so the safety plane never demonstrated offline | When the deterministic splitter runs, the plane uses its own formulary-grounded brand-match confidence instead of the flat guess | live: warfarin+aspirin → `interaction`; triple whammy → `interaction` (triple_whammy); child+doxy → `contraindication`; garbage → `confirm_queue`; clean → `pass`, all **without any model** |
| Double "taken" on a dose silently overwrote the log | First-action-wins: any re-action returns `already_acted`, never re-mutates | live: take → double-take → `already_acted`; skip-after-take refused |
| Catch-up guardrail *claimed* "logged as skipped" without persisting | The guarded skip is now written to the DB (cannot be taken later) | code path reviewed; audit `dose.guarded` |
| Plan-start re-ran the plane with empty contexts, dropping contraindication screening | Contexts are stored on the Prescription (`contextsJson`) at verify time and re-applied at plan start | live: verify with `age_under_12` persists; plans route reads stored contexts |
| "Can I stop taking my medicines?" passed the scope gate | Added stop/skip/quit patterns to `DOSAGE_ADVICE_PATTERNS` | `selftest` gate case now refuses |

## Regression law

Every bug found during audit or red-team gets a test that fails before the fix
and passes after. Do not loosen a red-team test to make a merge green — fix
the system; the test documents a real attack or failure.

## Known gaps (honest)

- No browser automation (Playwright) yet; the offline demo gate, typecheck,
  selftest and build are the current UI gates. `TODO` in TECH_DEBT.md.
- Accessibility is built to WCAG 2.2 AA conventions (semantic landmarks,
  labeled inputs, focus-visible, aria-pressed, reduced-motion) but not yet
  audited by axe-core in CI. Same TODO.
- No performance tests beyond the API latency bench and the web smoke
  (no sustained-load rig).