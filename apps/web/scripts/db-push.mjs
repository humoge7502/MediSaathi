/**
 * Cross-platform `bun run db:push`.
 *
 * The script this replaces used the POSIX inline-env prefix form
 * (`DATABASE_URL="…" prisma db push`). npm's cmd.exe shell on Windows does not
 * honour it, so the variable reached Prisma as the literal text
 * `DATABASE_URL=...` and every fresh Windows clone of this repo failed the
 * README quickstart with `P1012: The URL must start with the protocol file:`.
 * Setting the variable in-process makes the command work in cmd, PowerShell,
 * bash and CI shells alike, with no new dependency.
 *
 * Usage: bun run db:push   (or: node scripts/db-push.mjs)
 */
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");

const dbDir = join(appRoot, "db");
mkdirSync(dbDir, { recursive: true });

// Same default as prisma/schema.prisma (`file:../db/custom.db`) and
// scripts/start-standalone.mjs, so every entry point opens one database.
const url = process.env.DATABASE_URL || "file:../db/custom.db";

const cli = join(appRoot, "node_modules", "prisma", "build", "index.js");
const res = spawnSync(process.execPath, [cli, "db", "push", ...process.argv.slice(2)], {
  cwd: appRoot,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(res.status ?? 1);
