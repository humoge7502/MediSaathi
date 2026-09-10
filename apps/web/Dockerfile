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

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

# writable SQLite volume (schema pushed at runtime)
RUN mkdir -p /app/db && chmod 777 /app/db
ENV DATABASE_URL="file:/app/db/custom.db"

EXPOSE 3000
CMD ["sh", "-c", "bunx prisma db push --skip-generate --accept-data-loss >/dev/null 2>&1 || true; node server.js"]