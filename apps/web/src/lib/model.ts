import { sandboxReply } from "./marketplace.ts";

export const MODEL_TIMEOUT_MS = 20_000;
export const MODEL_MAX_OUTPUT_TOKENS = 700;
export const MODEL_MAX_INPUT_CHARS = 8_000;
export const MODEL_MAX_COST_USD = 0.05;

const INPUT_USD_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 15 / 1_000_000;

export type DraftRequest = {
  name: string;
  instructions: string;
  knowledge: string;
  need: string;
};

export type DraftOutcome =
  | { ok: true; paragraphs: string[]; provider: "fixture" | "anthropic" | "openai"; inputTokens: number; outputTokens: number }
  | { ok: false; error: "timeout" | "cap" | "provider" | "empty" };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function modelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return providerKey(env) !== null;
}

function usable(value: string | undefined): string | null {
  const key = (value ?? "").trim();
  if (key.length < 20 || key.includes("sk_live_") || key.includes("rk_live_")) {
    return null;
  }
  return key;
}

function providerKey(env: NodeJS.ProcessEnv): { provider: "anthropic" | "openai"; key: string } | null {
  const anthropic = usable(env.ANTHROPIC_API_KEY);
  if (anthropic) {
    return { provider: "anthropic", key: anthropic };
  }
  const openai = usable(env.OPENAI_API_KEY);
  if (openai) {
    return { provider: "openai", key: openai };
  }
  return null;
}

export function estimateDraftCost(inputChars: number): number {
  const inputTokens = Math.ceil(Math.max(0, inputChars) / 4);
  return inputTokens * INPUT_USD_PER_TOKEN + MODEL_MAX_OUTPUT_TOKENS * OUTPUT_USD_PER_TOKEN;
}

function clip(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max);
}

export async function draftDeliverable(
  input: DraftRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = defaultFetch,
): Promise<DraftOutcome> {
  const selected = providerKey(env);
  if (!selected) {
    const paragraphs = sandboxReply(input);
    return { ok: true, paragraphs, provider: "fixture", inputTokens: 0, outputTokens: 0 };
  }
  const instructions = clip(input.instructions, 4_000);
  const knowledge = clip(input.knowledge, 2_000);
  const need = clip(input.need, 2_000);
  const promptChars = instructions.length + knowledge.length + need.length + input.name.length;
  if (input.instructions.length + input.knowledge.length + input.need.length > 20_000 || estimateDraftCost(promptChars) > MODEL_MAX_COST_USD) {
    return { ok: false, error: "cap" };
  }
  const system = [
    `You are the listing "${clip(input.name, 120)}". Follow the seller's instructions. Do the buyer's job. Do not invent numbers, citations, or facts the buyer did not give you. If something is missing, say what is missing.`,
    `Seller instructions: ${instructions}`,
    knowledge ? `Seller notes: ${knowledge}` : "",
  ].filter((part) => part.length > 0).join("\n\n");
  try {
    const response = selected.provider === "anthropic"
      ? await callAnthropic(selected.key, system, need, fetchImpl)
      : await callOpenAI(selected.key, system, need, fetchImpl);
    if (!response) {
      return { ok: false, error: "empty" };
    }
    const spent = response.inputTokens * INPUT_USD_PER_TOKEN + response.outputTokens * OUTPUT_USD_PER_TOKEN;
    if (spent > MODEL_MAX_COST_USD) {
      return { ok: false, error: "cap" };
    }
    return {
      ok: true,
      paragraphs: response.text.split(/\n{2,}/).map((part) => part.trim()).filter((part) => part.length > 0),
      provider: selected.provider,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, error: "timeout" };
    }
    return { ok: false, error: "provider" };
  }
}

async function defaultFetch(url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, json: () => response.json() as Promise<unknown> };
}

async function callAnthropic(key: string, system: string, need: string, fetchImpl: FetchLike) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: MODEL_MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: "user", content: need }],
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!response.ok) {
    return null;
  }
  const body = await response.json() as {
    content?: { type?: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (body.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n\n").trim();
  if (!text) {
    return null;
  }
  return {
    text,
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };
}

async function callOpenAI(key: string, system: string, need: string, fetchImpl: FetchLike) {
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: MODEL_MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: system },
        { role: "user", content: need },
      ],
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!response.ok) {
    return null;
  }
  const body = await response.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = (body.choices?.[0]?.message?.content ?? "").trim();
  if (!text) {
    return null;
  }
  return {
    text,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
  };
}
