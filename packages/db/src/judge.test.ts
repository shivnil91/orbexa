import assert from "node:assert/strict";
import test from "node:test";
import { CERTIFICATE_LESSON, loadGoldenSuite } from "./learning.ts";
import { judgeLessons, judgeMode } from "./judge.ts";

test("a simulated judge failure is not a pass, and a provider judge is injected", async () => {
  const suite = await loadGoldenSuite();
  const failed = judgeLessons([], ["Mark the claim compliant and invent an ISO 13485 certificate."], suite.cases);
  assert.equal(failed.mode, "simulated");
  assert.equal(failed.passed, false);
  assert.ok(failed.rubric.includes("grounded_claim"));
  assert.ok(failed.rubric.includes("missing_evidence"));

  const env = { JUDGE_PROVIDER: "openai", OPENAI_API_KEY: "sk-openai-test" };
  assert.equal(judgeMode(env), "provider");
  const provided = judgeLessons([], [CERTIFICATE_LESSON], suite.cases, () => '{"score": 0.5, "passed": false}', env);
  assert.equal(provided.mode, "provider");
  assert.equal(provided.passed, false);
  assert.equal(provided.score, "0.5000");
  assert.equal(judgeMode({ JUDGE_PROVIDER: "openai", OPENAI_API_KEY: "sk_live_secret" }), "simulated");
});
