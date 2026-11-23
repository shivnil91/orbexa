import { randomUUID } from "node:crypto";
import type { KnowledgeAsset, ProofExample, ProofRecord } from "./demo-store.ts";
import { readDb, updateDb } from "./demo-store.ts";
import { assertNoLiveStripeKey } from "./live-key.ts";
import {
  PROOF_SYSTEM,
  agentPrompt,
  baselinePrompt,
  blindOrder,
  corpusFrom,
  heldOutTasks,
  isProven,
  judgePrompt,
  qualityScore,
  retrieveAssets,
  rubricSupport,
  type RubricSupport,
} from "./trust.ts";

const MODEL_TOKEN = /^[A-Za-z0-9._:-]{1,80}$/;
const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_JUDGE = "claude-haiku-4-5";

export type ModelCall = { model: string; system: string; user: string };
export type ModelResult = { text: string; inputTokens: number; outputTokens: number };
export type ModelTransport = (call: ModelCall) => Promise<ModelResult>;

export type ProofConfig = {
  live: boolean;
  model: string;
  judgeModel: string;
  budgetMinor: number;
  hourlyCap: number;
  key: string;
};

export function proofConfig(env: Record<string, string | undefined> = process.env): ProofConfig {
  const key = env.ANTHROPIC_API_KEY ?? "";
  const blocked = key.includes("sk_live_") || key.includes("rk_live_");
  const live = key.length > 0 && !blocked;
  const requested = env.ORBEXA_MODEL || DEFAULT_MODEL;
  const judge = env.ORBEXA_JUDGE_MODEL || DEFAULT_JUDGE;
  const budget = Number(env.ORBEXA_PROOF_BUDGET_MINOR ?? "80");
  const hourly = Number(env.ORBEXA_PROOF_HOURLY_CAP ?? "6");
  return {
    live,
    model: live && MODEL_TOKEN.test(requested) ? requested : "fixture",
    judgeModel: live && MODEL_TOKEN.test(judge) ? judge : "fixture",
    budgetMinor: Number.isFinite(budget) && budget >= 10 ? Math.min(budget, 100_000) : 80,
    hourlyCap: Number.isFinite(hourly) && hourly >= 1 ? Math.min(hourly, 100) : 6,
    key: live ? key : "",
  };
}

export function callCost(model: string, inputTokens: number, outputTokens: number): number {
  if (model === "fixture") return 1;
  return Math.max(1, Math.floor((inputTokens + outputTokens) / 1000));
}

export class ProofBudget {
  spent = 0;
  limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  charge(cost: number): void {
    if (!Number.isFinite(cost) || cost < 0 || this.spent + cost > this.limit) {
      throw new Error("proof budget");
    }
    this.spent += cost;
  }
}

export function hourlyOpen(stamps: string[], now: number, cap: number): boolean {
  const cutoff = now - 60 * 60 * 1000;
  return stamps.filter((stamp) => Date.parse(stamp) >= cutoff).length < cap;
}

type Material = { kind: string; text: string };

export function fixtureAnswer(role: "agent" | "baseline", support: RubricSupport): string {
  const any = support.specialist_check || support.leaves_gaps || support.no_guessed_fact;
  if (role === "baseline" || !any) {
    return "General draft from the question alone. A gap may be filled with a plausible guess. No specialist file was used.";
  }
  const lines = ["Specialist draft. Private seller material was applied and is not quoted."];
  if (support.leaves_gaps) lines.push("A missing item is left blank.");
  if (support.no_guessed_fact) lines.push("No measurement or certificate was invented.");
  if (support.specialist_check) lines.push("A specialist check was applied.");
  return lines.join(" ");
}

export type Graded = {
  agentOutput: string;
  baselineOutput: string;
  winner: "agent" | "baseline" | "tie";
  agentScore: number;
  baselineScore: number;
  order: "agent_first" | "baseline_first";
  rubric: { code: string; agent: number; baseline: number }[];
};

