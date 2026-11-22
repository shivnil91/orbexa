import { sandboxReply } from "./marketplace.ts";

export const MODEL_TIMEOUT_MS = 20_000;
export const MODEL_MAX_OUTPUT_TOKENS = 700;
export const MODEL_MAX_INPUT_CHARS = 8_000;
export const MODEL_MAX_COST_USD = 0.05;
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const OPENAI_MODEL = "gpt-4o-mini";

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
  return Boolean(usable(env.ANTHROPIC_API_KEY) || usable(env.OPENAI_API_KEY));
}

export function anthropicModel(env: NodeJS.ProcessEnv = process.env): string {
  const requested = (env.ORBEXA_MODEL ?? "").trim();
  return requested || DEFAULT_ANTHROPIC_MODEL;
}

function usable(value: string | undefined): string | null {
  const key = (value ?? "").trim();
  if (key.length < 20 || key.includes("sk_live_") || key.includes("rk_live_")) {
    return null;
  }
  return key;
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
  const anthropicKey = usable(env.ANTHROPIC_API_KEY);
  const openaiKey = usable(env.OPENAI_API_KEY);
  if (!anthropicKey && !openaiKey) {
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
    let response: { text: string; inputTokens: number; outputTokens: number } | null = null;
    let provider: "anthropic" | "openai" = "anthropic";
    if (anthropicKey) {
      try {
        response = await callAnthropic(anthropicKey, anthropicModel(env), system, need, fetchImpl);
      } catch (error) {
        if (!openaiKey && isTimeout(error)) {
          return { ok: false, error: "timeout" };
        }
        response = null;
      }
    }
    if (!response && openaiKey) {
      provider = "openai";
      response = await callOpenAI(openaiKey, system, need, fetchImpl);
    }
    if (!response) {
      return { ok: false, error: "provider" };
    }
    const spent = response.inputTokens * INPUT_USD_PER_TOKEN + response.outputTokens * OUTPUT_USD_PER_TOKEN;
    if (spent > MODEL_MAX_COST_USD) {
      return { ok: false, error: "cap" };
    }
    const paragraphs = response.text.split(/\n{2,}/).map((part) => part.trim()).filter((part) => part.length > 0);
    if (paragraphs.length === 0) {
      return { ok: false, error: "empty" };
    }
    return { ok: true, paragraphs, provider, inputTokens: response.inputTokens, outputTokens: response.outputTokens };
  } catch (error) {
    if (isTimeout(error)) {
      return { ok: false, error: "timeout" };
    }
    return { ok: false, error: "provider" };
  }
}

function isTimeout(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

async function defaultFetch(url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, json: () => response.json() as Promise<unknown> };
}

async function callAnthropic(key: string, model: string, system: string, need: string, fetchImpl: FetchLike) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
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
      model: OPENAI_MODEL,
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
