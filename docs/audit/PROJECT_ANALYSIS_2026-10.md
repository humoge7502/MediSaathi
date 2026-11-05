# MediSaathi / Vaidya — full project analysis (2026-10-28)

Prepared against the working tree on 2026-10-28, **not** against `master`. Where an
issue is already repaired in this tree it is marked **FIXED-LOCAL** with the test
that now holds it; where it is still open it is marked **OPEN** and carries the
`docs/TECH_DEBT.md` id. Every number below was produced by a command in this
repository on this date, or is explicitly labelled an estimate.

> **Disclosure constraint.** This repository is public and the invention is
> unfiled. Nothing here goes beyond what `master` already publishes about the
> three-band gate, the fusion function, queue-blocking semantics, the calibration
> method or binder numbers. Read the mechanism itself in `master`, not here.

---

## 1. Project analysis & strategic opportunities

### What the project actually is

A **two-tier medication guardian**: a FastAPI verification service (`apps/api`) and
a self-contained Next.js product (`apps/web`) that keeps working with the model
tier switched off. The defensible core is not the LLM — it is the law that the LLM
proposes and a deterministic plane decides, plus the evidence spine that makes
every published number traceable to a run manifest and a dataset hash.

Measured identity of the thing (all re-run 2026-10-29, except the API suite and the dataset snapshot below, re-measured 2026-11-02 when the `data/reference/` tier was brought inside the manifest; §6 carries what each layer proves):

| Asset | Value |
|---|---|
| Web suite | **509 tests / 26 files / 10 845 assertions**, 0 fail; `tsc` and `eslint` clean |
| Browser E2E | **64 tests in 6 files**; **47/47** deterministic (17 product journeys + 7 accessibility gates, 5 of them axe scans + 9 theme gates, 3 of them dark axe scans over 8 surfaces + 14 WCAG 2.2 geometry gates); the other 17 need a real clock, a registered worker or a headed window |
| API suite | **468 passed**, 26.5–34.3 s over three runs (band, not a pinned figure) |
| Cross-engine parity | **164/164** golden cases agree between TS and Python at corpus law v12 |
| Sealed benchmark | brand recall 1.00 · frequency recall 0.9938 · verdict agreement **0.973** · refusal precision 1.00 (n=111) |
| Counterfactual | verdict agreement **0.973 with the gate → 0.072 without it** (A1 vs A4) — the plane, not the model, carries safety |
| Decision latency | deterministic plane p50 **0.451 ms** / p95 **2.978 ms**; pipeline p50 **7.5–12.0 ms** in-process, **14.8–21.4 ms** over a socket |
| Formulary | **2 836 brands · 9 660 interaction pairs · 1 267 contraindications · 305 dose-cap molecules**, one compiled table shared by both tiers |
| Data gates | 5 in `make data-check`, including a manifest that compares evidence hashes with the bytes on disk |

That last line is the strategic asset most competitors cannot copy quickly: **the
project fails its own CI when its evidence goes stale.** Almost every "AI health
app" has numbers no one can re-derive.

### Strategic opportunities, ranked

1. **Verification-first positioning is provable, not rhetorical.** The A1/A4
   ablation (0.072 → 0.973) is the single most persuasive artefact in the
   repository. Lead every investor and clinical conversation with it.
   *Cost to exploit: near zero — it already runs.*
2. **The adherence dataset is the compounding asset.** Dose-level events, over
   weeks, per patient, with a caregiver feed attached. Nobody in India has this
   coupled to a verified-plan gate. The study design is already written
   (`docs/BLUEPRINT.md` E-G/E-H style protocols); executing one 8-week cohort
   pilot converts "we built it" into "it changed behaviour", which is the only
   claim payers and pharma-vigilance buyers pay for.
3. **Pharmacist-facing review console is a wedge, not a sidebar.** The queue
   already blocks plan generation until a human resolves a read. Productising the
   same surface for a chain pharmacy (queue + audit + per-pharmacist SLA) is the
   shortest path to a business model that does not require selling patient data.
4. **Multilingual + voice input.** Prescription-line legibility is the actual
   failure mode the confirm queue exists for; Hindi/Tamil/TELUGU OCR-and-voice
   reading of the same lines multiplies the addressable user base without touching
   the safety plane.
5. **The rules package as open source** (`@vaidya/rules`, already in the roadmap)
   is the cheapest credibility flywheel: it lets a third party falsify the engine
   and is the artefact a regulator or partner can audit.

### Structural constraint to respect

`data/interactions.csv` descends from **DDInter (CC-BY-NC-SA 4.0)** and
**CredibleMeds** needs a production licence. Both are recorded in the repo. This
means the current dataset is **not commercially deployable as-is** — see §5 and
the licensing row in §6. It is the hardest constraint in the project and it is not
a code problem.

