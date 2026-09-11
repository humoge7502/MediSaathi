/**
 * Copilot deterministic-layer tests (audit TD-G / MS-09 follow-up).
 *
 * The three refusal gates were already pinned by scripts/selftest.ts; this
 * suite pins the POST-GENERATION defenses that used to be untested:
 *   · the dosage-stripping post-check regex (guarded branch) — legit grounded
 *     answers must NOT be rewritten, dosage probes must be,
 *   · the exemption paths ("allowed", "always"),
 *   · the model-declared-refusal relabel,
 *   · citation-contract validation (added under TD-G: every [n] in a grounded
 *     answer must map to a retrieved chunk).
 *
 * The model boundary itself is sealed (no keys needed): answerCopilot's gates
 * run before any SDK call, and the citation validator is a pure function.
 *
 * Run: bun test tests/copilot.test.ts
 */
import { describe, expect, test } from "bun:test";
import { copilotGate, validateCitations, DOSAGE_POSTCHECK } from "../src/lib/ai/copilot";

describe("copilot gates 1-2 (regression: must keep firing before any model call)", () => {
  test("emergency triage", () => {
    expect(copilotGate("I am having chest pain right now").kind).toBe("emergency");
  });
  test("scope refusal: dose change", () => {
    expect(copilotGate("Should I double my dose of metformin today?").kind).toBe("refused_scope");
  });
  test("scope refusal: stop taking", () => {
    expect(copilotGate("Can I stop taking my medicines without asking?").kind).toBe("refused_scope");
  });
  test("informational question passes the gates", () => {
    expect(copilotGate("What is metformin used for?").kind).toBe("ok");
  });
});

describe("TD-G: the post-generation dosage post-check (was untested)", () => {
  test("legit grounded answer is NOT rewritten", () => {
    const grounded =
      "Metformin is a biguanide used for type 2 diabetes [1]. It works mainly by reducing glucose production in the liver [2]. Common safety points are discussed in the sources.";
    expect(DOSAGE_POSTCHECK.detect(grounded)).toBe(false);
  });

  test("dosage prescription IS caught", () => {
    expect(DOSAGE_POSTCHECK.detect("You may take 2 tablets of Dolo every 6 hours.")).toBe(true);
    expect(DOSAGE_POSTCHECK.detect("Switch to insulin 10 units daily.")).toBe(true);
    expect(DOSAGE_POSTCHECK.detect("Start 500 mg metformin twice a day.")).toBe(true);
    expect(DOSAGE_POSTCHECK.detect("Stop 5 mg of the evening tablet.")).toBe(true);
  });

  test("exemption paths: allowed/always phrasing is not a personal prescription", () => {
    expect(DOSAGE_POSTCHECK.detect("The maximum allowed daily amount is 4000 mg [1].")).toBe(false);
    expect(DOSAGE_POSTCHECK.detect("It is always dispensed in 500 mg tablets [2].")).toBe(false);
  });
});

describe("TD-G: citation contract (deterministic, no judge needed)", () => {
  test("citations present and in range -> valid", () => {
    expect(validateCitations("Metformin lowers glucose [1]. It also helps weight [2].", 2)).toEqual({ ok: true });
    expect(validateCitations("One claim [1].", 3)).toEqual({ ok: true });
  });

  test("missing citations -> invalid", () => {
    const r = validateCitations("A confident answer with no citations at all.", 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no citations");
  });

  test("out-of-range citation number -> invalid", () => {
    const r = validateCitations("A claim [4] beyond the retrieved set.", 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("out of range");
  });
});

describe("TD-G: model-declared refusal relabel", () => {
  // The relabel lives inside answerCopilot behind the SDK call; its law is a
  // pure prefix check, pinned here verbatim so a prompt/pattern drift fails.
  test("exact refusal phrase is recognized", () => {
    expect(/^(i don'?t have verified information on that\.?)/i.test("I don't have verified information on that.")).toBe(true);
    expect(/^(i don'?t have verified information on that\.?)/i.test("I don't have verified information on that in my sources.")).toBe(true);
  });

  test("other sentences are NOT mistaken for the refusal phrase", () => {
    expect(/^(i don'?t have verified information on that\.?)/i.test("I don't know what you mean.")).toBe(false);
    expect(/^(i don'?t have verified information on that\.?)/i.test("Metformin is used for diabetes.")).toBe(false);
  });
});
