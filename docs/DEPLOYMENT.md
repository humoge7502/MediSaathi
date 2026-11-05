# Deployment — MediSaathi / Vaidya

Two deployable tiers with one decision law:

| Tier | What ships | Image | Port |
|---|---|---|---|
| Web product app (`apps/web`) | Next.js standalone server (`next build` → `.next/standalone`) | `node:22-slim` (runner) + `oven/bun:1.4` (deps) | 3000 |
| Verification API (`apps/api`) | FastAPI app (`app.main:app`) | `python:3.13-slim`, uvicorn | 8000 (127.0.0.1 only) |

Both tiers are self-contained demo monoliths: SQLite file DB, no external
services required, fully offline-capable. This is deliberate (see
docs/DECISIONS.md ADRs) — the documented swap points are where production
services plug in.

Runtime floors, stated as what is actually declared rather than what the docs once
claimed: `apps/api/pyproject.toml` declares `requires-python = ">=3.10"` (not 3.11),
and `apps/web/package.json` declares **no `engines` field at all** — "Node ≥ 20" was
a convention, never a pinned claim. What has been run on this machine: CPython
3.13.6 for the API suite, Node 24 on the host, Node 22 in the web runner image and
CPython 3.13 in the API image. If a floor matters to your deployment, pin it in
front of the image rather than trusting a README line.

## Option A — Docker (recommended for the demo/hackathon)

```bash
make docker        # docker compose up --build -d  (web :3000, API 127.0.0.1:8000)
docker compose run --rm schema    # ONE-SHOT: apply the SQLite schema to the fresh volume

# a hosted launch sets the canonical origin at BUILD time, not runtime:
NEXT_PUBLIC_SITE_URL=https://your.origin docker compose up -d --build
```

`docker-compose.yml` builds both images from their Dockerfiles. The web
container runs the standalone server as a non-root user (uid 10001); the API
container runs uvicorn with the seed data baked into the image (also
non-root).

Container notes (each verified live in this environment on 2026-10-28,
re-verified 2026-10-29 on the constraints-pinned API image, and re-verified again
2026-10-30 by building with a non-default origin, booting the stack and reading the
properties back off the running containers; the last three
properties are now also asserted on every push by the `container` CI job,
because a fix nobody re-runs is a fix that can regress silently):
- **The API image installs through `constraints.txt`.** Until 2026-10-29 the
  Dockerfile installed `packages/contracts` and `apps/api[prod]` with no `-c`,
  so the image resolved whatever was newest on PyPI at build time and two builds
  of one commit could ship FastAPI / Starlette / pydantic versions no test in
  this repository had run — a version gap no test can see, because no test runs
  in the image. Both installs now carry `-c constraints.txt`, and
  `tools/check_container_pins.py` (a CI step and `make container-pins`) reads
  the versions back out of the built image rather than trusting the build log.
  Measured on the rebuilt image: fastapi 0.162.0 · starlette 1.10.0 ·
  uvicorn 0.54.0 · pydantic 2.14.2 · httpx 0.28.1 · python-multipart 0.0.32 —
  identical to the file and to the 466-test `.venv` — `pip check` reports no
  broken requirements. The gate's static half fails if any `pip install` line
  loses its `-c`, because that is how the hole would return: a version check
  alone stays green until upstream happens to release.
- **Build contexts are trimmed by two `.dockerignore` files** (root for the API,
  `apps/web/.dockerignore` for the web image). Measured on this machine before they
  existed: the web `load build context` transferred **1.18 GB and took 214.3 s**,
  and the build stage's `COPY . .` took another **204.2 s**, because it was being
  handed the host `node_modules`, a **293 MB** `.next` directory and
  `db/custom.db` — the developer's last demo run, 929,792 bytes. After: context
  load **11.0 s**, `COPY . .` **1.0 s**. The root file matters for a different
  reason: `COPY apps/api apps/api` reaches host-compiled bytecode, so the shipped
  API image used to contain Windows `__pycache__/*.cpython-313.pyc` files — and the
  root tree also carries a 264 MB `.venv` (re-measured 2026-10-30: **265 MB**) and a working
  SQLite database that no image should ever walk, let alone copy. Name it rather than sizing
  it, because it grows: `apps/medisaathi.db` was 224,952,320 bytes when the exclusion
  was written and **235,888,640** at the 2026-10-30 re-check.
