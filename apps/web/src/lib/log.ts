const SECRET_KEY = /password|prompt|instruction|token|authorization|cookie|secret|email|csv|answer|need|body|text|hash|salt/i;

export type LogFields = Record<string, string | number | boolean | null | undefined>;

/**
 * One JSON object per line. Fields that could carry a prompt, a secret, or
 * a person's contact details are dropped. Long strings are dropped too.
 */
export function logEvent(fields: LogFields): void {
  const line: Record<string, unknown> = {
    time: new Date().toISOString(),
    service: "orbexa-api",
  };
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEY.test(key) || value === undefined) continue;
    if (typeof value === "string") {
      if (value.length > 180) continue;
      line[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      line[key] = value;
    }
  }
  const metrics: Array<{ Name: string; Unit: string }> = [];
  if (typeof line.durationMs === "number") {
    metrics.push({ Name: "Latency", Unit: "Milliseconds" });
    line.Latency = line.durationMs;
  }
  if (typeof line.costMinor === "number") {
    metrics.push({ Name: "ModelSpendCents", Unit: "Count" });
    line.ModelSpendCents = line.costMinor;
  }
  if (metrics.length > 0) {
    line._aws = {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{ Namespace: "Orbexa/Dev", Dimensions: [["Service"]], Metrics: metrics }],
    };
    line.Service = "api";
  }
  console.log(JSON.stringify(line));
}
