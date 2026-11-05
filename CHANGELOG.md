# Changelog

All notable changes. Format based on Keep a Changelog; versions here map to
the event build blocks.

## [Unreleased] - the content guard stopped looking at a volume

The `container` job's three image-contents assertions ran through a compose *service*,
and `web` mounts a named volume at `/app/db`. So `find /app -name "*.db"` was not
reading the image: on this machine it returned the demo database sitting in
`medisaathi-web-db`. The same predicate, run against the image, returned nothing —
**1** versus **0** for the identical `sh -c 'test -z "$(find …)"'` string. CI was green
because of step order (the assertions precede the schema one-shot on a fresh runner),
and the documented local invocation false-positives for anyone who has ever run a demo
here, telling an operator the image leaks the database.

All three now run `docker run --rm --entrypoint sh <image> …`, and an image has no
mounts, so a volume cannot be in the field of view. Making that possible required
naming the images: the job pins `COMPOSE_PROJECT_NAME: medisaathi-container`, because a
`build:`-only service's implicit tag is otherwise the checkout directory's basename —
a fact the workflow does not control, and one that silently changes if the repo is
renamed or the runner's path layout shifts.

Then the two controls that make the rewrite trustworthy rather than merely newer. The
gate is not vacuous: the same wrapper aimed at a predicate that *does* match
(`/app/package.json`) returns **1**. The old form's failure was real, not theoretical:
re-run here, it still returns **1** on this machine, because that volume really does
hold `custom.db`. And against the rebuilt images all three assertions return **0**,
which is what CI will see. `docs/TECH_DEBT.md` closes this as **RES-42**; the
paragraph in `docs/TESTING.md` that had recorded it as an open tracking issue now
records the fix, and the `ci.yml` step comment keeps the A/B so nobody "simplifies" it
back to `docker compose run`.

Rehearsing the rest of the job under that project name then produced the red that proves
the *other* container gate is live. The first `web` image was built in a shell carrying
`COMPOSE_PROJECT_NAME` but not `NEXT_PUBLIC_SITE_URL`, so compose substituted its own
default and the running app shipped **8** occurrences of `localhost:3000` and **0** of
the intended origin — the exact defect the "build-time origin is the one that shipped"
step was written to fail on, reproduced here by building without the ARG instead of by
touching application code. Rebuilt with the variable present in the build environment:
**1** `<loc>` and **8** occurrences of `https://ci.example`, **0** of the fallback, both
services `Healthy`, `/api/evidence` and `/healthz` both **200**, schema one-shot clean on
a fresh volume. In CI a job-level `env:` block reaches both phases; the trap is local,
where exporting a build-time value only in the shell that boots the stack builds the
wrong image and still looks healthy. Everything from the rehearsal was scratch — its own
project name, its own volumes, throwaway loopback ports — and was torn down afterwards;
the two gates that guard a hosted launch remain the CI `container` job and the filing
that still has to happen.

## [Unreleased] - the container tier, re-surveyed against a running stack

The deployment docs had a table of container measurements taken on 2026-10-28 and a
line saying they had been re-verified the next day. Re-verification had meant reading
the built image; this pass built, booted and *asked the running stack*, which is the
only way to find out whether a documented property is delivered rather than merely
declared. Both tiers came up `Healthy`, and the properties held: `/sitemap.xml` and
`/` carry the build ARG's origin with **zero** occurrences of the `localhost:3000`
fallback (a third value, `https://reverify.medisaathi.test`, added to the two already
on record); the limiter budgets arrive spelled numeric rather than as `""`, so no
`Number("")` zero-budget can 429 the product; the privacy kill switch is present in
**both** containers' env; both publishers bind to `127.0.0.1`; both restart policies
are `unless-stopped`; `POST /api/seed {"force":true}` with no token answers **403**.

Two things came out of it that the docs could not have told me.

The destructive-reset claim is stronger than it was written, and worth the sentence
that now says so: the denial is not only returned to the caller, it is written to
`AuditLog` as `seed.force_denied` with the reason (`adminTokenConfigured: false,
demoResetOptIn: "0"`). A refused wipe is auditable instead of silent. The probe that
proved it was made reversible first — the volume's SQLite file copied out and compared
table-by-table afterwards, every demo row identical, the audit row the only delta.

And one published figure was wrong in kind rather than by drift. The container table
said the build context went from **1.18 GB to 34.31 kB**. `docker build` reports the
context it *transfers*, and a repeat build transfers only what changed since BuildKit's
cache, so 34.31 kB described a warm cache and could not be reproduced: a probe aimed at
the same two trees returned 7.05 kB and 118.11 kB. Measuring it honestly needs a cache
prune, declined because this daemon also holds other projects' images. The figure is
gone rather than caveated into invisibility — what remains in that row is the
`.dockerignore` exclusion list and the two wall times, which are what the fix actually
changed. The two image sizes had genuinely drifted a megabyte each (**732 → 733**,
**280 → 281**); everything else in the table held, including zero `.pyc`, zero foreign
binaries and CPython 3.13.18 — and TD-31's innards were re-measured rather than
assumed, where 192 / 112 / 20 / 37 MB all still hold and both Prisma engine variants
and all four `@img` platform blobs are still in the image.

The re-run also found a guard whose green depends on step order. The `container` job's
`*.db`/`.env*` find assertion returns **1** when run against the compose *service* on a
machine that already has demo data — it is matching the mounted volume, not image
content — and **0** against the image itself. CI passes today only because the
assertion sits before the schema one-shot. It was filed as **TD-32** and fixed the same
night rather than left as debt; the block above this one records the fix.

`docs/DEPLOYMENT.md` gained the two operator facts this could not have been found by
reading: `3000` and `8000` must both be free or `docker compose up` dies with
`port is already allocated` rather than half-starting, and a `ports: !override` file
remaps the host side while keeping the loopback law (`!override`, not a plain `ports:`
list, because sequences in a second compose file append — publishing the occupied port
*and* the new one, and failing for the same reason). Its `DATABASE_URL` row now says
what the container actually sets (`file:/app/db/custom.db`, the volume) and its
working-database figure was replaced by the file's name, because it grows:
`apps/medisaathi.db` is 235,888,640 bytes, not the 224,952,320 on record.

The claims gate re-ran clean over all 15 sites after the edits — 466 API tests,
509/26/10 845 on the web tier, 164/164 parity at v12 — which is the part of the
documentation that is derived and therefore cannot rot; the container numbers are not
sites in that gate, which is exactly how they drifted, and the section heading now
carries its own re-run date for that reason.

## [Unreleased] - three pins that fell behind overnight

`constraints.txt` exists because a floating install once made CI disagree with
the machine the gates ran on. It is only useful if the barge is re-surveyed,
so the survey was repeated against PyPI a day after the dependency pass: three
pins had already fallen behind — `pydantic 2.14.2` (and `pydantic-core`
2.50.2 with it), `pytest 9.2.0`, `hypothesis 6.170.13`. Everything else in the
file was still current: `fastapi 0.162.0`, `starlette 1.10.0`, `uvicorn
0.54.0`, `python-multipart 0.0.32`, `httpx 0.28.1`, `httpx2 2.16.0`, `ruff
0.17.3`.

The three were bumped rather than noted, and the whole API battery re-ran on
the new stack through the project venv: **466 passed** in 20.7 s, the four
data gates green, `tools/demo_check.py` **PASS** over 111 sealed cases, the
fixture eval unchanged, and Python parity **164/164**. pytest's summary line is
the thing `tools/check_claims.py` parses, so a 9.x output change would have
turned the claims gate red rather than mis-parsing — it did not. The
constraints header now records 2026-10-29 and 466 tests.

## [Unreleased] - the skip link that skipped nothing, and the phone that scrolled sideways

The accessibility passes so far read the page the way axe reads it: a settled
document, scored at rest. Three of the four WCAG 2.2 criteria this pass went
after are not visible to that reader at all, because they are about geometry
under motion — how wide the page is on a 320 px phone, how tall a link is when a
thumb is aimed at it, and whether the thing that took focus is actually the thing
the user is looking at. A fourth, the sticky bar's scroll padding, is invisible
even to a keyboard walk.

The inventory was worse than the scans had suggested. At 320 px the Today panel
measured **382 px** and the Family relation picker **420 px**, each dragging a
horizontal scrollbar onto the narrowest phone the criterion names. The four
header nav links measured **20 px** tall against a 24 px floor. And the skip
link, which this suite has clicked since the first browser pass, **skipped
nothing**: `SiteHeader` was rendered *inside* `<main>`, so `#main` — the skip
target — contained the navigation bar, and Enter-plus-Tab put focus straight
back on the links the reader had asked to bypass. The same structure held a
second defect: the document carried **two nested `<main>` elements**, one from
the layout and one from the page.

Two of those are one-line fixes and one is not. The panels wrap now. The shared
nav-link class carries `py-1`, which is 28 px. The skip target moved: the layout
renders `{children}` directly after the skip link, and the page owns
`<main id="main" tabIndex={-1}>` with the bar outside it — a skip link can only
name content that follows the thing it skips, so the ownership had to move
rather than the attribute.

The scroll-padding gate is the pass's honesty story. `scroll-padding-top:
4.5rem` has kept headings out from under the sticky bar since the first audit,
and nothing asserted it. The first gate written for it walked Tab stops and
looked for an element resting under the bar — and stayed **green** against a
build with the padding zeroed, because Chrome scrolls a focused element only to
the nearest viewport edge and never consults the padding on that path. The gate
that can see the rule is an anchor jump: all four nav anchors come to rest at
top **72** while the bar's bottom edge is at **65**, and with the padding zeroed
they rest at **0**.

The scans themselves were upgraded in the same pass. All eight axe runs — five
in light, three in the dark scheme — now carry `wcag22aa`, which tag-selects
axe-core 4.14's experimental `target-size` rule. That rule is disabled by
default, so the tag is the only thing that runs it, and a scan that quietly lost
the tag would stay green. It was therefore falsified live against the served
page: one 10 px button with room around it passes under SC 2.5.8's spacing
allowance, two flush 10 px buttons put `target-size` in the violations, and the
landing page's own 14 targets pass. The 2.5.8 gate now reads all eight tag lists
back out of `accessibility.spec.ts` and `theme.spec.ts` and fails naming the
file that lost one — the same read-it-out-of-the-source law the worker contract
gets from `public/sw.js`. The geometry gate stays the stricter reading: the
Inline exception, no offset allowance, and the 320 px viewport.

One measurement artefact is documented in the spec rather than papered over:
reading geometry in the same task as a `keyboard.press("Tab")` can catch the
skip link mid-recalc still at `left: -9999px` — **1 run in 12** — so the probe
settles across two animation frames before it measures, which took that to
**0 in 12**. The file also runs under `reducedMotion: "reduce"`: the criterion is
about where focus comes to rest, `scroll-behavior: smooth` otherwise animates
the scroll under a hit-test, and reduced motion is the state an assistive-tech
user is most likely to be in.

### Added
- `apps/web/e2e/wcag22.spec.ts` — 14 gates: reflow at 320 px (document
  `scrollWidth` may not exceed the viewport; a table inside its own
  `overflow-x-auto` region is the criterion's allowed exception), target size
  24×24 with SC 2.5.8's own Inline exception implemented rather than waived,
  focus-not-obscured walked stop by stop and hit-tested at each focused
  element's centre and four corners, the skip link's structural contract
  (exactly one `<main>`, target does not contain the header, next Tab stop
  inside main), and the anchor-rest measurement that is the only way to see
  `scroll-padding-top`.
- `apps/web/src/app/globals.css` — `#main:focus-visible` outline, so the
  programmatically focused skip target is visibly focused.
- All eight axe scans now run the WCAG 2.2 tag set (`wcag22aa`), scoring
  axe-core's own `target-size` rule on every widget; the 2.5.8 gate pins the
  tag lists by reading them back out of both spec files.

### Fixed
- The skip link now skips the navigation: the bar renders outside `<main>`, the
  page owns `<main id="main" tabIndex={-1}>`, and the document no longer holds
  two nested mains.
- The Today panel and the Family relation picker wrap at 320 px instead of
  scrolling the page sideways.
- Header nav links are 28 px tall, above the 24 px floor.

### Gates
`bun run test` **509 tests / 26 files / 10 845 assertions, 0 fail** — unchanged,
because this slice added browser gates and no unit gates. Browser tier: **64
tests in 6 files**, deterministic set **47/47** (17 product · 7 accessibility ·
9 theme · 14 WCAG 2.2 geometry); `tsc --noEmit`, `eslint .` and `next build` all
rc 0. Five falsifications, each breaking the mechanism its gate names: the
reflow and target gates red on three separate deliberate breaks, the skip gate
red reporting `found 2` mains, the anchor gate red reporting `#gap rests at 0,
the bar ends at 65` — and the padding gate's first Tab-walk form stayed green,
which is why it was rewritten as the anchor measurement above. The eight axe
scans now also carry `wcag22aa`; axe's `target-size` rule was proven to run
(spaced small target passes by the allowance, flush pair fails) and the tag law
went red on a doctored list naming the file that lost it.

## [Unreleased] - the sentences that stood in for a loading panel, and the headline nobody could see

The last two passes pinned what a page looks like and what a write says. This one
pinned the state before both: what a panel shows while it has nothing. Five data
panels each opened with a hairline card holding one pulsing sentence —
"Loading today…", "Running the engine suite…", "Loading family circle…" — and
that pattern, which reads as considerate in a screenshot, had two certain defects
in it. `animate-pulse` is defined as an opacity cycle, so the pulse was body copy
dropped to 50% for a third of every second: a contrast failure that the arriving
data cures, which makes it invisible to any scan of a settled page. And a screen
reader read the sentence, then read the panel that replaced it — a state that had
already ended, announced as news.

A third defect was assumed and then measured out: the layout shift. The claim was
that a 40 px card standing in for a 900 px panel moves the page when data lands.
At the 1 280×720 test viewport the one-line card leaves the document **720 px**
tall and the skeletons leave it **800**, against **1 590** loaded — `main` carries
`min-h-screen`, which floors any placeholder at exactly one viewport. So the
skeleton is not a CLS fix on this page and does not claim to be one; what it buys
is that each column of the panel starts where the loaded column starts, and that
nothing on screen while a panel waits is a sentence.

Found on the way, in the same family of states no scan reaches: the review
console's cleared-queue heading — "Queue clear", the sentence that tells a
pharmacist there is nothing to do — was painted in `var(--vy-hairline)`, which is
the card's *own border colour*, about **1.2:1** on a light card. Axe never saw it
because the dark-scheme tour seeds the queue with items first, so the branch that
renders it is not the branch that is scanned.

### Added
- `apps/web/src/components/ui/skeleton.tsx` — `Skeleton` (one pulsing block,
  `aria-hidden`, sized by the caller because the only honest thing about a
  placeholder is that it is not prose), `SkeletonHeading`, `SkeletonCard` (the
  hairline shell, carrying `aria-busy`), `SkeletonRows`.
- `apps/web/src/components/ui/empty-state.tsx` — `EmptyState`: a named card with
  the way out written into it. The four hand-built versions had already drifted —
  two centred a serif headline, one paired a button, one set its headline in the
  border colour, and only Today told the user which tab to go to.
- `.vy-skeleton` in the stylesheet, mixed from `--muted-foreground` into `--card`
  rather than taken from `--muted`: the two schemes define `--muted` 18 lightness
  steps apart, so a fixed fill is a ghost in one and a slab in the other.
- `.vy-enter`, an entrance built on `@starting-style` — a transition on a node's
  *first* style resolution, which is the case a transition normally cannot
  animate. Chosen over a keyframe for a reason that is invisible until it bites:
  `animation: … both` leaves `transform` computed on the element after the last
  frame, and any transform other than `none` silently makes it a containing block
  for fixed-position descendants. Engines without `@starting-style` show the
  panel instantly.
- `apps/web/tests/placeholder.test.ts` — 11 gates, 35 assertions: the pulse lives
  in exactly one file and it is the primitive; no panel renders a sentence as its
  loading state; a panel that waits for data imports the shapes; a rendered
  skeleton is `aria-hidden` and contains no text node; the fill stays a
  per-scheme mix; no panel hand-builds the empty card; every `EmptyState` names
  an exit; the entrance is a `@starting-style` transition rather than a keyframe;
  the animating wrapper remounts per tab; and the reduced-motion guard still
  covers transitions, which `.vy-enter` is the first entrance to depend on.
- One browser gate (`e2e/accessibility.spec.ts`): the plan request is held open
  so a state that lasts milliseconds can be measured — no pulsing node holds
  prose, every skeleton block is inside `aria-hidden`, the busy shells carry no
  text at all, and the real panel arrives when the request is released.
- One palette gate (`tests/theme.test.ts`): *no structural token is ever painted
  as text* — `--vy-hairline`, `--border`, `--input`, `--sidebar-border` may not
  appear as a `color:` in any form. The quiet text token is `--muted-foreground`,
  which the measured table already holds to 4.5:1 on a card in both schemes.

### Changed
- `today` / `insights` / `console` / `family` / `evidence` loading branches are now
  the loaded panel's own geometry — Today three cards a side, Insights the KPI
  row plus the heatmap's 14-column grid, the console and Evidence their
  header-card-plus-rows shape.
- `today`, `insights` and `console` empty cards come from `EmptyState`; the copy
  is unchanged, including "No analytics yet", which a dark-scheme comment names.
- `workspace.tsx` — the panel wrapper is `key={tab}` with `.vy-enter`, so a tab
  swap is the mount the entrance needs.