function rubricRows(agent: string, baseline: string): { code: string; agent: number; baseline: number }[] {
  const agentLower = agent.toLowerCase();
  const baseLower = baseline.toLowerCase();
  const hit = (text: string, phrase: string, banned?: string) => text.includes(phrase) && (banned ? !text.includes(banned) : true);
  return [
    { code: "specialist_check", agent: hit(agentLower, "specialist check") ? 1 : 0, baseline: hit(baseLower, "specialist check") ? 1 : 0 },
    { code: "leaves_gaps", agent: hit(agentLower, "left blank") ? 1 : 0, baseline: hit(baseLower, "left blank") ? 1 : 0 },
    {
      code: "no_guessed_fact",
      agent: hit(agentLower, "was invented", "plausible guess") ? 1 : 0,
      baseline: hit(baseLower, "was invented", "plausible guess") ? 1 : 0,
    },
  ];
}

export function gradePair(taskId: string, agentOutput: string, baselineOutput: string): Graded {
  const order = blindOrder(taskId);
  const left = order === "agent_first" ? agentOutput : baselineOutput;
  const right = order === "agent_first" ? baselineOutput : agentOutput;
  const leftScore = qualityScore(left);
  const rightScore = qualityScore(right);
  const agentScore = order === "agent_first" ? leftScore : rightScore;
  const baselineScore = order === "agent_first" ? rightScore : leftScore;
  const winner = agentScore === baselineScore ? "tie" : agentScore > baselineScore ? "agent" : "baseline";
  return { agentOutput, baselineOutput, winner, agentScore, baselineScore, order, rubric: rubricRows(agentOutput, baselineOutput) };
}

function parseJudgeScores(text: string): { a: number; b: number } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { a?: unknown; b?: unknown };
    if (typeof parsed.a !== "number" || typeof parsed.b !== "number") return null;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return { a: clamp(parsed.a), b: clamp(parsed.b) };
  } catch {
    return null;
  }
}

export async function gradeWithModel(
  transport: ModelTransport,
  budget: ProofBudget,
  judgeModel: string,
  taskId: string,
  task: string,
  agentOutput: string,
  baselineOutput: string,
): Promise<Graded> {
  const order = blindOrder(taskId);
  const left = order === "agent_first" ? agentOutput : baselineOutput;
  const right = order === "agent_first" ? baselineOutput : agentOutput;
  const result = await transport({ model: judgeModel, system: PROOF_SYSTEM, user: judgePrompt(task, left, right) });
  budget.charge(callCost(judgeModel, result.inputTokens, result.outputTokens));
  const scores = parseJudgeScores(result.text);
  const leftScore = scores ? Math.round(scores.a * 3) : qualityScore(left);
  const rightScore = scores ? Math.round(scores.b * 3) : qualityScore(right);
  const agentScore = order === "agent_first" ? leftScore : rightScore;
  const baselineScore = order === "agent_first" ? rightScore : leftScore;
  const winner = agentScore === baselineScore ? "tie" : agentScore > baselineScore ? "agent" : "baseline";
  return { agentOutput, baselineOutput, winner, agentScore, baselineScore, order, rubric: rubricRows(agentOutput, baselineOutput) };
}

export type ProofTask = { id: string; source: "held_out" | "seller_example"; task: string };

export function proofTasks(category: string, examples: { title: string; body: string }[]): ProofTask[] {
  const held: ProofTask[] = heldOutTasks(category).map((task, index) => ({ id: `${category}-${index}`, source: "held_out", task }));
  const extra: ProofTask[] = examples
    .filter((item) => item.title.trim() && item.body.trim())
    .slice(0, 2)
    .map((item, index) => ({
      id: `seller-${index}`,
      source: "seller_example",
      task: `Produce a draft a specialist would accept for: ${item.title}. Quality bar: ${item.body}`,
    }));
  return held.concat(extra);
}

export type ProofRunInput = {
  category: string;
  instructions: string;
  assets: KnowledgeAsset[];
  interview: { questionId: string; answer: string }[];
  examples: { title: string; body: string }[];
  version: number;
  config: ProofConfig;
  transport?: ModelTransport;
  now?: string;
};

function mean(rows: Graded[], code: string, side: "agent" | "baseline"): number {
  const held = rows;
  if (held.length === 0) return 0;
  const total = held.reduce((sum, row) => sum + (row.rubric.find((item) => item.code === code)?.[side] ?? 0), 0);
  return Math.round((total / held.length) * 100) / 100;
}

