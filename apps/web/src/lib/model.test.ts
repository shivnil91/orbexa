import assert from "node:assert/strict";
import test from "node:test";
import { anthropicModel, DEFAULT_ANTHROPIC_MODEL, draftDeliverable, estimateDraftCost, MODEL_MAX_COST_USD, modelConfigured } from "./model.ts";

const KEY = "sk-ant-test-key-not-a-secret-value";

test("without a model key the draft is the local fixture and quotes the request", async () => {
  const result = await draftDeliverable(
    { name: "Support reply", instructions: "Restate the issue.", knowledge: "", need: "The catering deposit" },
    {},
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.provider, "fixture");
    assert.match(result.paragraphs.join("\n"), /Thanks for writing about the catering order/);
    assert.equal(result.paragraphs.join("\n").includes("Restate the issue."), false);
  }
  assert.equal(modelConfigured({}), false);
  assert.equal(modelConfigured({ ANTHROPIC_API_KEY: "short", OPENAI_API_KEY: "sk_live_rejected_key_value" }), false);
});

test("a draft over the cost cap is refused before any provider call", async () => {
  let called = false;
  const result = await draftDeliverable(
    { name: "Huge", instructions: "x".repeat(21_000), knowledge: "", need: "y".repeat(1_000) },
    { ANTHROPIC_API_KEY: KEY },
    async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  );
  assert.equal(called, false);
  assert.deepEqual(result, { ok: false, error: "cap" });
  assert.ok(estimateDraftCost(8_000) < MODEL_MAX_COST_USD);
});

test("a provider failure does not echo the key or the buyer text", async () => {
  const result = await draftDeliverable(
    { name: "Support reply", instructions: "Restate the issue in plain words.", knowledge: "", need: "secret catering note" },
    { ANTHROPIC_API_KEY: KEY },
    async () => {
      throw new Error(`boom ${KEY} secret catering note`);
    },
  );
  assert.deepEqual(result, { ok: false, error: "provider" });
  assert.equal(JSON.stringify(result).includes(KEY), false);
  assert.equal(JSON.stringify(result).includes("secret catering note"), false);
});

test("an Anthropic response becomes the deliverable", async () => {
  const result = await draftDeliverable(
    { name: "Support reply", instructions: "Restate the issue in plain words.", knowledge: "", need: "The deposit is unpaid." },
    { ANTHROPIC_API_KEY: KEY },
    async (_url, init) => {
      assert.equal(init.headers["x-api-key"], KEY);
      assert.equal(JSON.parse(init.body).model, DEFAULT_ANTHROPIC_MODEL);
      assert.equal(JSON.stringify(init.headers).includes("authorization"), false);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "text", text: "Thanks for writing.\n\nThe deposit is still unpaid. Reply with the date you can send it." }],
          usage: { input_tokens: 40, output_tokens: 20 },
        }),
      };
    },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.provider, "anthropic");
    assert.match(result.paragraphs.join("\n"), /deposit is still unpaid/);
    assert.equal(result.outputTokens, 20);
  }
});

test("a retired Anthropic model error falls through to OpenAI", async () => {
  const calls: string[] = [];
  const result = await draftDeliverable(
    { name: "Support reply", instructions: "Restate the issue in plain words.", knowledge: "", need: "The deposit is unpaid." },
    { ANTHROPIC_API_KEY: KEY, OPENAI_API_KEY: "sk-openai-test-key-not-a-secret", ORBEXA_MODEL: "claude-haiku-5-5" },
    async (url) => {
      calls.push(url);
      if (url.includes("anthropic")) {
        return { ok: false, status: 404, json: async () => ({ error: { message: "model not found" } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Thanks for writing.\n\nReply with the date you can send the deposit." } }],
          usage: { prompt_tokens: 20, completion_tokens: 12 },
        }),
      };
    },
  );
  assert.deepEqual(calls, ["https://api.anthropic.com/v1/messages", "https://api.openai.com/v1/chat/completions"]);
  assert.equal(anthropicModel({ ORBEXA_MODEL: "claude-haiku-5-5" }), "claude-haiku-5-5");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.provider, "openai");
    assert.equal(JSON.stringify(result).includes("model not found"), false);
    assert.equal(JSON.stringify(result).includes("Restate the issue"), false);
  }
});

test("OpenAI is used only when Anthropic is unset", async () => {
  const result = await draftDeliverable(
    { name: "Scope note", instructions: "List scope and assumptions in plain words.", knowledge: "", need: "Redesign the menu." },
    { OPENAI_API_KEY: "sk-openai-test-key-not-a-secret" },
    async (url) => {
      assert.match(url, /openai\.com/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Scope: the menu.\n\nOut of scope: the website." } }],
          usage: { prompt_tokens: 30, completion_tokens: 12 },
        }),
      };
    },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.provider, "openai");
  }
});
