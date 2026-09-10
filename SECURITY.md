# Security Policy

## Scope of this build

This is an event-scope, read-only demo. Honest threat model:

- **No auth.** The API is unauthenticated by design for the demo; deploy it
  publicly and anyone can start pipelines on it. OTP/ABDM consent is the first
  post-event line item (`docs/MASTER_PLAN.md`, roadmap 1).
- **No PHI storage.** Patient context (pregnancy, age band, etc.) is declared
  per request, kept in request scope, and persisted only inside the opaque
  pipeline state blob. Do not send real identifiable data to the demo.
- **Live vision key handling.** `MEDISAATHI_VISION_KEY` stays server-side; the
  web client never sees it. Images uploaded to `/prescriptions/upload` are
  proxied to the configured provider and NOT persisted.
- **Judge route.** Gated by `MEDISAATHI_JUDGE_OPEN`; set `0` outside the demo
  laptop.

## Reporting

Open a private GitHub security advisory, or contact a maintainer directly.
For a hackathon build, expect the honest answer above rather than a CVE dance.

## Data integrity

Seed CSVs are synthetic-curated and versioned by snapshot string
(`2026-09`). Every verdict cites its snapshot in `provenance`. Do not edit seed
CSVs without re-running `make demo-check` and re-baking the judge cache
(`make bake-judge`).