- **The public origin is a build argument, not a runtime variable.** `/` is
  prerendered and `/robots.txt` + `/sitemap.xml` are Next metadata routes, so
  `NEXT_PUBLIC_SITE_URL` is resolved by `next build` and frozen into the image.
  Verified on this repo: an image built without it answers
  `<loc>http://localhost:3000/</loc>` from `/sitemap.xml` no matter what the
  container environment sets. `apps/web/Dockerfile` takes it as an ARG and
  `docker-compose.yml` passes it through `build.args`, so a hosted launch is
  `NEXT_PUBLIC_SITE_URL=https://your.origin docker compose up -d --build`.
- **`:8000` is published on loopback only** (`127.0.0.1:8000:8000`). Nothing in
  `apps/web/src` calls the API tier — the web app is self-contained — so that port
  has no in-compose consumer, and the API has no authentication layer. A published
  `8000:8000` binds an unauthenticated verification engine to every interface of
  the host machine.
- **Both host ports must be free, and `make docker` fails out loud if they are not.**
  On the machine this was re-verified on, `3000` and `8000` were already held by other
  projects' containers, so `docker compose up` died with `Bind for 127.0.0.1:8000 failed:
  port is already allocated` rather than starting a half-stack. Nothing in the compose file
  makes those numbers configurable. For a parallel checkout or a shared demo laptop, remap
  only the host side with an override file and keep the `127.0.0.1:` prefix so the loopback
  law above still holds — `ports: !override` replaces the sequence instead of appending to it,
  which matters because a plain `ports:` list in a second compose file would publish *both*
  the occupied port and the new one, and fail for the same reason:
  ```yaml
  services:
    web:
      ports: !override
        - "127.0.0.1:3100:3000"
    api:
      ports: !override
        - "127.0.0.1:8010:8000"
  ```
  `docker compose -f docker-compose.yml -f override.yml up -d --wait` then boots the same
  stack on the side ports; the container-side ports, healthchecks and env are untouched, so
  every property below still applies verbatim.
- **`restart: unless-stopped`** on both long-running services, so a laptop reboot
  or an OOM kill does not need an operator. `schema` stays a one-shot.
- **`MEDISAATHI_DISABLE_MODEL_EGRESS` now reaches both tiers.** Both *read* it; the
  compose file used to pass it only to `api`, so an operator who set it for a
  privacy demo silenced one egress path and left the other open — the MS-03 bug
  class exactly, and the worse variant because the switch looked like it worked.
- **Schema is never pushed at boot** (MS-05). Run `docker compose run --rm
  schema` once per fresh volume — it is a no-op when the schema already
  matches — or run `prisma migrate deploy` in your deploy pipeline. The
  `schema` service is profile-gated (`--profile tools` implied by `run`).
- The schema stage shares uid/gid 10001 with the runner so the SQLite file it
  creates is writable by the web server user; the prisma CLI's engines dir is
  chowned for the same reason.
- Both stages install `openssl` (Prisma cannot detect the engine on slim
  images without it) and pin `HOSTNAME=0.0.0.0` (Docker's container-id
  HOSTNAME otherwise breaks the standalone server with `EAI_AGAIN`).
- The web **build** stage runs `next build` with Node, not bun: bun 1.2's
  worker_threads/CommonJS loader breaks the Next 16 production build inside a
  container. Bun still owns installs (the lockfile is `bun.lock`).
- Healthchecks: API probes `/healthz` (curl); web probes the deterministic
  `/api/evidence` route (node fetch) — no model dependency on either.

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
| `DATABASE_URL` | web | SQLite path (standalone wrapper resolves relative paths) | `file:../db/custom.db` in `apps/web/.env.example`; **the container sets `file:/app/db/custom.db`**, which is the mounted volume rather than the image layer |
| `NEXT_PUBLIC_SITE_URL` | web | Canonical origin for `/sitemap.xml`, `/robots.txt` and page metadata. **Read at BUILD time** — the routes are prerendered, so a container environment alone cannot change it (see the container notes) | `http://localhost:3000` |
| `MEDISAATHI_VISION_KEY` | api | Live vision path (optional; sealed fixtures demo without it) | empty |
| `MEDISAATHI_VISION_MODEL/BASE_URL/TIMEOUT_S` | api | Any OpenAI-compatible vision endpoint | gemini-2.0-flash via Google |
| `MEDISAATHI_CORS` | api | Allowed web origin | `http://localhost:3000` |
| `MEDISAATHI_RATE_WRITE/READ` (+ `_WINDOW`s) | both | Per-client sliding-window limits. The web tier reads the same four names in `src/proxy.ts` through `envPositiveNumber`: a set-but-empty or non-numeric value falls back to the default instead of becoming `0`, which would deny every write | 60/300 per 60 s |
| `MEDISAATHI_MAX_BODY_BYTES` | api | JSON body cap in **bytes** (413) | 1 MiB |
| `MEDISAATHI_MAX_BODY_KB` | web | JSON body cap in **KiB** (`src/lib/api-helpers.ts`; a different name and unit from the API tier on purpose — the web surface takes extracted text, not photographs) | 64 KiB |
| `MEDISAATHI_EVAL_REUSE_MS` | web | Evidence-suite cache window for `POST /api/evals`; unlike the limiter budgets an explicit `0` is honoured ("run every time") — but a **blank** value is not a `0`, it reads as unset and keeps the default | 120 000 |
| `MEDISAATHI_TRUST_PROXY` | web | Honour `X-Forwarded-For` (per-client rate keys). `1` only behind a proxy that overwrites XFF, else a caller mints its own bucket | 0 |
| `MEDISAATHI_JUDGE_OPEN` | api | judge route gate; **default `0` = closed (403)**. Set `1` only on a demo laptop | 0 |
| `MEDISAATHI_DISABLE_MODEL_EGRESS` | both | `1` = hard-disable every outbound model call (deterministic tier only; zero third-party transmission). `docker-compose.yml` passes it to **both** containers — both tiers read it, and passing it to one was the MS-03 failure mode | 0 |
| `MEDISAATHI_ALLOW_DEMO_RESET` | web | `1` unlocks the destructive demo reset (`POST /api/seed {force:true}`) — the **only** way it is allowed without a token. Set by `next dev` via `.env.development`; nothing sets it implicitly | empty = reset denied |
| `MEDISAATHI_ADMIN_TOKEN` | web | admin token for the same route (sent as `x-admin-token`); empty = never unlockable by header | — |
| `MEDISAATHI_BUILD_TAG` | api | Stamped into eval JSON | dev |

