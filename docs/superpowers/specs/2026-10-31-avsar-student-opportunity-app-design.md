# Avsar — a source-verified opportunity radar for Indian students

**Status: proposal, awaiting approval. No code has been written for this product.**
Filed 2026-10-31 under `superpowers:brainstorming` (architectural path). Approval of this
document is the gate for scaffolding; nothing below is a commitment until it is approved.

## 0. The brief, as constraints

The request was: a new student-facing app under a distinctive name, built from the business
model, 100% working on real things with no demo data, easy to use, with an in-app tour so
students know where everything is, demo videos made with `/brag` so they understand how it
works, push updates so they never miss an opportunity, and a Play Store release.

Converted into testable constraints:

| # | Constraint | What it forces |
|---|---|---|
| C1 | real data only, nothing demo | every opportunity row must carry a verifiable official source, or be shown as unverified |
| C2 | easy to use, navigable | finite section set + guided tour + every section reachable without the tour |
| C3 | updates so nothing is missed | scheduled source re-reads, deadline countdowns, and delta alerts — not just APK releases |
| C4 | Play Store | a signing key, a developer account, a privacy policy, and a Data Safety declaration — all supplied by the operator, not invented here |
| C5 | different name | a mark that is not "Saathi", which is a common word and already carries MediSaathi |
| C6 | standing project gate | the provisional filing gates public disclosure; a Play Store **production** listing is public disclosure |

## 1. What transfers from the MediSaathi business model

`docs/BUSINESS_MODEL.md` lands on: *sell verification provenance to the parties who already
earn money when a chronic patient refills, and give the patient app away.* The student
market has the same shape, and the same trap.

- **The user is not the payer.** The file cites Medisafe's 2026-01-01 move to US$39.99/yr as
  evidence that a consumer paywall in a safety-/money-adjacent utility costs you the network
  you were going to monetise. Students are the least monetisable constituency in this
  category and the most important one to hold.
- **Someone else already earns on the outcome.** When a student enrols, applies, or gets
  shortlisted, coaching institutes, universities, education-lending desks and employer
  campus-hiring programmes each earn. That is the payer, exactly as the pharmacy is the payer
  in the MediSaathi thesis.
