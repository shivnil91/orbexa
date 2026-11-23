import { DEFAULT_ANTHROPIC_MODEL, MODEL_MAX_OUTPUT_TOKENS, MODEL_TIMEOUT_MS, OPENAI_MODEL } from "./model-limits.ts";

export type ModelTask = "drafting" | "extraction" | "judging";

export type RouteEnv = Record<string, string | undefined>;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type CostEntry = {
  at: string;
  task: ModelTask;
  provider: "anthropic" | "openai" | "fixture";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMinor: number;
  ok: boolean;
  fallback: boolean;
};

export type RouteResult =
  | { ok: true; text: string; provider: "anthropic" | "openai" | "fixture"; model: string; inputTokens: number; outputTokens: number; costMinor: number; attempts: CostEntry[] }
  | { ok: false; error: "cap" | "timeout" | "provider" | "empty"; attempts: CostEntry[] };

const RATES = [
  { name: "haiku", inputPerMillion: 100, outputPerMillion: 500 },
  { name: "sonnet", inputPerMillion: 300, outputPerMillion: 1500 },
  { name: "opus", inputPerMillion: 1500, outputPerMillion: 7500 },
  { name: "gpt-4o-mini", inputPerMillion: 15, outputPerMillion: 60 },
  { name: "gpt", inputPerMillion: 250, outputPerMillion: 1000 },
] as const;

const costLog: CostEntry[] = [];
const callStamps: number[] = [];

export function resetModelCostLog(): void {
  costLog.length = 0;
}

export function readModelCostLog(): CostEntry[] {
  return costLog.map((entry) => ({ ...entry }));
}

/** Cents. Same shape as the proof table, plus a small OpenAI row. Not a vendor invoice. */
export function tokenCostMinor(model: string, inputTokens: number, outputTokens: number): number {
  if (model === "fixture") return 0;
  const tokensIn = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const tokensOut = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;
  const key = model.toLowerCase();
  const rate = RATES.find((row) => key.includes(row.name)) ?? RATES[1];
  const cents = (tokensIn * rate.inputPerMillion + tokensOut * rate.outputPerMillion) / 1_000_000;
  return Math.max(tokensIn + tokensOut > 0 ? 1 : 0, Math.ceil(cents - 1e-9));
}

function usable(value: string | undefined): string | null {
  const key = (value ?? "").trim();
  if (key.length < 20 || key.includes("sk_live_") || key.includes("rk_live_")) return null;
  return key;
}

function remember(entry: CostEntry): void {
  costLog.push(entry);
  if (costLog.length > 200) costLog.splice(0, costLog.length - 200);
}

function capAllows(env: RouteEnv): boolean {
  const explicit = env.ORBEXA_MODEL_HOURLY_CAP;
  const cap = explicit != null && explicit !== ""
    ? Number(explicit)
    : env.ORBEXA_ENV === "dev"
      ? 30
      : null;
  if (cap == null) return true;
  if (!Number.isSafeInteger(cap) || cap < 0) return false;
  const now = Date.now();
  while (callStamps.length > 0 && now - callStamps[0] > 3_600_000) callStamps.shift();
  if (callStamps.length >= cap) return false;
  callStamps.push(now);
  return true;
}

export type RouteStep = { provider: "anthropic" | "openai"; model: string };

export function draftingModel(env: RouteEnv): string {
  const requested = (env.ORBEXA_MODEL ?? "").trim();
  if (!requested) return DEFAULT_ANTHROPIC_MODEL;
  if (requested.toLowerCase().startsWith("gpt")) return requested;
  return requested;
}

/** The judge is never the same model string as the drafting default. */
export function judgingModel(env: RouteEnv): string {
  const draft = draftingModel(env);
  const requested = (env.ORBEXA_JUDGE_MODEL ?? "").trim() || "claude-haiku-4-5";
  if (requested !== draft) return requested;
  const alternates = ["claude-haiku-4-5", "gpt-4o-mini", "claude-sonnet-5-5"];
  return alternates.find((model) => model !== draft) ?? "claude-haiku-4-5";
}

export function extractionModel(env: RouteEnv): string {
  const requested = (env.ORBEXA_EXTRACT_MODEL ?? "").trim();
  if (requested && requested !== draftingModel(env)) return requested;
  return judgingModel(env);
}

function providerFor(model: string): "anthropic" | "openai" {
  return model.toLowerCase().startsWith("gpt") ? "openai" : "anthropic";
}

