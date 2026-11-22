import { metricsByAgentVersion, type AgentVersionMetrics } from "./dashboard.ts";

type InvocationLine = {
  kind: "invocation";
  agentVersionId: string;
  currency: string;
  jobId: string;
  costMinor: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
};

type MetricLine = {
  kind: "run_metric";
  agentVersionId: string;
  currency: string;
  jobId: string;
  groundedClaimRate: number;
  latencyMs: number;
  costMinor: number;
};

type DraftLine = { kind: "draft"; agentVersionId: string; jobId: string };

export type DashboardRow = AgentVersionMetrics & { inputTokens: number; outputTokens: number };

export function metricsFromLog(text: string): DashboardRow[] {
  const metrics = [];
  const invocations = [];
  const drafts = [];
  const tokens = new Map<string, { input: number; output: number }>();
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parsed = JSON.parse(line) as InvocationLine | MetricLine | DraftLine;
    if (parsed.kind === "run_metric") {
      metrics.push({
        agentVersionId: parsed.agentVersionId,
        currency: parsed.currency,
        groundedClaimRate: parsed.groundedClaimRate,
        latencyMs: parsed.latencyMs,
        costMinor: parsed.costMinor,
      });
    } else if (parsed.kind === "invocation") {
      invocations.push({
        agentVersionId: parsed.agentVersionId,
        currency: parsed.currency,
        jobId: parsed.jobId,
        costMinor: parsed.costMinor,
      });
      const key = `${parsed.agentVersionId}:${parsed.currency}`;
      const current = tokens.get(key) ?? { input: 0, output: 0 };
      tokens.set(key, {
        input: current.input + (parsed.inputTokens ?? 0),
        output: current.output + (parsed.outputTokens ?? 0),
      });
    } else if (parsed.kind === "draft") {
      drafts.push({ agentVersionId: parsed.agentVersionId, jobId: parsed.jobId });
    }
  }
  return metricsByAgentVersion(metrics, invocations, drafts).map((row) => {
    const counted = tokens.get(`${row.agentVersionId}:${row.currency}`) ?? { input: 0, output: 0 };
    return { ...row, inputTokens: counted.input, outputTokens: counted.output };
  });
}