Per-tier copies of this list live next to the code they configure:
`.env.example` (API) and `apps/web/.env.example` (web, including the build-time
warning above). Keep them and this table in step when a variable is added — an
operator reads the file in the directory they are deploying, not this table.

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
  stateless-enough (re-seed with `POST /api/seed` from the UI — the `force`
  variant, which rewrites the adherence timeline, is denied on a deployment
  that does not opt in).
- For a public deployment: keep `MEDISAATHI_JUDGE_OPEN` at its default `0`,
  leave `MEDISAATHI_ALLOW_DEMO_RESET` unset (MS-03: the reset is denied by
  default now — it used to be allowed whenever `MEDISAATHI_ENV` was unset, and
  `docker-compose.yml` passed that variable to the api container, which never
  reads it, so the web tier ran on the permissive default whatever the file
  said), tighten rate
  limits, put TLS + a reverse proxy in front, and add real auth (first
  roadmap item — see docs/MASTER_PLAN.md).

## Post-event production path (documented, not yet built)

1. OTP auth + ABDM-style consent artifacts.
2. Postgres migration (single-file swap behind the store).
3. Redis shared limiter/queue for multi-worker deployments.
4. Versioned DDInter/RxNorm/DailyMed snapshots (replace curated seeds).
5. Pharmacist review console over the persisted confirm queue.