- **The incumbent weakness is the same one.** The category is already served
  ([Scholarship Exam Info & Alerts on Play](https://play.google.com/store/apps/details?id=com.examtest.scholarship),
  [EasyShiksha Govt Job Alerts](https://apps.apple.com/in/app/govt-job-alerts-easyshiksha/id6751952231))
  by apps whose product is an unverified scraped list monetised as traffic. Their students
  miss deadlines because the list was wrong. Verification is the differentiation, and
  verification is the one thing this repo already knows how to build.

**Payer order** (mirrors `BUSINESS_MODEL.md` §2): universities and coaching institutes first
(they earn per admitted student, so a verified application-intent signal has a price), then
employer/skill programmes, then education-finance partners. Students free, permanently.

## 2. Name

Proposed: **Avsar** (अवसर, "opportunity / the right moment"). Reasons: it is the product's
whole subject; it is not a generic English marketing word, so it can be owned; it is short,
pronounceable in every Indian language the target user speaks, and typeable on a basic phone.

Measured, not assumed:

- `Mauka` — rejected. It is the advertising word of the entire category ("*Apply karo,
  mauka gaya*", HSBC's "*Har Sapna Ek Mauka Deserve Karta Hai*", IDFC's Elevate reel) — a
  descriptor, effectively unprotectable.
- `Pukka` — semantically the best fit (genuine, verified) and rejected on collision
  evidence: Unilever sells **Pukka** tea, **Pukka Pads** and **Pukka Entertainment** are
  registered marks. See [HUL annual report](https://www.hul.co.in/files/hul-integrated-annual-report-2024-25.pdf),
  [WTR on the tea portfolio](https://www.worldtrademarkreview.com/article/unilever-sells-tea-brands-5-billion-zeeger-vink-appointed-2022-inta-president-obs-project-and-streamlabs-dispute-news-digest).
- `Avsar` / `Sootra` — a search for this category returned no competing student-opportunity
  brand under either. **That is weak evidence, not clearance.** Before naming is final:
  Play Store search, Apple App Store search, `.in`/`.com` domain check, and an IP India
  class 9 / 41 / 42 search at [ipindia.gov.in](https://ipindia.gov.in/). The user picks the
  mark; I will not treat a web search as legal advice.

## 3. The load-bearing constraint: C1, real data, measured

I checked whether legitimately obtainable data exists before designing anything. It does, but
not in the form the brief implies, and the difference decides the architecture.

**What exists:**

- [data.gov.in](https://en.wikipedia.org/wiki/Data.gov.in) — ~230,000 datasets as of July 2026,
  [API access with a free key](https://puredevkit.com/api-guides/data-gov-in/) (server-side
  only), published under the Government Open Data License, India
  ([licence notes per dataset must be read](https://apify.com/themineworks/india-data-gov-scraper)).
  It is a statistical and administrative catalogue. It is **not** a live feed of "scholarship X
  closes on 31 October".
- [API Setu](https://apisetu.gov.in/) — the government's API marketplace. Its student-facing
  use case is [verification of educational records and income certificates for a scholarship
  application](https://docs.apisetu.gov.in/document-central/explore-apisetu/Use%20Cases.html)
  — i.e. *document validation*, onboarding-side, not opportunity discovery. Valuable later;
  useless for the feed.
- The primary sources themselves — [National Scholarship Portal](https://scholarships.gov.in/)
  (which states its own cadence: open for 2026-27 from 1 June 2026), [UPSC](https://upsc.gov.in/),
  SSC, NTA, AICTE, UGC, state directorates, myGov. These carry the truth. They publish HTML
  pages and notification PDFs; there is no public listings API at the front door.
- The tempting shortcuts, measured: the GitHub dataset advertising
  ["5,900+ Indian government exams for 2026 … updated daily"](https://github.com/karankofficial41-cell/india-govt-jobs-2026)
  is **sourced from bharatgovresult.com** — a third-party results/SEO site — with no licence
  file and no per-record official source URL. Same for the HF
  [`NetraVerse/indian-govt-scholarships`](https://huggingface.co/datasets/NetraVerse/indian-govt-scholarships)
  set: 10 PDFs, Apache-2.0 wrapper, no source-link field, deadlines buried inside free text.

**The finding that shapes the design:** the shortcut datasets are the DDInter problem in
`BUSINESS_MODEL.md` §1 wearing a different hat — a corpus that can *agree* with reality but
cannot *falsify* it, and which inherits an unlicensed scrape of a site that itself scraped the
government. Ingesting them would make C1 false the moment it was checked. So the answer to
"no demo, only real" is not a better dataset. It is an architecture:

> **Every opportunity is admitted only from an official primary source, and carries that
> source with it. Anything that cannot be re-read at the source is not presented as real.**

## 4. The verification model (this is the product)

Each `Opportunity` record stores, per field: source URL, fetch timestamp, fetched-document
content hash, the extracted value, a per-field extraction confidence, and a fused band. Bands
reuse the shape of the MediSaathi gating module (`docs/patent/CLAIMS.md` §1) with the
medication-specific parts replaced:

| Band | Condition | What the student sees |
|---|---|---|
| **Verified** | re-read at the official URL within the freshness window; eligibility + both dates extracted with confidence above threshold | green badge; tapping it shows source, timestamp, hash |
| **Partially verified** | the scheme exists at the source, but a needed field (deadline, eligibility) could not be extracted | amber badge, the missing field named, "tell us if this moved" |
| **Pointer** | seen only in a secondary source and not yet confirmed at any official URL | shown in a separate "unconfirmed" list, never in the main feed, never in a push |
| **Refused** | source returned changed/410/403, or the document no longer supports the record | the row is withdrawn and any future deadline push is cancelled, with a visible reason |

Non-negotiable rules, inherited from the same reasoning as the medication engine: a **Refused**
record never appears as real; a **Pointer** never generates an alert; and the app is allowed to
be *empty* for a profile with nothing verifiable, and says so, rather than filling the screen.
That is what makes C1 true instead of merely claimed. It is also the honest version of
"everything should be working" — the work is real, the numbers are real, and where the source
is unreadable the app admits it.

Delta detection is the second half of the moat and the direct answer to C3: re-read
notification → hash the document → if the deadline or eligibility moved, emit a
`changed` event and push it. A student who was told "31 October" and is now told "extended to
15 November, here is the page that says so" is the reason the app is trusted.

## 5. Product surface

Five sections, bottom nav, one line each on the home card. Deliberately finite, because C2
("easy to use") fails by accumulation.

1. **Radar** — opportunities matched to the student's profile (class/stream, institution,
   state, category, field of interest), sorted by closing-soonest. Verified only.
2. **Opportunity sheet** — plain-language eligibility ("who can apply" as sentences, not the
   notification's clauses), amount, both windows, a checklist of documents required, a
   countdown, and the source strip (band + URL + timestamp + hash).
3. **My track** — the student's own applications: saved → preparing → applied → result. This
   is the retention object and the thing a payer would eventually pay for a signal from.
4. **Alerts** — what fires: new match for my profile, T-30 / T-7 / T-2 deadline reminders,
   a deadline that moved, a result date announced. Each alert is one tap to the sheet.
5. **How it works** — the tour replay, the `/brag` videos, the verification explainer (how a
   band is decided), and the licence/attribution page that C-licensed data requires.

**Tour (C2):** first-run, 6 steps, one per screen region, skippable, replayable from
`How it works`, and drawn from the same component vocabulary as the existing WCAG 2.2 work in
this repo (focus management, announced step changes, 320px reflow, target size). Tour
coachmarks must never be the only route to a section.

**Demo videos (the `/brag` ask):** `/brag` builds a 15–25s launch video from the project code
using Hyperframes and explicitly needs **no live URL** — which is what lets it run under the
no-public-URL gate at all. Plan: three separate runs rather than one, so each explains a
section — *Radar*, *Alerts*, *My track* — plus one `--voice` narrated vertical cut for the
Play listing. Rendered artifacts land in the app's static assets and are linked from
`How it works`. Video count and tone are a taste decision to be reviewed after the first
render, not now.

## 6. Packaging: the fork the deployment gate decides

The repo already ships a service worker, icons and an installable manifest (task #26), so the
cheap Play Store route is a Trusted Web Activity via Bubblewrap. It is blocked by the standing
gate, and the reason is worth recording precisely:

- **TWA/Bubblewrap requires a publicly reachable, verified HTTPS origin** — digital asset
  links must be served from the app's own domain for the Play listing to open the web app
  without a URL bar. There is no private-test variant of that requirement. So option A turns
  the deployment gate's "no public URL until the filing" into a public URL.
- **A native shell does not.** Option B — [Capacitor](https://capacitorjs.com/) wrapping the
  existing Next.js UI as bundled assets, with FCM for push — ships an APK to an
  [internal testing track (≤100 invited testers, no public visibility)](https://fasttesters.com/blog/internal-testing-vs-production-release)
  with no public product page. The API host still has to be reachable from the phone; an
  unlisted endpoint is a much smaller disclosure than a listing, **but it is not zero**, and
  that is a call for the user, not for me.
- Play also needs a **public privacy-policy URL** regardless of track, and the Google support
  page on [new personal developer account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
  could not be read from here (the fetch returned only page chrome) — the exact tester count
  and day count for a first production release must be confirmed in the Console, not assumed.

**Recommendation: Option B.** It is the only path that satisfies C4 and C6 in the same
direction, and it is the one that makes C3 real — Web Push in a TWA is Chrome-dependent; FCM
in a native shell is what students' other apps already use.

Reuse, honestly scoped: the provenance/banding **pattern** and the container/CI discipline are
worth taking. The engine, formulary, rules, and DB are not — they are medication artefacts, and
the claims in `docs/patent/CLAIMS.md` are drafted medication-specific on purpose ("Everything
medication-specific becomes a dependent limitation"). Reusing the *mechanism* across domains is
precisely the disclosure risk the gate exists to manage, so §9 puts it in front of the user.

## 7. Delivery slices

Each slice ends at something measured, not something typed.

| Slice | Work | Exit criterion |
|---|---|---|
| 0 | name clearance pass + Play developer account facts + a decision on C6 | written answer to three questions; no code |
| 1 | **source audit** (task #36): adapters for ~10 named official sources | a measured per-source table — machine-readable? fetchable from a container? licence? per-record URL? refresh cadence? — and a Go/No-Go per source. Sources that fail are dropped in public |
| 2 | opportunity store + banding + provenance fields + the four-band test suite | a record cannot reach a "verified" state without a source URL, timestamp, hash and a passing re-read; refusal is tested, not asserted |
| 3 | crawler + delta detector on the Go sources | a real deadline change observed twice in the wild, or the mechanism declared unproven |
| 4 | the five screens + profile matching | a student with a real profile sees only real rows; empty state is a tested screen |
| 5 | push/notifications + alerts cadence | a device receives a deadline alert for a real, currently-open scheme |
| 6 | tour + `/brag` videos + Capacitor shell + Play internal track | an invited tester installs it on a real phone and completes the tour |

Slice 1 is the highest-value hour available. If it comes back thin, the honest product is
smaller than the brief, and it is better to know that than to build a demo and call it real.

## 8. What I am not claiming

- No user counts, no revenue, no conversion rates. The payer hypothesis in §1 is a thesis to
  test with an institution, not a forecast.
- §2's name is a proposal with a weak negative search behind it, not a cleared mark.
- §6's Play facts are sourced and partly unconfirmed; the tester-count requirement is explicitly
  marked as needing the Console.
- No data-source claim in §3 survives without slice 1. Existence of a licence is not evidence
  that a site is crawlable, and crawlability from a container is not evidence of permission.

## 9. Three things only the operator can decide, before slice 0 closes

1. **Does the provisional-filing gate bind this product too?** If reusing the provenance
   mechanism across domains is itself a disclosure, the Play *production* track waits for the
   filing and the internal track may not. The user's call, with counsel, not mine.
2. **Play developer account and signing key.** A one-time registration fee, an org-verified
   account for some app categories, and a signing key that must not be generated-and-forgotten
   by an agent. Provided by the user; I will not go looking for credentials in stored config.
   This holds for every key in the brief: keys come from the operator or the project's own
   documented config, never from extraction.
3. **Which slice is the deal-breaker if slice 1 comes back thin** — a smaller verified
   category (e.g. scholarships only, no exams), or a later launch. Deciding this now prevents
   the padding-with-demo-data failure the brief rules out.

## 10. Rejected alternatives, with the reason

- **Reposition Vaidya for students under a new name.** It is a medication-safety product with
  a clinical claim structure; "student" and "drug interaction screening" is a confused
  audience and a wider regulatory surface. Rejected on focus.
- **A study/exam-prep companion.** Crowded, and it does not use anything this repo is good at.
  Rejected on differentiation.
- **Ingest a ready aggregator dataset to hit "everything working" fast.** It would satisfy the
  demo and destroy C1, and it inherits an unlicensed scrape (§3). Rejected on the one
  constraint the brief was emphatic about.
- **TWA over the existing PWA.** Cheapest by far, blocked by the verified-public-origin
  requirement that the deployment gate forbids (§6).
