# MediSaathi — Full Engineering Transformation Report

**Date:** 2026-09-10 · **Scope:** full red-team + staff review + executed transformation
**Method:** every claim executed and verified in this environment; nothing reported that was not run.

---

## 1. Executive Verdict

MediSaathi is already in the top tier of student/hackathon engineering: the two-plane architecture ("the model reads, the rules decide") is a genuinely correct idea, both implementations exist, both are tested, and the honesty discipline (refusal as a designed state, measured-not-claimed metrics) is rare. **Every performance and test claim in the README was verified true in this audit.** That said, it was not beyond attack or critique: this pass found and fixed one confirmed exploitable path traversal, one rate-limit bypass that made the limiter decorative against a real adversary, a limiter DoS, a missing web-tier middleware, a testing gap in the web tier, and ~660 packages of scaffold bloat. Post-transformation: 104 API tests + 14 web integration tests + gitleaks + ruff + pip-audit all green, second-pass red team clean.

## 2. Product Understanding

Target user: Indian families managing long-term therapy (elderly parents, chronic NCDs). Core problem: reminder apps ping, pharmacy apps sell, nothing *verifies*. The loop verify → schedule → adhere → protect → explain → measure is coherent and differentiated. The defensible moat is the deterministic safety plane + honesty posture — not the LLM. Competitive frame (Medisafe/1mg): they sell or remind; MediSaathi verifies and refuses. The product should keep refusing to become a diagnosis engine — that refusal is the identity.

## 3. Repository Baseline

**Verified working:** 93/93 pytest (now 104), eval benchmark (recall 1.00/agreement 1.00), ablation, demo-check, bench (p50 ~5 ms), 18/18 self-test, copilot gates, live degraded tier (all four verdicts without a model), production build, Docker, docs consistency largely accurate.
**Not working / found:** SEC-011..016 (see §9), 45/48 unused UI components, ~35 unused runtime deps, scaffold package name, no web lint/tests in CI, `dev.log` not gitignored, landing fallback claimed "95 brands" when formulary is 94.

## 4. Architecture Audit

Two-tier monorepo (product app + verification service) is the right size. Boundaries are clean: contracts package is the API's single source of truth; the safety plane is pure and zero-network in both languages; store APIs are the documented Postgres swap point. No microservices, no Kafka, no vector DB — correctly rejected complexity. Weak spots fixed: thread-shared SQLite connection (now per-thread); rate-limiter module constants re-read per request (kept: test seams, documented). The duplication of the safety law in TS+Python is a deliberate, defensible tradeoff (independent implementations, double evidence) — but it needs a cross-port conformance fixture file as the next real investment.

## 5. Staff Engineer Review

Would pass a staff review on architecture reasoning. A staff engineer would still challenge: (a) the TS/Python law duplication without a shared golden corpus — **legitimate, open**; (b) the ad-hoc overall-confidence formula in `verify/route.ts` (0.4·match-rate + 0.6·mean-confidence) — defensible heuristic, should be documented; (c) per-process limiters under multi-worker — filed as TD-11 with the documented Redis swap point.

## 6. Code Quality Audit

Above average: named constants for gates, docstrings citing regression history, first-action-wins dose law, ADR-style decision records. Fixed in this pass: 76 ruff findings (unused imports/noqa, unsorted imports, missing `raise ... from`, dead code), 3 real race conditions in panel data loading (stale-response clobber), skeleton-flash after dose actions.

## 7. Backend/API Audit

FastAPI tier is disciplined: envelope contract, vocabulary-validated contexts, magic-byte upload sniffing, O(1) `/metrics` via indexed column. Fixed: traversal (SEC-011), XFF bypass (SEC-012), limiter DoS (SEC-013), error chaining, no-echo 404s. Remaining honest gaps (documented): no auth (demo scope), no request-body size cap on JSON endpoints (TD-9), process-local counters (TD-7/11).

## 8. Database Audit

SQLite + WAL, parameterized statements, indexed `verdict_kind` for O(1) aggregates, in-place v2→v3 migration with backfill. Prisma schema is Postgres-portable; dose table has the right index (`scheduledAt`). Fixed: per-thread connections + `busy_timeout=5000`. Access patterns are demo-scale; the N+1-ish plan-creation loop is acceptable and bounded (≤15 lines).

## 9. Red-Team Security Audit (confirmed findings, all fixed + pinned by tests)

