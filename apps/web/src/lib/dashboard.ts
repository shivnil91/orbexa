export type RunMetricRow = {
  agentVersionId: string;
  currency: string;
  groundedClaimRate: number;
  latencyMs: number;
  costMinor: number;
};

export type InvocationRow = {
  agentVersionId: string;
  currency: string;
  jobId: string;
  costMinor: number;
};

export type DraftRow = {
  agentVersionId: string;
  jobId: string;
};

export type AgentVersionMetrics = {
  agentVersionId: string;
  currency: string;
  groundedClaimRate: number;
  latencyMs: number;
  costPerJobMinor: number;
  invocationCostMinor: number;
  revisionRate: number;
  jobCount: number;
};

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function metricsByAgentVersion(
  metrics: RunMetricRow[],
  invocations: InvocationRow[],
  drafts: DraftRow[],
): AgentVersionMetrics[] {
  const groups = new Map<string, RunMetricRow[]>();
  for (const row of metrics) {
    const key = `${row.agentVersionId}:${row.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const [agentVersionId, currency] = key.split(":");
      const metricJobs = rows.length;
      const draftCounts = new Map<string, number>();
      for (const draft of drafts) {
        if (draft.agentVersionId !== agentVersionId) {
          continue;
        }
        draftCounts.set(draft.jobId, (draftCounts.get(draft.jobId) ?? 0) + 1);
      }
      const revisionFlags = [...draftCounts.values()].map((count) => (count > 1 ? 1 : 0));
      const spentByJob = new Map<string, number>();
      for (const invocation of invocations) {
        if (invocation.agentVersionId !== agentVersionId || invocation.currency !== currency) {
          continue;
        }
        spentByJob.set(invocation.jobId, (spentByJob.get(invocation.jobId) ?? 0) + invocation.costMinor);
      }
      return {
        agentVersionId,
        currency,
        groundedClaimRate: mean(rows.map((row) => row.groundedClaimRate)),
        latencyMs: mean(rows.map((row) => row.latencyMs)),
        costPerJobMinor: mean(rows.map((row) => row.costMinor)),
        invocationCostMinor: mean([...spentByJob.values()]),
        revisionRate: revisionFlags.length === 0 ? 0 : mean(revisionFlags),
        jobCount: metricJobs,
      };
    })
    .sort((left, right) => left.agentVersionId.localeCompare(right.agentVersionId));
}

export const FIXTURE_DASHBOARD = metricsByAgentVersion(
  [
    {
      agentVersionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      currency: "USD",
      groundedClaimRate: 0.5,
      latencyMs: 1200,
      costMinor: 40,
    },
  ],
  [
    {
      agentVersionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      currency: "USD",
      jobId: "job-a",
      costMinor: 40,
    },
  ],
  [
    { agentVersionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", jobId: "job-a" },
    { agentVersionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", jobId: "job-a" },
  ],
);

export function formatRate(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export function formatMinor(amount: number, currency: string): string {
  return `${currency} ${(amount / 100).toFixed(2)}`;
}
