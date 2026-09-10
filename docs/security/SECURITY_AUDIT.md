# MediSaathi Security Audit

**Date:** 2026-09-10  
**Scope:** active FastAPI/Next.js implementation, upload path, state APIs, live vision boundary, and deployment configuration.  
**Classification:** engineering prototype; not a compliance certification.

## Security posture summary

The event build has useful defense-in-depth for a synthetic, unauthenticated demo: the safety decision path is deterministic, uploads are bounded and signature-checked, requests have sanitized IDs and rate limits, SQL is parameterized, and no image is persisted before the live provider call. It is not safe for real patient data because identity, authorization, tenant isolation, consent, retention, backup encryption, and operational monitoring are not implemented.

## Controls verified in code/tests

| Area | Control | Evidence |
|---|---|---|
| Upload DoS | 12 MiB bounded streaming read; oversized body rejected before vision call | `app/routers/api.py`; `test_upload_rejects_oversized_upload_before_live_call` |
| Type confusion | declared MIME allowlist plus magic signature; declaration/signature must agree | `app/routers/api.py`; upload red-team tests |
| HEIF ambiguity | only recognized HEIF/HEIC compatible brands accepted; generic ISO-BMFF rejected | `test_upload_rejects_generic_iso_bmff_as_heic` |
| Injection resistance | extracted text cannot set verdict fields; rules own verdict | `test_prompt_injection_in_fixture_lines_never_captures_verdict` |
| Abuse | sliding-window read/write rate limiter | `test_rate_limit_429_and_recovery` |
| Header injection | client request IDs accepted only against an ASCII allowlist | request-ID red-team tests |
| Browser policy | frame denial, nosniff, referrer and CSP headers; camera only in Permissions-Policy | `apps/web/next.config.ts` |
| Data access | no auth in demo scope; no real patient data permitted | `SECURITY.md`, repository policy |
| SQL injection | parameterized SQLite statements | `app/store.py` review |
| Sensitive logging | no image/health payload logging in the API code path | source inspection |

## Findings

### SEC-001 — Missing authentication/authorization

- **Severity:** High for any real deployment; CVSS cannot be responsibly scored without a deployment/identity context.
- **Affected component:** all state routes under `/api/v1/prescriptions/{id}` and metrics.
- **Safe reproduction:** obtain any known prescription ID from a response and request it from another unauthenticated client; the service has no ownership check.
- **Impact:** state disclosure and mutation in a public deployment.
- **Remediation:** add authenticated sessions or short-lived access tokens, resource ownership/role checks, consent records, and tests proving user A cannot read or confirm user B's state.
- **Status:** Open P1; explicitly outside the event build.

### SEC-002 — Process-local limiter and metrics

- **Severity:** Medium at scale.
- **Affected component:** middleware and `/metrics`.
- **Impact:** multiple workers or replicas do not share abuse counters or quotas.
- **Remediation:** shared Redis/Postgres-backed limiter and metrics store, or enforce a single-process deployment with an explicit operational guard.
- **Status:** Open P2.

### SEC-003 — Web CSP uses `unsafe-inline`

- **Severity:** Medium defense-in-depth gap.
- **Affected component:** `apps/web/next.config.ts` and theme initialization.
- **Impact:** weaker XSS containment if a future injection bug is introduced.
- **Remediation:** migrate to a nonce-based dynamic CSP or a carefully reviewed hash/SRI strategy. Next.js documentation notes the nonce approach requires dynamic rendering, so the performance/cache trade-off must be accepted first.
- **Status:** Open P2.

### SEC-004 — No malware scanning or image re-encoding

- **Severity:** Medium for live uploads; reduced because images are not stored and are sent only to the configured provider.
- **Impact:** parser/provider exposure to malicious or malformed image payloads.
- **Remediation:** isolate the upload worker, decode/re-encode with a hardened image library, apply antivirus/sandbox scanning where operationally justified, and keep files outside the web root.
- **Status:** Open P2 for live production.

## Healthcare privacy boundary

The current service is an information prototype, not a clinical device or compliance-certified system. Do not send real patient identifiers or medical records. The project should not claim HIPAA, GDPR, DPDP, or ABDM compliance until the relevant legal, governance, identity, retention, breach-response, and infrastructure controls are implemented and reviewed.

## External security guidance consulted

- OWASP File Upload Cheat Sheet, accessed 2026-09-10: <https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html>. Applied principles: allowlists, content-type non-trust, signature validation, size limits, and defense in depth.
- Next.js Content Security Policy guide, accessed 2026-09-10: <https://nextjs.org/docs/app/guides/content-security-policy>. Applied to document the current `unsafe-inline` trade-off and nonce migration consequences.

## Verification commands

```bash
make test
python3 tools/demo_check.py
cd apps/web && npx tsc --noEmit && npm run build
```

No destructive third-party security testing was performed.