| ID | Finding | Severity | Exploit (executed) | Fix |
|---|---|---|---|---|
| SEC-011 | Fixture path traversal (CWE-22) | **High** | `sample_id=../../../../../apps/web/tsconfig` read an external file | allow-list + realpath containment; 404 without echo |
| SEC-012 | XFF-rotation limit bypass | Medium | rotate `X-Forwarded-For` → fresh bucket per request | trust XFF only behind `MEDISAATHI_TRUST_PROXY=1` |
| SEC-013 | Limiter clear-all DoS | Low | spray 10k junk keys → all budgets reset | approx-LRU eviction |
| SEC-014 | Web tier unprotected | Medium | unlimited `/api/verify`, no request IDs | Next middleware mirroring API contract |
| SEC-015 | `Math.random()` family codes | Low | predictable credential | `crypto.getRandomValues` |
| SEC-016 | Shared cross-thread DB conn | Low | read/write interleave on one conn | per-thread connections |

Prompt-injection posture re-verified: perception output is inert text; the verdict is unreachable by injected instructions (tested).

## 10. Healthcare Privacy & Safety Audit

No PII collected; contexts are vocabulary-validated and never guessed; images proxied, not persisted; logs carry no health content. The repo is careful to say *security ≠ privacy ≠ compliance ≠ clinical validation* and never claims HIPAA/GDPR/medical certification — correct. Stay that way.

## 11. AI/ML Audit

The AI layer is engineering, not decoration: schema-constrained vision extraction with per-line confidence, deterministic fallback splitter, BM25 retrieval with a refusal floor, 3-gate copilot (emergency triage → scope refusal → grounded generation with citations), post-check that strips dosage prescriptions, relabeled model self-refusals. The gate law makes the model swappable — the correct architecture for safety-adjacent AI.

## 12. AI Safety & Evaluation Plan

Exists and is honest: 18-case engine self-test (live in-product), 10-case copilot eval with automated rubric judge + explicit "not clinical validation", API-side golden fixtures + refusal precision + A1/A4 ablation. Next real investments (priority order): (1) grow the copilot eval to 50+ cases incl. adversarial/indirect-injection prompts, (2) version the eval labels and publish them with results, (3) cross-port conformance corpus shared by both engines.

## 13. Reliability Audit

Three-tier degradation (full/degraded/offline) is real and demonstrated. Fixed reliability items: stale-response races in the UI, limiter resilience, store concurrency. Remaining: single-region, no health-check in docker-compose (add `healthcheck:` when you deploy), in-memory counters reset on restart (TD-10).

## 14. Performance Audit

