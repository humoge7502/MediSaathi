# Business model — who pays, for what, and what has to be true first

Written 2026-10-28 from public competitor pricing and from this repository's own
measurements. Every figure that is not measured *here* is labelled as an external price
point or an assumption to test, and no clinical-outcome claim is made anywhere in this
document (see §6 — the corpus has no external labels, TD-22).

**The decision in one line:** sell **verification provenance** to the people who already
earn money when a chronic patient refills, and give the patient app away. Reminders are
not the product — they are the reason the product gets opened.

---

## 1. The gate that comes before revenue: the data licence

Nothing in this document is reachable while the current interaction source is
non-commercial.

| Source in use today | Licence | Consequence |
|---|---|---|
| DDInter interaction rows | **CC-BY-NC-SA 4.0** | No commercial deployment of the engine as built. This is the binding constraint, not a footnote. |
| CredibleMeds (QT-prolongation class) | non-commercial terms | Needs a production licence before any paid use. |
| OpenFDA drug labels, RxNorm/Semon join, MedlinePlus | permissive / US-centric | The realistic replacement path, with a coverage cost (§2 of the audit's E-row). |
| Synthesised corpora (`data/cases.jsonl`, `regimen.jsonl`) | CC-BY-4.0 (ours) | Free to ship; they can agree with the engine but cannot falsify it (TD-22). |

**Cost of the swap is unknown and stays unknown until a quote comes back.** Wolters
Kluwer publishes no price for Medi-Span and First Databank sells enterprise access
quote-only; a self-serve competitor advertises a drug API "from $20/mo", which is a floor
for *an* API, not evidence that clinical-grade interaction coverage costs that — a
peer-reviewed comparison of three commercial knowledge bases found materially different
DDI detection between them, so price-per-row is not the buying criterion, coverage is
([Fung et al., 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC6080681/)).

The business model therefore carries a licensing COGS line with a blank in it. **Filling
that blank is gate 1** — a revenue conversation without it is a deck, not a plan.

## 2. Who pays, in priority order

1. **Chronic-care pharmacies and D2C pharmacy programs (primary).** Their revenue is the
   refill, and the refill is lost when a patient stops feeling well on a medicine that is
   working. The category proves the payer: Indian pharmacy apps bundle refill reminders
   and a ~5% membership discount into a *free* consumer product precisely because
   retention is the business ([PharmEasy](https://pharmeasy.in/)). What they do not have
   is a defensible answer to "why should this patient change therapy", which is what this
   engine produces with a source citation per verdict.
2. **Hospital discharge / polypharmacy review.** The buyer staffs pharmacists already.
   The product's confirm-queue → human-resolution loop is that workflow, with the record
   attached, so the pitch is throughput per pharmacist-hour, not a new role.
3. **Payers and employer chronic-care programs.** Same object (a documented adherence
   intervention with provenance), longer sales cycle. Third, not first.
4. **Patients: free, permanently.** Not a funnel trick — a market fact. Medisafe moved its
   consumer app behind **US$39.99/year** (or $4.99/month) and limited free users to two
   medications on 1 January 2026, and the visible result was a wave of "is Medisafe still
   free?" alternative marketing
   ([Cadence](https://www.cadencehealth.app/blog/medisafe-alternative-2026/),
   [Wellnest](https://wellnestapp.app/blog/medisafe-subscription-alternative-guide),
   [Pillo](https://pillo.care/blog/medisafe-no-longer-free-best-free-alternatives)). In
   India the consumer paywall for a reminder app is a churn generator, and Medisafe's own
   positioning shows where the money actually is: a
   ["patient engagement platform for pharma"](https://medisafe.com/).

**Pricing shape (proposed, to be confirmed by design partners, not by this document):**
a per-*verified-prescription* unit price for pharmacy pilots with a monthly floor, and a
platform fee that covers the evidence archive. No per-patient charge. A "verification" is
the unit the buyer already counts, so the invoice needs no new metric.

## 3. Unit economics, from what this repository measures

| Fact | Measured | Consequence for margin |
|---|---|---|
| Verification cost, in-process | `POST /prescriptions` full pipeline p50 **7.5–12.0 ms**; the deciding safety plane alone is **0.451 ms p50 / 2.978 ms p95** (E-F) | A verification is nearly free at the margin. Gross margin is not constrained by compute. |
| What a client actually pays over HTTP | p50 **14.8–21.4 ms** / p95 20.3–36.7 ms; socket floor 6.27 ms | One modest node serves a pilot's traffic; the latency story needs no infrastructure line. |
| Model spend | The deterministic plane answers most prescriptions; perception/generation are opt-in per prescription behind a circuit breaker and a run guard | COGS is bounded and predictable. A competitor whose answer *is* an LLM call has neither. |
| Storage | SQLite, single writer; write-path ceiling TD-30 carries the measured refusal ladder (0/2/3/7/21 rejected writes across 3→8 processes) | Ceiling exists, and the honest gap is that no sustained-load rig has measured HTTP concurrency yet (`docs/TESTING.md`, Known gaps). Re-architect before a multi-tenant paid tier. |
| Knowledge base | Compiled tables ship in the image; `make data-check` holds five gates over them | Marginal cost per customer of *data* is zero — until the licence in §1 is bought, at which point it becomes a fixed cost that rewards scale. |

The structural argument for the buyer: a plan a patient trusts is a refill, a refill is
recurring revenue, and this product's artifact is a **documented, sourced reason** the
patient can be shown — not a black-box nudge.

## 4. Why a patient stays (the retention device is not the reminder)

Reminders are a commodity in this category, so they are given away and never the invoice.
What makes the app load-bearing in a life:

- **A compounding artifact.** Every dose answer, escalation and pharmacist resolution
  lands in one evidence archive for *that* therapy. After six months the record is the
  thing a patient brings to a doctor and to a family member. It cannot be reconstructed
  by switching apps — switching cost that comes from value rather than from lock-in.
- **A second person who cares.** Caregiver/family links with a minted join code (the
  credential law in `tests/family.test.ts`) turn a personal habit into a household one.
- **It arrives when nothing is open.** The installable shell plus the worker-owned queue
  means the nudge survives closing the tab — measured, not asserted
  (`e2e/pwa-delivery.spec.ts`; `docs/TESTING.md`, "The delivery tier is split by what a
  browser will let it measure"). Web Push for a reclaimed browser process is TD-27's
  remaining half and is *not* part of any promise here.
- **It says "I don't know" in the patient's language.** The confirm queue and the refusal
  law are what earn trust on the day something genuinely conflicts.

## 5. What is explicitly not the model

- **No advertising, no data resale, no "de-identified dataset" line.** The store holds a
  prescription history; a business model that monetises it destroys the only reason a
  pharmacist would sign the invoice.
- **No clinical-outcome marketing.** Verdict agreement in this repository is a
  self-consistency claim (TD-22); the dual-pharmacist labelling protocol
  (MED-005) ships as protocol and blank sheets, not as annotations. Until external labels
  exist, no sentence may claim a health outcome, and none in this document does.
- **No "AI doctor" framing.** Information layer, deliberately not a medical device —
  the disclaimer is on every screen and the refusal law is enforced before generation.
- **No device-wide claim about phones.** There is no Android Doze or iOS bench (§6).

## 6. Pilot-readiness: what is not true yet

Ordered by what blocks a paid conversation:

1. **Data licence (§1)** — blocks everything.
2. **No accounts.** There is no sign-in route and no tenant isolation: every id-taking
   route is ownership-scoped, the destructive demo reset is denied by default
   (`MEDISAATHI_ALLOW_DEMO_RESET`), and the family join code is a real credential law —
   but a second pharmacy on the same deployment is not a supported state. This is the
   first engineering gate after the licence.
3. **No external labels (TD-22)** — no outcome claim can be sold, and a payer will ask.
4. **No sustained-load number (TD-30 gap in `docs/TESTING.md`)** and no
   `503`/`Retry-After`/`store_busy_total` on the write path: under store pressure a
   refusal is currently an anonymous 500.
5. **No device bench** for the reminder promise on real phones.
6. **Deployment is held deliberately.** The repository is public; the provisional
   filing comes first, so a public URL does not become the publication event.

## 7. Sequence, with gates instead of dates

| Gate | Question that must answer "yes" | Cost if it answers "no" |
|---|---|---|
| 0. Provisional filed | Is the mechanism protected before it is shown? | Publication forfeits the claim |
| 1. Licence quote + re-verify parity | Can a commercial interaction source cover the same rules, and does the corpus still pass 164/164 after the swap? | Product cannot be sold |
| 2. Accounts + isolation | Can two organisations be served without leaking a row? | B2B impossible; stays a single-tenant tool |
| 3. Two design partners, free, instrumented | Does a pharmacy see a refill-rate or pharmacist-minute change it would pay for? | Pivot to API-only provenance for other vendors' apps |
| 4. Charge | Does the invoice survive contact with procurement (DPDP, audit, DPA)? | Re-price, keep the pilot |

**Kill criterion, written now so it is not negotiated later:** if gate 1's licensed
coverage cannot be shown to match the current tables' reach — or if two instrumented
pilots show no refill or pharmacist-minute movement — the consumer product is not the
business, and the remaining asset is the verification API plus its evidence chain. That
is a smaller, honest company and this repository is already shaped for it.

## 8. Market frame, for context and not as a promise

Analyst sizing of this space is wide and mutually inconsistent: the global digital
therapeutics market is put at **US$10.15B (2025) → US$12.45B (2026)** by one firm
([Fortune Business Insights](https://www.fortunebusinessinsights.com/digital-therapeutics-market-103501)),
**US$10.58B → US$13.22B** by another
([Market Research Future](https://www.marketresearchfuture.com/reports/digital-therapeutics-market-6492));
medication-adherence *platforms* specifically are put at **US$4.05B (2026) → US$10.90B
(2033)** ([Coherent Market Insights](https://www.coherentmarketinsights.com/industry-reports/medication-adherence-platform-market)),
and India's digital-therapeutics market at **US$253M (2025) → US$1.04B (2031), 26.57%
CAGR** ([Ken Research](https://www.kenresearch.com/industry-reports/india-digital-therapeutics-market)).
The disagreement between houses is the point: a category this newly re-priced is not a
market share argument. The argument is §1 through §3 — a licensed, provable verification
that a pharmacy can bill against.

## Sources

External pricing/market references used above:
[Medisafe](https://medisafe.com/) ·
[Cadence on Medisafe's 2026 paywall](https://www.cadencehealth.app/blog/medisafe-alternative-2026/) ·
[Wellnest](https://wellnestapp.app/blog/medisafe-subscription-alternative-guide) ·
[Pillo](https://pillo.care/blog/medisafe-no-longer-free-best-free-alternatives) ·
[PharmEasy](https://pharmeasy.in/) ·
[Wolters Kluwer Medi-Span](https://www.wolterskluwer.com/en/solutions/medi-span) ·
[First Databank](https://www.fdbhealth.com/) ·
[RxLabelGuard pricing page (competitor list price)](https://rxlabelguard.com/alternatives/medi-span) ·
[Fung et al., knowledge-base comparison](https://pmc.ncbi.nlm.nih.gov/articles/PMC6080681/) ·
[Fortune Business Insights](https://www.fortunebusinessinsights.com/digital-therapeutics-market-103501) ·
[Market Research Future](https://www.marketresearchfuture.com/reports/digital-therapeutics-market-6492) ·
[Coherent Market Insights](https://www.coherentmarketinsights.com/industry-reports/medication-adherence-platform-market) ·
[Ken Research](https://www.kenresearch.com/industry-reports/india-digital-therapeutics-market) ·
[Yahoo Finance / medication adherence market report](https://finance.yahoo.com/healthcare/articles/medication-adherence-global-market-report-120000306.html)

Measured figures come from `README.md` ("What is measured (not claimed)"),
`docs/PERFORMANCE.md`, `docs/TESTING.md` and `eval/runs/`, under the standing law: no
number without a run manifest.
