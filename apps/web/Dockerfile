# --- deps (bun for installs; the lockfile is bun.lock) ---
FROM oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# --- build (Node runs the Next.js build: bun 1.2's worker_threads and
#      CommonJS loader break the Next 16 production build inside a container;
#      on the host it only worked because `bun run` shelled out to node) ---
FROM node:22-slim AS build
# Prisma needs a detectable libssl/openssl at runtime (verified live: without
# this, the client warns and fails to load its query engine on slim images).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/package.json /app/bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN node_modules/.bin/prisma generate \
  && node_modules/.bin/next build

# --- schema-apply (full install tree + prisma CLI + schema + openssl):
#      `docker compose run --rm schema` applies the Prisma schema to the
#      volume ONCE, deliberately (MS-05: no boot-time data-loss push). ---
FROM node:22-slim AS schema
# SAME UID/GID as the runner (10001): the SQLite file this stage creates on
# the shared volume must be writable by the web server user (verified live:
# root-created db files land read-only for the non-root runner).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r -g 10001 medisaathi \
  && useradd -r -u 10001 -g medisaathi -d /app -s /usr/sbin/nologin medisaathi \
  && mkdir -p /app/db && chown -R medisaathi:medisaathi /app/db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# The prisma CLI initializes its engines dir at startup: it must be writable
# by the stage user (node_modules is copied root-owned from the deps stage).
RUN chown -R medisaathi:medisaathi /app/node_modules/@prisma
COPY prisma ./prisma
COPY bun.lock package.json ./
ENV DATABASE_URL="file:/app/db/custom.db"
USER medisaathi
CMD ["node_modules/.bin/prisma", "db", "push", "--skip-generate"]

# --- runtime (the standalone server is plain Node) ---
FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Harden (audit MS-06): dedicated non-root user; the SQLite directory is owned
# by that user with 0750 — NOT world-writable. Schema is NOT pushed at boot
# (MS-05): run the `schema` profile once per fresh volume, or `prisma migrate
# deploy` in the deploy pipeline — never silently at container start.
RUN groupadd -r -g 10001 medisaathi && useradd -r -u 10001 -g medisaathi -d /app -s /usr/sbin/nologin medisaathi \
  && mkdir -p /app/db \
  && chown -R medisaathi:medisaathi /app/db \
  && chmod 750 /app/db

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
ENV DATABASE_URL="file:/app/db/custom.db"
# Docker sets HOSTNAME=<container-id>; the standalone server would try to
# resolve that as a network host and die with EAI_AGAIN. Bind all interfaces.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
USER medisaathi
CMD ["node", "server.js"]
