/**
 * Standalone server launcher.
 *
 * Prisma resolves relative `file:` SQLite URLs against the schema directory
 * baked at generate time, which does not exist inside `.next/standalone`.
 * This wrapper rewrites a relative DATABASE_URL to an absolute path anchored
 * at the repository's `db/` folder, then boots the traced server.
 *
 * Usage: bun run start   (after `bun run build`)
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");

if (!process.env.DATABASE_URL) {
  // Match prisma/schema.prisma's datasource (`file:../db/custom.db`) and the
  // db:push script's default — same absolute path, every entry point.
  const dbPath = join(appRoot, "db", "custom.db");
  if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
  process.env.DATABASE_URL = `file:${dbPath}`;
  console.log(`[start] DATABASE_URL -> ${process.env.DATABASE_URL}`);
}

const server = join(appRoot, ".next", "standalone", "server.js");
if (!existsSync(server)) {
  console.error(`[start] ${server} not found — run \`bun run build\` first.`);
  process.exit(1);
}

const child = spawn(process.execPath, [server], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));