---

## 2. Issues & required fixes

Effort is engineer-hours including tests. Dependencies are between *fixes*, not
between people.

### 2a. Security & privacy

| # | Issue | State | Severity | Est. effort | Depends on |
|---|---|---|---|---|---|
| S1 | **No authentication on the web tier.** Every route resolves "the patient" as `patient.findFirst()`. Anyone reachable over the network reads that one patient's prescription text, dose timeline, family links and confirm-queue history, and can *write* dose outcomes. | **OPEN** (TD-1) | **High. CVSS 3.1 7.1** — `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N` if deployed; **Informational (0.0)** for a localhost-only demo, which is the current documented posture | 2–3 d (sessions + per-patient scoping + route-level authz tests) | nothing; it is the dependency for everything cloud-side |
| S2 | Credential-bearing reads (join codes) and cross-patient writes on id-taking routes. | **FIXED-LOCAL** — code minted-and-shown once, hints everywhere else, `scopePatient()` on every id route, rejection-sampled generator, no codes in audit rows. | was Critical / High | done | `tests/family.test.ts` (14), `ownership.test.ts` (9) |
| S3 | Destructive demo reset reachable by an anonymous POST. | **FIXED-LOCAL** — deny-by-default env switch + admin-token path, audited without the credential. | was High | done | `tests/seed-gate.test.ts` (11) |
| S4 | Unbounded request bodies; `/api/evals` (~20 model calls, 300 s) launchable 60×/min. | **FIXED-LOCAL** — streamed body cap + single-flight run guard. | was Medium | done | `limits.test.ts` (17), `run-guard.test.ts` (7) |
| S5 | Rate limiter and counters are **per-process** → they fragment behind multiple workers, so S1's blast radius grows the moment anything scales. | **OPEN** (TD-7, TD-18) | Medium (defence-in-depth) | 0.5 d, with the Redis/Postgres swap | S1 |
| S6 | Stored health data at rest: SQLite file, no encryption, no retention policy, no deletion path for a patient. | **OPEN** — not yet in the debt register; add it | Medium-High for any deployment with real users (India: DPDP Act 2023 expects consent, purpose limitation and a erasure route) | 1–2 d (export/delete endpoints + retention job + documented lawful basis) | S1 |

**Reproduction for S1** (why the score is what it is): `curl -s localhost:3000/api/plans`
on a running instance with no headers returns the active plan and dose timeline.
Expected in any multi-user deployment: 401. Actual: the record.
Recommended timeline: **before** anything is exposed beyond localhost; the repo's
current posture (one patient, local, `MEDISAATHI_ALLOW_DEMO_RESET` gated) is honest
and defensible, and the day that changes this becomes P0.

### 2b. Performance

| # | Issue | State | Measurable impact | Severity | Est. effort |
|---|---|---|---|---|---|
| P1 | RX-001 p99 **154.2 ms** (max 188.1 ms) over loopback HTTP against a p50 of 14.8–21.4 ms, with the warmup already paid. Suspects: SQLite WAL checkpoint (1 000 pages) or GC of the 1.7 MB interned table per request. | **OPEN** (TD-26) | a 7× p99/p50 ratio is what a user reads as "it hung"; the ≤100 ms p95 budget still passes | Medium (quality, not breach) | 0.5–1 d: instrument the store write, or move it off the request path, re-measure `--transport live` |
| P2 | Landing shell first-load JS **~615 kB uncompressed** (≈200 kB gzipped). | **OPEN** (TD-11) | slower first paint on weak hardware — which is the majority of the target market | Medium | 1 d: audit the shared vendor chunk, trim unused primitives, push heavy libs behind dynamic chunks |
| P3 | No throughput test exists at any concurrency level. Every latency figure is n=400 sequential. | **OPEN** | unknown: requests/second, error rate under load, queue behaviour behind `--workers N` | Medium-High for deployment planning | 1 d: k6 or `vegeta` scenario against the sealed fixtures, published into `docs/PERFORMANCE.md` alongside the latency table |
| P4 | Engine cost is **not** the problem: 0.451 ms p50 / 2.978 ms p95 for the deciding plane. | measured | do not optimise the rules; they are 2 orders of magnitude below budget | — | — |

### 2c. Correctness & data (the class that actually matters clinically)