export async function executeProof(input: ProofRunInput): Promise<ProofRecord> {
  const config = input.config.live ? input.config : { ...input.config, model: "fixture", judgeModel: "fixture", live: false };
  const budget = new ProofBudget(config.budgetMinor);
  const support = rubricSupport(corpusFrom(input));
  const tasks = proofTasks(input.category, input.examples);
  const graded: { task: ProofTask; grade: Graded }[] = [];
  let capped = false;
  const transport = input.transport;
  try {
    for (const task of tasks) {
      const retrieved = retrieveAssets(input.assets, task.task).map((asset) => ({ kind: asset.kind, text: asset.text }));
      const interview = input.interview
        .filter((item) => item.answer.trim().length >= 8)
        .map((item) => ({ kind: "rule", text: item.answer }));
      const material: Material[] = [
        ...(input.instructions.trim() ? [{ kind: "instructions", text: input.instructions }] : []),
        ...interview,
        ...retrieved.map((asset) => ({ kind: asset.kind, text: asset.text })),
      ];
      let agentOutput = fixtureAnswer("agent", support);
      let baselineOutput = fixtureAnswer("baseline", support);
      if (config.live && transport) {
        const agent = await transport({ model: config.model, system: PROOF_SYSTEM, user: agentPrompt(task.task, material) });
        budget.charge(callCost(config.model, agent.inputTokens, agent.outputTokens));
        const baseline = await transport({ model: config.model, system: PROOF_SYSTEM, user: baselinePrompt(task.task) });
        budget.charge(callCost(config.model, baseline.inputTokens, baseline.outputTokens));
        agentOutput = agent.text.trim().slice(0, 1200);
        baselineOutput = baseline.text.trim().slice(0, 1200);
        const judged = await gradeWithModel(transport, budget, config.judgeModel, task.id, task.task, agentOutput, baselineOutput);
        graded.push({ task, grade: judged });
      } else {
        budget.charge(callCost("fixture", 0, 0));
        budget.charge(callCost("fixture", 0, 0));
        budget.charge(callCost("fixture", 0, 0));
        graded.push({ task, grade: gradePair(task.id, agentOutput, baselineOutput) });
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "proof budget") {
      capped = true;
    } else {
      throw error;
    }
  }
  const held = graded.filter((row) => row.task.source === "held_out");
  const wins = held.filter((row) => row.grade.winner === "agent").length;
  const ties = held.filter((row) => row.grade.winner === "tie").length;
  const losses = held.filter((row) => row.grade.winner === "baseline").length;
  const tests = held.length;
  const winRate = tests === 0 ? 0 : Math.round((wins / tests) * 1000) / 1000;
  const proven = isProven(wins, tests);
  const side = [
    ...graded.filter((row) => row.task.source === "seller_example"),
    ...graded.filter((row) => row.task.source === "held_out"),
  ].slice(0, 2);
  const examples: ProofExample[] = side.map((row) => ({
    task: row.task.task,
    source: row.task.source,
    agentOutput: row.grade.agentOutput,
    baselineOutput: row.grade.baselineOutput,
    winner: row.grade.winner,
    agentScore: row.grade.agentScore,
    baselineScore: row.grade.baselineScore,
  }));
  const now = input.now ?? new Date().toISOString();
  return {
    id: randomUUID(),
    version: input.version,
    status: tests >= 10 ? "complete" : "failed",
    startedAt: now,
    finishedAt: now,
    model: config.model,
    judgeModel: config.judgeModel,
    fixture: !config.live,
    tests,
    wins,
    ties,
    losses,
    winRate,
    proven,
    rubric: [
      { code: "specialist_check", agent: mean(held.map((row) => row.grade), "specialist_check", "agent"), baseline: mean(held.map((row) => row.grade), "specialist_check", "baseline") },
      { code: "leaves_gaps", agent: mean(held.map((row) => row.grade), "leaves_gaps", "agent"), baseline: mean(held.map((row) => row.grade), "leaves_gaps", "baseline") },
      { code: "no_guessed_fact", agent: mean(held.map((row) => row.grade), "no_guessed_fact", "agent"), baseline: mean(held.map((row) => row.grade), "no_guessed_fact", "baseline") },
    ],
    examples,
    costMinor: budget.spent,
    capped: capped && tests < 10,
    error: capped && tests < 10 ? "budget" : undefined,
  };
}

const tails = new Map<string, Promise<void>>();

export function anthropicTransport(key: string): ModelTransport {
  assertNoLiveStripeKey({ ANTHROPIC_API_KEY: key });
  return async (call) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: call.model,
        max_tokens: 1024,
        system: call.system,
        messages: [{ role: "user", content: call.user }],
      }),
    });
    if (!response.ok) {
      throw new Error("model request failed");
    }
    const parsed = (await response.json()) as {
      content?: { text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = parsed.content?.[0]?.text ?? "";
    return {
      text,
      inputTokens: parsed.usage?.input_tokens ?? Math.max(1, Math.ceil(call.user.length / 4)),
      outputTokens: parsed.usage?.output_tokens ?? Math.max(1, Math.ceil(text.length / 4)),
    };
  };
}

