# Contributing

## Setup

```bash
make setup          # python contracts + api
cd apps/web && npm install   # frontend
```

## The gates (all must pass before merge)

```bash
make test           # 64 tests
make eval           # benchmark table
make demo-check     # sealed cases + tests + eval
make ablation       # A1/A4 counterfactual runs
cd apps/web && npx tsc --noEmit && npm run build
```

CI enforces the same gates on every push.

## The laws of this codebase

1. `packages/contracts` is the single source of truth. Change contracts first,
   then implementations. Never ad-hoc dicts across a boundary.
2. The safety plane (`apps/api/app/safety/`) imports no model, makes no network
   call, and never raises the confidence of a field.
3. Verdict logic lives only in `apps/api/app/verdict.py`. If you add a rule,
   add its positive case AND a shuffled no-false-positive test.
4. NLG may only rephrase verified slots. If you touch `app/nlg/`, the slot
   traceability test must stay green.
5. Seed data changes require: `make demo-check` + `make bake-judge` in the same
   PR, with the snapshot string bumped in `data/sources.json` if semantics
   changed.

## Style

- Python: stdlib + pydantic + fastapi idioms; type hints everywhere; no new
  heavy dependencies without a decision-log entry (`docs/DECISIONS.md`).
- TS/React: function components; typed API client in `src/lib/api.ts` mirrors
  the contracts; Tailwind utility classes + the CSS custom properties in
  `globals.css` (no inline hex).

## Commits

Short imperative subject; the why in the body when it is not obvious.
