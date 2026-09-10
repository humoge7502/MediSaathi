# Security Policy

## Scope of this build

This is an event-scope, read-only demo. Honest threat model:

- **No auth.** The API is unauthenticated by design for the demo; deploy it
  publicly and anyone can start pipelines on it. OTP/ABDM consent is the first
  post-event line item (`docs/MASTER_PLAN.md`, roadmap 1).
- **No PHI storage.** Patient context (pregnancy, age band, etc.) is declared
  per request, vocabulary-validated, and persisted only inside the opaque
  pipeline state blob. Do not send real identifiable data to the demo.
- **Live vision key handling.** `MEDISAATHI_VISION_KEY` stays server-side; the
  web client never sees it. Images uploaded to `/prescriptions/upload` are
  proxied to the configured provider and NOT persisted.
- **Judge route.** Gated by `MEDISAATHI_JUDGE_OPEN`; set `0` outside the demo
  laptop.

## Controls implemented (verified by tests in `apps/api/tests/test_redteam.py`)

| Control | Where | Test |
|---|---|---|
| Sliding-window rate limiting (60 writes/min, 300 reads/min per client; env-overridable) | `app/middleware_security.py` | `test_rate_limit_429_and_recovery` |
| Security headers on every API response (`nosniff`, `X-Frame-Options: DENY`, CSP for the API, `no-referrer`) | `app/middleware_security.py` | `test_security_headers_present_on_every_response` |
| Request-ID correlation; client-supplied ids accepted only against `^[A-Za-z0-9_-]{8,64}$` (CRLF/unicode/oversize replaced, never echoed) | `app/middleware_security.py` | `test_malicious_request_ids_are_replaced_not_echoed` |
| Upload MIME allow-list + magic-byte sniffing (jpeg/png/webp/heic) — a JSON payload wearing `image/jpeg` is rejected before any model call | `app/routers/api.py` | `test_upload_rejects_non_image_magic_bytes`, `test_upload_rejects_wrong_declared_mime` |
| Prompt-injection containment: perception output is inert text; injected instructions cannot reach verdict fields, fabricate verdicts, or bypass the gate | `app/verdict.py` (rule assembly) | `test_prompt_injection_in_fixture_lines_never_captures_verdict` |
| Context vocabulary validation — unknown patient-context keys are dropped, never guessed about | `safety/engine.py` `validate_context` | `test_context_garbage_keys_are_dropped_silently` |
| Parameterized SQL everywhere; no string-built queries | `app/store.py` | code review + full suite |
| Web security headers (CSP, frame-deny, permissions-policy: camera=self only) | `apps/web/next.config.ts` | build + manual |
| Schema-failure observability — live-vision contract failures are counted, not hidden | `app/vision.py`, `/metrics` | `test_metrics_schema_fail_counter_is_real` |

## Known gaps (honest)

- **CSP keeps `'unsafe-inline'`** on the web app (Next.js inline runtime +
  no-flash theme script). No untrusted HTML is rendered anywhere; nonce-based
  CSP is the documented follow-up (`docs/TECH_DEBT.md` TD-2).
- **No auth** (above). Rate limiting bounds abuse; no PII exists to steal.
- **No CSRF tokens** — the API is token-less JSON with a restrictive CORS
  allow-list; cookie sessions do not exist in this build.
- **Metrics counters are process-local** (fold into the Postgres/Redis swap).

## Reporting

Open a private GitHub security advisory, or contact a maintainer directly.
For a hackathon build, expect the honest answer above rather than a CVE dance.

## Data integrity

Seed CSVs are synthetic-curated and versioned by snapshot string
(`2026-09`). Every verdict cites its snapshot in `provenance`. Do not edit seed
CSVs without re-running `make demo-check` and re-baking the judge cache
(`make bake-judge`).