export function routePlan(task: ModelTask, env: RouteEnv): RouteStep[] {
  const anthropic = usable(env.ANTHROPIC_API_KEY);
  const openai = usable(env.OPENAI_API_KEY);
  const preferred = task === "judging" ? judgingModel(env) : task === "extraction" ? extractionModel(env) : draftingModel(env);
  const primary: RouteStep = { provider: providerFor(preferred), model: preferred };
  const fallbackModel = primary.provider === "anthropic" ? OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL;
  const fallback: RouteStep = { provider: primary.provider === "anthropic" ? "openai" : "anthropic", model: fallbackModel };
  const steps = [primary, fallback].filter((step, index, all) => all.findIndex((item) => item.provider === step.provider && item.model === step.model) === index);
  return steps.filter((step) => (step.provider === "anthropic" ? anthropic : openai));
}

function isTimeout(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

async function defaultFetch(url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, json: () => response.json() as Promise<unknown> };
}

async function callStep(step: RouteStep, key: string, system: string, user: string, fetchImpl: FetchLike): Promise<{ text: string; inputTokens: number; outputTokens: number } | null> {
  if (step.provider === "anthropic") {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: step.model,
        max_tokens: MODEL_MAX_OUTPUT_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json() as { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (body.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
    if (!text) return null;
    return { text, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
  }
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: step.model,
      max_tokens: MODEL_MAX_OUTPUT_TOKENS,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const body = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const text = (body.choices?.[0]?.message?.content ?? "").trim();
  if (!text) return null;
  return { text, inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 };
}

export async function routeTask(input: {
  task: ModelTask;
  system: string;
  user: string;
  env?: RouteEnv;
  fetchImpl?: FetchLike;
  budgeted?: boolean;
}): Promise<RouteResult> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? defaultFetch;
  const plan = routePlan(input.task, env);
  const attempts: CostEntry[] = [];
  if (plan.length === 0) {
    return { ok: false, error: "provider", attempts };
  }
  let timedOut = false;
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    if (!input.budgeted && !capAllows(env)) {
      return { ok: false, error: "cap", attempts };
    }
    const key = step.provider === "anthropic" ? usable(env.ANTHROPIC_API_KEY) : usable(env.OPENAI_API_KEY);
    if (!key) continue;
    try {
      const response = await callStep(step, key, input.system, input.user, fetchImpl);
      const entry: CostEntry = {
        at: new Date().toISOString(),
        task: input.task,
        provider: step.provider,
        model: step.model,
        inputTokens: response?.inputTokens ?? 0,
        outputTokens: response?.outputTokens ?? 0,
        costMinor: tokenCostMinor(step.model, response?.inputTokens ?? 0, response?.outputTokens ?? 0),
        ok: Boolean(response),
        fallback: index > 0,
      };
      attempts.push(entry);
      remember(entry);
      if (!response) continue;
      return { ok: true, text: response.text, provider: step.provider, model: step.model, inputTokens: response.inputTokens, outputTokens: response.outputTokens, costMinor: entry.costMinor, attempts };
    } catch (error) {
      const entry: CostEntry = {
        at: new Date().toISOString(),
        task: input.task,
        provider: step.provider,
        model: step.model,
        inputTokens: 0,
        outputTokens: 0,
        costMinor: 0,
        ok: false,
        fallback: index > 0,
      };
      attempts.push(entry);
      remember(entry);
      if (isTimeout(error)) timedOut = true;
    }
  }
  return { ok: false, error: timedOut && attempts.every((item) => !item.ok) ? "timeout" : "provider", attempts };
}

export function routerModelTransport(env: RouteEnv = process.env) {
  return async (call: { model: string; system: string; user: string }) => {
    const task: ModelTask = /score two drafts/i.test(call.system) ? "judging" : /buyer scenarios/i.test(call.system) ? "extraction" : "drafting";
    const routed = await routeTask({ task, system: call.system, user: call.user, env: { ...env, ORBEXA_MODEL: task === "drafting" ? call.model : env.ORBEXA_MODEL, ORBEXA_JUDGE_MODEL: task === "judging" ? call.model : env.ORBEXA_JUDGE_MODEL }, budgeted: true });
    if (!routed.ok) {
      throw new Error("model request failed");
    }
    return { text: routed.text, inputTokens: routed.inputTokens, outputTokens: routed.outputTokens };
  };
}