| # | Issue | State | Severity | Est. effort |
|---|---|---|---|---|
| C1 | **83 of 583 molecules have no interaction, contraindication or dose-cap row**; 171 brand rows therefore screen against nothing. A patient on an uncovered drug gets a verdict that is *silent*, and silence reads as clean. | **OPEN** (TD-20) | **Critical for clinical credibility** — the engine can report coverage, it cannot invent rules | M: a licensed pairwise source + surfacing "screened against N rules" on every verdict so silence becomes visible |
| C2 | 3 molecule cells name a **form**, not an ingredient: `paracetamol_syrup` carries **no ceiling at all** while `paracetamol` carries 4 000 mg/day — and syrup is the paediatric weight-based class. | **OPEN** (TD-19) | **High**: cumulative-dose error in children | S: split form from ingredient at import, give syrup rows an explicit mg/ml rule, gate the vocabulary by name list not shape |
| C3 | The synthetic corpus **cannot falsify the engine**, only agree with it. A4 = 1.000 means self-consistency. Proven live: a data repair moved 8 of 44 frozen labels and dropped the ladder to 0.818 with no code change. | **OPEN** (TD-22) | **High** for any external claim of accuracy | M: dual-pharmacist annotation with kappa (sheets already under `data/annotation/`) |
| C4 | Three sealed labels are stale (RX-045, RX-088, RX-089), so verdict agreement is honestly 0.973, not 1.000. **The larger defect was attached to it and was invisible:** `eval/regression_gate.py` floored `verdict_agreement` at **1.00** against a committed baseline of **1.0**, so the CI step "Eval regression gate" has failed on every push since those labels went stale — while `docs/TESTING.md` published 0.973 as the expected figure. The gate and the documentation described different realities, which is how a permanently-red check gets read as noise. | labels **OPEN** (TD-21); gate **FIXED-LOCAL** — the floor is now the exact disagreement *set*, the aggregate is re-derived from the case rows that produced it, and the baseline records the measured 0.973. Attribution was measured, not assumed: the eval was run on the pre-upgrade and post-upgrade stacks and produced byte-identical metrics and the same three ids. Verified against five synthetic payloads — a fourth disagreement blocks, a healed label fails until it leaves the set (which raises the floor by itself), an aggregate that disagrees with its own rows is caught, and a payload with no per-case rows cannot pass | was **High for the process** (red CI that everyone learns to ignore), Low-Medium for the metric | S: re-seal as `eval_v2` with per-case rationale, keep v1 reproducible |
| C5 | **Adherence metrics flattered the patient.** Unanswered slots were excluded from the denominator (one answer in five scored 100%; no answers scored "no data"), and `mprPct` was the adherence division repeated under another name. | **FIXED-LOCAL** — `effectiveStatus()` closes a past day's unanswered slot as `missed` at read time, refuses to charge an unarrived day, and `mprPct` is now proportion-of-days-covered. Found by a 200-history property oracle (seed 1 disagreed 54 vs 50). | was **High** (a health app reporting a false adherence figure to a patient and a caregiver) | done; `tests/adherence.test.ts` (25) |
| C6 | **Reminders did not exist.** A schedule, a timeline, escalations and analytics with no alert to the patient — the feature the category is named after. | **FIXED-LOCAL** — `planAlerts` + `use-reminders` + `/api/reminders`, 60 tests, 2 browser journeys incl. a `page.clock` delivery proof. | was **High** (absence of the core loop) | done |
| C7 | Reminder delivery only reaches an **open tab**: no service worker, no Web Push, no server scheduler. | **PART-CLOSED** (TD-27 slice 1, 2026-10-28) — `public/sw.js` now owns the queue in IndexedDB, fires on its own timer with **every tab closed**, discards a message stamped with another day, and hands its fired set back so nothing announces twice; proven in a real browser by 12 headless + 5 headed gates, incl. the byte-for-byte anti-fork round trip and the double-announce regression this finding predicted. Residual (open): a wake that outlives the *browser process* needs Web Push + an operator-minted VAPID key, and periodic-background-sync cannot extend the 30-minute horizon on iOS Safari. No device bench exists (Android Doze / iOS) — `docs/TESTING.md`, "The delivery tier is split by what a browser will let it measure" | was **High** against the feature's own promise; now Low against it, Medium for a phone in a pocket | done: worker + install + offline shell; M remaining: push handler that re-plans from the same `planAlerts`, subscription table, device bench |
| C8 | Frequency-law residues: the `1-0-2` generation convention, `75-1-0`→`5-1-0` glue, Jan Aushadhi pack-size adjacency. | **OPEN** (TD-23) | Low today (none reachable from a real corpus line) — but they *can* invent or destroy a slot code | S, blocked on real-image perception data |

### 2d. Code quality & architecture

Genuinely strong, and measured: strict TypeScript with zero errors, ESLint clean
under the React-19 hook laws, one compiled table for both tiers, a pure decision
module per feature (`engine`, `adherence`, `reminders`, `regimen`) with a thin
delivery hook, hash-pinned artifacts, and a claims test that re-derives the
landing page's numbers from the artifacts they describe.

