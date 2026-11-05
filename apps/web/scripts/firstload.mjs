/**
 * First-load JS, measured from the bytes a browser is actually sent.
 *
 * TD-11 quotes this number, and the obvious way to get it — read
 * `.next/app-build-manifest.json` — does not exist under Next 16 + Turbopack:
 * the build emits `build-manifest.json` keyed by `pages`, and no per-route
 * client-chunk list at all. So this asks the running server instead, which is
 * the only source that cannot be wrong: the `<script src>` tags in the document
 * *are* the first-load set, and the response bytes *are* the payload.
 *
 * Needs a booted build:
 *   bun run build && PORT=3457 node scripts/start-standalone.mjs &
 *   bun scripts/firstload.mjs [path …]
 *
 * The compressed columns are computed locally with zlib level 9 and brotli,
 * because the standalone entry serves these chunks uncompressed — the honest
 * reading is "bytes shipped by this server" and "bytes a CDN or a compressing
 * proxy would ship", not one wire figure.
 */
import { brotliCompressSync, gzipSync } from "node:zlib";

const BASE = process.env.MEDISAATHI_MEASURE_BASE ?? "http://127.0.0.1:3457";
const routes = process.argv.slice(2).filter((a) => a.startsWith("/"));
if (routes.length === 0) routes.push("/");

let failed = 0;
for (const route of routes) {
  let html;
  try {
    html = await (await fetch(BASE + route)).text();
  } catch (e) {
    console.error(`${route}: no server at ${BASE} — ${e.message}`);
    failed++;
    continue;
  }
  const srcs = [...new Set(
    [...html.matchAll(/src="(\/_next\/[^"]+\.js(?:\?[^"]*)?)"/g)].map((m) => m[1])
  )];
  const rows = [];
  for (const s of srcs) {
    const buf = new Uint8Array(await (await fetch(BASE + s)).arrayBuffer());
    rows.push([buf.byteLength, gzipSync(buf, { level: 9 }).length, brotliCompressSync(buf).length, s]);
  }
  rows.sort((a, b) => b[0] - a[0]);
  const sum = (i) => rows.reduce((n, r) => n + r[i], 0);
  console.log(`\n${route} — ${srcs.length} scripts`);
  for (const [raw, gz, br, s] of rows) {
    console.log(`  ${String(raw).padStart(8)} raw  ${String(gz).padStart(7)} gzip  ${String(br).padStart(7)} br  ${s}`);
  }
  console.log(`  ${String(sum(0)).padStart(8)} raw  ${String(sum(1)).padStart(7)} gzip  ${String(sum(2)).padStart(7)} br  = first-load JS`);
  console.log(`  ${(sum(0) / 1024).toFixed(1)} kB uncompressed · ${(sum(1) / 1024).toFixed(1)} kB gzipped · ${(sum(2) / 1024).toFixed(1)} kB brotli`);
}
process.exit(failed ? 1 : 0);
