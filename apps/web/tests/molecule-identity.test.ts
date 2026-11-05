/**
 * One identity per drug, TypeScript side — mirror of
 * apps/api/tests/test_molecule_identity.py.
 *
 * WHY THIS FILE EXISTS: the identity pass renamed the rule tables, and the
 * product tier reads its own copies of those names. A renamed table plus an
 * un-renamed lookup key is not a crash — it is a silent miss. Measured here,
 * before this file pinned it: the copilot retrieves by molecule, its corpus
 * was keyed `ferrous sulphate`, and the engine now emits `ferrous sulfate`, so
 * a patient on Fefol asking about their iron tablet would have been refused
 * with a straight face. Same drug, two spellings, no answer.
 *
 * The law itself is data, not a list duplicated here: it is read from
 * data/reference/molecule_aliases.csv, the file tools/normalize_molecules.py
 * writes and the Python suite checks against the tool.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { KNOWLEDGE } from "@/lib/ai/knowledge";
import { retrieve } from "@/lib/ai/retrieval";
import { BRANDS, CONTRAINDICATIONS, INTERACTIONS } from "@/lib/safety/dataset";

/** alias -> canonical, for the identities the law retired (merged === "yes"). */
function readAliasLaw(): Map<string, string> {
  const path = new URL("../../../data/reference/molecule_aliases.csv", import.meta.url);
  const lines = readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  const law = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    // First two fields only, quote-aware: the later columns carry citations
    // full of commas, which a naive split would treat as field boundaries.
    const fields: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted && fields.length < 4) {
        fields.push(cur);
        cur = "";
      } else cur += ch;
    }
    fields.push(cur);
    const [alias, canonical, , , merged] = fields.map((f) => f.trim());
    if (merged === "yes") law.set(alias.toLowerCase(), canonical.toLowerCase());
  }
  return law;
}

const ALIAS_LAW = readAliasLaw();

/** A combination is "amoxicillin+clavulanic acid": every half is an identity. */
function offenders(names: Iterable<string>): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const part of name.split("+")) {
      const key = part.trim().toLowerCase();
      if (ALIAS_LAW.has(key)) out.push(`${key} (would need to be ${ALIAS_LAW.get(key)})`);
    }
  }
  return out;
}

describe("the alias law is loaded, not assumed", () => {
  test("the artifact parses into the retired identities", () => {
    expect(ALIAS_LAW.size).toBe(11);
    expect(ALIAS_LAW.get("lithium carbonate")).toBe("lithium");
    expect(ALIAS_LAW.get("ferrous sulphate")).toBe("ferrous sulfate");
    // A non-merge is NOT in the law: citalopram and escitalopram are two drugs.
    expect(ALIAS_LAW.has("escitalopram")).toBe(false);
  });
});

describe("no key the product tier looks up names a retired identity", () => {
  test("the formulary", () => {
    expect(offenders(BRANDS.map((b) => b.molecule))).toEqual([]);
  });
  test("the interaction rows", () => {
    expect(offenders([...INTERACTIONS.map((r) => r.a), ...INTERACTIONS.map((r) => r.b)])).toEqual([]);
  });
  test("the contraindication rows", () => {
    expect(offenders(CONTRAINDICATIONS.map((r) => r.molecule))).toEqual([]);
  });
  test("the copilot corpus, which is indexed by molecule", () => {
    expect(offenders(KNOWLEDGE.flatMap((c) => c.molecules))).toEqual([]);
  });
});

describe("retrieval meets the engine on the canonical name", () => {
  test("an iron tablet reaches its own advice", () => {
    // Zero latin tokens + a verified plan molecule: the path a Hindi or Tamil
    // question takes, and the one that used to come back empty.
    const hits = retrieve("", 3, ["ferrous sulfate"]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunk.molecules).toContain("ferrous sulfate");
  });

  test("a combination is looked up as a whole, not only as its halves", () => {
    const combo = "calcium carbonate+cholecalciferol";
    expect(KNOWLEDGE.some((c) => c.molecules.includes(combo))).toBe(true);
    expect(retrieve("", 3, [combo])[0].chunk.molecules).toContain(combo);
  });
});
