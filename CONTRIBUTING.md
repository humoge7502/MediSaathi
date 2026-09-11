# Contributing

## ⚠️ Disclosure pause (read before opening a PR)

This repository is public. Anything merged here is a **public disclosure** and
becomes prior art against future patent filings from its merge date. Before
merging a change that adds mechanism detail, stop and check:

- Is the change adding detail about the **gate law, fusion function, queue-blocking
  semantics, calibration method or the experiment numbers**? If yes, it belongs in
  the private evidence flow first — raise it rather than pushing it to `master`.
- Do not post, demo, present or publish the specific mechanism beyond what
  `master` already shows until either a provisional application is on file or
  counsel has advised otherwise.
- Design decisions, negative results and rejected alternatives are *valuable*
  evidence (they defeat hindsight arguments) — record them in the evidence
  binder / decision log, not in a public commit if they disclose new mechanism.

See `docs/patent/README.md` and `docs/patent/INVENTION_DISCLOSURE.md` §7.
Changing a public claim of novelty is a **review-blocking** change.

## Setup

```bash
make setup                          # python contracts + api (editable)
cd apps/web && bun install          # frontend
```

## The gates (all must pass before merge)

Python tier:

```bash
make setup          # install contracts + api + dev deps
make test           # API/safety/red-team/parity/property suite
make eval           # fixture benchmark table (A4)
make ablation       # A1 vs A4 counterfactual runs
make parity-py      # Python side of the cross-engine parity gate
make demo-check     # sealed cases + tests + eval + python parity (offline)
```

Web tier:

```bash
cd apps/web
bun run lint && bun run typecheck
bun run selftest    # deterministic engine self-test + copilot gates
bun run parity      # TS side of the cross-engine parity gate
bun run test        # route-handler integration tests (isolated SQLite)
bun run build
```

Evidence / research tier (only needed when you touch the corpus, engine law, or
the docs that quote numbers):

```bash
python tools/run_experiments.py --all   # E-A..E-G -> eval/runs/ + eval/results/
python tools/export_evidence.py         # -> apps/web/src/data/evidence.json
python tools/build_binder.py            # -> docs/patent/EVIDENCE_BINDER.md
```

CI enforces the same gates on every push.

## The laws of this codebase

1. `packages/contracts` is the single source of truth. Change contracts first,
   then implementations. Never ad-hoc dicts across a boundary.
2. The safety plane (`apps/api/app/safety/`) imports no model, makes no network
   call, and never raises the confidence of a field.
3. Verdict logic lives only in `apps/api/app/verdict.py`. If you add a rule,
   add its positive case AND a shuffled no-false-positive test.
4. The gate law lives exactly once per tier (`app/gate.py`, `lib/safety/gate.ts`)
   and the two must agree on the shared golden corpus. Changing one side without
   the other fails `make parity`; changing the *law* itself means bumping the
   threshold-set id and re-running E-A..E-G, because every verdict carries the
   set id that produced it.
5. NLG may only rephrase verified slots. If you touch `app/nlg/`, the slot
   traceability test must stay green.
6. Seed/corpus data changes require: `make demo-check` + `make bake-judge` +
   regenerating `data/manifest.json`, in the same PR, with the snapshot string
   bumped in `data/sources.json` if semantics changed. A number quoted in a doc
   without a run manifest is a bug.
7. No number may be quoted in documentation unless an archived run under
   `eval/runs/` produced it.

## Style

- Python: stdlib + pydantic + fastapi idioms; type hints everywhere; no new
  heavy dependencies without a decision-log entry (`docs/DECISIONS.md`).
- TS/React: function components; typed API client in `src/lib/client.ts` mirrors
  the contracts; Tailwind utility classes + the CSS custom properties in
  `globals.css` (no inline hex).
- Tests state the *law* they pin in the test name, so a failure names the
  behaviour, not the function.

## Commits

Short imperative subject; the why in the body when it is not obvious. Commits are
dated development evidence — keep them honest and small enough to be readable.
