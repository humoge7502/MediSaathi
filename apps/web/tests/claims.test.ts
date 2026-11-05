/**
 * Public-claim gate.
 *
 * The landing page quotes numbers under the heading "Evidence, not adjectives",
 * and README calls its table "what is measured (not claimed)". Both were hand-
 * typed, so they went stale twice (94 → 210 web tests, 110/110 → 147/147 parity)
 * while every gate in CI stayed green: the suites grew, nothing looked at the
 * sentence that describes them. This file makes the sentences re-derivable, so
 * drift fails a test instead of shipping.
 *
 * Every landing tile is pinned to an exact value re-derived here from the thing
 * it claims to describe — the golden corpus, the self-test suite, the caps CSV
 * (which is also asserted to have actually loaded into the engine, so a tile
 * cannot quote a table the build forgot). The one claim that has no exact
 * derivation is a test-suite *run* count, because a parametrized case runs more
 * times than it is written; those live in README and are pinned as lower bounds
 * on declarations, which is the direction the drift actually went.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DAILY_CAPS_MG } from "@/lib/safety/dose-caps.generated";
import { ENGINE_TEST_CASES, runEngineSuite } from "@/lib/safety/selftest";

const WEB_DIR = join(import.meta.dir, "..");
const REPO_DIR = join(WEB_DIR, "../..");

function proofTiles(): Map<string, string> {
  const src = readFileSync(join(WEB_DIR, "src/components/landing.tsx"), "utf8");
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\{ k: "([^"]+)", v: "([^"]+)"/g)) {
    out.set(m[2], m[1]);
  }
  return out;
}

function tileBy(needle: string): [string, string] {
  for (const [v, k] of proofTiles()) {
    if (v.includes(needle)) return [k, v];
  }
  throw new Error(`no landing tile mentions "${needle}" — the proof band was rewritten`);
}

describe("landing page proof tiles", () => {
  test("quote the real parity corpus size, both sides", () => {
    const doc = JSON.parse(
      readFileSync(join(REPO_DIR, "eval/parity/golden.json"), "utf8"));
    const [k] = tileBy("cross-engine parity");
    expect(k).toBe(`${doc.cases.length}/${doc.cases.length}`);
  });

  test("quote the corpus version the runners will actually enforce", () => {
    const doc = JSON.parse(
      readFileSync(join(REPO_DIR, "eval/parity/golden.json"), "utf8"));
    // Read the source rather than import it: parity.ts runs the whole corpus on
    // load, and a claim test must not be a second way to run the gate.
    const ts = readFileSync(join(REPO_DIR, "eval/parity/parity.ts"), "utf8");
    const py = readFileSync(join(REPO_DIR, "eval/parity/parity.py"), "utf8");
    const inTs = /PARITY_VERSION\s*=\s*(\d+)/.exec(ts)?.[1];
    const inPy = /PARITY_VERSION\s*=\s*(\d+)/.exec(py)?.[1];
    expect(inTs).toBe(String(doc.parity_version));
    expect(inPy).toBe(String(doc.parity_version));
  });

  test("quote a self-test suite that exists and actually passes", () => {
    const [k] = tileBy("engine self-test");
    const n = ENGINE_TEST_CASES.length;
    expect(k).toBe(`${n}/${n}`);
    const { results, passRate } = runEngineSuite();
    expect(results.length).toBe(n);
    expect(passRate).toBe(1);
  });

  test("quote a ceiling table the engine actually loads", () => {
    const [k] = tileBy("daily-dose ceilings");
    const csv = readFileSync(join(REPO_DIR, "data/reference/dose_caps.csv"), "utf8")
      .trimEnd().split("\n");
    expect(k).toBe(String(csv.length - 1));           // minus the header
    expect(Object.keys(DAILY_CAPS_MG).length).toBe(csv.length - 1);  // it really loaded
  });
});

describe("README's measured-not-claimed table", () => {
  /**
   * A suite grows; the sentence about it does not. That happened twice — 94 and
   * 110/110 were both true on the day they were typed. The landing band is now
   * derived from its own sources, and the doc figures are pinned as lower bounds
   * on declarations, which is the direction the drift actually went: a
   * parametrized case runs more times than it is written, so a claim BELOW the
   * declaration count is provably stale, and a claim above it is only ever
   * stale by cases nobody can count without running them.
   */
  const readme = readFileSync(join(REPO_DIR, "README.md"), "utf8");

  function figure(pattern: RegExp, what: string): number {
    const m = pattern.exec(readme);
    if (!m) throw new Error(`README no longer states ${what} the way this gate expects`);
    return Number(m[1]);
  }

  test("does not under-state the web suite", () => {
    const declared = readdirSync(join(WEB_DIR, "tests"))
      .filter((f) => f.endsWith(".test.ts"))
      .reduce((sum, f) => sum + (readFileSync(join(WEB_DIR, "tests", f), "utf8")
        .match(/^\s*(?:test|it)\(/gm) ?? []).length, 0);
    expect(figure(/\| Web suite \(unit \+ route\) \| \*\*(\d+) passing\*\*/,
      "the web suite size")).toBeGreaterThanOrEqual(declared);
  });

  test("does not under-state the API suite", () => {
    const dir = join(REPO_DIR, "apps/api/tests");
    const declared = readdirSync(dir)
      .filter((f) => f.startsWith("test_") && f.endsWith(".py"))
      .reduce((sum, f) => sum + (readFileSync(join(dir, f), "utf8")
        .match(/^def test_|^    def test_/gm) ?? []).length, 0);
    expect(figure(/\| API suite \| \*\*(\d+) tests passing\*\*/,
      "the API suite size")).toBeGreaterThanOrEqual(declared);
  });
});
