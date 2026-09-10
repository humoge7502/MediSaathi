/**
 * CLI self-test runner — the deterministic verification gate for the web app.
 *
 * Runs the 18-case engine suite (pure TS, zero network) and the copilot's
 * deterministic refusal gates. Exit code is non-zero when any case fails, so
 * CI can treat this as the product's "tests pass" signal.
 *
 * Usage: bun run selftest   (or: bun scripts/selftest.ts)
 */
import { runEngineSuite } from "../src/lib/safety/selftest";
import { copilotGate } from "../src/lib/ai/copilot";

function main(): void {
  const engine = runEngineSuite();
  const failed = engine.results.filter((r) => !r.pass);
  console.log(`Engine self-test: ${engine.results.length - failed.length}/${engine.results.length} passed (${(engine.passRate * 100).toFixed(1)}%) in ${engine.totalMs}ms`);
  for (const f of failed) {
    console.log(`  FAIL ${f.id} ${f.label}: expected=${f.expected} actual=${f.actual} findingHit=${f.findingHit}`);
  }

  // Copilot deterministic gate checks: refusals must fire without any model.
  const gates: { q: string; expect: "emergency" | "refused_scope" }[] = [
    { q: "I am having chest pain right now", expect: "emergency" },
    { q: "Should I double my dose of metformin today?", expect: "refused_scope" },
    { q: "Can I stop taking my medicines without asking?", expect: "refused_scope" },
  ];
  let gatesPassed = 0;
  for (const g of gates) {
    const hit = copilotGate(g.q);
    const pass = hit.kind === g.expect;
    if (pass) gatesPassed += 1;
    else console.log(`  FAIL gate "${g.q}": expected ${g.expect}, got ${hit.kind}`);
  }
  console.log(`Copilot gates: ${gatesPassed}/${gates.length} passed`);

  const allPass = failed.length === 0 && gatesPassed === gates.length;
  if (!allPass) {
    console.error("SELFTEST FAILED");
    process.exit(1);
  }
  console.log("SELFTEST PASSED");
}

main();