export async function runStoredProof(slug: string, env: Record<string, string | undefined> = process.env, transport?: ModelTransport): Promise<void> {
  try {
    const config = proofConfig(env);
    const db = await readDb();
    const agent = db.agents.find((item) => item.slug === slug);
    const owner = db.users.find((user) => user.id === agent?.ownerId);
    if (!agent || !agent.proof || agent.proof.status === "complete") return;
    const stamps = owner?.proofRuns ?? [];
    if (!hourlyOpen(stamps, Date.now(), config.hourlyCap)) {
      await updateDb((current) => {
        const row = current.agents.find((item) => item.slug === slug);
        if (!row?.proof || row.proof.status === "complete") return;
        row.proof = { ...row.proof, status: "failed", finishedAt: new Date().toISOString(), error: "hourly", proven: false };
      });
      return;
    }
    const version = agent.proof.version;
    await updateDb((current) => {
      const row = current.agents.find((item) => item.slug === slug);
      const user = current.users.find((item) => item.id === row?.ownerId);
      if (!row?.proof || row.proof.version !== version) return;
      row.proof = { ...row.proof, status: "running" };
      if (user) {
        const recent = (user.proofRuns ?? []).filter((stamp) => Date.parse(stamp) >= Date.now() - 60 * 60 * 1000);
        user.proofRuns = recent.concat(new Date().toISOString()).slice(-50);
      }
    });
    const result = await executeProof({
      category: agent.category,
      instructions: agent.instructions,
      assets: agent.assets ?? [],
      interview: agent.interview ?? [],
      examples: agent.exampleOutputs,
      version,
      config,
      transport: transport ?? (config.live ? anthropicTransport(config.key) : undefined),
    });
    await updateDb((current) => {
      const row = current.agents.find((item) => item.slug === slug);
      if (!row?.proof || row.proof.version !== version) return;
      row.proof = { ...result, id: row.proof.id, startedAt: row.proof.startedAt };
    });
  } catch {
    await updateDb((current) => {
      const row = current.agents.find((item) => item.slug === slug);
      if (!row?.proof || row.proof.status === "complete") return;
      row.proof = { ...row.proof, status: "failed", finishedAt: new Date().toISOString(), error: "run", proven: false };
    });
  }
}

export function scheduleProof(slug: string, env: Record<string, string | undefined> = process.env): void {
  const previous = tails.get(slug) ?? Promise.resolve();
  const next = previous.then(() => runStoredProof(slug, env), () => runStoredProof(slug, env));
  tails.set(slug, next);
  void next.finally(() => {
    if (tails.get(slug) === next) tails.delete(slug);
  });
}

const EXAMPLE_ASSETS: KnowledgeAsset[] = [{
  id: "example-asset",
  kind: "checklist",
  name: "bid-checklist.txt",
  text: "Check every evaluation factor. Mark a missing certificate as missing. Do not invent a certificate or a measurement.",
}];

export async function exampleHarnessProof(): Promise<ProofRecord> {
  return executeProof({
    category: "tenders",
    instructions: "Follow the solicitation. Leave a requirement blank when the file does not support it. Never invent a certificate.",
    assets: EXAMPLE_ASSETS,
    interview: [
      { questionId: "never", answer: "Never invent a certificate, a measurement, or a date that is not in the file." },
      { questionId: "incomplete", answer: "When the brief is incomplete, leave the gap blank and name the missing item." },
    ],
    examples: [{ title: "Missing certificate", body: "The certificate row stays missing evidence. No certificate number was added." }],
    version: 1,
    config: proofConfig({}),
    now: "2026-04-01T00:00:00.000Z",
  });
}