### Gates
`bun run test` **509 tests / 26 files / 10 845 assertions, 0 fail** (was
497/25/10 807; the +12 is `placeholder.test.ts` (11) and the new palette gate (1)).
Runs at recent counts took 96.3 s, 124.3 s and 37.9 s, in that order across three
passes — the spread is this machine and whatever else is compiling, which is why
no document here quotes a web wall time as a figure. Eleven falsifications were
run, each one breaking the mechanism its gate names: dropping `aria-hidden` from
the primitive, moving `animate-pulse` out of it, renaming the fill rule, removing
`key={tab}`, setting the starting-style opacity to 1 and its transform to `none`,
reinstating the `--vy-hairline` headline, deleting Today's skeleton import,
putting its old sentence back, hand-building its empty card again, and stripping
an empty state's exit. Each went red on exactly **one** gate and every restore
verified sha1-identical. The sixth case is the one worth keeping: hand-building
the empty card again passed the gate written to forbid it, because that regex
asked for `flex flex-col` where the real markup is `flex min-h-64 flex-col` — a
gate written from memory of a file rather than from the file, caught only by
actually falsifying it. Browser tier: **50 tests in 5 files**, of which the
deterministic set is now **33/33**; `tsc --noEmit`, `eslint .` and
`next build` all rc 0.

### Also in this pass
- `tools/check_claims.py` gained a **15th** doc site, and it is the one that mattered: page 1
  of the audit carries a "Measured identity of the thing" table that had been quoting 443
  web tests and 30 browser gates for a full day after the suite had run 509 and 50. Nothing
  caught it because the tool diffed the prose a documentation pass re-reads, not the snapshot
  a pass scrolls past to get to it. The table is current, its web row is now derived from a
  live run, and the drift was proven visible by editing that one number and watching exactly
  one site go red at exit 1.

## [Unreleased] - the messages a screen reader never received (and the region that had to outlive them)

Two passes fixed what a screenshot can check — colour, then lettering. This one
fixed what no screenshot has ever been able to check: the *third* channel a UI
has, which is only observable after a write. WCAG 2.1 SC 4.1.3 says a status
message must be announced programmatically, i.e. through a live region, and this
app's panels do all of their real work through a `POST`. Reading the eight files
that write to the server, five announced nothing at all and one announced far too
much. The reason is a defect class rather than eight bugs: `{msg && <p
role="status">…}` — the shape every one of these panels had picked — creates the
region and its first message in the same commit, which is the case screen readers
are documented not to report. So the visible response a sighted user gets ten
seconds after a tap was, for an AT user, silence; and because the message exists
only after a mutation, an axe scan of a page at rest scores green and says
nothing. That is why this pass shipped a structural gate plus a browser gate that
marks the region *before* the write and asserts the same node still holds the
sentence after it.

### Added
- **`src/components/ui/status-line.tsx`** — `StatusLine` (polite) and `AlertLine`
  (assertive), the only two `role="status"`/`role="alert"` nodes in the app. Both
  are permanently mounted and collapse to `h-0` when empty, because `display:
  none`, the `hidden` attribute and unmounting each take the region out of the
  accessibility tree and put the original bug back. They are two components
  rather than one with a `tone` prop: a panel that flips tone on a single node
  flips `role` on a live region the assistive tech already registered.
- **`tests/status.test.ts`** (12 tests / 83 assertions) — the announcement law,
  read out of the source the same way `theme.test.ts` reads the palette: an empty
  region is still in the tree, no panel is a live region it should not be (the
  writer set is *derived* from the `post(`/`save(` call sites and then pinned to
  its exact eight files, so a new writer that announces nothing fails rather than
  going unnoticed), every failure a panel can show goes to an assertive region, no
  `catch` block in the UI layer is empty, and the one-time join code is spoken as
  well as printed.
- **Two browser gates** in `e2e/accessibility.spec.ts` — a verification run whose
  sentence is asserted to arrive in a region that was already in the tree (the
  gate marks every `role="status"` node with a `data-vy-before` attribute before
  the click and requires the announcing node to still carry it), plus the copilot
  transcript as a named `role="log"` with its answer landing inside it and a full
  axe scan of a tab that had never been scanned.

### Changed
- **`verify.tsx`**: `aria-live="polite"` removed from the result column. Pointing
  a live region at the verdict panel re-read hundreds of words on every mutation
  inside it — including when an unrelated line was appended below — and its error
  line was not live at all. The column now ends in one `announce(result)`
  sentence: verdict, confidence, how many medicines were confirmed, how many
  findings, and whether a human is holding the plan.
- **`today.tsx`**: a clean tap now says what happened (`Marked taken: Telma 40 at
  09:00.`) instead of only moving a checkbox; the reminders card got
  `outcomeNote()`, which states the consequence of a toggle in the permission
  state the browser is actually in.
- **`copilot.tsx`**: the transcript scroller is `role="log" aria-atomic="false"`
  and named, so only the new node is read rather than the whole conversation, and
  it is `tabIndex={0}` for the same reason the evidence table is — axe's
  `scrollable-region-focusable`.
