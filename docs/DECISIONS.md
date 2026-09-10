# Decision Log (append-only)

| When | Decision | Why |
|---|---|---|
| T+0 | Two-plane architecture; LLM never touches safety decisions | Refusal-first product thesis; survives free-tier quota loss |
| T+0 | Fixtures carry the demo; live vision behind env key | Zero-failure demo; three-tier fallback |
| T+0 | Contracts package first; API generated from it | Frontend cannot drift from backend |
| T+0 | Confirm band 0.75-0.90, refuse below 0.75 | Product law; tuned per-field post-event |
| T+0 | Template-grounded NLG (no free generation of doses) | Spoken output traceable to verified slots, tested |
| T+0 | Refusal = HTTP 200 with refused verdict | Refusal is a designed success state, not an error |
| B4 | SQLite (WAL) instead of in-memory dict | Demo survives laptop restart; one-file Postgres swap later |
| B4 | Formulary autocomplete is read-only over seed data | Confirm flow must never invent a brand |
| B5 | Web Speech API for TTS instead of pre-baked audio files | Zero assets, three languages, degrade gracefully |
| B6 | NLG emits per-sentence AudioSegments with slot_refs | Enables highlight-while-speaking + auditability |
| B6 | Dose-cap warnings are report notes, never verdicts | Warnings inform humans; verdicts stay gate-law deterministic |
| B6 | Aggregate (cross-brand) daily-cap rule in the engine | Two sub-cap paracetamol brands can sum over the cap |
| B7 | A1 ablation simulated on fixtures (face-value read) | Shows the gate/formulary value without burning vision quota |
| B8 | Judge cache baked FROM the pipeline, stamped + re-bakeable | Zero-network tier that hides nothing; `make bake-judge` |
| B8 | Context codes frozen in contracts (CONTEXT_CODES) | Declared context is validated, unknown keys dropped |
| B8 | Fix parser regexes + regression tests first | The scaffold's silent no-op regexes were found by reading, proven by tests |
| B9 | **Integrate `vaidya-project.zip` frontend into `apps/web` as the product app** | The zip contained the newest, complete product UI (closed loop: verify→schedule→adhere→protect→explain→measure). The old scaffold was a thin client; keeping two overlapping UIs would split the demo. The FastAPI tier stays as the deep-verification companion (vision, multilingual NLG, pricing, judge cache) — see ADR 008 in docs/ARCHITECTURE.md |
| B9 | Web degraded tier uses the engine's formulary-grounded confidence, not a flat 0.7 | Without the LLM, the deterministic splitter's lines queued at 70% and the plane never demonstrated. Exact formulary matches now auto-confirm (1.0) so the offline demo shows real verdicts; garbage still queues |
| B9 | Prescription rows persist declared contexts (`contextsJson`); plan-start re-screens with them | Same regression law as the API tier's confirm fix: re-running the plane with an empty context silently drops contraindications |
| B9 | Dose accounting is first-action-wins | Double "taken" (double tap, replay) must never log a second intake; the catch-up guardrail persists a protected skip instead of merely claiming it |
