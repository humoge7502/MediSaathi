# HACKATHON_STRATEGY.md — VMEDITHON V3.0 judging plan

Tracks: **Open Innovation** + **Bio × Engineering** (software). Judged
self-scored below; the discipline is to score honestly and fix the weakest
category, not to inflate.

## Scorecard (self-assessment, 1–10)

| Category | Score | Evidence the judge will see |
|---|---|---|
| Innovation | 8 | refusal-as-a-feature with a live counter; confirm queue as a product surface, not an error; two-plane law |
| Technical depth | 9 | contracts-first monorepo; deterministic plane property-tested; A1/A4 ablation; indexed store; security middleware |
| Impact | 8 | adherence 16–24%, 62% OTC antibiotics, 6–10% ADR reporting — all cited; price layer is real savings |
| Feasibility | 9 | everything in the demo runs offline; 93 API tests plus web type/build gates; one-command gates (`make demo-check`) |
| UX | 8 | calm clinical design system, per-field confidence UI, spoken plan with highlight, contrast mode for projectors |
| Bio × Engineering | 7 | medical document intelligence + interaction pharmacology; sensor-agnostic safety plane named as the hardware hook |
| Open Innovation | 8 | the verification-first pattern generalizes to any document-to-decision pipeline |
| Research | 8 | RESEARCH.md with labeled claims; measured ablation; no fabricated results |
| Scalability | 7 | modular monolith with documented swap points (Postgres, Redis limiter, live vision fleet) |
| Demo quality | 9 | rehearsed 90s script, 5 failure drills, baked zero-network tier, Q&A bank |
| Originality | 8 | original identity/design; no copied assets; MIT/CC-BY clean |

Weakest two: **Bio × Engineering (7)** and **Scalability (7)**.

## Fix plan for the weakest categories

**Bio × Engineering (7 → 9):** the safety plane is already sensor-agnostic —
it consumes `ExtractionField`s regardless of who produced them. The
demonstrated hook: a wearable/IoT bridge can POST the same typed fields from a
sensor feed (e.g., a pill-dispenser or glucometer) and receive the identical
verdict law. Roadmap item 4 in MASTER_PLAN (fine-tuned small vision model)
plus the simulator pattern gives judges a concrete bio-hardware story without
pretending hardware exists. Label: SIMULATED until real sensors are attached.

**Scalability (7 → 9):** point judges at docs/ARCHITECTURE.md — indexed
verdict aggregation (O(1)), store API as the single Postgres swap surface,
limiter interface as the Redis swap surface, provider-agnostic vision tier
(any OpenAI-compatible endpoint incl. local vLLM/Ollama for on-prem hospital
deployment). The refusal/queue counters already work as the seed of an
operations dashboard.

## The 3-minute demo path (full script in docs/DEMO_SCRIPT.md)

1. **Hook (0:00)** — printed prescription held to camera: "most families
   cannot verify this."
2. **Scan (0:30)** — RX-001: extraction → confidence UI → pass verdict.
3. **The law (1:00)** — RX-002: warfarin+aspirin severe interaction, DDInter
   source, snapshot date on screen. "The model read; the rules decided."
4. **Voice (1:45)** — Tamil spoken plan, per-sentence highlight.
5. **The refusal moment (2:15)** — RX-006 corrupted scan → refused, counter
   ticks on /metrics. "A confident wrong answer is worse than an honest one."
6. **Proof (2:45)** — `make eval` table: A1 agreement 0.17 vs A4 1.00. Close.

## Anticipated judge attacks (Q&A bank in docs/QA_BANK.md)

- "Why not just GPT-4V?" → run `make ablation` on stage; the number answers.
- "What if the model is wrong but confident?" → plausibility + interaction
  screens run regardless of confidence; inconsistencies queue/refuse.
- "Data provenance?" → `data/sources.json`; snapshot stamped on every verdict.
- "HIPAA/DPDP?" → we collect nothing; no PII; declared context only; no fake
  compliance claims.
- "Auth?" → concededly absent in the demo build; first post-event item;
  read-only scope + rate limits meanwhile.

## Judge-demo hygiene

- `make bake-judge` the morning of; `make demo-check` before every rehearsal.
- Cached-mode checkbox stays ON by default on /judge (zero-network tier).
- Contrast mode hotkey ready for projector failure (failure drill 3).
- Second laptop with the same image + green `make demo-check` as hot spare.