| # | Item | State | Notes / effort |
|---|---|---|---|
| Q1 | Two engines that must agree (TS product plane, Python service plane). Parity is golden-corpus-based, and **the regimen port has no golden corpus at all**. | **OPEN** (TD-12) | a future divergence would ship silently. M: extend the shared corpus to regimen cases |
| Q2 | Documentation counts are hand-maintained; the claims gate covers the landing tiles and two README suite figures, not `docs/TESTING.md` prose. | **CLOSED 2026-10-29** (`tools/check_claims.py`, TD-16 retired by RES-36) | 14 doc sites are now diffed against a real `bun test` + `pytest` run and the corpus artifact, in both CI jobs; falsified 14/14 red on a doctored measurement and end-to-end red (exit 1) on two real edits |
| Q3 | Five one-shot parity migration scripts sit in `tools/` with no v9–v12 successors. | **OPEN** (TD-24) | S: move under `tools/migrations/` with a README, or delete |
| Q4 | `eval/eval.py` uses `sys.path` hacks instead of an installed package. | **OPEN** (TD-6) | S, brittle-but-working |
| Q5 | Test runtime is environment-sensitive: the Python gates only pass through `.venv` (the editable installs live there) and `make` is absent on Windows/PowerShell boxes. | **OPEN** — recorded in `docs/TESTING.md` | S: commit a `scripts/gate.(ps1\|sh)` wrapper so a new machine runs the same battery |

### 2e. Dependency currency (the "everything up to date" mandate)

**Outcome, 2026-10-28, after `bun update` plus two attempted majors:**
`next 16.4.3` · `react 19.3.1` · `react-dom 19.3.1` · `tailwindcss 4.3.3` ·
`tailwind-merge 3.7.0` · `@playwright/test 1.64.1` · `@axe-core/playwright 4.14.0` ·
`@radix-ui/react-slot 1.5.0` / `react-toast 1.3.1` · `bun-types 1.4.4` (the 1.3.x
mismatch against bun 1.4.3 is closed) · **`eslint 10.13.0`** · **`lucide-react
1.62.0`** — all at current stable, with lint and typecheck green.

Two majors were **attempted and measured, then reverted** (recorded as TD-28):

| Package | Current | Latest | Measured result of the attempt |
|---|---|---|---|
| TypeScript | 5.9.3 | 7.0.2 | installed → **`tsc --noEmit` exits 0**, i.e. the tree itself is ready — but `typescript-eslint` (newest release 8.72.1, pinned by `eslint-config-next` at `^8.56.0`) throws `does not support TS 7.0` at load, which removes the lint gate. Reverted: a toolchain that silences a gate is not an upgrade. |
| Prisma + client | 6.19.3 | 7.10.1 | v7 removes `prisma-client-js`, makes generator `output` mandatory and requires a driver adapter for SQLite. `@prisma/adapter-better-sqlite3` → `better-sqlite3` native binding **loads under Node 24.18 here and fails to bind under bun 1.4.3**, the runtime all 417 web tests execute on. Reverted: the migration cannot be verified on the runner that verifies it. |

`prisma 8.0.0-rc` and `@babel/* 8` also surface as "latest" on the registry —
**a release candidate is not "up to date", it is unreleased**, and nothing should
track it.

**The Python tier was the half this section first missed, and it was further
behind than the web tier.** Surveyed 2026-10-28 against PyPI: FastAPI was **26
minor versions** back. Upgraded, with the whole gate battery re-run on the new
stack:

| Package | Was | Now | Note |
|---|---|---|---|
| fastapi | 0.136.3 | **0.162.0** | pulled starlette 1.10.0, which is now pinned explicitly rather than floated through FastAPI |
| uvicorn | 0.51.0 | **0.54.0** | |
| pydantic | 2.13.4 | **2.14.2** | + pydantic-core 2.50.2 (2.14.1 was current on 2026-10-28; the patch landed overnight and the pin followed it) |
| hypothesis | 6.165.10 | **6.170.13** | the property tests are the safety plane, so this is a test-integrity pin, not a nicety |
| pytest | 9.1.1 | **9.2.0** | `check_claims.py` parses pytest's own summary line, so a major output change would fail the claims gate rather than mis-parse silently |
| ruff | 0.17.2 | **0.17.3** | found **two new defects in `tools/bench.py`** that 0.17.2 passed: an unsorted `noqa: E402` import block and an ambiguous `l` variable in the transport-floor maths |
| httpx | 0.28.1 | 0.28.1 | current for its line, and still used directly by the live-vision client and `bench.py` |

Two things the upgrade surfaced that a version bump alone would have hidden:

- **Starlette 1.10 deprecated `httpx` for its own `TestClient`.** Every pytest run
  opened with a `StarletteDeprecationWarning`. The replacement is a real,
  upstream-declared package (`httpx2`, 2.16.0, listed in Starlette's own `full`
  extra), so it is now installed and declared in `apps/api`'s `dev` extra; the
  warning is gone and the whole suite passes through it — 462 as measured on the day
  of the upgrade, **466** now, the +4 being `tests/test_verdict_tally.py`. The old
  pin list would have
  re-introduced it on a fresh CI install.
