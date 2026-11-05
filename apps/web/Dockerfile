# --- deps (bun for installs; the lockfile is bun.lock) ---
# 1.4, not the 1.2 this stage used to pin: `bun install --frozen-lockfile` reads the
# lockfile the host toolchain (bun 1.4.3) writes, and an older reader is the one thing
# that can fail on a format bump rather than on a dependency. This stage installs and
# nothing else — the build stage runs Node, because bun's worker_threads and CommonJS
# loader break the Next 16 production build inside a container.
FROM oven/bun:1.4 AS deps
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
# The public origin, and it has to be a build argument rather than a runtime one.
# `/robots.txt` and `/sitemap.xml` are Next metadata routes and `/` is prerendered:
# with `output: "standalone"` their HTML/XML bodies are produced by `next build` and
# then served from disk, so `process.env.NEXT_PUBLIC_SITE_URL` inside
# `src/app/robots.ts`, `src/app/sitemap.ts` and `src/app/layout.tsx` is resolved at
# BUILD time and frozen into the image. Setting it only in the container environment
# would change nothing for those routes, and a deployed app whose sitemap announces
# `http://localhost:3000/` is an SEO canonical failure nobody notices until the
# crawler already trusted the wrong origin. The default is the value the code falls
# back to, so an unparameterised build still gets a coherent localhost.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
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
