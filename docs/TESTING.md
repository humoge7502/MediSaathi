# Testing Strategy & Results

**Latest runs (API/data/parity measured 2026-11-02 against dataset snapshot `cbcbc470c439ffd9`; web tier re-measured 2026-10-28 after the theme slice landed and nothing in this list is aspirational):**
- API tier: **468 passed** on `fastapi 0.162.0 · starlette 1.10.0 · pydantic 2.14.2 · uvicorn 0.54.0 · hypothesis 6.170.13 · pytest 9.2.0` (three runs of this suite: 26.5 s, 26.9 s, 34.3 s — reported as a band and not as a pinned figure, because the band is the only honest form). Four numbers in this bullet's own history are worth their sentences: the count is **468** and not the **466** this document carried on 2026-10-29, and the +2 is the two `tests/test_dataset_manifest.py` gates added with the `data/reference/` provenance pass; 466 was in turn not the **462** carried before it, that +4 being `tests/test_verdict_tally.py`; and the 36.6–43.8 s band recorded for the *smaller* 462-test suite did not reproduce, so "the wall time moves ±20% between runs" was a description of three observations on a differently-loaded machine rather than a property of the suite. Same suite: safety-plane properties + API golden paths + perception + red-team + JSON body cap + the two identity laws + the evidence chain of custody + the maintained verdict tally. Run through `.venv/Scripts/python.exe`: the editable installs from `make setup` live there, and a bare system interpreter fails this tier on `ModuleNotFoundError: medisaathi_contracts` — an environment fault, not a code one. (`make` itself is not on PATH on this Windows box, so each gate above was invoked as its own `python tools/…` command.)
- Web tier: **509 tests / 26 files / 10 845 assertions** (route + unit, isolated SQLite, perception sealed; the run at this count took 37.9 s, against 96.3 s and 124.3 s at the count before it, and three runs of a near-identical suite two passes ago took 103.1 s, 95.8 s and 41.3 s, so wall time is a band here and not a pinned number — the suite shares one SQLite file, and a cold run pays the first-query WAL cost the section below calls out) · **18/18 engine self-test (100%) + 3/3 copilot gates** · `eslint`, `tsc --noEmit`, `next build` clean · **64 browser tests in 6 files** (17 product journeys + 7 accessibility gates — 5 axe scans in light plus the status-message announcement gate and the placeholder gate — + 9 theme gates (3 dark axe scans over 8 dark surfaces, one a six-panel tour, plus 6 rendering gates) + 14 WCAG 2.2 geometry gates + 12 service-worker gates headless + 5 delivery gates headed, of which 2 need a dose 2-180 min ahead of the real clock and skip out loud when none exists — both were executed and passed against a dose put inside that window, then reverted; the headed file also needs a *window server*, and CI is given one by `xvfb-run` rather than skipping five gates — see "The delivery tier is split by what a browser will let it measure").
- Cross-engine parity: **164/164 golden cases agree in both planes** at corpus law **v12** (`PARITY_VERSION` pinned by both runners).
- Sealed fixture benchmark: brand recall **1.00** · frequency recall **0.9938** · verdict agreement **0.973** · refusal precision **1.00** (n=111; the 3 misses are stale sealed labels — TD-21). `eval/regression_gate.py` **passes**, and no longer on a number: it asserts the exact disagreement set `{RX-045, RX-088, RX-089}`, re-derives the aggregate from the case rows that produced it, and re-baselines `eval/baseline.json` to the measured 0.973. It had been **red on every CI push** while these labels were stale, because it floored the metric at 1.00 against a baseline of 1.0 — the stale baseline, not the October dependency upgrade, was the cause, proven by running the eval on both stacks and getting byte-identical metrics and the same three ids.
- Data gates (`make data-check`, five): molecule vocabulary · brand self-consistency (**0 of 2 836 rows** contradict their own name) · dose-cap derivation (305 molecules, hash `3dc1505f75b23bdd`) · compiled web table vs its three CSVs · **dataset manifest vs the bytes on disk**.
- Experiments E-A…E-H re-run under corrected provenance: A4 agreement **1.000** / unsafe **0.000**, E-C zero unsafe at all six corruption levels, E-H 0.8315 → 0.9048 → **1.000** (`eval/results/RESULTS.md`, one manifest per run under `eval/runs/`).

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
| Data-identity gates | `tests/test_molecule_identity.py`, `tests/test_pmbjp_identity.py` | one drug one name (11 retired aliases, 5 pinned non-merges, the import gate that rejects a retired identity or a duplicated engine key) **and** the inverse law: no catalog row keyed to a molecule its own brand string denies, checked end-to-end through the real engine including the patient-facing warning text | 31 + 10 |
| Evidence chain of custody | `tests/test_dataset_manifest.py` | the committed `data/manifest.json` matches the bytes on disk; mutating a tracked table moves `snapshot_id` and makes `verify_manifest` report it; **a run manifest cites disk hashes even when the record is stale**; a refresh preserves the builders' seed/strata metadata; the governed importer refreshes the record in the same step that replaces a table; **editing a dose cap moves the dataset identity** (the whole `data/reference/` tier is hashed by directory, so the next table added beside `dose_caps.csv` cannot escape it either); and the shipped manifest is asserted to carry `dose_caps.csv` and `qt_prolonging.csv` — the two tables the engines read to decide a ceiling and a QT stack | 7 |
| Web mirror of both identity laws | `apps/web/tests/molecule-identity.test.ts`, `apps/web/tests/pmbjp-identity.test.ts` | no key the product tier looks up names a retired spelling; every one of the 226 repaired ledger rows compared against the compiled table the app actually loads, and the whitespace fold (`_norm_key`'s law) asserted in the artifact itself | 7 + 8 |
| Web: full suite | `apps/web/tests/*.test.ts` via `bun run test` | routes, gate law, dose-cap and interval laws, regimen escalation, generated-table invariants, proxy security contracts (`proxy.security.test.ts` **23**, the Next.js 16 rename of the middleware convention — and since the container pass also the **deploy-budget fallback**: a set-but-empty `MEDISAATHI_RATE_*` is `""`, `Number("")` is `0`, and a zero write budget answers 429 to every mutation in the product, so `envPositiveNumber` is pinned behaviorally *and* by a structural gate that fails if `src/proxy.ts` stops reading its budgets through the guard), **the join-code credential law** (`family.test.ts` — minted once, hinted on every read path, uniform generator, never stored in the audit trail), **ownership scope on every id-taking route** (`ownership.test.ts`), **the request boundary** (`limits.test.ts` streamed body cap, `run-guard.test.ts` single `/api/evals` run), **the destructive demo reset as a deny-by-default matrix and its timeline law** (`seed-gate.test.ts`), **the reminder law** (`reminders.test.ts` **47** + `reminders-route.test.ts` **13** — which alerts a plan owes in which order, deduplication against the delivered-set, quiet hours, per-medication mute, any answer ending the sequence, settings round-tripping through the server), **the worker law** (`pwa.test.ts` **33** — the protocol, timer horizon, periodic-sync tag and day-key shape the two planes must agree on; that the handover carries the *law* rather than a copy of it; that a `sync` stamped with a day the worker does not live in changes nothing; that exactly one `cache.put` exists and is held open by the `FetchEvent` that started it; that no code path in the worker reads `localStorage`, which is `undefined` in a worker and a `TypeError` on the first wake; and — because the headed tier can hide itself behind a green run — that its display guard fires *before* a browser exists, refuses to skip on macOS or Windows, treats Wayland-only as no display, and that the CI job which runs it installs the X server the guard asks for), **the adherence analytics, overdue-sweep and catch-up laws** (`adherence.test.ts` **25**, of which one test is a **property oracle**: 200 generated histories, every published number recounted by an independently written second implementation — it is what found the future-day hole), **the public-claim gate** (`claims.test.ts` re-derives every landing-page number from the artifact it describes), **the theme law** (`theme.test.ts` **30** — resolution, boot-script text invariants, both schemes' `color-scheme`, every `.dark` override naming a real token, the band tokens *not* being overridden, ratios recomputed out of `globals.css` rather than out of a comment, two name laws (no `-ink` token as a background, no `.dark`-redefined fill without its own `-on` label), and the **typeface law** — the display and wordmark faces must be the ones the body mounts, `.vy-serif` must resolve through `--font-display` with a real serif under it, every markup element that renders the वैद्य wordmark must carry the class that gives it a Devanagari face, and the generated Open Graph card may only paint families it registers with satori and hexes a `:root` token still resolves to), **the placeholder law** (`placeholder.test.ts` **11** — what a panel shows *before* it has anything: `animate-pulse` may live in one file and one file only, because a pulse is an opacity cycle and the five panels that pulsed a sentence were pulsing body copy to 50% for a third of every second; nothing rendered while a panel waits may contain text, so the shapes are `aria-hidden` and the shell says `aria-busy`; an empty card comes from the shared `EmptyState` and must name the way out; and the tab entrance is a `@starting-style` **transition** rather than a keyframe, because `animation: … both` leaves `transform` computed on the node after its last frame and silently turns it into a containing block), **the announcement law** (`status.test.ts` **12** — WCAG 2.1 SC 4.1.3 read out of the source rather than assumed from a screenshot: an *empty* live region must still be in the accessibility tree, so collapsing is done with `h-0` and never with `display:none`, the `hidden` attribute or an unmount, because a region created in the same commit as its first message is the documented non-announcement case; `role` and `aria-live` are fixed per component, so tone is two components rather than a prop flipped on a node the assistive tech already registered; the writer set is **derived** from the `post(`/`save(` call sites and then pinned to its exact eight files, so a ninth panel that writes without announcing fails instead of going unnoticed; every `aria-live` node in the tree carries a `status`/`alert`/`log` role and only the primitive and the copilot transcript are live at all — a result column with `aria-live` on it re-reads hundreds of words per mutation; a writer that shows a failure shows it on the assertive region; no `catch` block in the UI layer is empty; and the one-time caregiver join code is spoken as well as printed) | **509 tests / 26 files / 10 845 assertions** |
| Offline E2E | `tools/demo_check.py` | all six verdict kinds through real HTTP + plan + price + refusal counter | 1 gate |
| **Web: deterministic engine** | `apps/web/scripts/selftest.ts` + `lib/safety/selftest.ts` | **18 expert-labeled cases** — the same counterfactual the A1 ablation proves: the rules, not the reading, carry safety | 18 cases |
| **Web: copilot gates** | `scripts/selftest.ts` → `lib/ai/copilot.ts` | emergency triage and scope refusal fire deterministically, **before any generation** (the same `copilotGate()` path the API uses) | 3 gates |
| **Web: typecheck + build** | `bun run typecheck` + `bun run build` | strict TS, standalone production build with **22 route entries** (17 server-rendered incl. `/api/reminders` and `/api/queue/*`, 5 static metadata), exiting with **zero deprecation warnings** since the `middleware` → `proxy` rename (RES-30) | 2 gates |
| **Web: smoke** | manual E2E (single command) | verify → plan → dose → catch-up guardrail → family → analytics → metrics | 15 checks |
| **Web: browser E2E (TD-3 resolved)** | `apps/web/e2e/product.spec.ts` + `accessibility.spec.ts` + `theme.spec.ts` + `wcag22.spec.ts` via Playwright | landing story + metrics, workspace launch (all seven sections), verify (severe interaction w/ DDInter source, triple whammy, confirm queue, prompt-injection inert), review console (queue blocks the plan, human resolves), copilot gates (emergency, scope, out-of-knowledge), evidence (18/18 self-test + archived operating point and ladder), today plan, first-action-wins dose guardrail, **reminders twice**: a chosen nudge POSTed, reloaded, and reflected in the card copy, and **delivery on `page.clock`** — an injected `Notification` class records every announcement while the clock runs 08:48 → 09:50, proving the 08:50 nudge, 09:00 due and 09:30 late re-nudge each fire once and that nothing fires after the dose is answered, family (a minted join code renders exactly once and is absent from the DOM after re-opening the panel) — plus the axe gate: landing, workspace, **the Today tab (reminders card + a timeline holding both a taken and a skipped dose)** and evidence tab with zero serious/critical WCAG 2.x violations, **and the same scan in the dark scheme over the landing page, the Today tab and a one-page tour of all six remaining panels** (verify, review, insights, copilot, family, evidence — each click asserted by `aria-current` *and* a panel-specific anchor, so a scan of a surface that never mounted fails instead of passing quietly) — plus six theme-rendering gates: the first `requestAnimationFrame` of a dark-OS visit is already dark, Chromium's canvas agrees with `scripts/palette.ts` on the same token to ±2/255, the served bytes put the nonced boot script above any markup that could paint, a stored choice survives a reload against the OS, `prefers-color-scheme` is followed live until a choice is stored, and a browser that throws on `localStorage` still hydrates, **plus the announcement gate that no at-rest scan can see**: every `role="status"` node is stamped with a `data-vy-before` attribute *before* the write, a verification is run, and the node that ends up holding "Verification finished:" must still carry the stamp — which is the only way in this tier to prove the region outlived its message instead of being created together with it — the sentence it announces is one line rather than the panel, and it is asserted to contain the confidence figure a pharmacist reads visually — **plus the WCAG 2.2 geometry a tree-only axe scan cannot reach** (`wcag22.spec.ts`, 14): Reflow at 320 px (the document may not scroll sideways; a table inside its own `overflow-x-auto` region is the allowed exception — this found Today at 382 px and the Family relation picker at 420 px), Target Size 24×24 with the criterion's own Inline exception implemented rather than waived (this found four 20 px header links), Focus Not Obscured measured by walking Tab stops and hit-testing the centre and four corners of each focused element (the skip link skipped nothing because the sticky bar lived *inside* `#main`, and the document held **two nested `<main>` elements** — the gate asserts one main, that the target excludes the header and that the next stop is inside main), and the sticky bar's `scroll-padding-top` proven on an anchor jump rather than on Tab, because Chrome scrolls a focused element only to the nearest edge and the padding is invisible to that walk (all four nav anchors rest at top 72 with the bar ending at 65; at padding 0 they rest at 0). Each of these was falsified against a deliberately broken build before being credited: reflow and target thrice, the skip gate reporting `found 2`, the anchor gate reporting `#gap rests at 0, the bar ends at 65` — and the padding gate's first Tab-walk form stayed **green** against the broken build, which is why it was rewritten as an anchor measurement. All eight axe scans (five in light, three in dark) also carry `wcag22aa`, which tag-selects axe-core 4.14's experimental `target-size` rule — disabled by default, so the tag is the only thing running it. Live proof on the served page: 14 targets scored and passing; a single spaced 10 px button passes by the criterion's offset allowance; two flush 10 px buttons put `target-size` in the violations; and the 2.5.8 gate reads every tag list back out of `accessibility.spec.ts` and `theme.spec.ts`, so a scan that silently drops the tag is red rather than green | **47 tests** in the four deterministic files (17 product journeys + 5 axe scans in light + 1 status-message announcement gate + 1 placeholder gate + 3 in dark covering 8 dark surfaces + 6 theme-rendering gates + 14 WCAG 2.2 geometry gates); the full browser tier is **64 tests in 6 files** — the other 17 are the PWA rows below, `make web-e2e` |
| **Web: service worker, headless** | `apps/web/e2e/pwa.spec.ts` via Playwright | the half of the PWA tier a headless browser can measure, in the order the features depend on each other. **Served bytes**: `/manifest.webmanifest` is answered as `application/manifest+json` with the installability inputs the OS needs (`id`, `scope`, `start_url`, `display: standalone`, both icon purposes, shortcuts) and the document actually links it; `/sw.js` is answered under a CSP that a worker can *run* under — no `nonce-`, no `strict-dynamic`, `script-src 'self'` present, `must-revalidate` so a worker can update — while the document's own policy still matches `script-src 'self' 'nonce-…" 'strict-dynamic'`, which is the proof the exclusion did not become a hole in the page. **A worker that starts**: `controller.scriptURL`, `state === "activated"` and `reg.scope` read from the two different objects that hold them. **A queue that outlives the document**: handed over, every tab closed, and the same keys, moments and wording come back — from IndexedDB, not from a page still open to remember them; **a message stamped with a day the worker does not live in is discarded rather than merged**, so its do-not-repeat list cannot hush today's alert; a cancel empties queue, timer and `beyond` without recording the alert as announced; and an alert past the 30-minute horizon is **counted, not dropped** — split rather than truncated, since the nudge at +25 min gets a real timer and `due` at +35 min waits for a wake. **The links an icon and a notification open**: every manifest shortcut opens the panel it names (asserted on the tab strip's `aria-current`, not on any button with that label) and keeps it in the URL; the worker's `notificationclick` literal is a route that answers with the right tab; a `?task=` that is not a tab is no instruction at all; a deep link survives a reload; and **the shell opens offline while the data refuses to** — an offline reload paints the panel the patient was on *and* the landing an installed icon opens, `/api/plans` returns a network error rather than a stale plan, and the offline document arrives with a worker controlling it. | 12 gates (headless) |
| **Web: reminder delivery, headed** | `apps/web/e2e/pwa-delivery.spec.ts` + `e2e/pwa-helpers.ts` | the half that cannot run headless, in its own file because Playwright rejects `test.use({ headless })` inside a `describe` (see "The delivery tier is split by what a browser will let it measure"): a **precondition gate** that asserts `Notification.permission === "granted"` so no later "nothing appeared" can be read as a pass; **the worker announces while every tab is closed** (a lawful alert 8 s out, handed over through `toScheduled(planAlerts(...))`, the tab closed, the real clock waited, then `getNotifications()` — a worker-exclusive observation channel — shows the exact title/body/tag, and the `tag` equals the queue `key` on both paths so the browser's own dedupe does the work); **the anti-fork round trip** (what the worker was handed is compared byte for byte against the same two modules the product imports, through the product's own hook); **the double-announce bug** (a reminder the worker fired with no document is merged into the page's delivered set and is not re-announced on reopen, while the `:due` alert for the same dose stays armed); and **cross-window resolution** (a dose answered in a second tab drops the key from the one worker, so no post-*Taken* notification). 2 of the 5 need a pending dose 2-180 min ahead of the real clock and, when the seeded day has none, skip out loud with the fix in the reason. The whole file additionally needs a **window server**: on Linux a headed Chromium fails to launch without `DISPLAY`, so the file skips itself as one unit *before* Playwright opens a browser, and CI is given an X server (`xvfb-run`) so the skip never fires there. | 5 gates (headed) |
| **Web: contrast, computed offline** | `apps/web/scripts/contrast.ts` | oklch → linear sRGB → relative luminance with alpha composited over the real background, printed PASS/FAIL against the AA floor; **reproduces axe's own live measurements to 0.02** (2.69 vs 2.71, 4.18 vs 4.19), so a palette change can be checked before a browser is booted. It is how the two failing status chips (3.66:1, 2.52:1) were turned into ink tokens that clear the floor (6.33, 6.48, 7.61) — and, since the theme slice, how the two dark-scheme defects were reproduced without a browser first: the report prints the fixed law band (mint 6.86, heading 10.98, body 7.80) beside the shape that shipped (1.06, 1.51, 1.07 — axe measured 1.05, 1.51, 1.08) and white-on-dark-safe at 2.36 where axe saw 2.35 | `bun scripts/contrast.ts` |
| **Verdict-tally unit law** | `apps/api/tests/test_verdict_tally.py` | the maintained counter equals a full row scan after plain writes, after a verdict-replacing upsert, after an idempotent re-put and after a cleared verdict; a pre-tally database seeds **once**; an `EXPLAIN QUERY PLAN` guard fails the suite if the production read ever touches `prescriptions` again. No test asserts milliseconds — on this machine that would fail for the wrong reason | 4 |
| **Multi-process proofs (separate processes, not threads)** | `tools/prove_tally_atomicity.py` → `make prove-atomicity`, `tools/prove_wal_boot_order.py` → `make prove-boot-order`; both wired into CI | the first runs 3–8 real processes over one shared 8-prescription pool — because the production race is two confirmations of **one** `prescription_id` — and reports the `BEGIN IMMEDIATE` shape beside a deliberately stale-read shape, so the guard is demonstrated rather than asserted; `--baseline ROWS` additionally quotes the single-process write ceiling TD-30 uses. The second opens a **deleted** file from N processes in both `PRAGMA` orders and counts lost connections per shape, gating only on the production order. Each prints the broken shape's result without asserting it must fail — whether a race fires depends on OS scheduling, and a gate that can only pass is not a gate | 2 gates |

## Multi-process gates, as run (2026-10-28)

A race gate is only readable if the reader knows what a real run looks like —
including a run where the hazard stayed silent. Verbatim, at the `make`/CI flags:

```
$ python tools/prove_tally_atomicity.py --workers 3 --rounds 1500 --baseline 3000
  baseline (1 proc)   287 writes/s over 3000 rows | put() p50 3.062 … verdict_counts() p50 0.005 p99 0.0166 ms
  baseline (1 proc)   291 writes/s over 3000 rows | put() p50 3.100 … verdict_counts() p50 0.007 p99 0.0314 ms
  baseline (1 proc)   303 writes/s over 3000 rows | put() p50 3.044 … verdict_counts() p50 0.0107 p99 0.0261 ms
                        spread: 287-303 writes/s on identical code (the band, not the mean, is the number TD-30 quotes)
  immediate    3 x 1500 rounds -> written 4500
              tally {'duplicate_atc': 3, 'pass': 2, 'interaction': 3}
              rows  {'duplicate_atc': 3, 'interaction': 3, 'pass': 2}  MATCH
  stale-read   3 x 1500 rounds -> written 4499, 1 refused by SQLITE_BUSY, 1 of them from a stale base
              tally {'duplicate_atc': 2, 'pass': 3, 'interaction': 3}
              rows  {'duplicate_atc': 3, 'interaction': 2, 'pass': 3}  DRIFT
production put(): exactly consistent
stale-read shape: drifted, as expected          → exit 0

$ python tools/prove_wal_boot_order.py --trials 30 --workers 4
  wal-first (the old shape)          120/120 opened, 0 failed  [clean]
  timeout-first + retry (production) 120/120 opened, 0 failed  [clean]
production shape: 0-vs-0 failures, wal-first hazard did not reproduce this run (a race, not a certainty)
                                                → exit 0
```

Read the two runs against each other and the design of these gates is obvious: the
atomicity gate's own shape is exact every time, so it can assert; the boot-order
gate's production shape is exact every time but its *hazard* shape is not, so it
prints and gates only on what it can promise. Across three earlier boot-order runs
the WAL-first order lost 3 connections in 360; this run lost 0 in 120 and the tool
said so rather than reporting a clean sweep of both shapes.

## Container tier, as run (2026-10-28; re-run against the live stack 2026-10-30, and the
assertions themselves rewritten 2026-10-31)

Every other job in `.github/workflows/ci.yml` tests *source*: lint, typecheck, unit,
integration, browser, build. None of them has ever produced an image, which is how a
deployment path can be green for eight weeks while it ships the wrong bytes. A
`container` job now builds the real compose file, runs the schema one-shot, boots
`up -d --wait --wait-timeout 180`, and asserts the properties below — each by
`docker run --rm --entrypoint sh <image> -c 'test -z "$(find …)"'` for image contents or by
a `curl` against the live stack, not by reading the YAML.

| Property | Before (measured on this machine) | After |
|---|---|---|
| Context handed to the web build | **1.18 GB** transferred; `load build context` **214.3 s**, `COPY . .` a further **204.2 s** (host `node_modules`, a 293 MB `.next`, `db/custom.db` at 929,792 bytes) | host `node_modules`, `.next`, `.venv`, `db/*.db` and `__pycache__` excluded by two `.dockerignore` files; context load **11.0 s**, `COPY . .` **1.0 s** |
| Foreign binaries in the Linux runner image | `query_engine-windows.dll.node` and `schema-engine-windows.exe` present, image **908 MB**: `COPY . .` lands *over* the `deps` stage's Linux `node_modules`, so the runner copied the Windows ones out of the build stage | **0** matches for `*windows*` / `*.exe` / `*darwin*`; image **733 MB** |
| Host bytecode in the API image | 67 `__pycache__/*.cpython-313.pyc` | **0**; image **281 MB**, CPython 3.13.18 |
| Canonical origin in `/sitemap.xml` and `/` | `http://localhost:3000`, permanently: `/` is prerendered and the metadata routes resolve at build time, and `NEXT_PUBLIC_SITE_URL` was set nowhere | the build ARG's origin — `https://demo.medisaathi.test/` in the local A/B, `https://ci.example/` in CI, and re-proved on 2026-10-30 with a third value: `NEXT_PUBLIC_SITE_URL=https://reverify.medisaathi.test docker compose build web`, then `curl /sitemap.xml` → `<loc>https://reverify.medisaathi.test/</loc>` and **8** occurrences in `/`, with **zero** occurrences of the `localhost:3000` fallback |
| Privacy kill switch | `MEDISAATHI_DISABLE_MODEL_EGRESS` passed to `api` only, though **both** tiers read it | passed to both services |
| API exposure | `8000:8000` on every interface of the host — no in-compose consumer, no auth layer | `127.0.0.1:8000:8000` |
| After a reboot | no `restart` policy: the demo stays down until an operator notices | `restart: unless-stopped` on both long-running services |
| Limits that survive an operator's blank `.env` | `${VAR:-}` yields `""` for a set-but-empty variable, `Number("")` is `0`, and a zero write budget answers 429 to every mutation | read back out of the running containers on 2026-10-30: `MEDISAATHI_RATE_WRITE=60`, `_WINDOW=60`, `RATE_READ=300`, `MAX_BODY_KB=64`, `EVAL_REUSE_MS=120000`, `TRUST_PROXY=0` — all spelled numeric defaults, plus `MEDISAATHI_ALLOW_DEMO_RESET=0` and an empty `MEDISAATHI_ADMIN_TOKEN` |
| Destructive demo reset, on the running stack | — | `POST /api/seed {"force":true}` with no token answered **403** `{"ok":false,"error":"Force reset is disabled in this deployment…"}`, and wrote an `AuditLog` row `seed.force_denied` carrying `{"adminTokenConfigured":false,"demoResetOptIn":"0"}`. Every demo table was byte-identical before and after (`Dose` 56, `TherapyPlan` 1, `Medication` 3, `EscalationEvent` 2); the only row added was the denial itself, so a refused wipe is auditable rather than silent |

Three things the re-run changed, each recorded because it is the kind of correction a
hand-maintained table drifts by silently — the first two landed in this table, the third
landed in the workflow:

- **Two sizes were stale by 1 MB** (732 → **733** for the web runner, 280 → **281** for the
  API). Nothing else in the table moved: the bytecode and foreign-binary counts are still
  zero and CPython is still 3.13.18. These container numbers are *not* sites in
  `tools/check_claims.py` — that gate derives the suite counts (466, 509/26/10 845, 164 at
  v12) and stops there — so a rebuild that adds a megabyte has no gate to tell anyone. The
  honest reading of this table is "measured on this machine, this date", and the date is now
  in the heading for that reason.
- **The `34.31 kB` context figure was removed rather than re-measured**, because it turned out
  never to have been a measurement of the thing it appeared to measure. `docker build` reports
  the context it *transfers*, and on a repeat build BuildKit transfers only what changed since
  its cached context. The figure therefore described a warm cache, not the effect of the
  `.dockerignore` files, and a probe built to reproduce it reported 7.05 kB and 118.11 kB for
  the same two trees. Reproducing the full-context number needs a cache prune, which was
  declined: this Docker host also carries other projects' images. What is left in the row is
  the exclusion list and the two wall times, which are what the fix actually changed.
- **The `*.db` / `.env*` find assertion was sound only in the order CI ran it — and is now
  fixed rather than filed.** Run against the *service* (`docker compose run --rm --no-deps
  --entrypoint sh web …`) on a machine that already has demo data, it returns **1** match —
  not image content, but the mounted `medisaathi-web-db` volume. Run against the image itself
  it returns **0**. On 2026-10-31 the three content assertions were rewritten to `docker run
  --rm --entrypoint sh medisaathi-container-api:latest` / `…-web:latest`, and the job pins
  `COMPOSE_PROJECT_NAME: medisaathi-container` so those tags exist at all: without the pin, a
  `build:`-only service's implicit tag is the checkout directory's basename, which is not a
  fact the workflow controls. Rebuilt under that project name and re-ran the three commands
  verbatim — all **0**. Two controls, because a green guard that cannot go red is not a guard:
  the same wrapper aimed at `/app/package.json` returns **1**, so the predicate is live; and
  the old service-based form still returns **1** on this machine, so the false positive was
  real rather than hypothetical. `docs/TECH_DEBT.md` RES-42.

The three find-based assertions were executed against the built images *locally* before
the job was trusted: a CI guard that fails on its own quoting bug is worse than no guard,
and `sh -c` with a glob inside double quotes does not glob.

The whole job was then rehearsed end to end on this machine under the pinned project name
— schema one-shot (rc 0, fresh volume), `up -d --wait` (both services `Healthy`), `/api/evidence`
and `/healthz` both **200** on loopback remaps, and the origin step green. The rehearsal also
produced an unplanned but genuine red for the origin gate: the first `web` image was built in a
shell that had `COMPOSE_PROJECT_NAME` but *not* `NEXT_PUBLIC_SITE_URL`, so compose substituted
its own default and `/` shipped **8** occurrences of `localhost:3000` with **0** of the intended
origin — precisely the failure that step exists to catch, reproduced by building without the ARG
rather than by editing the app. Rebuilt with `NEXT_PUBLIC_SITE_URL=https://ci.example` in the
same environment the build runs in: `/sitemap.xml` carries **1** `<loc>https://ci.example/</loc>`,
`/` carries **8** occurrences of the ARG origin and **0** of the fallback. The lesson is the
build/run split, not the code: a job-level `env:` block covers both phases in CI, but a local
rehearsal that exports the variable only in the shell that boots the stack will build the wrong
image and still look healthy.

That pass also surfaced a code-level foot-gun in compose interpolation. `${VAR:-60}`
covers unset *and* empty, but `${VAR:-}` yields `""` — and a set-but-empty variable is
`""`, not `undefined`, so `process.env.X ?? 60` returns `""` and `Number("")` is `0`.
For the write limiter that is a **zero budget**: every POST in the product answered 429
on a healthy install. `docker-compose.yml` now spells its numeric defaults, and
`src/proxy.ts` reads every budget through the exported `envPositiveNumber`, so a deploy
typo falls back instead of going dark. `tests/proxy.security.test.ts` (**19 → 23**) pins
it four ways: defaults and honoured values; a junk sweep (`""`, `" "`, `"60x"`, `"NaN"`,
`"Infinity"`, `"-1"`, `"0"`, `"two"`, `"1e"`); a behavioural gate showing
`allow(key, 0, …)` denies the first request while `allow(key, envPositiveNumber("", 60), …)`
admits it; and a structural gate that fails if `proxy.ts` stops calling the guard. The
structural gate earned its keep immediately — its first draft matched
`Number(process.env.MEDISAATHI_RATE…`, which the *guard's own call site* contains, so a
test written to prove the fix was red until it was anchored with a `(?<![\w$])` lookbehind
plus an exact count of four guarded reads. `MEDISAATHI_EVAL_REUSE_MS` deliberately accepts
an explicit `0`, so it is parsed by a different helper and is *not* one of the four — and
the same blank-value hazard was closed there too (`limits.test.ts`, **16 → 17**): a blank
line reads as unset and keeps the documented 120 s window, while a `0` an operator typed
still means "run every time". That gate was falsified before it was credited — reverting
the one changed line makes it the only failure in the file (16 pass / 1 fail).

## Documented counts, as derived (2026-10-29)

Two gates cover the numbers in this file and they cover different halves of the problem,
which is why both exist.

`apps/web/tests/claims.test.ts` (fast, runs inside `bun run test`) re-derives the landing
tiles from the artifacts they describe and pins the README suite figures as **lower bounds**
on test *declarations*. A unit test cannot pin an exact figure: a parametrized case is
written once and run many times, so `test(`-counting is a floor by construction, not a
measurement.

`tools/check_claims.py` is the exact-count half. It runs the suites (`bun test tests/
--timeout=20000` and `python -m pytest apps/api -q`), parses their own summary lines, counts
the shared parity corpus out of `eval/parity/golden.json`, and then compares what every
document *states* against what that run *produced*. `--tier web` / `--tier api` / `--tier all`
select which suites are affordable; each CI job runs its own tier, and `make claims-check`
runs all.

Statuses are deliberately non-boolean, because a gate that can only say OK has a way of
saying OK for the wrong reason:

| Status | Meaning |
|---|---|
| `OK` | the document's number equals this run's number |
| `FAIL: doc says X, the measurement says Y` | drift — the case the tool exists for |
| `FAIL: claim not found (its wording moved)` | the regex no longer matches, so a silent pass is impossible; the site is edited, not the pattern |
| `FAIL: ambiguous (n matches)` | two places claim the same present-tense number; the tool refuses to guess which one is current |
| `SKIP: unmeasured …` | this tier never ran that suite, so the number was compared against nothing — reported as a partial result, never as OK |
| `FAIL: the suites are not clean` | a red or errored suite makes the measurement itself untrustworthy |

Fourteen sites are checked today: two README rows and the README parity row, four in this
file, four in `docs/audit/PROJECT_ANALYSIS_2026-10.md`, the newest `Gates after this pass`
line in `CHANGELOG.md`, the newest `Web suite after this pass` line in
`docs/TECH_DEBT.md`, and the parity step *name* in `.github/workflows/ci.yml` — the last of
those was found by hand: it said "shared 148-case golden corpus" while `golden.json` holds
164 cases, a number GitHub renders in the run UI, so every CI run was advertising a stale
corpus size.

`CHANGELOG.md` and `docs/TECH_DEBT.md` are *history*, so only their newest block makes a
present-tense claim; both sites select one match rather than refusing a file with several, and
an older block quoting an older count is correct rather than stale. Which end is "newest"
follows how each file grows: the changelog **prepends** a block, so its current claim is the
first match, while the resolved-debt table **appends** a row, so its current claim is the last.
The difference is not cosmetic — the first version of this used one `first_only` flag for both,
which pinned the *oldest* `Web suite after this pass` row, and that fails in the worst available
way: it goes red on exactly the day the count is correct, so the natural "fix" is to restore the
stale number.

Falsified the same way as every gate above, three times:

1. **Synthetic** — the 15 sites were re-checked against a measurement doctored by exactly one
   in each key (510/27/10 846/467/165/v13). All 15 went `FAIL`; none matched its number by
   accident. The same call with only the parity measurement — doctored too — produced 0 `OK`,
   5 `FAIL` and 10 `SKIP`: no site was credited for a number nobody ran.
2. **End-to-end through the CLI** — `docs/TESTING.md:31` was edited to `480 tests` and the CI
   step name back to `148-case`, then `--tier web` ran the real suite through the project
   venv interpreter: exactly those two sites `FAIL`, the two API-stating sites `SKIP`, exit
   code **1**. Both files were restored from byte-for-byte verified backups (sha256 prefix
   `7c688b76…` / `e6acf93f…`) and a re-check reported 14/14 OK. The same route was walked
   again when the audit's page-1 snapshot joined as the 15th site: `509` became `508` in that
   row alone, `--tier web` ran the real suite, and exactly that site answered
   `FAIL: web.pass: doc says 508, the measurement says 509` at exit **1** while the other
   thirteen kept their own status (12 `OK`, 2 `SKIP: unmeasured`). The file came back
   byte-identical from a hash-verified backup (sha256 prefix `dacf0eb3d1c7df07…`).
3. **The `pick` direction, on the day it started to matter** — the two history sites were
   re-checked against the current measurement as shipped (`CHANGELOG.md:65` OK,
   `docs/TECH_DEBT.md:83` OK), then with the `docs/TECH_DEBT.md` site flipped back to
   `PICK_FIRST`. It then reads `docs/TECH_DEBT.md:81` — the *previous* pass's row — and
   reports `FAIL: web.pass: doc says 481, the measurement says 485`. That is the bug this
   field exists to prevent, demonstrated rather than asserted: the direction is only
   observable once a file has two rows, which is why it was written and shipped wrong.

Also worth stating, because it is the honest caveat on a tool that parses numbers out of
prose: the separator class (NBSP, figure space, narrow and thin spaces, tab) is folded to a
plain space before matching, so `10 845` written with a U+00A0 and `10807` are the same claim;
a number written in words ("about four hundred eighty tests") is not a claim this tool can
see, and is not checked. Files that record a *pass* rather than a *state* are deliberately out
of the site list for the same reason `CHANGELOG.md` is read newest-block-only — the first audit
document (`docs/audit/REPOSITORY_AUDIT.md`) quotes "90 passed" before hardening and "93 passed"
after it, and both are correct about the moment they were written.


## Shared-database timing (why the web suite gets a 20 s ceiling)

`bun test` runs every file in **one process**, so the `PrismaClient` singleton is
created once — against whichever `DATABASE_URL` was set first. Each test file
mints its own temp path and assigns `process.env.DATABASE_URL`, but the client is
already bound, so in practice **all 23 files share one SQLite database** (the
newest one, `theme.test.ts`, never opens it — it reads `globals.css` and
`src/`, which is the point: see the blind spot noted in TECH_DEBT.md's RES-33).
Three consequences are load-bearing:

1. **A file that leaves an `active` `TherapyPlan` behind changes what every later
   file sees.** `/api/verify` composes its regimen from the active plan, so a
   leaked plan silently re-labels another file's expected verdict. Every file that
   creates rows deletes them in `afterAll` (`family.test.ts`, `seed-gate.test.ts`,
   `ownership.test.ts`, `regimen-route.test.ts` each track the ids they minted).
2. **The first query in a file can land on a WAL checkpoint left by whichever file
   wrote last.** That is a multi-second stall on Windows and it is not the tested
   code being slow — it is the harness. It produced the original 5 000.91 ms
   timeout in `regimen-route.test.ts`.
3. **`describe()` takes no timeout.** Passing a third argument is a TypeScript
   error *and* a runtime no-op, so a per-block budget is not a thing this suite can
   ask for. The ceiling is set two ways instead: `setDefaultTimeout(20_000)`
   (file-scoped, so a file run alone is still honest) and `--timeout=20000` on
   `bun test tests/` (the whole-suite ceiling; bun's default is 5 000 ms). The
   slowest test in the suite measures 344 ms in isolation.

## API red-team coverage (`tests/test_redteam.py`) — what each test protects

| Test | Failure mode it forecloses |
|---|---|
| `test_confirm_rescreens_with_declared_context` | **Verified regression:** confirm used to re-screen with an empty context — contraindications silently vanished after human confirmation. Context persists on the row; the child-doxycycline canary fails loudly if the law breaks. |
| `test_security_headers_present_on_every_response` | missing `nosniff`/`DENY`/CSP on any route |
| `test_request_id_*` | log-correlation gaps; CRLF/unicode/oversize id injection |
| `test_upload_*` (magic bytes, MIME mismatch, ISO-BMFF, oversized) | spoofed/mismatched/oversized uploads reaching the vision path |
| `test_rate_limit_429_and_recovery` | unbounded write abuse; 429 must be an Envelope, not a raw string |
| `test_metrics_schema_fail_counter_is_real` | **Verified regression:** `llm_schema_fail_total` was hardcoded `0` — now bound to the real counter |
| `test_json_body_cap_rejects_declared_oversize` | oversized JSON with a declared Content-Length must 413 before the app reads a byte (TD-9) |
| `test_json_body_cap_rejects_chunked_oversize` | chunked bodies without Content-Length are byte-counted and aborted at the cap |
| `test_json_body_cap_allows_normal_body` | the cap must not reject legitimate payloads |
| `test_confirm_rejects_*` | IDOR-adjacent input abuse on the confirm endpoint |
| `test_context_garbage_keys_are_dropped_silently` | unknown context codes influencing rules |
| `test_formulary_search_unicode_and_injection_safe` | injection/unicode/oversize search abuse |
| `test_prompt_injection_in_fixture_lines_never_captures_verdict` | injected instructions in extracted text must be inert — decisions stay rule-derived |
| `test_plan_blocked_for_refused_and_queued` | unverified fields leaking into the spoken plan |

## Web-tier integration suite (`bun run test`, deterministic)

The web tier now has a route-handler integration suite that mirrors the API
tier's sealed-fixture law: the perception layer (`@/lib/ai/extraction`) is
module-mocked with fixed confidences, so the deterministic plane, the Next.js
route handlers, the Prisma/SQLite persistence and the guardrails are exercised
end-to-end without any model key — in a developer shell or in CI.

| Suite | What it proves |
|---|---|
| verify | warfarin+aspirin → severe interaction (persisted); unreadable input → confirm queue (offline tier: unmatched formulary lines queue, B9); no lines → refused; short input → 400; doxycycline + `age_under_12` → contraindication |
| plan lifecycle | pass verdict → plan with scheduled doses; GET returns today's doses; second plan archives the first; refused prescriptions can never become plans |
| dose guardrail | first `taken` wins; replaying the action is inert (`already_acted`); unknown actions rejected |
| family | join code matches the CSPRNG alphabet; malformed `eventId` rejected before lookup |
| metrics | counters actually moved after the pipeline ran |
| regimen escalation (`tests/regimen-route.test.ts`) | a triple whammy assembled across two visits escalates the published verdict (single-Rx law passed it); a same-brand refill keeps passing; a fragile read (0.93, auto band) queues at fieldIndex 0 and blocks the plan; human acceptance releases it; rejection leaves the prescription unverifiable |
| regimen plane (`tests/regimen.test.ts`) | the TypeScript port of `regimen.py`: composition catches cross-visit harms, propagation queues fragile reads (ablation removes the queue), identity distributions normalise, verdict mass sums to 1, screens are deterministic |
| nonce CSP (`tests/proxy.security.test.ts`) | document routes get a per-request nonce + `'strict-dynamic'` script CSP with no `'unsafe-inline'` in script-src; API routes keep the limiter contract and carry no page CSP |

Run: `cd apps/web && bun run test` (a throwaway SQLite is created and pushed
automatically; the developer database is never touched).

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

The second clause is the one that has bitten here, twice: a test that is
structurally incapable of failing reads exactly like a passing guard. Both
multi-process proofs in the table above run the **broken** shape next to the
production shape and print it, because "green" only means something when the
same command could have said red. RES-31's first version minted one prescription
per worker, so the stale-read control could not drift and reported MATCH — which
is what a decorative guard looks like.

The theme slice (RES-33) added a third shape of the same problem, and it is a
tier-shaped one: the web unit suite reached 23 files and stayed fully green while
the application it described returned **HTTP 500 on every document route**,
because `layout.tsx` imported `headers` from `next/server` and that module does
not export it in Next 16. A test that reads a source file with `readFileSync`
cannot resolve a module, and `bun test` never starts the router. The same tier is
blind to rendering: it asserted palette ratios for months while `.dark` —
unreachable, so never measured — carried two WCAG failures a browser found on its
first run. To be exact about who did catch what: `bunx tsc --noEmit` named the
bad specifier immediately, and `next build` would too (`ignoreBuildErrors` is
`false`); the failure was not that no tier could see it, it is that the slice was
being driven by `bun test` output and the typecheck ran afterwards. Both blind
spots are now paid for in the tier that can see them: `e2e/theme.spec.ts` fetches
a real document and asserts `res.ok()`, and the two defects are pinned as *names*
(`--vy-band` may not be overridden in `.dark`; an `-ink` token may not be a
background) as well as by scan.

## The delivery tier is split by what a browser will let it measure

A service worker is the only part of this app whose behaviour cannot be reached from
the document that owns it, so the PWA tier splits along **facts about Chromium**, not
along subject areas. Three boundaries, each of which changes what a green run means:

**1. A headless browser has no message centre.** Measured on this build: headless
Chromium reports `Notification.permission === "denied"` for this origin *even after*
`context.grantPermissions(["notifications"])`, which is the same call that makes
`permissions.query({name:"notifications"})` answer `granted`. A denied origin never
reaches `showNotification`, so running the delivery gates headless would assert that a
notification was **not** shown — a gate that can only pass on a browser with nothing to
deliver to. The second measured fact is what makes the headed half worth its cost:
`getNotifications()` does **not** list notifications a page constructed with
`new Notification()`; it is a worker-exclusive observation channel, so an entry there is
proof of *who* announced, and the page's side of the pair needs the recorder in
`recordPageAnnouncements` instead of a platform count. And a worker's own `setTimeout`
does fire with every tab closed, with its notification still in `getNotifications()`
when a page comes back — which is the product promise (`you are told even after you
close the tab`) and the only way to observe it.

**2. The split is therefore two files, not two `describe`s** — Playwright rejects
`test.use({ headless })` inside a `describe` because it forces a new worker. Headless
`e2e/pwa.spec.ts` owns the served bytes, registration, the queue's life across tab
close, the day guard, cancel, the horizon count, the deep links and the offline shell
(12 gates, always runnable). Headed `e2e/pwa-delivery.spec.ts` owns the permission
precondition and delivery itself (5 gates). `e2e/pwa-helpers.ts` is a module rather
than a copy because two definitions of "what the worker said" is exactly the fork the
rest of the tier is built to catch; every `page.evaluate` body in it is self-contained,
since a body ships as source text and the document's nonce CSP rules out `eval` as a way
to close over a constant.

**3. Two of the five headed gates need a dose 2-180 minutes ahead of the real clock,
and the honest answer at other hours is a loud skip.** `page.clock` cannot reach a
worker — `product.spec.ts` uses the fake clock precisely because nothing there has to
survive a closed tab — so the only lever the product itself offers over *when* an alert
becomes due is `leadMinutes`: for the next pending seeded dose, `floor((slot - now) /
60s) - 1` puts the nudge 60-120 s out, inside the worker's 30-minute horizon, and whole
minutes because the law only accepts minutes. The seeded plan holds 09:00 / 14:00 /
21:00 doses, so a late-evening run has nothing ahead of it and the two gates call
`skipWithoutNearDose`, which `console.warn`s the window it needs and names this file.
The alternative — a gate that passes at 22:00 because nothing was armed — reports
success on a feature it never looked at. Both were **executed, not assumed**: a single
synthetic pending dose was inserted into the developer database, the two gates passed in
1.8 min, the row was deleted and the file re-measured. Measured again for this edition:
`bunx playwright test e2e/pwa.spec.ts e2e/pwa-delivery.spec.ts` at 22:42 IST →
**15 passed, 2 skipped in 51.3 s** — the skip is the time of day, not the mechanism, and
the always-run headless gates carry it.

**4. A headed browser also needs a window server, which is a CI fact.** On Linux a
headed Chromium fails to launch with `Missing X server or $DISPLAY`, so the default
`ubuntu-latest` runner would have gone red for a reason that is not a product defect —
and Playwright's `install --with-deps` supplies Chromium's shared libraries, not an X
server. `.github/workflows/ci.yml`'s `web-e2e` job now installs `xvfb` and runs
`xvfb-run -a bun run e2e`; the same escape hatch is available on a local Linux box
(`xvfb-run -a make web-e2e`, noted in the `Makefile`). For any *other* display-less host
the file skips itself as one unit via `displayAvailable(…)` at file scope: the placement
is load-bearing, because a
`beforeEach` that touches the `context` fixture has already launched the browser, so only
a file-scope `test.skip` can act before the launch attempt. The predicate is pure and
unit-pinned in `tests/pwa.test.ts` — `DISPLAY` set/unset/empty on Linux, Wayland-only
treated as no display (Playwright launches X11 Chromium by default), never false on
macOS/Windows (a false there would hide five gates on the machine most likely to run
them), and a structural assertion that the guard sits at file scope and after
`test.use({ headless: false })`. What is proven where: this Windows host runs the headed
tier for real (the guard cannot fire, and did not); the Linux branches are proven by the
unit gates and by the workflow installing the display, not by a runner log.

The offline half of the boundary is stated once, because it is a product claim: the
worker precaches `/` and `/icons/icon.svg` and adds **every document this visit
navigates**, so an installed icon opened offline answers with the landing page and the
panel the patient was last on answers with itself, while `/api/*` is never answered from
a cache — a stale plan is a plan someone could act on. That gate asserts the patient's
own URL comes back, and was proven load-bearing by mutating the built copy and watching
exactly that gate fail (RES-34's third defect).

## What each tier cannot see

| Tier | Blind to | What that blindness hid, first |
|---|---|---|
| `bun test` (unit + route) | module resolution — it loads `@/lib/*` through bun's own resolver, never Next's; rendering; paint order; CSP enforcement | `headers` imported from `next/server`: every document route 500, 417 tests green |
| `bunx tsc --noEmit` | anything a type does not describe — a value that exists but is the wrong colour, a ratio nobody renders, an effect that re-renders | nothing in this slice: it caught the bad specifier *and* a missing `Rgb` type import. The lesson is ordering, not coverage — it has to run before a slice is called done |
| `bun run lint` | correctness — it enforces hook *shape* | `react-hooks/set-state-in-effect` in `theme-toggle.tsx`: a real cascading-render hazard the unit tier accepted |
| `bunx playwright test` | anything off the six scanned surfaces; the timing of a race; and **its own host** — headless Chromium cannot deliver a notification, a Linux host with no `DISPLAY` cannot open the headed file at all, and no clock override reaches a worker, so two gates depend on the time of day | the two dark-scheme contrast failures, both found on the first dark run; the headed tier's CI launch failure was found by reading `ci.yml`, not by running it, which is why the guard is unit-pinned (see the section above) |
| `next build` | runtime warnings Next 16 stopped printing at build time; lint does not run during a build | the 500: it typechecks the route and fails, so a build was always part of this gate |

The durable line from this: a UI slice is not verified until a browser has asked
the running server for a page. Everything above that line is a text assertion
about intent.

## Known gaps (honest)

Closed since the first edition of this list, so it does not keep claiming absences
the repository has fixed: browser automation exists (`apps/web/e2e/`, **64 tests in 6
files** — 17 product journeys, 7 accessibility gates (5 axe scans, 1 announcement proof,
1 loading-state proof), 9 theme gates (6 theme-rendering, 3 axe), 14 WCAG 2.2 geometry
gates (reflow, target size, focus-not-obscured and the sticky bar's scroll padding,
none of which a tree-only axe scan can see — the eight scans also carry `wcag22aa`, so axe's own target-size rule scores beside them), 12 headless
service-worker gates and 5 headed delivery gates — with `make web-e2e` and its own CI
job, which now runs under `xvfb-run` because the headed tier needs a window server),
and accessibility is audited by axe-core in
CI rather than only built to convention (8 scan bodies covering 13 surface-scans:
landing, workspace, the Today tab, the evidence tab and the copilot tab in the light
scheme, then
landing, the Today tab and a tour of all six remaining panels in the dark one —
the `.dark` palette is reachable now, and the first dark scan is what found the
two defects RES-33 records).

What is genuinely still open:

- **No sustained-load rig against the running server.** The API bench is 400
  sequential requests over three transports, and the two new proofs hammer the
  *store* from several processes, not HTTP. Nothing measures the service as a
  service under concurrent clients, so the single-writer ceiling (TD-30) has no
  request-level number attached to it.
- **The store-busy path has no test because it has no behavior.** A refused write
  surfaces as an anonymous 500; there is no `503`, no `Retry-After`, no
  `store_busy_total`. A test would only pin the defect, so TD-30 carries the
  measured refusal ladder instead (0, 2, 3, 7 and 21 writes of each run's total
  across 3→8 processes) and the handler is the fix that gets a test.
- **axe covers every workspace surface in both schemes, and the behaviour gap it
  structurally cannot see is now gated separately.** The dark scheme is scored on
  the landing page, the Today tab and a tour of the other six panels in one page,
  so nothing about a dark-only *contrast* regression is uncovered. The remaining
  honesty was never about colour: a status message exists only after a mutation,
  so an at-rest scan of a green page said nothing about SC 4.1.3 one way or the
  other — and when this was read rather than assumed, five of the eight panels
  that write to the server announced nothing at all. That is now a law
  (`status.test.ts`, structural) plus a browser gate that stamps every live
  region before the write and requires the announcing node to be the same node.
  Two absences stay open and are stated rather than glossed: the tour still
  scores each panel **as it mounts**, so a state a panel only reaches after an
  interaction (a queue row awaiting resolution, a family code mid-display, a
  copilot answer with a source citation) is not on the page axe scores — the
  announcement gate covers those panels' *messages*, not their contrast in that
  state; and all 17 product journeys still run in the light scheme, so a
  dark-only *functional* regression is not covered by them.
  The tour's own falsifiability was checked rather than assumed: with
  `.dark --muted-foreground` deliberately moved to `oklch(0.28 0.01 160)` and a
  rebuild, it failed naming `color-contrast` on **all six** panels — a gate that
  can only pass is not a gate.
- **The synthetic corpus can agree with the engine but cannot falsify it** (TD-22).
  Every verdict-agreement number in this project is a self-consistency claim, and
  the only external label source (MED-005 dual-pharmacist kappa) is shipped as
  protocol and sheets, not as annotated data.
- **Race gates report, they do not assert.** A WAL boot-order hazard fired in 3 of
  360 connections across three runs and not at all in a fourth, so both tools
  gate only on the production shape and print the hazard's count. That is the
  honest ceiling for a race on one machine; a deterministic version needs a
  scheduled interleaving, which SQLite does not offer.
- **A closed tab is not a powered-off phone.** Every gate in the headed tier keeps
  *the worker* alive and proves its `setTimeout` fires with no document (RES-34,
  and re-measured here at 15 passed / 2 honest skips in 51.3 s at 22:42 IST). The
  wake that outlives the **browser process** is Periodic Background Sync: the app
  *requests* it (`requestPeriodicWake` registers the tag at the interval the browser
  publishes, and Chromium answers `NotAllowedError` until the app is installed and
  judged engaged), the worker *has* a `periodicsync` handler, and the card's sentence
  is walked over all four answers (`on`/`off`/`unsupported`/`unknown`) so it can never
  claim a schedule it was refused. What is **not** here is a device bench: no Android
  Doze test, no iOS Safari run (its worker lifetime rules are stricter still), no
  real-installed-PWA harness. So the shipped promise is exactly "you are told even
  after you close the tab, on a browser whose process is alive", and Web Push —
  `PushManager`, a server holding subscriptions, an operator-minted VAPID key — remains
  TD-27's other half rather than a claim in the copy.
- **The headed tier's Linux branches are pinned, not observed.** `displayAvailable`'s
  false branch has never run on this machine (Windows opens a headed Chromium whether or
  not anything is on screen, and the guard correctly never fired in any run recorded
  above), and the `xvfb-run` step in `ci.yml` has not executed on `ubuntu-latest` yet —
  the workflow change is verified by reading it and by three unit gates over its text,
  not by a runner log. This repository is deliberately not being pushed, so the first
  real evidence for that branch is the first CI run after the provisional is filed.