- **CI was not testing the verified environment.** It ran Python **3.12** while
  every number in `docs/TESTING.md` was measured on **3.13** — and Starlette's
  metadata installs a *different dependency graph* below 3.13
  (`typing-extensions` only for `python_version < '3.13'`). CI also installed
  `ruff>=0.6` **unpinned**, which is exactly why a linter bump can turn the build
  red on a day nobody touched code. Both fixed: Python 3.13, ruff installed
  through `constraints.txt`.

`constraints.txt` is re-pinned from the verified environment. It also lost a dead
pin: `pydantic-settings==2.14.2` constrained a package **nothing in the
repository imports**.

### Priority ranking (what to do in that order)

1. **S1 auth** (or a written, enforced localhost-only posture) — everything else
   in the security table is defence-in-depth behind it.
2. **C1 coverage silence + C2 syrup ceiling** — the only issues here that can
   directly harm a patient.
3. **C7 push delivery** — the shipped feature's promise is unmet without it.
4. **P1 tail, then P3 throughput** — you cannot plan a deployment without the
   second.
5. **C3 external labels** — unlocks every accuracy claim.
6. Q1 regimen parity corpus, S6 erasure/retention, P2 bundle.
7. Dependency majors.

**Indicative timeline** (one engineer, the order above): week 1 S1 + S6; week 2
C7 + P1; week 3 P3 + P2 + Q3/Q4/Q5; weeks 4–8 C1/C2/C3 with the licensing work in
§5 as the long pole.

---

## 3. Enhancements & modifications (existing surfaces)

