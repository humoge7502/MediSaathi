# --- deps ---
FROM oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# --- build ---
FROM deps AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run db:generate \
  && bun run build

# --- runtime ---
FROM oven/bun:1.2 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Harden (audit MS-06): dedicated non-root user; the SQLite directory is owned
# by that user with 0750 — NOT world-writable. The image ships the schema push
# (run once as root at build-safe init below); serving happens unprivileged.
RUN groupadd -r medisaathi && useradd -r -g medisaathi -d /app -s /usr/sbin/nologin medisaathi \
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
# MS-05: boot-time `prisma db push --accept-data-loss` REMOVED. Schema is
# applied by `migrate deploy` in the deploy pipeline (or `docker compose run
# web bunx prisma db push` once, deliberately, by an operator) — never
# silently at every container start.
EXPOSE 3000
USER medisaathi
CMD ["node", "server.js"]
