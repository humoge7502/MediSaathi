# Vaidya — 4-Minute Judge Demo Script

Golden rule: **the demo runs live, but every live element has a deterministic fallback.** Drill the contingency once before judging.

## Opening — 20 seconds (landing page)

> "Half the patients with chronic conditions in India don't take their medicines as prescribed. Reminder apps ping; pharmacy apps sell. Nothing checks. Vaidya is a closed-loop medication guardian — it verifies the prescription, schedules the therapy, measures adherence, protects with the family, and explains with citations. And when it isn't sure — it refuses. On purpose."

## Beat 1 — Verify (90 seconds, Verify tab)

1. Tap sample chip **"Warfarin + aspirin"** → **Run verification**.
2. Narrate the result cards: verdict banner, per-medicine confirmation, the SEVERE finding with its source (DDInter).
3. Point at the telemetry line: `perception: llm · engine: 0.3 ms · snapshot 2026-09-vm3`.
4. Tap **"Triple whammy (AKI risk)"** → run. Say: "This one is not a pairwise lookup — ARB + diuretic + NSAID is a *combination* rule. Two of these pairs look innocent; the triangle kills kidneys."
5. Tap **"Unreadable input (refusal)"** → run. Say: "Refusal is a designed success state. A confident wrong answer in medication is worse than an honest one."

**Contingency (model down):** the pipeline falls back to a deterministic line splitter; the same verdicts appear with a visible "deterministic-fallback" note. Say the line: "the AI is down, and the product still works — that's the architecture law."

## Beat 2 — Schedule & adhere (45 seconds)

1. On the warfarin result press **Start therapy plan** (family circle will show the interaction alert later).
2. Open **Today**: press **Taken** on a due dose. If a dose is overdue, show the catch-up guidance and the guardrail: try taking a dose whose window closed — the app refuses double-ups.
3. Open **Insights**: 79% adherence, MPR, streaks, 14-day heatmap. Say: "These are the same metrics used in the adherence literature — computed from dose-level events, not self-reports."

## Beat 3 — Protect + explain (60 seconds)

1. **Family** tab: the escalation feed shows "Plan started with 1 safety finding" — timestamped, acknowledgeable. Link a caregiver to show the family code.
2. **Copilot** tab: ask **"What is metformin used for?"** → grounded answer with [1] citations and retrieval telemetry.
3. Ask **"Should I double my dose today?"** → refused_scope, deterministically, ~50 ms, no generation.
4. Ask **"Who won the last IPL final?"** → refused — "I don't have verified information on that." Say: "the refusal IS the feature."

## Beat 4 — Evidence (45 seconds, the judge magnet)

1. **Evidence** tab: the engine self-test is already on screen — 18/18, 100%, ~7 ms, per-case expected vs actual.
2. Press **Run evaluation**. While it runs (~1–2 min): "ten labeled cases — grounded answers, scope refusals, an emergency redirect, an out-of-scope trap — scored by an automated rubric judge. It's engineering telemetry, clearly labeled, not clinical validation."
3. Point at provenance cards: 94 brands · 79 rules from DDInter/Stockley/FDA/CredibleMeds/BMJ · 30 knowledge chunks from MedlinePlus/NHS/WHO.

## Closing — 20 seconds

> "MediSaathi proved the model should read and the rules should decide. Vaidya closes the loop around the patient: verify, schedule, adhere, protect, explain — and measure itself, live, on this page. If every model vanished tonight, the safety plane, the schedule and the family circle would still work tomorrow. That's not an AI wrapper. That's engineering."

---

## Contingency drills (do once before judging)

| Scenario | Action |
|---|---|
| WiFi down | Everything on-device still works except copilot generation & eval; show the honest refusal in Copilot and continue — the script is designed around it |
| Model quota exhausted | Same as above; Verify shows `deterministic-fallback` tag — frame as the resilience tier |
| DB corrupted | **Reset demo data** button re-seeds deterministically in ~2 s |
| Time cut to 2 min | Beat 1 (warfarin) + Beat 4 (evidence, already rendered) only |
| Judge asks "is this a doctor?" | Every screen's disclaimer + refusal law; "information layer, deliberately not a medical device" |

## Pre-demo checklist

- [ ] `bun run dev` up; open `/` — landing loads with live counters
- [ ] Press **Reset demo data** once (Asha's plan, 14-day history)
- [ ] Evidence tab pre-rendered (self-test table)
- [ ] Copilot answered one warm-up question (first-token latency out of the demo)
- [ ] Browser zoom 100%, viewport 1440×900, do-not-disturb on