| Area | Change | Why | Effort |
|---|---|---|---|
| Design system | **Typeface law**: the display face behind `.vy-serif` is a mounted variable serif (Fraunces) with a Devanagari companion for the wordmark (Rozha One), and the generated Open Graph card paints those same faces, the palette's own hexes and the hero's metrics | the palette has had a contrast law that recomputes every documented ratio out of `globals.css` since the theme pass; type had no law at all, so a `font-family` could revert silently — and did, on the one surface a shared link shows, where a `Georgia` that satori was never handed rendered in a sans under five colours the theme pass had already retired | **shipped 2026-10-29** (4 gates, `theme.test.ts` 26 → 30) |
| Insights | Show **coverage on the panel**: "this verdict screened against N rules for your medicines; M of your drugs have no documented pair in our source". | Converts TD-20 from a hidden limitation into visible caution — the | product's own refusal law applied to its data | S |
| Insights | Adherence trend line + week-over-week delta, not only the 14-day window | the sweep now makes the number honest; a single static % still reads as a verdict | S |
| Today | Snooze + "I took it later" correction flow with an audited reason | patients reorder their day; without it a late answer looks like a miss and the guardrail fights the human | S |
| Reminders | Per-dose-channel choice (notification only / + SMS to caregiver after 2 late days) | escalation exists in the family plane but the trigger is not the reminder plane | M |
| Family | Trend summary ("4 missed doses this week") instead of per-event spam | a caregiver who receives 30 pings mutes them | S |
| Review console | Filter/sort by pharmacist workload, per-row time-to-reserve, and a "same brand seen before" shortcut | E-G measured 5.91 s/case review — that becomes a product SLA the moment it is displayed | M |
| Copilot | Answer with the plan in scope: "your metformin" resolves against the active therapy, not the corpus | personalisation without any model judgement; the engine already holds the plan | S–M |
| Verification | Accept a photo, not only text, reusing the deterministic fallback line splitter as a cross-check | the confirm queue exists because text is hard; the image is the real input | L (needs the perception experiment, TD-23's blocker) |
| Data | `@vaidya/rules` extraction so the plane can be imported and falsified by outsiders | credibility flywheel §1.5 | M |

---

## 4. Advanced features (new capability, not a polish item)

1. **Longitudinal regimen plane, extended to refills and stock-outs.** Composition
   already reaches 1.000 with uncertainty propagation (E-H). The natural next
   axis is possession: a patient who runs out mid-course changes the interaction
   window. Pairs directly with the PDC metric now in Insights.
2. **Calibrated confidence on entity linking** (open task #6): the current
   gate uses retrieval + fusion scores; a temperature/isotonic-calibrated
   probability with a published ECE against a labelled set is what turns
   "the gate rejects at threshold t" into "the gate's error rate is known".
   E-D already swept operating points — the missing piece is *labels*.
3. **Adverse-event capture with signal-shaped reporting.** The app sits at the one
   place a patient actually reports: the dose button. A two-tap "felt something"
   event, tied to the plan and the molecule, is a genuine pharmacovigilance feed —
   and India's 6–10% ADR reporting rate is the cited gap.
4. **Multi-patient household mode** ("I manage Mum + Dad"): one caregiver, several
   timelines. The schema is one patient per database today; the caregiver link is
   already there, and this is the feature that makes the app a permanent fixture in
   a household rather than a personal tool.
5. **Offline-first**: the app is 100% deterministic-capable already; a service
   worker + SQLite mirror makes a rural connection drop invisible. Pairs with C7.
6. **Vernacular voice in/out** — not built today (the perception layer reads text
   and image lines only; there is no speech library in either tier), with the
   refusal discipline intact: a spoken "should I double my dose" must still hit
   `refused_scope` before any generation.
7. **FHIR export** (present API-side) exposed as a "hand this to your doctor"
   artefact — the highest-trust, lowest-cost clinical feature in the list.

---

## 5. New additions worth starting (net-new)

| Addition | Value | Cost | Blocking risk |
|---|---|---|---|
| **Licensed pairwise source** (DDInter commercial, or openFDA drug label + Semon/RxNorm join, or MedlinePlus) | removes the NC-SA wall and TD-20's silence in one move | L (procurement + rebuild + re-verify parity) | **The current dataset cannot be commercially deployed.** Nothing else on this list matters for a business until this is resolved |
| **DPDP/consent layer** — lawful basis, consent capture at first plan, erasure endpoint, retention job | required for any Indian consumer deployment | M | S1 first |
| **8-week cohort adherence pilot** (protocol already in `docs/BLUEPRINT.md`) | converts capability into an outcome; the artefact payers read | M–L, mostly time | external labels (C3) share the annotation effort |
| **Chain-pharmacy review-console product** | B2B revenue that needs no patient-data sale | M | S1, Q1 |
| **`@vaidya/rules` + published conformance suite** | open-source credibility, third-party falsifiability | M | licensing on the *data* still applies to the package |
| **`tools/check_claims.py`** — docs regenerate from test output | retires TD-16 permanently; keeps the honesty table honest | S | none — **shipped 2026-10-29** (15 sites, both CI jobs, `make claims-check`; see Q2) |

---

## 6. Verification & testing strategy

### Already in place, re-measured today

| Layer | Coverage | Evidence |
|---|---|---|
| Unit (pure law) | 509 web tests / 10 845 assertions across 26 files: gate law, interval law, dose-cap law, molecule identity, brand self-consistency, table invariants, streak + overdue-sweep + catch-up guidance, reminder plan, **the worker contract read back out of `public/sw.js` so the two planes cannot drift**, **theme resolution and the contrast law recomputed out of `globals.css` itself**, **the typeface law so a declared brand face cannot quietly revert to a system serif with the suite green**, **the deploy-budget fallback so a set-but-empty rate-limit variable cannot become a 429 on every mutation**, **the announcement law so a status message is delivered by a region that already existed rather than one born holding it**, **the placeholder law so a panel that is still waiting pulses the layout it will become and never a sentence** | `bun run test` — **0 fail, 10 845 expect() calls** |
| Property / oracle | Python: 5 safety invariants over ~900 generated prescriptions (hypothesis). Web: a **200-history recount oracle** written independently of the metric it checks — it found the future-day hole | `tests/test_properties.py`; `tests/adherence.test.ts` |
| Route / integration | every route handler against isolated SQLite, incl. ownership, limits, seed gate, breaker, middleware contracts | `tests/*.test.ts` |
| Cross-engine conformance | 164/164 golden cases, versioned law (v12), same corpus both runners | `make parity` |
| E2E | **64 browser tests in 6 files** (**47/47** deterministic — product + accessibility + theme + WCAG 2.2 geometry, the other 17 needing a real clock, a service worker or a headed window), incl. a **faked-clock notification delivery proof**, a **real closed-tab delivery proof** (the worker's own timer, `getNotifications()` after a reopen — headless Chromium cannot do this, so that half is its own headed file, and CI gives it an X server), a settings round-trip through the server, an offline reload that must answer the patient's own URL, and **what only a browser can see**: the first animation frame of a dark-OS visit is already dark, Chromium's own colour engine agrees with this repo's OKLCH maths to ±2/255, and the served bytes put the nonced boot script above anything that could paint | `bun run e2e` |
| Accessibility | 8 axe scans at zero serious/critical — landing, workspace, Today with reminders + resolved timeline, evidence and **the copilot tab (the last surface axe had never scored)** in light; then landing, Today **and a one-page tour of the remaining six panels** in the dark scheme (that dark pair is what caught mint-on-mint at 1.05/1.51/1.08 and white-on-safe at 2.35, both now fixed and pinned as token *laws* rather than as colours; the tour was proven falsifiable by moving one dark token and rebuilding, and it named `color-contrast` on all six panels). **Axe cannot see SC 4.1.3 at rest** — a status message exists only after a mutation — so the announcement is gated separately: every live region is stamped before the write and the node that announces must still carry the stamp, which is what found five panels whose writes announced nothing at all. **Axe cannot see a loading state either** — on a warm server it lasts milliseconds — so a seventh accessibility test holds a panel's request open and measures the state that never settles: every `[aria-busy]` region's placeholder carries no text node, every `animate-pulse` node is empty, and the real heading appears only after the release; the paired static law bans prose-as-loading outright. That same run **withdrew one of this pass's own claims**: the skeletons were documented as a layout-shift fix, but `min-h-screen` on `main` floors any placeholder at a viewport, so 720 px before / 800 px during / 1 590 px loaded says the shift was never what they bought — column alignment and silence are. And **the review queue's invisible headline** (`Queue clear` painted with `--vy-hairline`, ≈1.2:1 on `--card`) surfaced only because the branch was rendered rather than scanned — axe never reaches a cleared queue on the tour that seeds it — which is why a new palette law now forbids any structural token (`--vy-hairline`, `--border`, `--input`, `--sidebar-border`) from being painted as text. **The three WCAG 2.2 criteria a tree-only axe scan cannot reach are now measured geometry, and all three were red.** Reflow (SC 1.4.10) at 320 px: the Today panel measured **382 px** and the Family relations picker **420 px**, both wider than the viewport and both dragging a horizontal scrollbar onto a phone; both wrap now, and the gate asserts the document's `scrollWidth` never exceeds the viewport at 320 while allowing a table inside its own `overflow-x-auto` region. Target Size (SC 2.5.8): four header links measured **20 px** tall against the 24 px floor; the shared nav link class carries `py-1` and they are 28. Focus Not Obscured (SC 2.4.11) surfaced the pass's real defect — **the skip link skipped nothing**: `SiteHeader` was rendered inside `<main>`, so `#main` contained the sticky bar and Enter+Tab landed back on the navigation, and the document carried **two nested `<main>` elements**. The fix is structural rather than cosmetic: the page owns `<main id="main" tabIndex={-1}>` and the bar renders outside it, and the gate asserts exactly one main, that the target does not contain the header, and that the next Tab stop is inside main — it went red on the unfixed build reporting `found 2`. `scroll-padding-top: 4.5rem` was the one rule with no gate, and a Tab walk cannot see it (Chrome scrolls a focused element only to the nearest edge); the anchor probe can: all four nav anchors come to rest at top **72** with the bar's bottom edge at **65**, and with the padding zeroed they rest at **0** — that falsification is why the gate measures an anchor jump rather than a Tab. The same eight scans also carry `wcag22aa`, which tag-selects axe-core 4.14's experimental `target-size` rule — off by default, and a rule that measures boxes rather than the tree, so every widget on those surfaces is now scored under SC 2.5.8 with the criterion's own spacing allowance while the geometry gate keeps the stricter Inline-only reading. It was proven to execute rather than silently skip: the landing page scores 14 targets and passes, a single spaced 10 px button passes by the offset allowance, two flush 10 px buttons put `target-size` in the violations, and — because a scan that quietly dropped the tag would stay green — the 2.5.8 gate reads all eight tag lists back out of the two spec files and fails naming the file that lost it. One measurement artefact is pinned in the file's comments: geometry read in the same task as a `Tab` press saw the skip link still at `left: -9999px` for one style recalc (**1 run in 12**), and a double `requestAnimationFrame` settle inside the probe took that to **0 in 12**; the gate settles, uses `reducedMotion: "reduce"` (the state an AT user is most likely in, and the one where `scroll-behavior: smooth` cannot animate a hit-test out from under it), and asserts each focused stop's centre and four corners all hit-test to itself | `e2e/accessibility.spec.ts`, `e2e/theme.spec.ts`, `e2e/wcag22.spec.ts`, `tests/placeholder.test.ts` |
| Contrast, pre-flight | `bun scripts/contrast.ts` reproduces axe to 0.02 offline | tool in repo |
| Claims (what the landing page says) | landing tiles + README suite figures re-derived from artifacts; mutation-checked | `tests/claims.test.ts` (6) |
| Claims (what the docs say) | **exact-count half**: 15 documented suite/parity figures diffed against a live `bun test` + `pytest` run and the corpus artifact; unmoved wording, a duplicated claim and an unrun tier are each a distinct non-OK status; falsified 15/15 red under a measurement doctored by one in every key, and end-to-end with exit **1** on real edits — the latest of which was this document's own page-1 snapshot, whose one-digit drift failed exactly that one site | `tools/check_claims.py`, in both CI jobs + `make claims-check` |
| Data gates | 5 gates: identity, brand-vs-name, cap derivation, compiled-table-vs-CSV, **evidence manifest vs bytes on disk** | `make data-check` |
| **Deployment artefact** (added 2026-10-28; the gap this audit had not named) | the compose stack builds, boots and serves on a clean volume, and CI now asserts *contents*: no host bytecode/DB/`.env` inside either image, **no Windows or macOS Prisma engine in the Linux runner image** (`COPY . .` used to overwrite the `deps` stage's Linux `node_modules` and ship `query_engine-windows.dll.node` + `schema-engine-windows.exe`), and the canonical origin baked into `/sitemap.xml` + `/` equals the build ARG (before: `localhost:3000` permanently, because the landing is prerendered). Context transfer 1.18 GB → 34.31 kB, `COPY . .` 204.2 s → 1.0 s, image 908 MB → 732 MB. **Corrected on the 2026-10-30 re-run:** the `34.31 kB` was not a context size — BuildKit reports only what it *transfers*, so that figure described a warm cache and could not be reproduced; the image sizes are **733 MB** (web) and **281 MB** (API). See `docs/TESTING.md` → "Container tier" for both corrections and for the order-dependency found there — filed as TD-32, closed by **RES-42** on 2026-10-31, the three content assertions now running `docker run` against the image instead of `docker compose run` against a service that has a database volume mounted at the path being searched | `.github/workflows/ci.yml` → `container` job; `docs/TESTING.md` "Container tier, as run" |

### The gaps, and what I would add

1. **Performance:** add a concurrency battery (k6, ramping 1 → 50 → 200 VU against
   the nine sealed endpoints), publish p50/p95/p99 **and error rate** at each level
   into `docs/PERFORMANCE.md`, and gate it — a p99 regression should fail CI the way
   a parity divergence does. Today's suite cannot tell you the app is slow, only
   that it is wrong.
2. **Security:** (a) an authz matrix test that enumerates every route × every
   identity state (anon / owner / caregiver / other patient) and asserts the
   expected status, generated from the route table so a new route cannot be
   forgotten; (b) dependency and secret scanning in CI (`bun audit`,
   `pip-audit`, gitleaks — partially present); (c) a PHI-leak lint: no `console.*`
   of request bodies, no raw text in audit rows; (d) threat-model doc per release.
3. **Integration:** a real **multi-worker** run (uvicorn `--workers 4`) asserting
   TD-7/TD-18 behaviour explicitly, so "the limiter fragments" becomes a measured
   number instead of a comment.
4. **UAT:** the one place the strategy has no substitute — two pharmacists
   labelling the corpus (C3, with inter-rater kappa) and a 20-patient walkthrough
   of the reminder loop. Script, consent form, and the metric that decides pass/fail
   (missed-dose recall; time-to-rescue on a late dose) belong in `docs/`.
5. **Resilience:** chaos on the model tier (already the design's best feature —
   prove it in CI with `LLM_API_KEY` absent, which the gates already do), plus a
   SQLite-corruption recovery drill (reset path exists and is gated).
6. **Regression on the honest-metric law:** adherence numbers must be
   snapshot-tested against a fixed seeded history so a future denominator change
   cannot silently move a patient's score — this is exactly how C5 hid.

---

## 7. Beyond the categories asked for

**Business model, from the constraints rather than from wishfulness.** The
licensing wall (non-commercial interaction data) plus TD-1 (no auth) plus S6 (no
erasure) means the current artefact is **not** a sellable consumer app, and saying
so is the most investor-grade thing available: the route that respects all three is
(1) ship the open-source deterministic rules *engine* with a pluggable data source
— credibility and a developer funnel; (2) sell **B2B verification + review-console
capacity** to pharmacy chains and telehealth platforms, who bring their own
licensed drug data — this sidesteps the dataset licence entirely, because you are
selling the gate, not the tables; (3) then, once an 8-week pilot produces a real
adherence delta, sell **outcome reporting** to payers and pharma-vigilance, who pay
for measured behaviour change and never need the app to be a consumer brand. The
consumer app stays free and remains the evidence engine, not the revenue engine.

**What would most impress an investor in the current tree:** the A1/A4 ablation,
the stale-evidence CI gate, and the refusal discipline — in that order. All three
are demonstrated rather than asserted, and none of them are common.

**What would embarrass the project if discovered by a hostile reviewer:** that the
headline adherence metric divided by answered doses (fixed here, now measured),
that `MPR` was a renamed duplicate of it (fixed here), that 171 brand rows screen
against nothing while the UI reads as clean (open, TD-20), and that the whole
product assumes one patient and no attacker (open, TD-1). Two of those are closed
in this tree; the other two are documented rather than hidden, which is the
posture the repository already commits to.
