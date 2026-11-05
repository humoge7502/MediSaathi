/**
 * Cross-platform post-build step for the standalone Next.js bundle.
 *
 * `next build` with `output: "standalone"` traces JS into
 * `.next/standalone/server.js` but deliberately leaves static assets and the
 * public folder outside the bundle; they have to be copied in. The previous
 * script did it with `cp -r`, which does not exist on Windows, so
 * `bun run build` — and with it `bun run e2e` — failed on a fresh Windows
 * checkout. `fs.cpSync` is the same operation with no dependency.
 *
 * Usage: bun run build   (wired into the `build` script)
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(appRoot, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error(`[postbuild] ${standalone} not found — did \`next build\` succeed?`);
  process.exit(1);
}

const copies = [
  [join(appRoot, ".next", "static"), join(standalone, ".next", "static")],
  [join(appRoot, "public"), join(standalone, "public")],
];

for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.log(`[postbuild] skipped ${from} (does not exist)`);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`[postbuild] ${from} -> ${to}`);
}
