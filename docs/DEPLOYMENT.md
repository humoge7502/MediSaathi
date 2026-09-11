# Deployment — MediSaathi / Vaidya

Two deployable tiers with one decision law:

| Tier | What ships | Runtime | Port |
|---|---|---|---|
| Web product app (`apps/web`) | Next.js standalone server (`bun run build` → `.next/standalone`) | Node ≥ 20, bun for build | 3000 |
| Verification API (`apps/api`) | FastAPI app (`app.main:app`) | Python ≥ 3.11, uvicorn | 8000 |

Both tiers are self-contained demo monoliths: SQLite file DB, no external
services required, fully offline-capable. This is deliberate (see
docs/DECISIONS.md ADRs) — the documented swap points are where production
services plug in.

## Option A — Docker (recommended for the demo/hackathon)

```bash
make docker        # docker compose up --build -d
# web on :3000, API on :8000 (/docs), API /healthz /readyz
```

`docker-compose.yml` builds both images from their Dockerfiles. The web
container runs the standalone server; the API container runs uvicorn with the
seed data baked into the image.

## Option B — Bare metal (dev / judging laptop)

```bash
# Web tier
cd apps/web
bun install
bun run db:push          # create SQLite schema (or `bun run db:migrate`)
bun run build
NODE_ENV=production bun run start      # :3000

# API tier
make setup
make run                 # uvicorn on :8000
```

## Environment variables

Both tiers read `.env` (gitignored). The complete, documented set is in
`.env.example`. Critical items:

| Var | Tier | Purpose | Default |
|---|---|---|---|
| `DATABASE_URL` | web | SQLite path (standalone wrapper resolves relative paths) | `file:../db/custom.db` |
| `MEDISAATHI_VISION_KEY` | api | Live vision path (optional; sealed fixtures demo without it) | empty |
| `MEDISAATHI_VISION_MODEL/BASE_URL/TIMEOUT_S` | api | Any OpenAI-compatible vision endpoint | gemini-2.0-flash via Google |
| `MEDISAATHI_CORS` | api | Allowed web origin | `http://localhost:3000` |
| `MEDISAATHI_RATE_WRITE/READ` (+ windows) | api | Per-client sliding-window limits | 60/300 per 60 s |
| `MEDISAATHI_MAX_BODY_BYTES` | api | JSON body cap (413) | 1 MiB |
| `MEDISAATHI_JUDGE_OPEN` | api | judge route gate; **default `0` = closed (403)**. Set `1` only on a demo laptop | 0 |
| `MEDISAATHI_DISABLE_MODEL_EGRESS` | both | `1` = hard-disable every outbound model call (deterministic tier only; zero third-party transmission) | 0 |
| `MEDISAATHI_ENV` | web | `development` allows the demo seed force-reset; any other value requires `MEDISAATHI_ADMIN_TOKEN` for force resets | development |
| `MEDISAATHI_ADMIN_TOKEN` | web | admin token for `POST /api/seed {force:true}` outside development (sent as `x-admin-token`); empty = never unlockable | — |
| `MEDISAATHI_BUILD_TAG` | api | Stamped into eval JSON | dev |

**Secrets policy:** never commit `.env`, keys, or tokens. Demo runs fully
offline with zero keys; the vision key is optional and only touches the API
tier server-side.

## Database & migrations

- Web tier: Prisma + SQLite. Dev: `bun run db:push`. Versioned migrations:
  `bun run db:migrate` (Prisma Migrate). The schema is Postgres-portable;
  the store API (`apps/web/src/lib/db.ts`) is the documented swap surface.
- API tier: SQLite WAL via `app/store.py`; schema created on first run
  (idempotent). `MEDISAATHI_DB_PATH` overrides location.

## Storage

- Demo: SQLite files only (`apps/web/db/custom.db`, `apps/api/medisaathi.db`).
- Uploaded images are **not persisted** — they are validated, processed, and
  discarded (privacy by design).
- Production roadmap: Postgres, object storage with signed URLs, Redis
  limiter/queue — see docs/ARCHITECTURE.md swap-point table.

## AI provider

- Web copilot: `z-ai-web-dev-sdk` (server-side only; keys never reach the
  browser). When unavailable, the copilot **refuses visibly** — that is a
  designed tier, not a failure.
- API vision: any OpenAI-compatible endpoint (Google Gemini, OpenAI, or local
  Ollama/vLLM for on-prem hospital deployments). Provider abstraction means
  no vendor lock-in; the safety plane is provider-agnostic.

## Observability

- Liveness: `GET /healthz`. Readiness: `GET /readyz` (seed tables + fixtures
  loaded). Latency header: `x-medisaathi-latency-ms` on every API response.
- Structured counters: `GET /metrics` (pipeline, verdict kinds, refusals,
  confirm queue, schema-fail). Request IDs propagate as `x-request-id`.
- Web tier: audit log table (`AuditLog`) records verify/plan/dose/copilot
  actions; structured JSON responses on every route.

## Monitoring & rollback

- Health-check both tiers after any deploy (`curl /healthz`, `curl /readyz`).
- Rollback = redeploy the previous image/commit; SQLite makes the demo
  stateless-enough (re-seed with `POST /api/seed` from the UI).
- For a public deployment: keep `MEDISAATHI_JUDGE_OPEN` at its default `0`, set `MEDISAATHI_ENV=production`, tighten rate
  limits, put TLS + a reverse proxy in front, and add real auth (first
  roadmap item — see docs/MASTER_PLAN.md).

## Post-event production path (documented, not yet built)

1. OTP auth + ABDM-style consent artifacts.
2. Postgres migration (single-file swap behind the store).
3. Redis shared limiter/queue for multi-worker deployments.
4. Versioned DDInter/RxNorm/DailyMed snapshots (replace curated seeds).
5. Pharmacist review console over the persisted confirm queue.