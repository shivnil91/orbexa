import assert from "node:assert/strict";
import test from "node:test";
import { judgingModel, readModelCostLog, resetModelCostLog, routePlan, routeTask, tokenCostMinor } from "./model-router.ts";
import { callCost } from "./proof.ts";

const ANTHROPIC = "sk-ant-test-key-not-a-secret-value";
const OPENAI = "sk-openai-test-key-not-a-secret";

test("the judge model is different from the drafting model", () => {
  const env = { ORBEXA_MODEL: "claude-sonnet-5-5", ORBEXA_JUDGE_MODEL: "claude-sonnet-5-5", ANTHROPIC_API_KEY: ANTHROPIC, OPENAI_API_KEY: OPENAI };
  assert.notEqual(judgingModel(env), "claude-sonnet-5-5");
  const plan = routePlan("judging", env);
  assert.notEqual(plan[0]?.model, "claude-sonnet-5-5");
  const drafting = routePlan("drafting", env);
  assert.equal(drafting[0]?.model, "claude-sonnet-5-5");
  assert.equal(drafting[0]?.provider, "anthropic");
});

test("a failed provider falls back and the cost log keeps the prompt out", async () => {
  resetModelCostLog();
  const calls: string[] = [];
  const result = await routeTask({
    task: "drafting",
    system: "system",
    user: "secret buyer note",
    env: { ANTHROPIC_API_KEY: ANTHROPIC, OPENAI_API_KEY: OPENAI, ORBEXA_MODEL: "claude-sonnet-5-5" },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("anthropic")) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "A short draft." } }],
          usage: { prompt_tokens: 20, completion_tokens: 8 },
        }),
      };
    },
  });
  assert.deepEqual(calls, ["https://api.anthropic.com/v1/messages", "https://api.openai.com/v1/chat/completions"]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.provider, "openai");
    assert.equal(result.attempts[1]?.fallback, true);
    assert.equal(result.attempts[0]?.ok, false);
  }
  const logged = JSON.stringify(readModelCostLog());
  assert.equal(logged.includes("secret buyer note"), false);
  assert.equal(logged.includes(ANTHROPIC), false);
  assert.equal(tokenCostMinor("claude-sonnet-5-5", 1000, 1000), callCost("claude-sonnet-5-5", 1000, 1000));
});
