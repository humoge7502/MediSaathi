# Vaidya — Project Blueprint (VMEDITHON V3.0)

Condensed strategic record: evidence → concepts → architecture → execution. Companion to README.md (engineering) and DEMO_SCRIPT.md (presentation).

---

## 1. Executive summary

MediSaathi — our existing build — is a verification-first prescription intelligence layer with a genuinely differentiated deterministic safety plane. Its weakness is scope: verification is a one-shot event, while medication harm and non-adherence are longitudinal problems. Vaidya keeps MediSaathi's law ("the model reads, the rules decide") and closes the loop: **verify → schedule → adhere → protect → explain → measure**, implemented as a single Next.js 16 fullstack application with a TypeScript port of the safety engine, an expanded curated dataset, and a three-gate grounded AI layer. Everything is live, evaluated in-app, and honest about its limits.

## 2. MediSaathi forensic analysis (summary of evidence)

Evidence source: direct repository inspection (73 files) of `github.com/humoge7502/MediSaathi`.

**Retain (proven assets)**
- The safety-plane architecture: deterministic rules over in-memory seed tables, zero network, zero LLM. Evidence: `apps/api/app/safety/engine.py`, property tests.
- The confidence gate law (refuse < 0.75, human-confirm 0.75–0.90). Evidence: `apps/api/app/verdict.py`.
- Refusal-as-a-designed-success-state — rare and judged well.
- Dataset discipline: sources recorded in `data/sources.json`; eval labels in `data/eval_labels.csv`.

**Transform**
- Python FastAPI + Next.js two-service split → single Next.js fullstack app (one deploy, one language, 24-hour feasible, judge-demoable from one URL).
- CSV datasets → typed TypeScript modules, expanded and source-attributed (47→79 interaction rules; 27→34 contraindication rules; 84→94 brands; added molecule groups enabling graph rules).

**Discard for this event**
- Sealed fixture corpus + `/judge` baked cache (great offline trick, but the fresh demo runs live deterministically anyway).

**Bug found by inspection (feeds the audit section of the original brief)**
- `apps/web/src/app/page.tsx:6` — `const etrics, setMetrics] = useState(...)` broken destructuring; the home metrics fetch would crash the component tree in strict builds.

## 3. External research snapshot

| Claim used in product | Source |
|---|---|
| NCD medication adherence averages ≈51% (n=2,840, 2023 meta-analysis) | PMC / British Geriatrics Society summary (retrieved 2026-09-10) |
| Medication errors cost ≈$42B/yr globally; "Medication Without Harm" | WHO |
| ~half of ADEs are preventable | AHRQ PSNet |
| Competitors = reminders (Medisafe, MyTherapy) or commerce (Tata 1mg, PharmEasy, Apollo 24|7); none verify + adhere + ground AI + family | Web survey of app market, retrieved 2026-09-10 |

Honesty note: the in-app dataset is a **curated demo corpus** with per-rule source tags (DDInter, Stockley, FDA, CredibleMeds, BMJ); production replaces it with versioned snapshots. No statistics are fabricated in-product.

## 4. Concept selection (10 candidates, 10 criteria)

Criteria: novelty, technical depth, 24h feasibility, demo impact, social impact, research potential, recruiter appeal, visual/demo potential, scalability, differentiation (each /10).

| # | Concept | Avg |
|---|---|---|
| 1 | **Closed-loop medication guardian (Vaidya)** | **8.9** |
| 2 | Pose-CV elderly fall detection | 6.3 |
| 3 | TeleDerm skin-lesion classifier | 6.8 |
| 4 | NeoCare NICU monitor (hardware) | 6.9 |
| 5 | EpiSense outbreak prediction | 6.2 |
| 6 | GenoRx pharmacogenomics advisor | 6.2 |
| 7 | FHIR records explorer | 5.9 |
| 8 | Prescription-OCR API only | 5.9 |
| 9 | Mental-health companion | 5.7 |
| 10 | Food-photo nutrition CV | 5.3 |

Selection rationale: #1 uniquely combines a **defensible engineering story** (deterministic safety), a **longitudinal data model** (adherence metrics researchers recognize), **social relevance** (India chronic-therapy gap), and **demo resilience** (degrades honestly without network).

## 5. Architecture decisions and trade-offs