Measured: API p50 4.6–5.6 ms, p95 6.7–12.7 ms (400-request bench, this environment); engine self-test 5.2–5.7 ms for 18 cases; web first-load 639 kB uncompressed post-prune (vs 615 kB pre-prune — framework patch drift, honestly recorded in docs/PERFORMANCE.md; the prune's win is 827 → 170 packages install/audit surface, not bundle bytes). No fabricated numbers anywhere.

## 15. Testing Strategy

Now: 104 API tests (unit/property/golden/red-team/AI-safety) + 18/18 engine self-test + 3/3 copilot gates + **14 new route-handler integration tests** (sealed perception, isolated SQLite, full plan lifecycle + double-dose guardrail replay) + benchmark + ablation + demo-check as executable documentation. Gaps honestly filed: no Playwright E2E (TD-3), axe-core not in CI (TD-4).

## 16. DevOps & CI/CD

CI now runs: gitleaks (full history) → ruff → pip-audit → pytest 104 → eval → ablation → demo-check (API); eslint → tsc → selftest → 14 integration tests → production build (web); PR-only dependency review; least-privilege `contents: read`; concurrency cancellation. Not deployed anywhere in this environment (stated, not claimed).

## 17. Observability

Request-ID correlation now on **both** tiers; security headers stamped on every response incl. 429s; structured AuditLog in the web tier; verdict/refusal/schema-fail counters; latency header on API responses. Privacy law held: no health content in logs.

## 18. UX/UI Audit

The "Clinical Editorial" system is coherent and unusual in the best way (typographic, calm, purposeful). Workspace panels lazy-load per tab. Fixed: skeleton flash on dose actions, stale-data races, "95-brand" fallback fiction.

## 19. Accessibility Audit

Added: skip-to-content, `:focus-visible` ring (2.4.7), `aria-live` verdict region (4.1.3), reduced-motion covers ALL entrances + hover-scale (2.3.3). Pre-existing good: semantic tabs with `aria-current`, `aria-pressed` toggles, labeled textarea. Honest gap remains: no measured axe-core audit (TD-4) — keep it filed.

## 20. Visual Design System

Tokens in `globals.css`: pine/clay/paper palette in oklch, severity colors, hairline cards, banner states, tabular numerals. Dark theme defined. The system is documented by use, not by a poster.

## 21. Image Strategy

Executed: hand-crafted SVG → 1200×630 PNG social preview + OG image (68 KB each), typographic, on-brand, no stock photos, no AI imagery, full alt text in the README. Lives at `.github/assets/social-preview.png` + `apps/web/public/og.png`.

## 22. Animation Strategy

One motion (fade-up), three delays; CSS-only, zero runtime cost (explicit ADR against framer-motion — a JS animation library earns nothing at this motion budget); all entrance animation and hover-scale disabled under `prefers-reduced-motion`.

## 23. GitHub Audit

Fixed: `.github/ISSUE_TEMPLATE` (bug + safety/security), PR template with the repo's law checklist, social preview asset, `*.log` gitignored. UI-only (documented in PUSH_INSTRUCTIONS.md): About description, topics, social preview upload, branch protection, pinning.

## 24. README Transformation

Added brand hero image; all numbers updated to measured reality (104 tests, 14 integration tests, 40 red-team tests); new Security posture entries (middleware parity, CSPRNG codes, traversal hardening); two new engineering-decision entries (dependency prune rationale, CSS-motion rationale) written as interview answers.

## 25. Documentation Architecture

Kept the existing (strong) doc set; extended SECURITY.md + docs/security/SECURITY_AUDIT.md (SEC-011..016 with exploits/fixes/tests), TESTING.md (web integration suite), PERFORMANCE.md (honest re-measurement), TECH_DEBT.md (TD-11). No doc claims anything unverified.

## 26. Architecture Diagrams

Existing ASCII pipeline diagram in README is the right maintenance-free choice; the brand image carries the gate-law visual. If you want rendered diagrams later, prefer Mermaid (renders natively on GitHub) over PNG.

## 27. ADRs

docs/DECISIONS.md ADR table verified referenced (ADR-006 limiter swap point cited in code). This pass added two decision records in README (dependency prune, CSS motion) and one in TECH_DEBT (TD-11).

## 28. Recruiter 10-Minute Test

**10s:** hero image + "The model reads. The rules decide." — instantly parseable. **30s:** measured-results table with runnable commands — credible. **2min:** engineering-decisions section reads like interview answers. **10min:** red-team suite, ablation, honest limits section — this is where doubt converts to respect. Remaining friction: hackathon-branded docs (VMEDITHON) — fine to keep, but the pinned README no longer leads with it.

## 29. FAANG Hiring-Bar Assessment

Fundamentals 8.5/10 · architecture 8.5 · problem solving 8 · code quality 8 · security 8 (post-fix; was 6 with the traversal) · AI maturity 8.5 · testing 8 (was 6.5 — web tier now tested) · reliability 7.5 · DevOps 8 (was 6) · product thinking 8 · communication 9 · originality 8.5. Earned, not gifted: every score maps to runnable evidence.

## 30. Senior Engineer Interview Questions (now answerable from the repo)

Why two planes? (README §decisions) · What happens when the model fails? (three-tier degradation, tested) · How do you prevent prompt injection? (inert perception + rule assembly, property-tested) · How do you rate-limit behind a proxy? (`MEDISAATHI_TRUST_PROXY`, XFF trust model, tested) · How do you test AI behavior? (labeled cases + rubric judge + ablation, in-product) · What breaks at 10x traffic? (TD-7/11, documented swap points) · Show me a security bug you found and fixed. (SEC-011, with the regression tests)

## 31. WOW-Factor Features (defensible)

1. The gate law with in-product self-test (refusal as designed success).
2. A1/A4 ablation proving the plane, not the reading, carries safety.
3. Double-implementation safety plane with independent suites.
4. Red-team suite where every test cites the failure mode it guards.
5. Honest degradation the demo "cannot be killed by WiFi, quota, or outage."

## 32. Things To Remove (done) / Never Add

Removed: 45 UI components, ~35 deps, scaffold name, dead code, `noqa` noise. Never add: vector DB/agent frameworks/microservices for this scale; stock photos; buzzword claims; another LLM "feature" that deterministic logic can own.

## 33. P0/P1/P2/P3 Roadmap

P0 (done): SEC-011..016. P1 (next): shared golden corpus for the dual-plane law; grow copilot eval to 50+ cases; JSON body size caps (TD-9). P2: nonce CSP (TD-2), Playwright E2E (TD-3), axe in CI (TD-4). P3: Postgres/Redis swap (TD-7/11), versioned DDInter/RxNorm snapshots (TD-5), pharmacist review console.

## 34. Exact Files Changed (this pass)

**API:** `app/vision.py`, `app/routers/api.py`, `app/middleware_security.py`, `app/store.py`, `app/safety/{engine,dosing}.py`, all 6 test files. **Web:** `package.json`, `bun.lock`, `tsconfig.json`, `src/middleware.ts` (new), `src/app/{layout,globals.css}`, `src/app/api/family/route.ts`, `src/components/{landing,workspace?no}` + `app/{family,today,verify}.tsx`, 45 deleted UI files, `tests/api.test.ts` (new). **Root:** `ci.yml`, `ruff.toml` (new), `Makefile`, `README.md`, `CHANGELOG.md`, `SECURITY.md`, `.env.example`, `.gitignore`, `.github/templates` (new), `.github/assets` (new), `apps/web/.env.example`, `public/og.png` (new), 5 docs files.

## 35–36. Implementation & Verification Plan (executed)

Every fix followed: patch → targeted test → full suite. Final verification on the committed tree: ruff clean · **104/104 pytest** · eval pass · demo-check pass · eslint clean · tsc clean · **18/18 + 3/3 selftest** · **14/14 integration** · production build pass. Second-pass red team: **14/14 fresh probes clean**. Anything not runnable here (GitHub Actions UI, actual push) is labeled as such in PUSH_INSTRUCTIONS.md.

## 37. Final Scorecard (current → target for "unimpeachable")

| Area | Before | After | Next lever |
|---|---|---|---|
| Security | 6.0 | **8.5** | nonce CSP, body caps |
| Testing | 6.5 | **8.0** | E2E + axe in CI |
| DevOps | 6.0 | **8.0** | deploy target + healthchecks |
| Code quality | 7.5 | **8.5** | shared golden corpus |
| AI evaluation | 7.5 | **8.0** | 50+ labeled cases |
| Recruiter impact | 7.0 | **9.0** | hero + verified numbers + clean tree |
| Architecture | 8.0 | **8.5** | cross-port conformance tests |
| Docs honesty | 8.5 | **9.0** | keep the ledger discipline |

## 38. Resume-Ready Achievements (all evidenced in-repo)

- Designed and implemented a deterministic medication-safety plane (TS + Python) with property-based red-team coverage (118 automated checks across two tiers), p95 < 13 ms per verification.
- Found and fixed an exploitable CWE-22 path traversal plus a rate-limit bypass via header rotation through a self-authored adversarial review; every fix pinned by a failing-first regression test.
- Built an AI evaluation harness (labeled cases, automated rubric judge, ablation proving decision-plane causality) and shipped measurement in-product rather than as claims.
- Cut a scaffold dependency tree by 79% (827 → 170 packages) with a grep-verified import audit; established lint, secret-scanning, and dependency-audit CI gates running least-privilege.

## 39. LinkedIn Presentation

Post the **social-preview image** (it unfurls everywhere). Lead with the law, not the stack: "Reminder apps ping. Pharmacy apps sell. Nothing verifies — so I built the thing that refuses to guess." Second beat: measured table (18/18 self-test, 104 tests, p95 < 13 ms, A1→A4 agreement 1.00 → 0.17). Third beat: the refusal story with a screenshot of a refused verdict. Never claim medical validity — the honesty is the differentiator and engineers will notice it.

## 40. Final Hiring Verdict

**Would I interview this developer? Yes — and put them in the "strong hire" conversation for mid-level, with a credible path to senior given the security growth shown between the first hardening pass and this one.** The repository demonstrates the rarest signal: not "I used impressive things," but "I verified my own claims, attacked my own system, and wrote down what I found." The remaining gaps are documented rather than hidden, which is itself the strongest engineering signal in the repo.