- **`evidence.tsx`**: the throttle *policy* answer ("a run is already in
  progress") moved out of the error channel into the polite line, where it
  belongs, next to a summary of the run that finished.
- `console.tsx`, `family.tsx`, `workspace.tsx`: conditional message elements
  replaced by the two mounted lines.

### Fixed
- **A caregiver invite that a blind user could send and could not use.** The join
  code is shown exactly once and cannot be retrieved — so once, on a plain `<p>`
  that mounted with its text, meant the credential never reached the person the
  panel exists to hand it to. It is now announced, spelled out one character at a
  time, with the unretrievability stated in the same sentence.
- **The most safety-relevant refusal in the product was the least audible.** The
  dose guardrail's "you already took this, do not double up" appeared in a card
  that *mounted with its own text*, which is the non-announcement shape; and the
  tap it refuses is a tap a patient makes several times a day. It now arrives on
  the assertive region.
- **Two writes that failed silently.** `family.tsx` acknowledged an escalation
  with `catch { /* non-fatal */ }` — the escalation stays open and the user was
  told nothing; `reminders.tsx` never rendered `useReminders`' server error at
  all, so a rejected settings write looked exactly like a control that had not
  been tapped.
- **Seed guidance that existed only in a tooltip.** The demo-reset hint was a
  `title` attribute; it is a sentence on the page now, which is also the only
  form a keyboard or screen-reader user can reach.

### Gates
`bun run test` **497 tests / 25 files / 10 807 assertions, 0 fail** (was
485/24/10 724; the +12 is `status.test.ts`). The two runs at this count took
96.3 s and 124.3 s, which is why no document here quotes a web wall time as a
figure. Three source-level falsifications were run before the law was credited,
each on the defect it targets: unmounting the polite region behind its own
message (`if (!text) return null`) went red on **two** gates — the empty-region
test and the "tone is a component" test — which is the correct outcome, since
that one line re-imports both halves of the bug; dropping the announce line from
a writer went red on exactly `each writer announces, through a status line or a
log`; and routing the dose-guardrail refusal through the polite line alone went
red on exactly `the dose guardrail refuses assertively and a clean tap does not`.
Every file was restored from a backup and byte-verified by sha1 against the
pre-mutation hash. The browser half was falsified the same way earlier in the
pass: with a panel made to create its own region together with its message, the
`data-vy-before` gate failed and nothing else did.

And the pass then broke four product journeys, which is the point of having a
browser tier: the announced sentence repeats the verdict word, so
`getByText("Confirmation needed")` and `getByText(/plan blocked/i)` — loose
substring locators — resolved to two elements and failed strict mode. They were
tightened rather than papered over: `{ exact: true }` on the verdict card, and an
`.vy-eyebrow` filter for the queue heading, because `.first()` here would have
matched the *announcement* and quietly stopped proving that the card exists. That
is the same trap the change set: a locator that passes on the new node asserts
nothing about the old one. `bunx tsc --noEmit` rc 0 · `bun run lint` rc 0 ·
`next build` rc 0 · the three deterministic browser files **32 passed** (17
product journeys, 8 accessibility, 6 theme-rendering, 1 dark tour) and
`e2e/accessibility.spec.ts` alone **6 passed**. The landing shell was re-measured
from served bytes while this build was up: **664.0 kB uncompressed / 207.6 kB
gzipped / 179.6 kB brotli over 13 chunks**, recorded against TD-11 with the tool
that produced it (`scripts/firstload.mjs`), together with the one concrete trim
that measurement found — `<Toaster />` is mounted at `src/app/layout.tsx:112`
while nothing in the tree calls the `toast()` defined at
`src/hooks/use-toast.ts:145`, so three files of an unused shadcn toast stack ship
in the shell on every route. Documented, not deleted: removing a component
another pass may intend to wire is a decision nobody has made yet.

## [Unreleased] - the typeface pass (and the card that described a font it never got)

The theme pass measured the palette and left the *lettering* alone: one display
class resolving to Georgia on all 27 of its usages, a Devanagari wordmark rendered
in a Latin serif's fallback, and no test anywhere that could see either. Colour is
the part a reviewer can check from a screenshot; a typeface is the part that
silently reverts on the one machine where nobody is diffing pixels — `next/font`
fails to resolve, a class name is mistyped, a `font-family` is edited to something
the build does not have, and the product keeps rendering in a different voice with
every suite green. This pass put two real faces behind that seam, then gated the
seam — and the gate paid for itself before it was written, because reading the
generated Open Graph card to see what the identity should look like there turned up
a file that described a serif it never received and shipped five retired colours.

### Added
- **Fraunces** (`--font-display`) and **Rozha One** (`--font-devanagari`), both
  mounted through `next/font/google` and both on the body's class list. Fraunces is
  a variable serif with two non-standard axes (`SOFT`, `WONK`) next to `opsz`, which
  is the difference between "a serif" and the product's serif; Rozha One is a
  Devanagari display face, so वैद्य is drawn by a designer who drew Devanagari
  rather than by whatever the machine has.
- **`.vy-devanagari`**, the companion to `.vy-serif` for the wordmark, and
  **`.vy-display`** for the hero line. `.vy-display` spells out `"opsz" 144`
  inside `font-variation-settings` because that property resets *every* axis it
  does not name — setting `SOFT` and `WONK` alone would have silently undone the
  optical sizing on the one line that depends on it most.
- **Two font files and their licences in `src/app/fonts/`** (396 kB, both
  OFL-1.1, unmodified Google Fonts static instances), because the Open Graph card
  is composed by satori, which inherits no stylesheet and knows only the faces it
  is handed. `outputFileTracingIncludes` in `next.config.ts` names the directory
  for Next's file tracer, which a `readFileSync` is invisible to. Stated precisely,
  because the card is prerendered and never reads these bytes at request time
  today: that is not a bug fixed, it is the reason the first *dynamic* card — the
  per-plan and per-drug images `next/og` exists for — does not 500 in production
  while passing every check on a laptop. Verified traced: both faces and both
  licences land in `.next/standalone/src/app/fonts/`, and both read back from
  that cwd.
- **`pick` in `tools/check_claims.py`** — see Fixed.

### Changed
- `.vy-serif` now resolves through `var(--font-display)` with Georgia kept *under*
  it as the offline fallback. One CSS rule, 27 usages, 14 files.

### Fixed
- **The Open Graph card was lying about its own type.** `opengraph-image.tsx`
  declared `fontFamily: "Georgia, serif"` and passed no `fonts` to `ImageResponse`,
  so the "oversized serif claim" its comment described rendered in the runtime's
  bundled sans. Its five hardcoded hexes were a snapshot of the palette *before*
  the theme pass — `#0b6b5d` where `--vy-pine` now resolves to `#0f6353`, `#fbfaf7`
  where `--vy-paper` is `#f8f7f4` — so the one surface every share, link preview
  and investor message shows was painting a brand the product had stopped using.
  The card now takes the mounted faces, the palette's own values, and the hero's
  metrics; `fetch(new URL("./fonts/x.ttf", import.meta.url))`, the pattern the
  Next.js docs show, does not work under Turbopack and failed the prerender with
  `not implemented... yet...`, which is why the bytes are read instead.
- **`first_only` in the claims tool pinned the oldest claim in one of the two
  files it was set on.** `CHANGELOG.md` prepends, so its newest block is its first
  match; `docs/TECH_DEBT.md` appends RES rows, so its newest claim is its *last*.
  One flag for both was wrong for the second, and wrong in the worst direction: it
  goes red on exactly the day the count is correct, so the tempting "fix" is to
  restore the stale number. Each history site now names its own end (`PICK_FIRST`
  / `PICK_LAST`). Found by writing the row this pass needed, not by the tool.

### Gates
`bun run test` **485 tests / 24 files / 10 724 assertions, 0 fail** (was
481/24/10 689; the +4 is the typeface law — `theme.test.ts` 26 → 30). The two runs
at this count took 56.1 s and 66.4 s, and three runs of a near-identical suite took
103.1 s, 95.8 s and 41.3 s, so no document here quotes a web wall time as a figure.
Each of the four new gates was falsified before it was credited: unmounting
`${fraunces.variable}` from the body className, putting `Georgia` *ahead* of
`var(--font-display)` in the chain, dropping `vy-devanagari` from the header
wordmark, and five mutations of the card (a registered face never painted, a colour
no `:root` token resolves to, the claim's line-height diverging from the hero's, the
tracing entry deleted, one licence file moved aside) — each produced exactly one red
test, the right one, and every restore was byte-verified by sha256 prefix. The
wordmark gate also caught its own first false positive: it read the वैद्य inside an
explanatory comment and demanded a CSS class on prose, so the laws now scan
`markup()`, which is source with its comments stripped. `bunx tsc --noEmit` rc 0 ·
`bun run lint` rc 0 · `next build` rc 0, with the card served from the standalone
build (`/opengraph-image` 200, 55 645 bytes) and the rendered PNG *looked at* rather
than assumed — that inspection is what found the sans in the first place.

## [Unreleased] - the artefact nobody ran (and the Windows binaries a Linux image was shipping)

`[0.4.1]` booted the compose stack on 2026-09-11 and fixed four real defects, and every
one of those fixes still holds: both images build, both containers come up, the corpus is
baked in, the schema one-shot applies. What that pass checked was that the stack *starts*.
It never opened the images to see what was inside them, and no job in CI has run `docker`
since — so four months and four feature slices later, the deployment path was a description
again. This pass executed it and measured the two halves nobody had looked at: **artefact
contents** and **what the environment actually delivers**. Six defects, one of them in code.

### Added
- **Two `.dockerignore` files** (repo root for the API context, `apps/web/.dockerignore`
  for the web context), each stating what it removes and why the image rebuilds it. The
  web one is the load-bearing file: `COPY . .` was being handed the host tree — a 293 MB
  `.next`, the host `node_modules`, and `db/custom.db`, the developer's last demo run at
  929,792 bytes. Measured before → after on one machine, one daemon, warm cache: context
  transfer **1.18 GB → 34.31 kB**, `load build context` **214.3 s → 11.0 s**, `COPY . .`
  **204.2 s → 1.0 s**. The root one exists because `COPY apps/api apps/api` reaches
  host-compiled bytecode (**67** `__pycache__/*.cpython-313.pyc`) and the root context
  otherwise walks a 264 MB `.venv` and a 224,952,320-byte working database.
- **`NEXT_PUBLIC_SITE_URL` as a build argument.** `apps/web/Dockerfile` takes it as an ARG
  wired into the build stage and `docker-compose.yml` passes it through `build.args`,
  because the landing page is prerendered and `/robots.txt` + `/sitemap.xml` are metadata
  routes: the origin is resolved by `next build` and frozen into the image. Proven by A/B
  on the same daemon — the pre-fix image answers `<loc>http://localhost:3000/</loc>` from
  `/sitemap.xml` *for ever*, whatever the container environment later sets; an image built
  with `https://demo.medisaathi.test` serves that origin in the sitemap and in the
  document's canonical and opengraph URLs.
- **A `container` job in CI**, between the browser tier and dependency review: build the
  real compose file, run the schema one-shot, `up -d --wait --wait-timeout 180`, curl
  `/api/evidence` and `/healthz`, then assert three properties that were each false before
  this pass — no `*.pyc`/`*.db`/`.env*` inside either image, no `*windows*`/`*.exe`/`*darwin*`
  binary in the web image, and the built origin is the origin that ships. `docker compose
  logs` on failure, `down -v` always, 20-minute ceiling.
- **`envPositiveNumber` in `src/proxy.ts`** (exported, so the contract is testable without
  a server) and four gates for it in `tests/proxy.security.test.ts` (**19 → 23**):
  defaults/honoured values, a junk sweep, a behavioural gate proving `allow(key, 0, …)`
  denies the *first* request while `allow(key, envPositiveNumber("", 60), …)` admits it, and
  a structural gate that fails if the module stops reading its budgets through the guard.
- **Compose states its own runtime policy**: `restart: unless-stopped` on both long-running
  services (a reboot used to leave the demo down until an operator noticed), the API port
  published as `127.0.0.1:8000:8000` (no in-compose consumer, no auth layer — see the
  loopback note in `docs/DEPLOYMENT.md`), and every web-tier variable spelled out instead
  of inherited: the kill switch, `MEDISAATHI_TRUST_PROXY`, all four limiter budgets,
  `MEDISAATHI_MAX_BODY_KB` and `MEDISAATHI_EVAL_REUSE_MS`, each with its numeric default.
- **The API image now runs the interpreter the API numbers were measured with**:
  `python:3.12-slim → 3.13-slim` (host `.venv` is 3.13.6, the image is 3.13.18). A 3.12
  artefact describing 3.13 tests is a version gap no test can see, because no test runs
  inside the image.
- **`tools/check_claims.py` — the documented counts are now derived, not transcribed**
  (retires the remainder of TD-16). Three stale counts surfaced while writing this one
  pass: the web suite moving 476 → 480 → 481 behind hand-edited documents, RES-30 claiming
  "the 20 contract tests in `proxy.security.test.ts`" when it held 19, and the CI parity step
  naming a "shared **148**-case golden corpus" while `eval/parity/golden.json` holds **164** —
  a number GitHub shows in the run UI, so every green pipeline since the corpus grew has been
  advertising a smaller gate than it ran. The tool runs `bun test` and `pytest -q`, parses
  *their* summary lines, counts the corpus from its artifact, folds typographic spaces so
  `10 689` and `10689` are one claim, and diffs 14 sites across `README.md`,
  `docs/TESTING.md`, `docs/TECH_DEBT.md`, `CHANGELOG.md`, this audit doc and the CI step name.
  `--tier web|api|all`; `CHANGELOG.md` and `docs/TECH_DEBT.md` are read newest-block-only
  because they are history. A wording that no longer matches, a number quoted in two places,
  and a suite that is not clean are all FAILs, and a tier that did not run a suite reports
  `SKIP: unmeasured` instead of OK. Its own patterns are arity-checked at import — an early
  draft's `(\d+)/\1` backreference was two groups against three declared keys, which would
  have skipped a corpus version silently, and the guard caught it.
- **CI runs it in both jobs** (`python tools/check_claims.py --tier api` after pytest,
  `python3 tools/check_claims.py --tier web` after `bun run test`) and `make claims-check`
  runs the whole set locally. The duplicated ~75 s + ~100 s is the honest price of a
  measurement claim that cannot rot: three stale counts were found by hand in one pass, which
  is the argument for the derivation rather than for more care.

### Fixed
- **A Linux production image was shipping Windows binaries.** `COPY . .` lands *over* the
  `deps` stage's freshly-installed Linux `node_modules`, so the runner copied the host's
  out of the build stage: the image contained `query_engine-windows.dll.node` and
  **`schema-engine-windows.exe`**, 908 MB unpacked, with two query engines for the client to
  choose between. After: **732 MB**, zero foreign-platform binaries, proven by `find` inside
  the running container rather than by reading the Dockerfile.
- **`src/proxy.ts` read its budgets as `Number(process.env.X ?? 60)`.** A set-but-empty
  variable is `""`, not `undefined`, so `??` passes it through and `Number("")` is `0` — a
  write budget of zero, which is a 429 on every mutation in the product, on a healthy
  install, caused by a blank line in an env file. The compose interpolation that would have
  triggered it (`${VAR:-}`) was caught at review; the *code* hole predated this pass and is
  now closed by the guard.
- **`/api/evals` had the same hazard pointing the other way.** There, `0` is a deliberate
  policy ("no cache window, run every time") and the parser is correctly written to honour
  it — which is exactly why `Number("")` → `0` was wrong: a blank value silently moved the
  ~20-model-call suite from a 120 s reuse window to every request. Blank now reads as unset;
  a typed `0` stays `0`. The new gate (**`limits.test.ts` 16 → 17**) was falsified before it
  was credited — reverting the one changed line makes it that file's only failure.
- **The privacy kill switch reached one tier.** Both tiers read
  `MEDISAATHI_DISABLE_MODEL_EGRESS`; compose passed it only to `api`, so an operator who set
  it for a privacy demo silenced one egress path and left the other open — the MS-03 class,
  and the worse variant because the switch appeared to work.

### Gates after this pass
`bun run test` **481 tests / 24 files / 10 689 assertions, 0 fail** (was 476/24/10 667; the
+5 is the four budget gates and the blank-eval-window gate) — three runs of that suite on
this machine were 103.1 s, 95.8 s and 41.3 s on the same code, so no document here quotes a
web wall time as a figure. `bunx tsc --noEmit` rc 0 · `bun run lint` rc 0 · `next build`
rc 0. API tier **466 passed** in 73.4 s — the count unchanged and the time *not*: it ran
concurrently with the production build, which is why `docs/TESTING.md` reports that tier as
a band (25.5–30.4 s) rather than a number. The deployment path itself was executed, not
described: `docker compose build` → `--profile tools run --rm schema` → `up -d --wait` →
`/api/evidence` 200 and `/healthz` `{"ok":true}` over a fresh named volume,
`docker compose config` validating the loopback publish and both restart policies, and the
origin A/B above. What this pass does **not** cover, stated so it is not mistaken for done:
no registry push and no deployment to any host (deliberate — the launch is gated behind the
provisional filing), no TLS termination (compose terminates nothing; a reverse proxy is the
operator's), no orchestrator, no multi-worker run (TD-7/TD-18 still
describe per-process counters), and the ~150 MB of CLI-only Prisma/img-sharp binaries in the
web image were **left alone on purpose** — `/api/evidence`, the smoke route CI curls, never
touches the query engine, so a trim that broke Prisma would have gone green. That is TD-31
with its prerequisite written down.

The new count-derivation gate was then run against the tree it just described:
`tools/check_claims.py --tier all` → **14/14 doc sites OK** against web 481/24/10 689, api 466
and parity 164 cases at law v12, exit 0; `--tier api` and `--tier web` (the CI commands) each
exit 0 with the other tier's sites reported as `SKIP: unmeasured`, never as OK. It was
falsified the way every gate in this block was: against a measurement doctored by one in each
key all **14** sites go FAIL, and end-to-end — `docs/TESTING.md`'s pyramid cell edited to 480
plus the CI step name edited back to 148 — `--tier web` ran the real suite and returned exactly
those two FAILs with exit **1**, after which both files were restored from sha256-verified
backups and re-checked clean. `ruff check` on the tool is clean and it imports under
`-W error`, which mattered: the first draft's `[\s\u00a0…]` character class raised a
`SyntaxWarning` for an invalid escape, and on Windows that draft had already written real
NBSPs into its own source before the approach was replaced with ordinal folding.

## [Unreleased] - the tab that closes (and the three defects that appeared only once it did)

The reminder feature could tell a patient whose browser was open. That is not the
failure it was written against: a dose is missed in a kitchen, not in a tab, so the
plan's alerts have to outlive the document that planned them. TD-27 slice 1 landed the
mechanism that does it — a service worker that holds the queue in IndexedDB and fires on
its own timer, and a manifest an operating system can install from. The worker is 419 lines of JavaScript in a product that compiles nothing like it, which is precisely
how it was verified: 33 unit gates read the worker's literals back out of the file and
compare them against the module the app compiles from, and 17 browser gates run the real
thing. Three of the four defects this pass found were *inside the fix*, and all three
read as fine while the app was open — the reason they are written up as RES-34 rather
than folded into the lines below.

### Added
- **An installable shell with a worker that keeps the plan.** `/sw.js` (plain JS, served
  under its own CSP — see Fixed) stores the handed-over queue in IndexedDB, holds real
  timers up to the 30-minute horizon the platform publishes, counts what waits beyond it
  instead of dropping it, discards a message stamped with a day it does not live in, and
  answers a page's `state` request with the bytes it will print. `/manifest.webmanifest`
  is generated from `THEME_CHROME` and carries `id`, `scope`, `standalone`, both icon
  purposes and launcher shortcuts that deep-link straight to the panel each names.
  Precached: the landing, the icon, and every document this visit navigates — so an
  installed icon answers offline *and* the screen the patient was on answers as itself,
  while `/api/*` is never answered from a cache.
- **The card says what the platform answered, and nothing more.** `backgroundSentence`
  is built from four facts (link state, armed count, beyond count, whether Periodic
  Background Sync said yes) and the unit tier walks its entire input cross-product, so
  there is no state in which the copy claims a wake the browser refused. Chromium returns
  `NotAllowedError` for that registration until an app is installed and judged engaged,
  which is a fact about the platform, not a bug — the card reports it.
- **17 browser gates in two new files**, split by what a browser will allow: 12 headless
  (`e2e/pwa.spec.ts`) and 5 headed (`e2e/pwa-delivery.spec.ts`), sharing
  `e2e/pwa-helpers.ts`. Headed is not a preference: headless Chromium answers
  `Notification.permission === "denied"` for this origin even after `grantPermissions`,
  so a headless run of the delivery gates would have asserted that a notification was
  *not* shown. The `describe` that would express it is rejected by Playwright
  (`test.use({ headless })` forces a new worker), hence two files.

### Fixed
- **The worker adopted the day a message carried.** The first draft reset its state on a
  `sync` **and** wrote `state = { day: data.day, … }` one line above the loop that
  re-added that day's do-not-repeat list. Dose ids survive their day, so yesterday's
  `d:due` in today's set silences today's reminder — the patient stops being asked at
  exactly the dose they never took, while the panel says everything is armed. The day the
  worker lives in is now never a value a page can send it.
- **The delivered set could not see what the worker fired with no document.** A dose
  announced at 21:00 with the tab closed was re-planned on the next open, and `due` stays
  live for the whole late window: the same "Time for Telma 40" on every reload for half
  an hour — the failure mode the reminder law exists to prevent. The page now holds its
  own firing until the worker has answered once, then merges `state.fired` into the set
  the law dedupes against, so "already announced" is one fact owned by one process.
- **A fire-and-forget cache write was dropped.** `caches.open(SHELL_CACHE).then(c =>
  c.put(req, res.clone()))` outside `waitUntil` is discarded when Chromium retires the
  worker after handing a document over, so the screen the patient is on never entered the
  shell and an offline reload answered with the *landing page* at a different URL.
  `deferredWrite(event)` opens `waitUntil(new Promise(done => …))` during dispatch — the
  only moment it is legal — and settles it later; `store()` clones synchronously, because
  once the page reads a response its body is locked and a later `clone()` throws.
- **`/sw.js` inherited the document's nonce CSP.** Under `'strict-dynamic'` a conforming
  browser ignores `script-src 'self'` and a worker has no nonce to carry, so
  `register()` rejects with a generic `SecurityError` while the UI still says "linked".
  The exclusion is compiled in `next.config.ts` and proven twice: semantically in
  `tests/pwa.test.ts` (including that removing the matcher term lets `sw.js` back in) and
  on the wire in the browser tier, which also asserts the document policy still carries
  its nonce, so one route's fix is not another route's hole.
- **A gate that would have passed a worker counting nothing.** The horizon test asserted
  every armed alert sits past 30 minutes — impossible for the queue shape the law
  produces (a dose 25 minutes out gets a nudge *on* a timer and a `due` alert *beyond*
  it). Measurement caught it before it was credited; the shipped test derives its own
  expected count and requires it to be greater than zero and less than the whole queue.
- **The headed tier would have turned CI red for a reason that is not a defect.** A
  headed Chromium on `ubuntu-latest` cannot launch without an X server
  (`Missing X server or $DISPLAY`), and Playwright's `--with-deps` installs libraries,
  not a display. `web-e2e` now installs `xvfb` and runs `xvfb-run -a bun run e2e`; for any
  other display-less host the file skips **itself as one unit**, at file scope, because
  that is the only place a guard acts *before* Playwright opens a browser (a
  `beforeEach` touching `context` has already launched it). The predicate
  (`displayAvailable`) is pure and unit-pinned — `DISPLAY` set/unset/empty, Wayland-only
  treated as no display, never false on macOS or Windows, and asserted to sit after the
  `test.use` line it depends on.

### Gates after this pass
`bun run test` **476 tests / 24 files / 10 667 assertions, 0 fail** (was 443/23/8 027;
the +33 is `tests/pwa.test.ts`) · `bunx tsc --noEmit` rc 0 · `bun run lint` rc 0 ·
`next build` rc 0 · **47 browser tests in 5 files**, both halves re-run for this block:
`bunx playwright test e2e/pwa.spec.ts e2e/pwa-delivery.spec.ts` → **15 passed / 2
skipped in 51.3 s** at 22:42 IST, and `bunx playwright test e2e/product.spec.ts
e2e/accessibility.spec.ts e2e/theme.spec.ts` → **30 passed in 1.0 m**. The two skips are
the honest kind: those
gates need a pending dose 2-180 minutes ahead of the *real* clock and the seeded plan's
last slot (21:00) had passed. They were separately **executed** against a temporary
in-window dose — both passed, 1.8 min — then the row was deleted and the file re-measured
at 3 passed / 2 skipped. API tier **466 passed** · data gates 5/5 · parity **164/164**
unchanged. What this pass does *not* cover is a device: no Android Doze bench, no iOS
Safari, no Web Push (TD-27's remaining half), so the shipped claim is "told even after you
close the tab", on a browser whose process is alive.

## [Unreleased] - the palette nothing could reach (and the two colours that were wrong once it could)

The `.dark` block has been in `globals.css` since the design system landed: every
override tuned, none of it appliable — no control, no stored preference, no
`color-scheme`. So the four months of contrast work behind `scripts/contrast.ts`
described a *theory*, and a dark-preference visitor got light colours inside a
browser chrome that `themeColor` metadata had already promised would be dark.
Making the palette reachable turned out to be the cheap half. It exposed two real
WCAG failures that had never been able to render, and the code written to fix them
carried two defects of its own — one of which took every document route down while
417 tests stayed green. The browser tier written against it was then wrong twice
for reasons that were about the platform rather than the code, and both times the
fix was to measure the platform instead of assuming it.

### Fixed
- **A token `.dark` redefines for *text* was being used as a background** — one
  defect class, two victims. The landing law section painted itself with
  `--vy-pine-ink`, which `.dark` lifts from L 0.32 to L 0.82, so on a dark visit
  the band became a mint wash behind mint text: axe measured **1.05 / 1.51 /
  1.08:1** for eyebrow, heading and body. The `Taken` button's `text-white` sat on
  a `--vy-safe` that `.dark` lifts to L 0.72: **2.35:1**. Both were latent for the
  entire life of the stylesheet because nothing could reach the scheme that broke
  them. Fixed by naming the roles instead of borrowing them — `--vy-band` for the
  band surface (a *fixed island*: declared once in `:root`, never overridden, so
  its text tokens are already dark-surface values; its hairline moved off
  `--border` onto `--vy-panel-border` for the same reason) and `--vy-safe-on` for
  the label on a fill that does flip (light `oklch(1 0 0)` → **4.60:1**, dark
  `oklch(0.2 0.01 160)` → **7.66:1**). The off-white the palette already uses for
  `--primary-foreground` fails here at **4.47** — measured before this was written
  down — which is the only reason that one token is pure white. `--vy-safe-on` is
  exported through `@theme`, so `text-vy-safe-on` is a utility that exists rather
  than a class name that silently matches nothing.
- **`src/app/layout.tsx` imported `headers` from `next/server`**, which does not
  export it in Next 16 (`next/headers` does). Every document route returned 500 —
  and all 417 web tests passed, because `bun test` reads those source files and
  never resolves a module through Next's mapping. This is not a coverage hole:
  `next build` fails on it, since `ignoreBuildErrors: false`. It was a gate
  *ordering* failure — the slice was being driven by `bun test` output and
  typecheck ran last. The gate chain is now run in the order that can hurt first.
- **`theme-toggle.tsx` set state inside its own `useEffect`** — precisely the
  cascading-render shape `react-hooks/set-state-in-effect` exists to stop. It is
  `useSyncExternalStore` with `null` as the server snapshot now, so the control
  reports what the document says instead of what its own state says, and its icons
  follow the class (`dark:hidden` / `hidden dark:block`) rather than React.

### Added
- `src/lib/theme.ts`: the four shared facts (`THEME_STORAGE_KEY`, `DARK_CLASS`,
  `THEME_CHROME` — *derived* from the tokens each scheme paints, replacing a
  metadata block that claimed `#fbfaf7` / `#141614`, neither of which is any token
  — and `resolveTheme`, where a stored choice beats the OS and a corrupt stored
  value is treated as *nothing stored* rather than trusted), plus the DOM half.
  The boot script is built from the same constants, so the SSR default, the
  pre-paint script and the control cannot disagree. Deliberately **not** a
  dependency: a theme package would add context for four constants and still need
  the per-request CSP nonce threaded by hand. The pre-paint script runs nonced
  (TD-2's `script-src` has no `'unsafe-inline'`) inside one outer `try` plus one
  around `getItem`, because a browser that blocks storage *throws*, and the
  degraded answer has to be the OS rather than an unstyled document.
- `tests/theme.test.ts` (**26**). It reads `globals.css` as the source of truth,
  so editing a colour fails a test instead of making a documented number quietly
  false. Three of its laws are new shapes for this repository: the band is a fixed
  island (each of its seven tokens must exist in `:root`, must **not** exist in
  `.dark`, and must resolve to the same bytes in both schemes); a fill that `.dark`
  redefines must ship its own `-on` label; and no app file may paint an `-ink`
  token as a background. The last one was validated rather than trusted — its
  first regex matched two *legal* chips and caught nothing illegal, which is worse
  than no test; the tightened version is checked against four strings, two true
  positives and three true negatives.
- `e2e/theme.spec.ts` (**9**) for what no source-reading test can see: the first
  `requestAnimationFrame` of a dark-OS visit is already dark in class,
  `color-scheme`, `<meta>` **and** the body's painted colour; Chromium's own colour
  engine agrees with `scripts/palette.ts` to ±2/255 on the same token; the served
  bytes put the nonced script above anything that could paint; a stored choice
  survives a reload against `emulateMedia`; `prefers-color-scheme` is followed
  live until a choice is stored; a `localStorage` getter that throws still
  hydrates with zero page errors; and **axe in the dark scheme over every surface
  the product has** — landing, Today, then a one-page tour of the other six panels.
  The tour exists because the slice had otherwise walked those six by hand and
  written "clean" in a document, which is the same thing as not measuring. Each
  click is asserted twice over — `aria-current="page"` on the tab *and* an anchor
  only that panel renders — because a scan of a panel that silently failed to
  mount is a green run about nothing. Violations are collected across all six and
  asserted once, so a failure names every surface carrying it instead of only the
  first axe happened to reach.

### Measured
- The two defects, and their replacements, in the browser and offline. axe dark
  **1.05 / 1.51 / 1.08** → band **6.86 / 10.98 / 7.80**, and on the inner panel
  **7.34 / 13.31 / 9.46**; white-on-safe **2.35** → **7.66** (light **4.60**).
  `scripts/contrast.ts` reproduces the *shipped* broken values offline at
  **1.06 / 1.51 / 1.07 / 2.36** against axe's **1.05 / 1.51 / 1.08 / 2.35**, so the
  pre-flight tool predicts a dark-theme failure without booting a browser.
- **Chromium serialises a computed OKLCH as `lab()`** — for declared properties
  *and* custom properties (`--background` comes back as
  `lab(97.1209% -.0107288 1.52524)`, dark as `lab(5.37082% -2.38625 0.94696)`).
  The first version of the colour test asserted `rgb(14, 19, 16)` and could never
  have matched. The token side now goes through a canvas: `fillStyle` +
  `getImageData` returns true sRGB bytes — **(248, 247, 244)** light,
  **(14, 19, 16)** dark — which are `oklchToRgb`'s own outputs. That cross-check is
  what turns every contrast ratio in this repo from a claim about a stylesheet into
  a claim about the page a user gets. The rasteriser is a *nested* function inside
  the serialised callback because the app's CSP has no `'unsafe-eval'`, so a
  string-`eval` helper would be refused on the page it was testing.
- **Placement, measured, replacing an assumption.** The test asserted the boot
  script lands before `<body>`. React 19 / Next 16 hoists an inline script that is
  the first child of `<html>` to the top of `<body>` instead of into `<head>`, so
  the honest law is "before anything paints": script at byte **4099**, `<body` at
  **3884**, Next's own `<div hidden="">` Suspense marker at **3973** (also above the
  assertion's original anchor, and also not paintable), the theme-color `<meta>` it
  must be able to rewrite at **1714**, and the first real element — the skip link —
  at **4510**. The scan now skips non-rendering tags and `hidden` subtrees rather
  than trusting tag order.
- **Two numbers this repository was carrying that a fresh run contradicted.** The
  API suite is **466**, not the **462** printed in the previous block's
  "Gates after this pass" line — that run was taken before the four
  `test_verdict_tally.py` tests the same block *adds* had landed. And its wall time
  today is **25.5 s / 26.8 s / 30.4 s** for four *more* tests than the band
  `docs/TESTING.md` carried (**36.6–43.8 s**) for it: the earlier spread was three
  observations on a differently-loaded machine, not a property of the suite. Both
  documents now quote today's runs and say which.

### Gates after this pass
`bun run test` **443 tests / 23 files / 8 027 assertions, 0 fail** (was 417/22/7
832) · `bunx tsc --noEmit` rc 0 · `bun run lint` rc 0 · `next build` rc 0, still
warning-free, and the built CSS carries `--vy-band:#013d31` plus
`.text-vy-safe-on{color:var(--vy-safe-on)}` · `bunx playwright test` **30/30** — which was
the whole browser tier at that moment, and is now the deterministic subset of 47 (see the
block above):
(17 product journeys + 4 axe scans in light + 3 in dark covering 8 dark surfaces +
6 theme-rendering gates) · API tier **466 passed** · data gates 5/5, parity
**164/164** unchanged. The new tour was falsified before it was credited:
`.dark --muted-foreground` was moved to `oklch(0.28 0.01 160)`, the app rebuilt,
and the test failed naming `color-contrast` on **all six** panels; the token was
then restored and the whole 30-test browser run went green again. What still keeps
this from being a complete dark audit is in `docs/TESTING.md`: the tour scores each
panel as it mounts, so a state reachable only through an interaction is not on the
page it scans, and the 17 product journeys run light-only.

## [Unreleased] - the aggregate that read every row (and the proof that could not fail)

Three claims in this repository's own documents were wrong in the same direction:
that `/metrics` was O(1), that the framework upgrade had made the request path
slower, and that a multi-process test had proved the new write path was safe. The
first was measured and fixed. The second turned out to be unmeasurable on this
machine, which is a different answer and is written down as such. The third was a
test that could not have failed whatever it was testing, and finding that out cost
more than fixing it.

### Fixed
- **`/metrics` scanned every stored row on every call** while three documents said
  it did not (TD-29). `verdict_counts()` was a `GROUP BY` over an indexed column,
  and an index makes that aggregate cheaper *per row* — it does not skip rows. The
  counts now live in a `verdict_tally` table that `put()` maintains inside the same
  write transaction (RES-31): a verdict being *replaced* decrements the bucket it
  leaves, emptied buckets are deleted so the shape still matches the scan's, and a
  database written before the table existed seeds once and records
  `store_meta.tally_seeded` so the seeding scan cannot become a per-connection
  habit.
- **The `BEGIN IMMEDIATE` in `put()` is load-bearing, and the script meant to show
  that it was could not show anything.** Each worker had been minting its *own*
  prescriptions, so no two processes ever wrote the same row, the stale-read
  control was structurally unable to drift, and it reported MATCH — which reads as
  "the guard is decorative". The pool is shared now, because the race in production
  is two confirmations of one `prescription_id`.
- **Three modules opened the same SQLite file and each ran `PRAGMA
  journal_mode=WAL` before `PRAGMA busy_timeout`** (RES-32). SQLITE_BUSY from that
  pragma is not routed through the busy handler, so the timeout that should absorb
  a contended boot is installed one statement too late; the crash surfaced first as
  `tools/prove_tally_atomicity.py` dying on a fresh file. The connection-opening law
  is now one function, `apps/api/app/db.py`'s `apply_pragmas()`, imported by `store.py`, `queue.py`
  and `consent.py`, and a store that cannot become WAL after five retries **raises**
  rather than quietly continuing in rollback mode — because then the file's
  durability characteristics are whatever the race produced and no number in
  `docs/PERFORMANCE.md` describes them.

### Added
- `tools/prove_tally_atomicity.py` and `tools/prove_wal_boot_order.py`, both behind
  `make prove-atomicity` / `make prove-boot-order` and both wired into CI. Each one
  runs the broken shape next to the production shape and prints both, so the guard
  is demonstrated rather than asserted.
- `tools/bench.py` gained a framework-free `/noop` ASGI-3 probe timed inside every
  transport (`/healthz − noop` is the cost of the framework stack, which is the
  quantity an upgrade is supposed to move), `--fresh-db` so the store stops being a
  measurement variable, and `--out` — which now implies `--json`, because four
  150-request runs completed with exit code 0 and left no artifact at all.
- `apps/api/tests/test_verdict_tally.py` (4): the tally equals the row scan after
  plain writes, after a verdict-replacing upsert, after an idempotent re-put and
  after a cleared verdict; a pre-tally database seeds once and only once; and an
  `EXPLAIN QUERY PLAN` guard on the production statement that fails the suite if the
  read ever touches `prescriptions` again. No test asserts milliseconds — on this
  machine that would fail for the wrong reason.

### Measured
- `/metrics` p50 **2.227–2.993 ms on an empty store** against **5.756–12.909 ms at
  56 446–60 286 rows** before the fix (p99 to 21.270), with `/healthz` and the bare
  `noop` overlapping completely across the two groups — so the row count moved that
  one endpoint and nothing else. After: **2.093 / 2.562 ms at 63 166–65 086 rows**,
  back inside the empty-store band. Read in isolation, the tally costs
  **0.009–0.023 ms** against **2.648–2.744 ms** for the same-result scan.
- The upgrade A/B (`fastapi 0.136.3 → 0.162.0`, `uvicorn 0.51 → 0.54`, n=400 per
  cell, six runs) is **inconclusive rather than fast**: stack-cost bands of
  1.900–2.722 ms old against 1.594–3.557 ms new, overlapping, with a no-code `noop`
  handler alone ranging 0.670–1.757 ms. Any per-request difference under ~1 ms is
  below this harness's resolution, and the September→October "regression" was the
  benchmark harness, not the server.
- Tally atomicity, five configurations: `BEGIN IMMEDIATE` matched the row scan in
  **5 of 5** (4 500 / 9 000 / 7 500 / 15 000 / 16 000 writes at 3, 3, 5, 5 and 8
  processes) and the stale shape drifted in **5 of 5**, with stale-base counts
  growing with the worker count rather than by luck: 6, 9, 20, 37, 58. Worst
  observed: a tally reading `{duplicate_atc: 10, interaction: 6}` against rows that
  say `{duplicate_atc: 3, interaction: 3, pass: 2}`.
- Boot order, three 30-trial × 4-process runs (360 connections per shape):
  WAL-first lost **3**, every one raised by the journal-mode statement; the
  production order lost **0**. One of the three runs was clean for both.
- `store.put()` on an empty temp store **has no single rate.** Eleven runs of
  `--baseline 3000` — identical code, identical row count, one process — landed in
  three bands: 287, 291, 303 / 315, 323, 334, 340, 342, 370, 381 / 643 and 692
  writes/s, with `put()` p50 3.04–3.10 ms in the slow band, 2.7–2.9 ms in the middle
  and 1.30 ms in the fast. The first number this pass wrote down (643/s, from a
  script that no longer exists) turned out to be the machine in its fast mode, so
  the tool now prints the baseline next to the sweep and TD-30 quotes the bands.
  The part that *is* stable is the aggregate: `verdict_counts()` over those 3 000
  rows read p50 **0.005–0.011 ms** in all eleven runs, p99 0.015–0.051 ms.
- Reproducing the sweep at the CI/make flags widened a second number: the
  3 × 1 500 configuration refused **1** write in this run where the five-run sweep
  refused **0**, while `BEGIN IMMEDIATE` still matched the row scan exactly and the
  stale-read shape still drifted (1 stale base → tally
  `{duplicate_atc: 2, pass: 3, interaction: 3}` against rows reading
  `{duplicate_atc: 3, interaction: 2, pass: 3}`). A single rung of the refusal
  ladder is scheduling luck; the slope across rungs is the finding, and TD-30 says
  so in those words.

### Stated, not buried
TD-30 is opened rather than fixed: the store has one writer, `_write_lock` is
process-local, and a refused write leaves this tier as an anonymous HTTP 500 with no
retry and no counter that can tell "the store was busy" from "the engine crashed".
Measured refusals were 0, 2, 3, 7 and 21 of each run's writes at 3 to 8 processes —
0.13 % at the top end. That is a ceiling on a demo that runs single-process today,
and a P1 blocker the day it does not. And the tally's honest cost is a *write*
path that is now strictly longer than the scan it replaced; the write-path numbers
above are quoted inside the ~1 ms floor rather than claimed as an improvement.

### Gates after this pass
API tier on `.venv`: **466 pytest passed / 30.67 s**, `ruff check apps/api packages/contracts eval tools`
clean, `make prove-atomicity` (now `--workers 3 --rounds 1500 --baseline 3000`) and
`make prove-boot-order` green at the CI flag counts — with the boot-order run's
hazard side reporting 0-of-120 this time and saying so out loud ("did not reproduce
this run"), which is the outcome the tool was written to distinguish from a clean
shape. Five data gates, `tools/demo_check.py` 111 sealed cases, parity **164/164**.

## [Unreleased] - reminders and the measurement-honesty pass (an absence and two flattering numbers)

One feature this product always promised and never shipped, and two defects that
both erred in the direction that makes a patient look better than they are. Neither
defect was visible from a green suite: the first was a set of contrast ratios nobody
had measured, the second an arithmetic law that only misbehaves on history nobody
had generated in a test. Both are now measured, and one of them was caught by a
property test rather than by a hand-written case.

### Added
- **Dose reminders.** `src/lib/safety/reminders.ts` decides what should be said —
  a lead-in nudge, the due alert, a re-nudge once the dose is late — as a pure
  function of the plan, the patient's settings and the clock, on the same two-plane
  law as every other decision in this repository (ADR-0012): decide in a pure
  module, deliver in a thin hook. `src/lib/use-reminders.ts` is the delivery — a
  `Notification` per alert, deduplicated through a delivered-set so a re-render
  cannot say the same thing twice, ticking every 15 s inside the 60 s delivery
  grace. The Today tab carries the panel and the settings (nudge lead, late
  re-nudge, quiet hours, per-medication mute) through `/api/reminders`. Answering a
  dose ends its alerts, because a resolved slot is never reminded about — whether
  the answer was `taken` or the guardrail's `skipped`.
  - `tests/reminders.test.ts` (**47**) for the alert plan, `tests/reminders-route.test.ts`
    (**13**) for the settings round trip, and two Playwright journeys: a chosen nudge
    surviving a reload and changing the card copy, and delivery on a `page.clock` —
    08:50 nudge, 09:00 due, 09:30 late, and nothing further after the dose is taken.
    The clock law that suite taught the hard way: every absolute target must
    overshoot the alert moment by more than one tick, or the tick that would fire
    the alert never happens; and a *frozen* clock proves nothing about permissions
    or delivery, because both are read inside a timer.
- `apps/web/scripts/contrast.ts` — WCAG contrast computed the way axe computes it
  (oklch → linear sRGB → relative luminance, alpha composited over the real
  background), printed as PASS/FAIL against the AA floor. It reproduces axe's own
  live measurements to 0.02 (2.69 vs 2.71, 4.18 vs 4.19), which is what makes it a
  pre-flight check rather than an opinion. `bun scripts/contrast.ts`.

### Fixed
- **Two status chips were below the AA contrast floor, and a container's opacity
  was hiding it.** `taken` read 3.66:1 and `skipped` 2.52:1 against their own pale
  tints; the resolved-dose list carried `opacity-80`, which dragged its text to
  4.18:1 and its chip to 2.69:1. Removing the opacity would have exposed the chip
  failures, so both went: three ink tokens (`--vy-safe-ink`, `--vy-warn-ink`,
  `--vy-severe-ink`) now carry the chip text at 6.33, 6.48 and 7.61 with the hue
  unchanged, so a chip still reads as its severity. A container's `opacity` over
  real text is a contrast violation, not a style — and this was found by an axe
  scan over the Today tab, not by review.
- **An unanswered history used to read as perfect adherence.** `computeAnalytics`
  divided by the doses the patient had answered, so a slot left `pending` for six
  days sat in neither side of the fraction: someone who answers one dose in five
  scored 100%, and someone who answers none got "no analytics yet" instead of 0%.
  `effectiveStatus()` now closes a slot whose *calendar day* has passed with no
  answer as `missed`, at read time — no worker, and no read route that mutates the
  timeline it is supposed to report. The boundary is the day, not the clock hour,
  deliberately in the patient's favour: today is never charged for a dose that has
  not happened yet, which is also what stops the panel disagreeing with itself at
  09:00 and at 22:00 about identical history.
- **`MPR` was not an MPR — it was the adherence figure computed twice.** The old
  line divided the same numerator by the same denominator and capped it at 100. It
  is now the proportion of days covered: days with *every* slot taken, over days
  that have closed. That is the day-level statistic a dose-event dataset can
  honestly produce; the refill-based possession ratio needs dispensing data this
  app never sees. The two numbers now disagree on real history (83% of doses
  against 67% of days in the pinned case), which is the point.
- Both of the last two were caught by a property test rather than an example: 200
  generated dose histories, every published number recounted a second, independent
  way (different day keys, statuses decided inline, plain loops). Seed 1 disagreed
  on MPR, 54 against 50, because a row dated *tomorrow* and marked `taken` was
  being counted as a fact about the past. `effectiveStatus` now returns `pending`
  for any day that has not arrived, whatever its stored status — the boundary had
  to close in both directions before the metric was honest.
- The new axe scan asserted "the seeded day has at least two pending doses", which
  is true of a fresh demo and false of whatever the previous suite left in the
  shared database; it now force-seeds and resolves one slot `taken` and one
  `skipped` itself, so the scan describes the panel rather than the run order.

### Changed
- The Insights KPIs say what they divide: "taken ÷ doses whose day closed" and
  "days fully covered ÷ days closed", with a line under the grid explaining that a
  slot is only charged once its day has gone. The demo figure is unchanged — the
  seed resolves every past day, so the ~79% in `docs/DEMO_SCRIPT.md` was already
  honest — but a real patient's history is now reported lower and correct rather
  than higher and wrong.
- **Dependency currency pass, measured rather than chased.** `next 16.4.3`,
  `react 19.3.1`, `tailwindcss 4.3.3`, `@playwright/test 1.64.1`,
  `@axe-core/playwright 4.14.0`, `eslint 10.13.0`, `lucide-react 1.62.0`,
  `bun-types 1.4.4` — all current, all with the full gate chain re-run on top.
  Two majors are **held back on evidence, not on effort**: TypeScript 7.0.2
  typechecks this tree clean but `typescript-eslint` (latest 8.72.1, pinned in by
  `eslint-config-next`) hard-errors at load, so taking it would trade a green
  `bun run lint` for no linter; and Prisma 7 requires a driver adapter for
  SQLite whose `better-sqlite3` native binding loads under Node 24.18 and fails
  to bind under bun 1.4.3 — the runtime every one of the 417 web tests runs on.
  Both re-tested per release; the ceiling is tracked as TD-28.
- **The deprecated `middleware` file convention is now `proxy`.** Next.js 16
  renamed it and warned on every single build, which is the kind of warning a
  team learns to read past. `src/middleware.ts` → `src/proxy.ts`,
  `export function middleware` → `export function proxy`, and
  `tests/middleware.security.test.ts` → `tests/proxy.security.test.ts`. The
  runtime default moved from edge to Node with the rename, which is the one
  thing here that could have broken silently: the bucket table is still
  per-process (the law the file always documented), and the nonce, the origin
  gate and the limiter are pinned by 20 contract tests plus 21 E2E journeys that
  all still pass. The build is now warning-free.

### Gates after this pass
`bun run test` **417 tests / 22 files / 7 832 assertions, 0 fail** · `bunx
tsc --noEmit` clean · `bun run lint` clean · `next build` clean with **zero
deprecation warnings** · **21/21 E2E** (17 product journeys + 4 axe scans) · API
tier on `.venv`: 5/5 data gates, `tools/demo_check.py` 111 sealed cases, **462
pytest passed**, eval A4 `brand_recall=1.0 frequency_recall=0.9938
verdict_agreement=0.973 refusal_precision=1.0`, parity **164/164**.

## [Unreleased] - web-tier credential and ownership pass (the routes that answered anyone)

The safety engine was the hardened half of this repository. The web tier in front
of it has no authentication (TD-1), which means every route there resolves "the
patient" as `db.patient.findFirst()` and every credential on that surface is the
one thing standing between one visitor and another person's data. This pass went
through that surface as credential law rather than as feature smoke, and five
defects fell out — three of them disclosure bugs, one a silent data-loss bug, one
a write that crossed patients.

### Fixed
- **`GET /api/family` answered any request with the patient's `joinCode` plus
  every `links[].code` in the circle** (Critical, credential disclosure). The
  route treated "no code in the query" as proof of being the owner; with no
  session behind it, that is not evidence of anything, so the first anonymous
  visitor to the endpoint collected every live invite code and could read every
  family feed. Now a code exists only in the `POST` response that minted it: the
  owner view and the caregiver view both serialize `codeHint`
  (`Ra••••`) and nothing else, and `tests/family.test.ts` asserts the
  *serialization*, not the typed shape — a stray field is exactly what an
  `as unknown as` cast hides from the compiler.
- **Linking a second caregiver wrote no row and answered `ok` anyway** (High,
  silent data loss). The create path reused the first `CaregiverLink` of the
  patient, so the circle list stayed at one name while every UI affordance
  reported success.
- **Both acknowledge actions updated `EscalationEvent` by `id` alone** (High,
  cross-patient write). A caregiver code for patient A resolved patient B's
  escalation. Acknowledgement is now scoped through the link's own patient, and
  a foreign id gets the same 404 text a missing row gets — no existence oracle.
- **`familyCode()` was not a uniform draw** (Medium, credential strength). It
  mapped a `Uint32` over a 31-symbol alphabet with `%`, which biases the last
  symbols; for a credential that is a bug, not a nit. `src/lib/join-code.ts` now
  uses rejection sampling, and the test asserts all 31 symbols are reachable
  across 200 draws with no repeat.
- **The audit log stored join codes in full** (Medium). A database dump doubled as
  an invite list. `family.*` rows now carry the hint only.
- **A dose the engine skipped on the patient's behalf told nobody** (Medium,
  promised behaviour not delivered). `/api/doses/action`'s guardrail branch
  returned `guarded`, persisted `skipped` and audited — but wrote no
  `EscalationEvent`, while the family panel's own law says the circle is told
  when a dose is skipped. A blocked double intake is the single event in this
  product a relative most needs to read, so both write paths now notify, with the
  message attributed to the guardrail rather than to the patient.
- **A minted join code was never displayed** (Medium, UI defect found by the
  credential fix). `family.tsx` cleared `freshCode` inside its load effect, and
  linking triggers a reload — so the response that disclosed the code wiped it in
  the same tick. The clear moved to the two view-switch handlers, and
  `e2e/product.spec.ts:198` now proves the browser case: the code is visible
  after minting and absent from `page.content()` after re-opening the panel.
- **`describe()` timeouts were silently ignored** (Low, flaky gate). bun's
  `describe` takes no timeout argument — passing one is a TS error *and* a no-op
  at runtime — so the 120 s budgets in `regimen-route.test.ts` were never in
  force. `setDefaultTimeout(20_000)` (file-scoped, verified against a 7 s test)
  plus `bun test tests/ --timeout=20000` replaced them; the ceiling is what the
  shared-database law needs, because every web test file writes to ONE SQLite
  file and a first query can land on a WAL checkpoint left by whichever file
  wrote last.

### Changed
- **Prescription ownership is now a claim, not an assumption.**
  `Prescription.patientId` is nullable — NULL means "not claimed yet" — and
  `/api/plans` claims it transactionally, so two browsers cannot both build a
  plan off one uploaded script. A non-NULL foreign id is refused with the same
  text a missing row produces.
- **The seeded demo timeline is actionable at every hour** (`src/app/api/seed/
  route.ts`). The course ends today, and the old law resolved today's earlier
  slots by the clock: an after-21:00 reset produced a plan with zero pending
  doses, an empty Today panel, and an E2E journey whose result depended on the
  time the suite started. Today now stays pending; the history before it stays
  closed, which is what makes the adherence numbers a history at all.
- **A day still in progress no longer zeroes the streak**
  (`src/lib/safety/adherence.ts`). The loop's comment said "trailing perfect days
  up to the last resolved day" while the code stopped at the first *un*resolved
  one, so the same history read `0d` in the morning and `3d` at night.

### Added
- `apps/web/tests/adherence.test.ts` — **12** new tests over the two pure
  functions the Insights panel and the dose button depend on, both previously
  exercised only through a route: the streak law (including "fully pending is not
  a streak"), the resolved-only denominators, `null` rather than a demoralising
  `0%`, and all four `catchUpGuidance` branches — with the clock pinned, because
  built from "today at 20:00" the 18:00 dose lands in the future when the suite
  runs at 15:00 and the branch under test is not the one reached.
- `tests/family.test.ts` (**14**), `tests/ownership.test.ts` (**9**),
  `tests/limits.test.ts` (**16**), `tests/seed-gate.test.ts` (**11**),
  `tests/run-guard.test.ts` (**7**) — the rest of the surface this pass
  hardened, recorded here for the first time: the join-code credential law end to
  end, dose/plan/queue writes scoped to the patient the server actually serves,
  bounded request bodies with `readJson` (the middleware counted requests per
  minute, never bytes), the destructive demo reset as a deny-by-default switch
  matrix, and the guard that keeps one `/api/evals` run — ~20 model calls, 300
  seconds — from being launched sixty times a minute. `tests/breaker.test.ts` and
  `tests/middleware.security.test.ts` already carried the breaker and header
  laws; the pass ran against them rather than rewriting them.
- The dose-guardrail family escalation and the shown-once code journey are both
  covered end-to-end: **18/18 Playwright** (15 product journeys + 3 axe scans).

### Gates after this pass
`bun run test` **344 tests / 20 files / 5 862 assertions, 0 fail** · `bunx
tsc --noEmit` clean · `bun run lint` clean · **18/18 E2E**.

## [Unreleased] - evidence-provenance pass (the fallout the identity repair did not cause but exposed)

Re-keying 226 catalog rows changed the *data*. The two things downstream of that
data — the synthetic corpus whose labels are built from it, and the chain of
custody every experiment number rides on — were both wrong, and neither failure
was visible from a green suite.

### Fixed
- **A frozen corpus that had quietly stopped describing the engine it tests.**
  `tools/build_corpus.py` builds each case from a documented rule and verifies
  the intent against the engine before writing it, so re-keying the molecules
  invalidated labels without touching a line of code. Measured on the run before
  this pass: the A4 ladder read **0.8182** instead of 1.000 — **8 of the 44**
  frozen test cases disagreed (`C163`, `C185`, four `adversarial_injection` cases
  `C261`/`C263`/`C268`/`C269` moved to `confirm_queue`, `C293`/`C297` from
  `script_mix`), and the E-C acceptance gate **failed** with `unsafe auto-confirm
  0.0039` on `C099`, whose expected interaction existed only because hydroxyzine
  was filed under `cetirizine`. The fix was to re-derive both corpora with the
  seeded generators — not to edit a label, not to loosen the gate: same 300 and
  119 case ids, same strata, same 70/15/15 split, **0 verdict moves**, 243 and
  111 rows re-rendered because their brand text now comes from the repaired
  catalog. A4 returned to 1.000 and E-C holds at every corruption level.
- **Every experiment was citing data it never read** (High, evidence integrity).
  A run manifest's `dataset.files` map was copied from `data/manifest.json`, and
  only the two corpus builders rewrite that record. The repair replaced
  `data/brands.csv` through the governed importer; the next full battery stamped
  `snapshot_id 38a7994f36e641b5` in which **all 11** tracked entries disagreed
  with the bytes on disk — including the four corpus files that run had just
  read, and `brands.csv` recorded as `f80a7fffc3a0…` while disk said
  `9e641166c239…`. `ml/manifest.py`'s docstring claimed the loader verifies
  hashes and CI fails on mismatch; `verify_manifest()` was correct and reachable
  only behind a `--verify` flag that no gate ran. Now: a run hashes disk
  (`current_files()`), `snapshot_id()` recomputes instead of reading, the
  governed importer (`tools/import_snapshot.py --apply`) refreshes the record in
  the same step that
  replaces a table (preserving the builders' seed/strata metadata), `make
  data-check` runs `tools/build_corpus.py --verify`, and every path default is
  late-bound so a test that redirects `ROOT` cannot write into the live repo.

### Added
- **The E2E gate now runs on Windows.** `apps/web/playwright.config.ts` started the
  production server with `PORT=3457 NODE_ENV=production node …` — POSIX shell
  syntax that `cmd.exe` runs literally, so Playwright reported
  `'PORT' is not recognized as an internal or external command` and the whole
  browser gate (14 journeys + 3 axe scans) died before a browser launched. On
  this machine `make web-e2e` had therefore never been the evidence the README
  quoted; the config now passes `env` to the child process, which is what
  Playwright's contract is for. **17/17 green** after the change.
- `apps/api/tests/test_dataset_manifest.py` — 5 tests: the committed record
  matches disk; mutating a tracked table moves `snapshot_id` and makes
  `verify_manifest` report it; a run manifest cites disk hashes when the record
  is stale; a refresh preserves the builders' metadata; the importer's apply path
  refreshes the record.
- `make data-check` is now **five** gates, not four: molecule vocabulary, brand
  self-consistency, dose-cap derivation, the compiled web table, and the dataset
  manifest versus the bytes on disk.

### Measured
- `data/corpus/cases.jsonl` digest `98128b0192854fa8 → ee46cca6037a5eaf` (n=300,
  0 verdict moves); `data/corpus/regimen.jsonl` `18652d47055956fd →
  774292e7663b246d` (n=119, 0 verdict moves); dataset snapshot
  `38a7994f36e641b5 → efa012dcfd17d32b`, verified against disk.
- Full battery re-run under corrected provenance: E-A **A0 0.2273 → A1 0.7045 →
  A2 0.4773 → A3 0.7045 → A4 1.000** (macro F1 1.000, unsafe 0.000, queue 0.250,
  ECE(safety) 0.1457) · E-B every ablation regresses · E-C zero unsafe at L0–L5,
  invariants **HOLD**, invented brands auto-confirmed 0.000, replay refusals 3/4 ·
  E-D frozen point `v1-2026-09` unchanged (20 grid points, 13 pareto, **0** with
  zero unsafe at ≤15% queue) · E-F p50 0.512 ms / p95 3.166 ms, offline delta 0 ·
  E-G raw 0.7045 vs queue 1.000 at 5.91 s/case against 26.59 s for blanket refusal
  · E-H 0.8315 → 0.9048 → 1.000 · parity **164/164** in both planes.
- Newest run manifest checked by hand: `snapshot_id efa012dcfd17d32b`, and the
  `brands.csv` hash inside it equals the hash of the file on disk.

### Stated, not buried
A rebuilt 1.000 on engine-derived labels is **self-consistency**, not accuracy —
that is TD-22, and the external evidence remains the sealed 111 fixtures and the
164 curated parity lines. The sealed set still reads verdict agreement **0.973**
with three named stale labels (TD-21), and 83 of the 583 molecules the catalog
names still have no rule row at all (TD-20).

## [Unreleased] - wrong-drug identity pass (226 catalog rows re-keyed)

Every previous pass asked whether a rule was *reachable*. This one asked whether
the rule that fired was about the drug on the strip. It usually was not: 226 of
the 2 836 brand rows are Jan Aushadhi catalog entries whose `molecule` cell names
a different drug than their own `brand` string states — the row was shelved under
the class representative instead of its ingredient, and every table the engine
indexes by molecule inherited that.

### Fixed
- **A brand screened against another drug's rules** (Critical, undocumented
  before this pass). Measured consequences, each reproduced end-to-end before
  being fixed:
  - `Jan Aushadhi Apixaban Tablets 5mg` carried `warfarin`, so the anticoagulant
    interaction set and the pregnancy rule the patient was shown were warfarin's,
    and the 5 mg course was measured against warfarin's INR-level-guided 10 mg
    ceiling — a cap the engine cannot verify for this patient, so it advised on
    the wrong drug instead of screening the right one.
  - `Jan Aushadhi Cholecalciferol Soft Gelatin Capsule 60000 IU` carried
    `calcium carbonate`, a molecule with no ceiling at all. The v11 IU interval
    mandate — the rule behind P159/P160/P164, added specifically for the 60,000 IU
    sachet — was unreachable from the one brand most likely to be prescribed as
    it. A daily 60K course passed in the product tier for a different reason than
    the table was incomplete.
  - `Jan Aushadhi Escitalopram Tablets IP 10 mg` carried `citalopram`: the strip
    screened against 40 mg/day while escitalopram is licensed to 20, so a 40 mg/day
    escitalopram course — double the label — was clean.
  - `Jan Aushadhi Heparin Sodium Injection IP 25000 IU` carried `warfarin`.
- **The direction of the change, stated before anyone reads it wrong.** These
  brands went from addressing **17 082 interaction rows to 4 238**, **875
  contraindications to 431** and **214 ceilings to 189**, and rows addressing
  nothing went **0 → 28**. A fall in "rules reached" here is the false-positive
  load being removed: a brand that matches another drug's rules does not produce
  extra safety, it produces confident wrong answers. The 28 rows that now address
  nothing are the honest cost and a provenance gap, not a regression — the catalog
  holds no rule row yet for cefotaxime, budesonide inhalation or levosalbutamol.

### Added
- **`tools/repair_pmbjp_molecules.py`** — a deterministic, evidenced re-key, not a
  hand edit. A row is a contradiction when its brand string names an ingredient
  that its `molecule` cell denies, where "names" means the maximal span of the
  name that is not itself part of a longer declared identity and whose leading
  word is unique to one identity in the vocabulary. It refuses the two false
  classes that a substring detector produced on the first pass: spelling variants
  (`cyclosporin` under a `cyclosporine` row — declared, so kept) and shared
  leading words (`insulin`, `tenofovir` — name several identities, so excluded).
  `--check` gates it in `make data-check`: **0 of 2 836 rows contradict their own
  name**. `--apply` writes the ledger, drives the change through the governed
  importer, and re-reads the tables to confirm the fixed point.
- **`data/reference/pmbjp_molecule_repairs.csv`** — 226 rows of
  `brand, molecule_before, molecule_after, ingredient_named_in_brand, form,
  source`, and **`data/reference/pmbjp_repair_reach.json`** — the before/after
  reach figures frozen with the definition used to compute them, so the number can
  be re-derived and argued with rather than trusted.
- **The same law tested in both planes** —
  `apps/api/tests/test_pmbjp_identity.py` (10 tests: the gate itself, the four
  measured consequences through the real engine including the warning text a
  patient would see, and the two other identity gates re-run as subprocesses) and
  `apps/web/tests/pmbjp-identity.test.ts` (8 tests: every one of the 226 ledger
  rows compared against the compiled table the product app actually loads, plus
  the four class representatives by name).
- `make data-check` now runs four gates, not three: molecule vocabulary, brand
  self-consistency, dose-cap derivation, and the compiled web table.

### Measured
- 226 rows changed, 2 610 untouched, through `tools/import_snapshot.py` with a
  `.bak` and a diff report; `apps/web/src/lib/safety/tables.generated.ts`
  regenerated — decision-bearing table hash **`62ea56268040d1ea` →
  `67c861f3f86dc7f7`**.
- Gates: pytest **457** · bun **308 tests / 17 files / 5 721 assertions** ·
  parity **164/164 in both planes** · sealed eval unchanged at brand recall
  **1.00**, frequency recall **0.9938**, verdict agreement **0.973** (3 cases),
  refusal precision **1.00** · engine self-test 18/18 + copilot gates 3/3 · ruff,
  eslint, `tsc`, `next build` clean · all four data gates pass.
- The parity corpus did **not** need a new version: no verdict rule moved. This
  was a keying error in data, and the test that holds it is a data gate.

### Found while writing the mirror test
- The ledger keeps the source's whitespace; the compiled artifact folds it.
  `data/brands.csv` carries U+00A0 inside 11 brand names (21 characters), the web
  build folds it, `apps/api` folds it at load through `_norm_key`, and a test that
  compares a ledger string to a compiled string without the same fold reports a
  repaired row as missing. The TS mirror now folds exactly as `_norm_key` does and
  asserts the fold itself: no NBSP anywhere in the generated table.

## [Unreleased, earlier] - frequency-composition pass (parity corpus v11 → v12)

A slot code and an interval word are written together on one line — `0-0-1
weekly` — and they are one instruction: which hours, and how often that day comes
around. The extractor returned the code and dropped the qualifier, so a correct
weekly course arrived at the interval law as a daily one.

### Fixed
- **A weekly drug scheduled daily by the reader** (Critical, ISMP never-event
  class). `Tab Folitrax 10 mg 0-0-1 weekly` and `Cap Calcirol 60K 0-0-1 weekly`
  both queued as never-events in both planes. The false positive is not neutral: a
  queue that fires on correct prescriptions is a queue a reviewer learns to wave
  through. Pinned as **P162** and **P163**; the sealed fixture RX-038 is written
  this way, which is how the pair was measured.
- **The reverse direction, pinned too.** Composing the qualifier must not excuse a
  schedule shorter than the label allows: `1-0-1 alternate day` of 60,000 IU is
  still three times the weekly maximum, so the mandate bites at interval 2 as well
  as interval 1. Pinned as **P164**.
- **A dose separator read as a slot code.** A prescription line is written
  `<brand> <dose> - <regimen>`, and `Lyrica 75 - 1-0-1` starts a legal code at the
  7: `75-1-0` is 6+ administrations a day, which invented a 30 mg/day pregabalin
  reading out of a 75 mg capsule. `_LINE_FREQ` now requires the separator to be
  spaced on both sides, and a code whose own slots are spaced (`1 - 0 - 1`) still
  matches.
- **One line-to-frequency function per plane, shared with perception.** The
  deciding plane and `app.vision` used to parse the same line twice, differently;
  `extract_line_frequency` (Python) and `extractLineFrequency` (TypeScript) are now
  the single function both call, so what the reader saw and what the engine judged
  are the same reading. The `Frequency` record carries `interval_days` and an exact
  `daily_factor = doses_per_day / interval_days`, and the TAC branch precedes the
  prose `_EVERY_RE` so `0-0-1 weekly` cannot be caught by a word-only match first.

### Measured
- Corpus **v12**, `PARITY_VERSION = 12` pinned in both runners; **164** cases,
  distribution `pass 36 · interaction 35 · confirm_queue 50 · contraindication 18
  · duplicate_atc 16 · refused 9`, **164/164 agree in both planes**.
- Sealed eval: frequency recall **0.9938** (n=111), verdict agreement 0.973.
- Gates after this pass: pytest 447 · bun 300/16 files · ruff and eslint clean.

## [Unreleased, earlier] - unit-law pass (parity corpus v10 → v11)

Perception stamped `" mg"` on every trailing brand number. That default is not a
rounding error — it is a different drug, a different dose and a different unit:
`Thyronorm 50` became 50 mg of levothyroxine against a 0.3 mg/day cap (a
thousandfold over-read of a 50 mcg tablet), and `Calcirol 60K` became 60 mg of
cholecalciferol, dropping both the kilo multiplier and the unit the preparation is
sold in.

### Fixed
- **One unit law for strengths** (Critical). The unit of a bare number now comes
  from the formulary row's molecule in the deciding plane (`_MCG_BRAND_MOLECULES`,
  `_IU_BRAND_MOLECULES`), never from a default; a label that prints its own unit
  always wins; and **25** ratio brand labels (`500/125`) match against either
  component instead of reading only the trailing half — a correct 500 mg
  amoxicillin line had looked fourfold wrong. Pinned as **P156** (the clean read
  must pass), **P158** (ratio label) and **P161** (a stated IU unit beats the
  molecule-derived one).
- **A tenfold mis-read that hid inside the brand name.** The look-alike /
  different-strength guard compares the line's number with the resolved row's
  strength — but with the invented unit the strength was being read *back out of
  that row*, so `Tab Thyronorm 500` verified as perfect agreement with a label the
  prescription never wrote and passed. The line's number is now anchored to the
  resolved brand core, so the contradiction is the finding. **P157**.
- **The never-event the caps table could not state.** `dose_caps.csv` is keyed on
  mg, and an IU strength has no mg equivalent, so both the caps and the interval
  rules abstained on the 60,000 IU sachet and a month of daily 60K — 1.8 million
  IU — passed silently in both planes. `IntervalMandate.min_iu` makes a mandate
  expressible in the unit the label uses, with the threshold on dose size so the
  400–2,000 IU daily drops and syrups a patient legitimately takes are untouched.
  **P159** (weekly passes) and **P160** (daily queues).

### Measured
- Corpus **v11**; relabels in this version move **toward** the stricter verdict,
  and P156/P158/P159 are the negative controls that prove the fix is not a blanket
  block. Parity 161/161 in both planes at this version (P156–P161 on top of the
  155 cases v10 left).

## [Unreleased, earlier] - combination-granularity pass (parity corpus v9 → v10)

Screening walked a brand's *components*. The harm a combination carries is
documented on the combination, so the rule that was on the table could not be
found by the name the patient swallows.

### Fixed
- **Combination-keyed rules were unreachable from any brand pair** (Critical for
  the class). `data/interactions.csv` holds **176** rows keyed on a whole
  combination, **89** of them with no component-level counterpart for the same
  partner; `data/contraindications.csv` holds **17** more. `_molecule_identities()`
  now yields the components *and* the whole combination string, and the regimen
  plane mirrors it through `_identities_of()`, so a walk over one brand pair
  reaches both granularities without a second index.
- The rules this made reachable are not exotic: carbapenem-driven valproate
  failure (seizure breakthrough), CYP3A4 induction against the combined pill as
  sold (contraceptive failure), additive QTc on `artemether+lumefantrine`, central
  D2 blockade on `levodopa+carbidopa`, ciprofloxacin chelation by an iron-folate
  tablet, and first-trimester `artemether+lumefantrine` as an absolute. Pinned as
  **P150–P155**, one per mechanism, the last of them a contraindication reached
  from a single line plus a declared context.

### Measured
- Corpus **v10**, both runners pinned; **155** cases at this version (P150–P155 on
  top of v9's 149), 155/155 agree in both planes. 33 tests added across the two
  planes' identity-law suites to hold the granularity in the deciding plane *and*
  in the longitudinal one.

## [Unreleased] - one-table pass (parity corpus v8 → v9)

The product tier and the service tier were not running the same engine. Neither
the parity gate, nor the suite, nor the demo could see it, because every test
named a drug both copies happened to hold. Every figure below was measured by
loading both tables and comparing them row by row.

### Fixed
- **The web tier shipped 99 of the 2 836 catalog brands** (TD-15 / TD-9,
  Critical). `apps/web/src/lib/safety/dataset.ts` hand-copied 99 brands, 84 of
  the 9 660 documented interaction pairs and 37 of the 1 267 contraindications:
  86 nameable molecules and 865 addressable interaction rows, where the API tier
  had 583 and 9 290. Consequence, concretely: "Losar 50 + Lasix 40" — a pair
  `data/interactions.csv` documents as moderate — verdicted `pass` in the app and
  `interaction` in the service, and the composed triple-whammy class the regimen
  plane exists to catch was invisible there.
- **A resolver that could invent a resolution.** The web resolver took a
  brand-*core* substring match after the whole-key containment scan, which with
  2 836 rows means `brufen` matches both `Brufen 200` and `Brufen 400`. It picked
  the wrong strength on 575 of 1 909 ambiguous cores, and the strength guard then
  queued lines the perception layer had read perfectly. The scan is gone: this
  plane now applies the API tier's law — exact key, else the longest key the line
  contains, else the ingredient-name guess.
- **An ingredient-name guess that counted as a formulary match.** 7 of the 583
  molecules appear inside no brand key, so a line naming one (e.g. "ferrous
  sulfate 500 mg OD") was guessed into a brand at 0.85 here and treated as
  resolved, while `SafetyEngine.normalize()` returns None for the same line and
  queues it. At a 0.97 reading the app auto-passed a drug identity nothing
  confirms — the unsafe direction. Guessed meds now carry `resolvedBy` and never
  auto-confirm; the guess stays in the record for the pharmacist and decides
  nothing. Pinned as corpus case **P149**.
- **One drug spelled two ways depending on which engine answered.** 11 catalog
  brand names carry a non-breaking space; the web build folded it and the API
  tier did not, so the same row was named differently in the verdict text.
  `_fold_spaces` at API load mirrors `fold_spaces` at build.

### Added
- **`tools/build_web_dataset.py`** compiles `data/brands.csv`,
  `interactions.csv` and `contraindications.csv` into
  `apps/web/src/lib/safety/tables.generated.ts`: 2 836 / 9 660 / 1 267 rows and
  the 8 graph-rule groups, interned into one string pool with integer row tuples
  so the shipped artifact is **1 719 KB instead of ~3.5 MB**. It refuses to build
  over a data shape either plane would misread: colliding folded brand keys, a
  molecule cell that is not already lowercase and space-free, a self-pair (Python
  collapses it to one element, TypeScript keys it `a|a`), a colliding unordered
  pair, an open vocabulary violation, a contraindication whose condition code no
  client can declare. `--check` decodes the emitted file back and compares **every
  row**, not just `DATASET_TABLE_HASH`; the hash covers only decision-bearing
  values, so a reworded mechanism is not a rule change.
- **Three gates so this cannot regress quietly**: `make data-check` now runs
  `--check` (CI fails on a stale artifact); `apps/api/tests/test_web_dataset.py`
  (7 tests) compares the generated module with `SafetyEngine.load()` brand key by
  brand key, pair by pair, rule by rule; `apps/web/tests/dataset-tables.test.ts`
  (17 tests) checks the module against itself — declared counts, the hash
  recomputed from decoded rows with a Python-`json.dumps`-compatible serializer,
  the fold and vocabulary invariants, combination granularity, and the resolver
  law itself.
- **Corpus v9** (`P149`), with `PARITY_VERSION` bumped in both runners, so the
  ingredient-guess law is now a conformance case rather than a comment.

### Measured
- Resolver sweep, 6 365 lines (every corpus line plus every catalog name, raw and
  written as "Tab … 1 OD x5d"): both planes resolve the same **6 265** lines to
  the same rows and name them identically — **0 disagreements** (the core scan
  disagreed on 12 of the 3 069 lines it was measured against before).
- `normalizeLine` cost fell from 23.7 µs to **8.2 µs per line** on that sweep;
  the engine self-test went 21.58 ms → **7.69 ms**; the web suite 8.99 s → 7.95 s.
- Gates: pytest **405** (was 398) · bun **274 tests / 15 files / 1 013
  assertions** (was 257) · parity **149/149 in both planes** with identical
  verdict distribution · self-test 18/18 · ruff clean · `tsc` clean · demo-check
  PASS (sealed, offline, no keys).

### Documented instead of changed
- **TD-19**: 3 molecule cells name a *form* (`metformin_sr`, `metoprolol_sr`,
  `paracetamol_syrup`) and pass every shape gate. Two of them carry their own
  ceilings, which is defensible for modified-release; `paracetamol_syrup` carries
  nothing at all — no pair, no contraindication, no cap — so the two paracetamol
  syrup brands screen against nothing, in the paediatric weight-based class. Left
  open deliberately: the fix belongs at the import boundary with a molecule-name
  vocabulary, not in a hand edit that `make data-check` cannot verify.

## [Unreleased, earlier] - molecule-identity pass (parity corpus v7 → v8)

A lookup table can only find what it is keyed on. Four independent curation
passes had each used the spelling their source used, so the same substance sat
under its salt, its British spelling and its US adopted name in different rows —
and a documented rule became unreachable with no error anywhere. Every number
below was read back out of the tables before and after, not reasoned about.

### Fixed
- **One drug, several names ⇒ unreachable rules** (TD-17, Critical).
  `ferrous sulfate` brands (Fefol, Autrin, Jan Aushadhi) reached **no** daily-dose
  ceiling, because the 325 mg iron cap was filed under `ferrous sulphate`: a
  500 mg/day iron course screened clean in both planes. `lithium carbonate`
  reached 4 contraindications and no pregnancy rule while `lithium` reached 3,
  pregnancy ABSOLUTE among them, plus its 2400 mg ceiling — `Lithosun 300` printed
  the salt. `carvedilol phosphate` reached 0 of carvedilol's 28 interaction rows
  and missed bradycardia and heart_block. `cyclosporin` reached 0 of
  cyclosporine's 164 rows; `torsemide` 0 of torasemide's 109. Renaming 23 brand,
  84 interaction, 17 contraindication, 3 dose-cap and 2 RxNorm rows took the
  rules those brand rows can reach from 561 to 1,475 interactions, 38 to 72
  contraindications, and 0 to 23 of 23 brand rows reaching a ceiling.
- **A same-regimen verdict that varied by brand spelling.** `metronidazole +
  lithium` was stated `severe` under one identity and `moderate` under the other.
  Collisions are now adjudicated by strength — severity, then an escalating cap,
  then a row that states the mechanism over one that only cites a page — so a
  merge never weakens a rule; four of them corrected one upward. 13 interaction
  and 5 contraindication collisions resolved; every dropped row is kept verbatim,
  citation included, in `data/reference/molecule_merges.csv`.
- **A dose hazard that read differently in each plane.** Python `.title()`-cased
  the molecule in the hazard text while TS emitted the table's own spelling, so
  the same finding said "Ferrous Sulfate" in one tier and "ferrous sulfate" in
  the other. Verdicts matched, so parity could not see it. One identity, one
  spelling, everywhere.
- **The copilot silently stopped answering the drug the rename touched.**
  Retrieval boosts by molecule; its corpus was keyed `ferrous sulphate` and the
  engine now emits `ferrous sulfate`, so a patient on an iron tablet would have
  been refused with a straight face. `knowledge.ts` keys and the web dataset are
  canonical now, and pinned as such.
- **A parity case that had been pinned to the split.** `P31` (Fefol + doxycycline)
  was labelled `pass` while the iron ceiling was unreachable from it; relabelled
  `confirm_queue` on measurement, and `expect_finding` moved from "chelation" to
  "chelate" because the merged survivor states the mechanism as a verb — the web
  row's text was aligned to the same surviving sentence so both planes explain
  this interaction with the same words.
- **A line with no strength could write `None` into two `str` contract fields,
  and only the read-back noticed** (Critical, found by the demo gate).
  `enrich_field()` rebuilds the field with `model_copy(update=...)`, which skips
  validation; for a brand whose core carries no number ("Crocin Advance") the new
  brand-label-strength fallback returned `None` and so did `dose or strength`.
  Every in-process step accepted it — the engine, the verdict, `put()` — and
  `GET /prescriptions/{id}/explanation?lang=ta` died with a 500 when `store.get()`
  re-validated the row. RX-004 was therefore un-demonstrable, and the only thing
  that had ever read a persisted prescription back was `tools/demo_check.py`.
  Absence of evidence now stays an empty string, which is the documented
  behaviour for an unlegible strength (the line abstains from the per-line cap
  rule instead of crashing the plan).

### Added
- `tools/normalize_molecules.py` — the identity law in one place: 11 retired
  aliases, each with its basis and source, and 5 **pinned non-merges**
  (citalopram is not escitalopram; omeprazole is not esomeprazole; prednisone is
  not prednisolone; and suffix stripping would have collapsed sodium chloride,
  potassium chloride and calcium carbonate onto the empty string). `--apply`
  routes through the governed importer, `--check` gates it, `--reach` freezes the
  before/after evidence in `data/reference/molecule_identity_reach.json`.
- `tools/import_snapshot.py` now enforces two properties of the engine's own
  indexing, so a future snapshot cannot re-split an identity: a candidate naming
  a retired identity is rejected, and a candidate stating one engine key twice is
  rejected (the loader keeps whichever row it reads last — the loser is a
  documented rule that silently does not exist). The live tables pass the same
  gate on every test run.
- `apps/api/tests/test_molecule_identity.py` (31) and
  `apps/web/tests/molecule-identity.test.ts` (7) — the law inside the suite, not
  only as a CLI a contributor can forget.
- `apps/api/tests/test_state_roundtrip.py` (5) — every sealed fixture is run
  through the real route handler and read back out of the store, so a contract
  type violation anywhere in a persisted state fails in the suite instead of in
  a rehearsal. Handler-level on purpose: the middleware adds ~60 ms per call and
  the write limiter would refuse the 60th sample. Mutation-checked — reverting
  the one-character fix fails three of the five.
- Corpus v8: `P148` (lithium/pregnancy, the ABSOLUTE rule the salt spelling hid)
  and the `P31` relabel, both with the measurement written into `why`.
- `make lint` (the exact paths and command CI runs) and `make data-check`
  (identity + caps gates, now wired into `audit` and `demo-check`, and so into
  CI). `ruff` added to the API `dev` extra and installed in the venv — the lint
  gate previously existed only in CI, on a tool the repo did not pin.

### Verified after this pass
`ruff` clean (0.17.2) · **398/398** pytest · **148/148** Python parity · eslint +
`tsc` clean · **224/224** bun tests across 11 files (660 assertions) ·
**148/148** TS parity · 18/18 selftest + 3/3 copilot gates ·
**`tools/demo_check.py` green** — the gate that found the `None` write, and the
only thing that had ever read a persisted prescription back ·
`normalize_molecules.py` dry run reports **0 cells to rename, 0 collisions** (the
migration is a fixed point) · caps table 305 rows, hash `3dc1505f75b23bdd` ·
production build. README honesty table, the landing proof band and
`docs/TECH_DEBT.md` updated to these numbers; the stale `110-case` label in
`.github/workflows/ci.yml` corrected to 148, and the two hand-typed counts in
README's own `make` block retired (179 tests, 147 corpus cases) — help text has
no version bump, which is TD-16's residue exactly.

## [Unreleased] - safety-law closure pass (parity corpus v4 → v7)

Every rule that changes a verdict now exists, identically, in both planes — and
each of the five defects below was found by *measuring* the two engines against
each other, not by reading one of them.

### Fixed
- **Weekly drugs scheduled daily** (methotrexate, alendronate, weekly GLP-1):
  the scheduler expanded `1-0-0` × 7 days for a drug the interval law says is
  taken once a week. A weekly tablet printed seven administration slots.
- **The administration-interval law had no raw-text reach.** `doses_per_day`
  and `interval_days` were adjudicated correctly when a frequency was parsed,
  but the frequency *vocabulary* was not mirrored: the Python tier read 65
  tokens ("6 hourly", "QOD", "alternative days", "1-0-1", "weekly") and the
  TypeScript tier read fewer, so a line could be caught in one app and passed in
  the other. The token table is now one array, verbatim in both planes, with a
  drift test that fails if either side edits its copy (corpus v4 → v5).
- **The aggregate daily-dose cap was the last verdict-affecting rule in only one
  plane.** `Tab Cetzine 10 BD x 5 days` — 20 mg of cetirizine against a 10 mg
  licensed maximum — verdicted `interaction` in TypeScript and `pass` in Python.
  134/134 corpus agreement was real about everything except this (corpus v6,
  `P135`–`P139`, including the two-lines-each-at-the-cap case that only breaches
  in aggregate).
- **Three copies of the caps tables, disagreeing on 17 molecules.** A 306-entry
  Python literal, a second TypeScript literal, and
  `data/reference/dose_caps.csv` — the only copy with a source per row — read by
  nothing. The conflicts were clinically real: theophylline 450 mg/day against
  the curated level-guided 900 turned a routine modified-release 800 mg/day
  course into a "fatal overdose" (P42); ondansetron 32 was the historic *IV*
  single dose withdrawn over QT prolongation, applied to tablets (oral is 24);
  warfarin 10 and digoxin 0.5 were stored as ceilings though both are titrated
  to a measured value. One table of record now, generated into both tiers,
  hash-pinned (`83b0fb4a40216989`), with `basis` + `escalate`: a cap the engine
  cannot verify for THIS patient — level-guided, weight-based,
  specialist-supervised — advises and never blocks.
- **A label that prints two thresholds was executed with one.** Correctly moving
  ibuprofen's blocking ceiling (1200 OTC → 2400 prescription) made a 1600 mg/day
  course *silent*, because the lower self-care figure lived only in note text.
  `advisory_mg` is now a loaded, executed column — the ceiling decides the
  verdict, the second figure decides whether it says so out loud (naproxen 660
  under 1500, loperamide 8 under 16). Clopidogrel's inverted row (300 loading
  *above* the 75 maintenance line) is deliberately inert, so a legitimate loading
  dose still only advises.
- **The ceiling a declared patient condition lowers was in the notes, not in the
  rule.** Paracetamol 2 g/day in liver disease, citalopram 20 over 65, tramadol
  300 and tapentadol 500 in renal impairment — while the app already asks the
  patient about exactly those contexts. So 4600 mg/day of paracetamol was
  indistinguishable for a healthy adult and for a patient who declared severe
  liver disease. `lowered_by` is now a column of the table of record; the lowest
  applicable declared figure becomes operative and the 1.5× escalation law runs
  on *it* (corpus v7, `P142`–`P147`, incl. `P144`: the ceiling moved, the law did
  not). The usual excuse for advisory-only caps — "the engine has no serum
  level" — does not apply to a number the patient declared.
- **The two planes printed different numbers for the same dose.** TypeScript
  rendered `Math.round(total)`, so a 0.5 mg/day levothyroxine breach of a 0.3
  mg/day cap read "1 mg/day" while Python read "0.5 mg/day" — in the
  sub-milligram class (levothyroxine, digoxin, warfarin) a rounding error in the
  sentence *is* a wrong sentence. `formatMg` mirrors Python's `f"{x:g}"`.
- **Different-strength guard blind spot:** its magnitude test rejected every bare
  number under 2, which is exactly where tenfold errors kill. `Alprax 0.5` and
  `Digoxin 0.25` — a decimal brand strength contradicted by the milligram figure
  on the same line — are now caught; P41/P89 relabel because their old
  "overdose" verdicts were computed from invented 10 mg/day alprazolam and 1000
  mg/day digoxin aggregates.
- **Fabricated evidence, caught negatively:** applying one stated strength to
  every molecule of a combination brand produced "380 mg/day atorvastatin" on a
  routine statin+aspirin line. P81 keeps its verdict and gains
  `expect_not_finding` — the corpus can now assert that a number stopped being
  made up, which an expected label alone cannot.

### Added
- `tools/build_dose_caps.py` — one build, two artifacts: the CSV of record and
  `apps/web/src/lib/safety/dose-caps.generated.ts`, exporting `DAILY_CAPS_MG`,
  `HARD_CAP_MG`, `CAP_BASIS`, `ADVISORY_MG`, `CAP_LOWERED_BY` and the table hash.
- One shared classifier per plane (`cap_check` / `capCheck`, `effective_cap` /
  `effectiveCap`), so the per-line warning rule and the multi-line aggregate rule
  cannot disagree with each other in either tier.
- `tools/parity_v4.py` … `v7.py` — idempotent, reviewable corpus migrations, each
  with `--check` as a gate. Measured relabels are recorded with the bug they were
  masking, never silently.
- `apps/api/tests/test_dose_caps.py` (43) and `apps/web/tests/dose-caps.test.ts`
  (21) — mirror-image law tests plus the cross-plane drift gate.
- `apps/web/tests/claims.test.ts` — the **public-claim gate**. The landing page
  quotes numbers under "Evidence, not adjectives" and README under "what is
  measured (not claimed)", and both were hand-typed: they went stale twice
  (`94`, `110/110`) while every gate stayed green, because a suite growing is not
  a test failure. Each landing tile is now re-derived from the artifact it
  describes — the golden corpus and the `PARITY_VERSION` both runners enforce,
  the self-test suite (also asserted to pass), and the caps CSV (also asserted to
  have actually loaded into the engine). The web-test figure moved out of the
  landing band into README, where it is pinned as a lower bound on test
  declarations — the direction the drift actually went. Mutation-checked: putting
  `110/110` and `94` back fails the suite.

### Verified after this pass
`ruff` clean · **362/362** pytest · **147/147** Python parity · eslint + `tsc`
clean · **216/216** bun tests across 10 files (633 assertions) · **147/147** TS
parity · 18/18 selftest + 3/3 copilot gates · production build. README's
"what is measured (not claimed)" table and the `Makefile` help text updated to
these numbers (the Makefile no longer quotes a corpus count at all — it drifts
every version bump).

## [Unreleased] - frontend transformation pass

### Added
- SEO layer: canonical, Open Graph + generated 1200×630 card
  (`opengraph-image`), twitter card, `robots.txt`, `sitemap.xml`, PWA
  `manifest`, file-convention icon, theme-color viewport.
- Editorial landing: numbered sections (01–04), asymmetric 5/7 gap grid,
  loop-as-index rows, new "The proof" evidence band, three-column footer
  with engine metadata.
- Header extracted to `site-header.tsx` with IntersectionObserver
  active-section nav and underline micro-interaction (`aria-current` for AT).
- Scroll-reveal (`scroll-reveal.tsx` + `html.js .vy-reveal`): below-fold
  sections animate when seen; visible by default without JS; collapsed under
  `prefers-reduced-motion`.
- Branded `error.tsx` (retry + digest) and `not-found.tsx`.
- Motion tokens (`--vy-duration-*`, `--vy-ease-out`) and display-scale utility
  (`vy-display`), fluid via `clamp()`.

### Changed
- A11y gate stabilized: scans run under `reducedMotion: "reduce"` (axe
  snapshots mid-fade elements; the reduced-motion experience is the scan
  target). One strict-mode assertion updated for the footer's positioning
  line (`.first()`, existing suite pattern).
- Bundle: first-load JS 655.6 kB / 12 chunks (+0.8 kB vs 654.8 kB baseline);
  zero new dependencies.

### Design audit pass (hallmark disciplines, all verified by gates)
- **One orchestrated entrance, not scroll-reveals everywhere.** The
  below-fold scroll-reveal wrapper (`scroll-reveal.tsx` + `html.js .vy-reveal`)
  was removed — "every section fades in on intersection; the page never
  settles" is a named AI-design tell. The hero keeps its staggered fade-up;
  everything below is simply present. The `html.js` bootstrap and
  `suppressHydrationWarning` left `layout.tsx` with it. Reduced-motion CSS
  guard unchanged.
- **Roman display type** (gate 38a): the italic emphasis words in the hero
  h1 and the italic loop-step numerals are gone; emphasis carries through
  weight and the clay accent instead.
- **Vertical section heads** (gate 54): the tag-left/header-right
  two-column head (number beside the heading) is replaced by a one-column
  stack — number → eyebrow → heading.
- **Dark-band token discipline** (gate 48): the inline `oklch(...)` literals
  in the law section moved into named tokens (`--vy-mint`, `--vy-dark-ink`,
  `--vy-dark-ink-soft`, `--vy-panel`, `--vy-panel-border`,
  `--vy-clay-bright`); the axe contrast gate covers the same values.
- **Landing metrics fetched once**: the page shell owns the single
  `/api/metrics` request and passes it to the landing; the duplicate fetch
  inside the landing component is gone.
- Verified after the pass: eslint + tsc clean, 18/18 selftest, 94/94
  integration tests (since grown to 216 with the interval-, dose-cap law and
  claim-gate suites — see the safety-law closure pass above), production build, **17/17
  Playwright journeys incl. 3
  axe scans**; chunk total unchanged (812 kB, within measurement noise).

## [0.8.0] - 2026-09-12 - regimen escalation ships in the product tier + strict CSP + a11y gate

The E-H/E-G research mechanisms become product behavior, and two P2 debt
items close with evidence.

### Added
- **Longitudinal regimen escalation (product tier, TD-12/14).**
  `apps/web/src/lib/safety/regimen.ts` ports the Python regimen plane 1:1:
  identity distributions over formulary confusion neighbourhoods, pruned
  world enumeration, verdict-mass + fragility, and the could-hide-harm guard.
  `src/lib/regimen-state.ts` composes the ACTIVE `TherapyPlan` rows
  server-side (never caller-supplied). Verify and queue-resolve apply the
  escalation through one shared function; a composed harm (e.g. a triple
  whammy assembled across two visits) escalates the published verdict, a
  fragile read queues (fieldIndex 0 in the persisted confirm queue), a
  same-brand refill passes, and a human acceptance releases the plan (the
  E-G reviewed arm). The verify UI renders the regimen screen (composed
  verdict, nominal/worst, fragility, worlds, crossing findings with
  read-mass); the Review console presents the escalation row with
  accept/residual-uncertainty semantics.
- **Nonce-based CSP (TD-2).** Middleware mints a per-request nonce and serves
  `script-src 'self' 'nonce-…' 'strict-dynamic'` on document routes — no more
  `'unsafe-inline'` for scripts. `layout.tsx` opts into dynamic rendering so
  Next stamps every runtime script (verified 11/11 in served HTML). The
  standalone launcher anchors relative `file:` DATABASE_URLs (a live boot
  path 500, found and fixed during verification).
- **axe-core accessibility gate (TD-4).** `e2e/accessibility.spec.ts` scans
  the landing page, workspace and Evidence tab (wcag2a/2aa/21a/21aa) inside
  `make web-e2e`; serious/critical violations fail the build. First run
  caught 3 real contrast violations + 1 non-focusable scroll region — all
  fixed (eyebrow token darkened, clay CTA darkened to ≥4.5:1 with white
  text, Rx watermark retinted + aria-hidden, evidence tables keyboard-
  scrollable).
- 22 new tests: 18 regimen unit tests + 4 route-level escalation tests;
  4 middleware CSP contract tests. Web integration suite now 90 tests;
  E2E suite now 17 journeys.

### Changed
- Enter animation curve is ease-out (`cubic-bezier(0.22,1,0.36,1)`);
  `prefers-reduced-motion` now collapses ALL animation/transition durations
  universally instead of per-class selectors.
- `Prescription.regimenJson` persists the regimen screen provenance with
  every verdict (schema pushed in place).
- Landing "The law" section: the eyebrow color override actually applies
  (inline `oklch` used Tailwind underscore syntax — invalid CSS in a style
  attribute; found by the axe gate).

### Fixed
- Product E2E strict-mode collisions after the regimen panel repeated
  finding/source text (`.first()` added).
- Standalone launcher: relative `DATABASE_URL` now resolves against
  `prisma/` as the schema intends.

## [0.7.0] - 2026-09-11 - longitudinal regimen plane (mechanisms A+B)

Extends the two-plane law from one prescription to the patient's time-composed
regimen, and makes the gate operate on the *verdict* as well as the field.

### Added
- **`apps/api/app/safety/regimen.py`** — mechanism A (compose the active regimen
  and screen the union, tagging findings that cross the composition boundary)
  and mechanism B (per-field identity-mass propagation over a derived confusion
  neighbourhood, exact enumeration to a verdict distribution, and a
  fragility-to-queue coupling that fires only when read uncertainty could *hide*
  harm). Deterministic, zero-network; reuses the existing rule plane unchanged.
- **`data/corpus/regimen.jsonl`** — 113-case cross-prescription corpus,
  constructed by intent and verified against *both* planes (kept only when the
  incumbent returns `pass` and the regimen plane catches it).
- **`ml/regimen.py`** + **`tools/build_regimen_corpus.py`** — the evaluation
  harness (arms `single_rx` / `regimen` / `regimen+propagation`) and the corpus
  builder.
- **Experiment E-H** in `tools/run_experiments.py`, wired into the evidence
  export, the patent binder, the Makefile (`make regimen-corpus`) and CI.
- **`apps/api/tests/test_regimen.py`** — 12 tests: cross-prescription catch,
  the fragility queue and its ablation, preserved refusal/queue semantics,
  determinism and distribution normalisation.

### Measured (E-H, n=113, 66 cross-prescription)
- incumbent single-prescription law: unsafe pass on harm 0.832, cross-prescription
  catch **0.000**;
- regimen composition (A): 0.000 unsafe, cross catch 0.949, no added queue;
- regimen + propagation (A+B): 0.000 unsafe, cross catch **1.000**, queue 0.035.

### Documentation
- `docs/patent/` extended: invention disclosure §10, second independent claim
  concept, dependent claims D13-D15, normative pseudocode §10, prior-art rows
  and a differentiation section, and the E-H protocol in `EXPERIMENTS.md`.
- `INVENTION_DISCLOSURE.md` §7 now records that the second mechanism was
  published by explicit project decision, and therefore becomes prior art.

### Known limit (filed, not hidden)
- The mechanism is implemented in the Python plane; the TypeScript mirror and a
  regimen-mode parity corpus are the next step (TD-12). The fragile stratum is
  small (4 cases) because the demo formulary contains few look-alike pairs.

## [0.6.0] - 2026-09-11 - patent-readiness evidence spine (MED-001..MED-028)

Turns the engineering into *reproducible* evidence. The organising law: no
number is quoted anywhere without an archived run manifest behind it.

### Added — evidence spine
- **`ml/`** research package: corpus loader/splits/strata, the A0-A4 baseline
  ladder + A4 ablations, calibration (ECE / Brier / reliability curves /
  threshold sweep / operating-point selection), the corruption+injection+
  confusable+replay robustness suite, the HITL simulation, sha256 dataset
  manifests and the run-manifest writer.
- **`tools/run_experiments.py`** — one command runs E-A..E-G and archives
  `eval/runs/<id>/{manifest,metrics,cases}` (config, dataset SHAs, engine
  commit, environment). Writes `eval/results/RESULTS.md`.
- **`tools/build_binder.py`** (MED-020) — compiles the run archive into
  `docs/patent/EVIDENCE_BINDER.md` + `eval/results/binder.json`, including the
  negative results.
- **`tools/export_evidence.py`** (MED-013) — compiles the archive into the
  Evidence-tab artifact, labelled with its snapshot/commit and honest limits.
- **`tools/import_snapshot.py`** (MED-027) — governed knowledge-snapshot
  import: schema validation, sha256, diff report, explicit `--apply`.
- **`data/corpus/`** (MED-005/006) — 300-case adjudicated corpus with a
  70/15/15 stratified split, annotation codebook and sha256 manifest.

### Added — product surfaces
- **Pharmacist review console** (MED-012) — a Review tab over the persisted
  confirm queue: band/fused/why per queued field, confirm/correct/reject with
  actor + reason, per-prescription audit trail, and the plan-block state.
- **Evidence tab v2** (MED-013/014) — renders the archived baseline ladder,
  ablations, calibration reliability curve, frozen operating point, parity and
  latency, with run provenance and explicit honesty notes. Verify now shows the
  band, fused score and why-queued explanation per queued field.
- **FHIR R4 export mapping** (MED-028) — `GET /prescriptions/{id}/fhir` returns
  a MedicationRequest collection Bundle **only for verified prescriptions**; a
  queued or refused prescription exports 409, because an unverified read must
  never be laundered into a clinical record.
- **Consent-artifact stub** (MED-025) — ABDM-vocabulary consent records
  (pseudonymous ref only, expiring, fail-closed on revoke/expiry). Explicitly a
  stub, not a live ABDM gateway.
- **Multilingual NLG coverage tests** (MED-026) — the slot-traceability law is
  now asserted across en/ta/hi, including “no unformatted placeholder survives”.

### Added — documentation
- **`docs/patent/`** — invention disclosure (MED-021), claim-concept pack +
  strength matrix (MED-022), normative pseudocode of the gate/fusion/precedence/
  queue laws, experiment protocol + results, prior-art matrix, and the generated
  binder.
- **Disclosure pause** (MED-001) in `CONTRIBUTING.md` + `docs/patent/README.md`:
  the repository is public, so post-push mechanism detail is a public disclosure.

### Changed — cross-engine parity (MED-015)
- The golden corpus moved from a 25-case in-code copy per language to **one
  shared, versioned file** (`eval/parity/golden.json`), expanded to **110 cases**;
  both planes read the identical bytes, so corpus drift is impossible by
  construction.
- **Three real drifts found and fixed by the expansion:** the TS formulary mapped
  `Hydroquin 200` to hydrochlorothiazide where the source-of-truth CSV says
  hydroxychloroquine (so a QT/pairwise rule silently did not fire on that tier);
  three formulary rows (`Zental`, `Monocef 1g`, `Digoxin Tab`) and three
  contraindication rows present in the Python data were missing from the TS
  dataset.

### Fixed
- `ml.manifest.git_sha()` passed `--short` without a revision, so every run
  manifest recorded `engine_git_sha: "unknown"`.
- The E-C corruption ladder no longer perturbs perception confidence when
  injecting instruction text: labels are confidence-derived, so moving
  confidence invalidated the label. Boundary sensitivity is instead measured and
  reported as its own diagnostic (`confidence_boundary_sensitivity`).
- `ml.hitl` raw arm reported 0 coverage while auto-accepting everything, and the
  acceptance test used `>` where equality was the honest comparison.

### Verified (this tree)
API: **179/179 pytest**, ruff clean, eval + eval regression gate, parity
110/110 both engines, demo-check PASS. Web: eslint + tsc clean, 18/18 selftest,
110/110 parity, 68/68 integration tests, production build, **14/14 Playwright**.
Experiments: E-A..E-G archived with manifests; E-A A4 agreement 1.000 / unsafe
0.000 on the frozen test split vs A1 0.705 / 0.295.

## [0.5.0] - 2026-09-11 - observability + property-based safety proofs

Two engineering-depth additions, both dependency-free and both *proven* by
tests rather than claimed:

### Added
- **Observability stack (API tier, zero deps)** — `app/obs.py`:
  · structured JSON-lines logging (one machine-parseable object per request:
  ts/level/route/method/status/latency_ms/request_id; unwhitelisted fields
  can never leak into the stream),
  · `GET /slo` — per-endpoint p50/p95/p99/max from bounded per-route rings
  (512 obs each; memory O(routes), never O(traffic)),
  · `GET /metrics.prometheus` — Prometheus/OpenMetrics text exposition of the
  existing counters + latency summary with correct HELP/TYPE and label
  escaping. Pinned by 8 tests: format parses, counts match /metrics, labels
  escape correctly.
- **Property-based safety proofs (hypothesis)** — `tests/test_properties.py`:
  ~900 generated prescriptions must uphold the five product invariants:
  P1 totality (never crash; verdict stays in the shared vocabulary),
  P2 gate integrity (low-confidence fields are queued and never feed
  findings), P3 symmetry (screen(a,b) ≡ screen(b,a)), P4 dose caps (the
  aggregate paracetamol cap fires iff the summed daily mg exceeds it —
  combination molecules like Combiflam legitimately trip other molecules'
  caps), P5 monotonicity (raising perception confidence can never produce a
  refusal). The deterministic core is the right place for property testing:
  a single counterexample is a real bug class, not a flake.
- **Retry/backoff on the live vision call** — exponential backoff between
  attempts (0.5s → 1s → …, env-capped), attempt count env-tunable; pinned by
  two deterministic tests (fake transport): backoff schedule is exactly
  [0.5, 1.0] for 3 attempts, and a transient failure recovers on attempt 2.
- **Circuit breaker for the copilot (web tier)** — `lib/ai/breaker.ts`: after
  3 consecutive model failures the breaker opens; queries fail fast and
  honestly (`service_unavailable`) instead of paying the network timeout;
  after a 30 s cooldown the next call probes (half-open) and recovery is
  automatic. Clock-injected so the state machine is walked deterministically
  (7 tests, no sleeps).
- **Web `/api/metrics`** now reports a live engine-plane latency measurement.

### Changed
- CI test step renamed to include properties + observability;
  `hypothesis` pinned in `constraints.txt` and `apps/api[dev]`.

### Verified (this tree)
API: 125/125 pytest (was 112), ruff clean, eval gate, parity 25/25 both
engines. Web: tsc/eslint clean, 48/48 integration tests (was 41), build,
12/12 Playwright.

## [0.4.1] - 2026-09-11 - container stack fixed and verified live end-to-end

The Docker path was asserted, never executed. Built both images, booted the
compose stack on a clean volume, and drove every check below through the
published ports. Four real defects found and fixed:

### Fixed
- **web image could not build** — the build stage ran `next build` under
  bun 1.2, whose unimplemented worker_threads options and CommonJS loader
  break the Next 16 production build inside a container (it passed on the
  host only because `bun run` shells out to node). Build now runs on
  `node:22-slim`; bun still owns installs (`bun.lock`).
- **web container could not start** — the runner was `oven/bun` calling
  `node server.js` (no node in the image). Runner is now `node:22-slim`, and
  `HOSTNAME=0.0.0.0` is pinned (Docker's container-id HOSTNAME made the
  standalone server die with `EAI_AGAIN`).
- **api container exited at import** — the Dockerfile never copied the
  repo-root `data/` corpus, so `SafetyEngine.load()` raised
  FileNotFoundError on `/srv/data/brands.csv`. Corpus is now baked in.
- **web DB was read-only at runtime** — Prisma needs a detectable OpenSSL on
  slim images (installed), and the MS-05 removal of the boot-time push
  requires an operator one-shot: a profile-gated `schema` compose service
  (uid 10001, shared with the runner) applies the schema deliberately.

### Verified (clean volume, published ports)
web: warfarin+aspirin -> interaction; triple whammy -> interaction; garbage
-> confirm_queue; seed OK; evidence selftest 18/18 in-container;
cross-origin write -> 403. api: RX-002 -> interaction; /healthz + /readyz
ok; judge route default-closed (403). Both containers healthy, non-root.

Also: demo-check no longer pulls `make parity` (which needs bun) in the
python-only CI job — `parity-py` is the API-tier gate (CI green on master).

## [0.4.0] - 2026-09-11 - audit hardening pass: parity contract, safe defaults, privacy switch

Third audit pass. Every item below is pinned by a test and verified green in
this tree (112/112 pytest · eval gate · parity 25/25 both engines · eslint +
tsc · 18/18 selftest · 41/41 web tests · build · 12/12 Playwright).

### Added
- **Cross-engine parity gate (ADR-0012)** — `eval/parity/parity.{py,ts}`: a
  25-case golden corpus (pass / interaction / contraindication / duplicate /
  confirm_queue / refused) run through BOTH safety planes; any disagreement
  blocks the merge (`make parity`, pytest `test_parity.py`, `bun run parity`,
  CI). Closes the two-plane drift risk (R-7/TD-D).
- **Eval regression gate (ADR-0013)** — `eval/regression_gate.py` + committed
  `eval/baseline.json`: CI benchmark now FAILS on severity/recall drift
  instead of printing a table. Floors: brand recall 0.95, verdict agreement
  1.00, refusal precision 1.00.
- **Privacy kill switch (Ch.12)** — `MEDISAATHI_DISABLE_MODEL_EGRESS=1`
  hard-disables every outbound model call on both tiers (extraction, copilot,
  live vision); the deterministic plane runs at full strength with zero
  third-party transmission. Pinned by tests in both tiers.
- **Combination graph rules ported to the Python plane (ADR-0012)** — triple
  whammy, QT stacks, serotonin stacks, bleeding stack now fire in
  `apps/api/app/safety/engine.py`, mirrored 1:1 from the TS plane; parity
  corpus P16/P17/P23 pins them across engines.
- **`MEDISAATHI_ENV` + `MEDISAATHI_ADMIN_TOKEN`** — `POST /api/seed
  {force:true}` (destructive demo reset) is deny-by-default outside
  development: 403 unless a constant-time-compared admin token is presented;
  an empty token never unlocks it (MS-03).
- **Pinned CI installs (MS-11)** — `constraints.txt`; both pip installs run
  `-c constraints.txt`; `bun audit --audit-level=high` added to the web job
  (with the one documented dev-only exception).
- **Citation contract for the grounded copilot (TD-G)** — `validateCitations()`:
  a grounded answer MUST carry inline `[n]` citations, all within the
  retrieved range; violations demote to refusal. The dosage post-check regex
  is exported and unit-tested (`DOSAGE_POSTCHECK`).
- **Named confidence formula (TD-F)** — `overallConfidence()` in the safety
  plane with documented 0.4/0.6 weighting and boundary tests; the verify route
  no longer carries an inline magic-weight expression.

### Security
- **Judge route default CLOSED (MS-08)** — `MEDISAATHI_JUDGE_OPEN` now
  defaults to `0` (403); demo laptops opt in explicitly. Regression test pins
  the forgotten-env case.
- **Web rate-limit key law (MS-02)** — without a trusted proxy the limiter
  uses a shared `anon` bucket; `x-real-ip` (client-supplied) is never
  trusted, so callers cannot mint fresh buckets per request.
- **Same-origin mutation check (MS-10)** — cross-origin writes are rejected
  at middleware with 403 before any handler runs (defense in depth; pinned by
  the middleware security contract tests).
- **System-prompt role (MS-09)** — system instructions travel as role
  `system`, not `assistant`, in every model call (extraction, copilot, rubric
  judge): instruction hierarchy matters for gates 1–2.
- **Containers run non-root (MS-06)** — both Dockerfiles add a dedicated
  `medisaathi` user; the web image's SQLite dir is 0750; the boot-time
  `prisma db push --accept-data-loss` was REMOVED from the web CMD (MS-05):
  schema is applied deliberately by the operator, never silently at start.
- **Short-brand matcher hardening** — sub-4-char brand cores ("Pan 40")
  match only as full brand tokens; parity case P03 pins the law in both
  engines.

### Fixed
- **Offline-tier confirm/refuse boundary** — the TS gate's all-refused band
  consumed formulary `brandConfidence` when no LLM ran, REFUSING garbage that
  the Python law (and decision B9) queues for human confirmation. The
  refusal band now consumes perception confidence only — exactly mirroring
  `apps/api/app/verdict.py` (gate 2). Found by the E2E confirm-queue and
  prompt-injection journeys failing; parity + selftest + E2E all pin it.
- **Plan-start atomicity (TD-E)** — archive-old-plan → create-plan →
  medications → doses now runs in ONE interactive transaction; a mid-loop
  failure no longer leaves a partially scheduled plan.
- **Judge test isolation** — judge-path tests opt in via `monkeypatch` so
  each file is self-contained under the new closed-by-default flag.
- **Corpus sync** — brands/interactions CSVs extended for cross-tier parity
  (warfarin+cotrimoxazole, metformin+furosemide, PDE5+nitrate, lithium and
  statin stacks, …); TS dataset adds Warfone 5 / Cotrimoxazole DS.

### Verified (this tree, this environment)
- API: **112/112 pytest** (incl. parity gate + egress switch + judge default),
  eval gate at floors (brand recall 1.00 · frequency recall 0.9444 · verdict
  agreement 1.00 · refusal precision 1.00), ablation, demo-check, ruff clean,
  bench p50 ~13 ms.
- Web: eslint + tsc clean, 18/18 self-test + 3/3 copilot gates, **TS parity
  25/25**, **41/41 integration tests**, production build, **12/12 Playwright
  journeys**.

## [0.3.2] - 2026-09-10 - integration pass: security + E2E lines united

Unifies the two parallel hardening passes (the 0.3.1 security line and the
uncommitted E2E line) into one tree:

### Added
- **Browser E2E (TD-3 resolution, now merged)** — `apps/web/e2e/product.spec.ts`:
  12 Playwright journeys on the deterministic tier, wired into `make web-e2e`
  and a dedicated CI job.
- **JSON body cap (TD-9 resolution, now merged)** — `apps/api/app/bounded_body.py`:
  1 MiB cap on every non-multipart request (413 envelope; declared
  Content-Length fast path + streaming receive counter), pinned by 3 red-team
  tests. `MEDISAATHI_MAX_BODY_BYTES` documented in `.env.example` and
  docs/DEPLOYMENT.md.
- **CI union** — secret scan, ruff, pip-audit, eval + ablation + demo-check,
  eslint, integration tests, and the Playwright job in one workflow; push
  trigger now covers the actual default branch (`master`).

### Fixed
- **Fresh-install typecheck/build breakage (CI-caught)** — `tailwind.config.ts`
  still imported `tailwindcss-animate`, which the 0.3.1 dependency prune had
  removed; a stale local `node_modules` masked it locally while CI's frozen
  install failed. The file was dead scaffold code (Tailwind v4 config is
  CSS-first via `@theme inline` in globals.css; nothing referenced it, and the
  one animate-utility consumer, the toaster, is served by the already-imported
  `tw-animate-css`). Deleted; verified by a full clean-install gate.
- **Web middleware rate limiter shared one window across read AND write
  requests** — the Python tier keeps separate `_WRITES`/`_READS` limiters, but
  the TS port keyed one bucket per client, so ~60 combined API calls a minute
  (browser journeys issue many reads) 429'd the next write. Found by the E2E
  dose-guardrail journey failing with HTTP 429; windows are now per
  (class, client), mirroring the FastAPI tier. Pinned by the E2E suite
  (12/12) which fails-first on the old behavior.
- **Makefile recipe indentation** — recipes used spaces, so every target
  failed with "missing separator"; restored tabs and verified `make -n` plus a
  full `make web-check` run.
- docker-compose: added the missing web healthcheck (the API service already
  had one); closes the reliability-audit gap noted in the engineering report.
- Copilot outage kind (`service_unavailable`) now has its own UI badge instead
  of masquerading as a low-confidence refusal (RES-12).
- Eval case E07 replaced with a below-floor BM25 probe so the low-confidence
  refusal fires deterministically (RES-13).

### Verified (this tree, this environment)
- API: **107/107 pytest**, eval (recall 1.00 / agreement 1.00 / refusal
  precision 1.00), ablation, demo-check, ruff clean.
- Web (verified twice: stale install **and** a from-scratch
  `bun install --frozen-lockfile`): eslint + tsc clean, 18/18 self-test, 3/3
  copilot gates, 14/14 integration tests, production build, **12/12
  Playwright journeys**. Install surface after the prune + E2E tooling:
  170 product packages, ~420 with dev tooling.

## [0.3.1] - 2026-09-10 - red-team hardening, web test suite, dependency discipline

### Security (all confirmed findings from a second-pass red-team, each pinned by tests)
- **Path traversal in the fixture loader (CWE-22, HIGH)** — `sample_id` was
  joined into a path with no containment check, so
  `sample_id=../../../../../apps/web/tsconfig` read arbitrary `.json` files
  outside the fixture directory. Fixed with a character allow-list plus a
  realpath containment check; blocked ids now return a clean 404 that does
  not echo the attacker-controlled input back. (`test_redteam.py::test_fixture_traversal_*`)
- **Rate-limit bypass via X-Forwarded-For (MEDIUM)** — the API limiter trusted
  a client-supplied XFF unconditionally; rotating the header minted a fresh
  bucket per request. XFF is now honored only behind
  `MEDISAATHI_TRUST_PROXY=1`. (`test_xff_rotation_cannot_mint_fresh_buckets`)
- **Limiter DoS via key flooding (LOW)** — the 10k-key guard cleared ALL
  buckets, so spraying junk keys reset every client's budget. Eviction is now
  approx-LRU (oldest keys evicted, active budgets preserved).
  (`test_limiter_eviction_never_flushes_active_buckets`)
- **Web tier got the API tier's middleware contract**: request-ID correlation +
  per-client sliding-window rate limits on `/api/*` (bounded-memory, LRU
  eviction, same 429 envelope).
- **Caregiver join codes** now come from a CSPRNG (`crypto.getRandomValues`),
  not `Math.random()`; `eventId` inputs are shape-validated before any lookup;
  `caregiverName` length-capped.
- **Store**: per-thread SQLite connections (the shared cross-thread connection
  allowed read/write interleaving on one connection object) + `busy_timeout`.

### Added
- **Web integration test suite** (`bun run test`, 14 tests): route handlers
  exercised end-to-end over an isolated SQLite with the perception layer
  sealed — verify verdicts, plan lifecycle, double-dose guardrail replay,
  family-code shape, metrics. No model keys needed.
- **Web quality gates**: eslint in CI; `make web-check` now runs
  lint + typecheck + selftest + integration tests + build.
- **CI hardening**: least-privilege `permissions`, concurrency cancellation,
  secret scanning (gitleaks), Python lint (ruff), dependency audit (pip-audit),
  PR dependency review.
- **Brand assets**: typographic social-preview/OG image (no stock photos).
- **Accessibility**: skip-to-content link, `aria-live` verdict region,
  `:focus-visible` ring, staggered landing entrance honoring
  `prefers-reduced-motion`.

### Changed
- **Dependency discipline**: web package pruned 827 → 170 installed packages;
  45 unused shadcn/ui components and ~35 unused runtime deps removed
  (dnd-kit, mdxeditor, react-query, next-auth, next-intl, framer-motion,
  sharp, zustand, uuid, date-fns, ...). Package renamed
  `nextjs_tailwind_shadcn_ts` → `medisaathi-web`.
- Stale-response race fixed in Today/Family panels (cancelled-fetch pattern);
  dose actions no longer flash the loading skeleton.
- Python tier: 76 ruff findings resolved (import hygiene, exception chaining
  with `from e`, dead code); `ruff check` added as a CI gate.

### Verified
- API: 104/104 pytest · eval benchmark · ablation · demo-check · bench.
- Web: typecheck · eslint · 18/18 selftest · 14/14 integration · build.

## [0.3.0] - 2026-09-10 - the closed-loop product app

### Added
- **Product app integrated into `apps/web`** (from `vaidya-project.zip`):
  self-contained Next.js 16 fullstack app closing the loop
  verify → schedule → adhere → protect → explain → measure. Deterministic
  TypeScript safety plane (94 brands · 79 interaction rules · 34
  contraindication rules · combination graph rules · aggregate dose caps),
  adherence engine (MPR, streaks, 14-day heatmap), family escalation feed,
  three-gate grounded copilot with citations, 18-case in-app engine
  self-test and 10-case copilot eval, Prisma/SQLite longitudinal schema.
- **Web gates in CI**: bun install, prisma generate, typecheck, 18-case
  engine selftest + copilot gates, production build.
- `scripts/selftest.ts` — deterministic verification gate for the web tier.
- `scripts/start-standalone.mjs` — cwd-independent standalone boot
  (Prisma SQLite path resolution).
- Dockerfile + compose updates for the bun-based web container.

### Fixed
- **Degraded-tier confidence**: the no-LLM fallback queued everything at a
  flat 70%, so the safety plane never demonstrated offline. The plane now
  uses its own formulary-grounded brand-match confidence — warfarin+aspirin,
  triple whammy and contraindication verdicts all fire without any model.
- **Double-dose guardrail**: a second `taken` action silently overwrote the
  log; dose accounting is now first-action-wins (`already_acted` refusal).
- **Guardrail persistence**: the catch-up guardrail claimed a protected skip
  without writing it; the skip is now persisted.
- **Context provenance**: prescriptions store the declared contexts
  (`contextsJson`); plan-start re-screening re-applies them instead of
  silently dropping contraindication checks.
- **Copilot scope gate**: "can I stop taking my medicines" now refuses
  deterministically (patterns added, gate test covers it).

## [0.2.0] - 2026-09-10 - the completed build

### Fixed
- **Parser regression**: extraction regexes in `app/vision.py` used doubled
  backslashes inside raw strings, making dose/frequency/duration parsing a
  silent no-op. Fixed, plus parsing contract tests (`tests/test_vision.py`)
  so it cannot ship silently again.
- Data: "Jan Aushadri" typo, CRLF line endings, duplicate interaction pair,
  orphan molecules that could never normalize (tizanidine, calcium carbonate,
  codeine...), contraindication coverage.

### Added
- Live vision path: OpenAI-compatible schema-constrained call (Gemini/OpenAI/
  Ollama/vLLM), temperature 0, one retry, honest refusals; multipart upload
  endpoint with key-gating (503 without key, 413 over 12 MB, 422 empty).
- Dose-plausibility plane: per-line daily-dose caps, aggregate cross-brand
  caps (two sub-cap paracetamol brands summing over), bizarre-frequency
  detection, long-course review notes - deterministic warnings that ride with
  the report without touching the verdict law.
- SQLite WAL store (thread-safe, restart-safe) replacing the in-memory dict.
- Formulary autocomplete endpoint (`GET /formulary/search`), wired into the
  confirm-queue UI.
- Price savings math: generic brand, per-row and total savings vs Jan Aushadhi.
- NLG per-sentence `AudioSegment`s with slot_refs; web TTS with highlight-
  while-speaking in en/ta/hi.
- Eval v2: frequency recall, latency p50/max, `--ablation A1` raw-read
  counterfactual (A4 verdict agreement 1.00 vs A1 0.17 on the fixture set).
- Judge cache baker (`make bake-judge`) + baked zero-network tier.
- Frontend: full scan flow (samples, camera, upload, context chips), per-field
  confidence UI, confirm queue with autocomplete, interaction/dose cards,
  price table, provenance drawer, ADR form, high-contrast mode, skip link.
- Docker: api + web Dockerfiles, compose with data volume; CI split into
  api/web jobs enforcing all gates.

## [0.1.0] - 2026-08-18 - the scaffold

- Two-plane pipeline (fixture tier), safety engine, verdict gate, NLG,
  12 sealed cases, eval CLI, judge route, Next.js scaffold, docs skeleton.