- **Single Next.js app vs two services** — chosen for 24h feasibility and single-URL judging; the deterministic core lives in `lib/` as pure TS, so extraction into a standalone service later is mechanical.
- **SQLite/Prisma vs Postgres** — event build runs anywhere, survives demo-laptop restarts; schema is Postgres-portable (no SQLite-specific types).
- **Zero-dependency BM25 vs vector DB** — retrieval must be auditable and offline-safe in a safety-adjacent product; 30 chunks don't need embeddings. A vector index is a post-event upgrade, not a dependency.
- **LLM-as-judge for evals** — labeled for what it is: automated rubric telemetry, not clinical validation. Displayed as such, in-product.
- **Graph/combination rules** — the "triple whammy", QT-stack, serotonin-stack and bleeding-stack rules catch dangers pairwise lookup cannot see; this is the technical differentiator judges can verify in the self-test table.

## 6. Threat model (STRIDE, condensed)

| Asset | Threat | Mitigation (in product) |
|---|---|---|
| Prescription text (PII-ish) | Exposure | Data minimization (no identifiers), on-device DB, no third-party transmission beyond the model prompt, audit log |
| Safety verdict integrity | Prompt injection via Rx text | The LLM only proposes lines; rules decide; invented brands fall to the confirm queue |
| Copilot output | Hallucinated dosage | Gate 2 deterministic refusal, grounding enforcement, post-check strip, refusal-on-low-retrieval |
| Family feed | Over-sharing | Code-scoped view; demo build keeps all data local; production adds consent artifacts + row-level scope |
| Availability | Model/network outage | Three-tier degradation (full → deterministic fallback → offline tier) |

## 7. Failure-mode register (top entries)

| Failure | Detection | Mitigation | Fallback |
|---|---|---|---|
| LLM extraction down | try/catch in route | deterministic line splitter | safety plane runs unchanged |
| LLM copilot down | try/catch in copilot | honest refusal message | deterministic gates still fire |
| Judge unavailable during evals | score < 0 sentinel | table shows "judge n/a" | type-accuracy row still scored |
| DB locked/corrupt | Prisma errors | WAL-style single-writer simplicity; seed reset | re-run `db:push` + Reset demo |
| Malicious Rx input | length caps, JSON validation | findings rendered as text only | — |

## 8. Benchmarks (labels: measured vs projected)

Measured: engine self-test 18/18 (100%) at ~4–7 ms/suite; per-verdict 0.1–0.5 ms; copilot gates fire in ~50 ms; eval run 10/10 type-accuracy with groundedness 1.00, safety 1.00 (single run, automated rubric).

Projected (not yet measured in this environment): Lighthouse/Core Web Vitals greens; production-formulary recall — requires versioned snapshots and a labeled corpus, specified in §9.

## 9. Research / academic direction

**Question**: can a deterministic-rule-gated, longitudinal medication platform measurably improve adherence behavior and unsafe-plan interception in a student/cohort pilot?

**Method (post-event)**: baseline vs Vaidya-assisted adherence over 8 weeks (MPR via dose-level events), plus interception rate on a labeled bad-plan corpus; ablation A1 (no safety plane) vs A4 (full) — the counterfactual MediSaathi already established (agreement collapse 1.00 → 0.17 without the plane).

**Publication shape**: short paper (CHI/AMIA posters, or a CS conference): system + evaluation harness + ablation. **No clinical claims**: the prototype is an information layer; the paper studies engineering and behavior, not treatment efficacy.

**IP note (not legal advice)**: the combination-rule graph + verdict gate + refusal telemetry stack is a potential area requiring professional patent/prior-art evaluation.

## 10. Post-event roadmap

- **1 week** — photo perception path (vision LLM, same gate law); OTP auth; labeled-corpus expansion to 300+ interaction pairs from versioned DDInter/RxNorm snapshots.
- **1 month** — regional-language plans (ta/hi template NLG ported from MediSaathi); SMS/WhatsApp escalation bridge; PWA offline shell.
- **3 months** — cohort pilot with a campus clinic; IRB-lite consent flow; vector-index retrieval upgrade; CI/CD + Lighthouse budgets.
- **6 months** — ABDM-style consent artifacts; pharmacist confirmation queue as a real workflow; multi-patient caregiver accounts.
- **1 year** — adherence-outcome study writeup; open-source the safety-plane as a standalone package (`@vaidya/rules`).

## 11. Definition of done (met at ship)

- [x] Single-route product runs from `bun run dev` with zero manual steps beyond `db:push`
- [x] Deterministic engine suite ≥ 95% (achieved 100%, 18/18)
- [x] Copilot refuses out-of-scope, dose-change and emergency classes deterministically
- [x] LLM outage degrades honestly (verified by fallback code path)
- [x] Every dataset surface displays its sources
- [x] Browser E2E pass on desktop + mobile widths
- [x] No fabricated metrics anywhere; measured vs projected labeled
- [x] README + blueprint + demo script + worklog complete
