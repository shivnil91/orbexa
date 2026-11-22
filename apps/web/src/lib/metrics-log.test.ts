import assert from "node:assert/strict";
import test from "node:test";
import { metricsFromLog } from "./metrics-log.ts";

test("dashboard rows come from recorded invocations", () => {
  const log = [
    JSON.stringify({
      kind: "invocation",
      agentVersionId: "version-1",
      currency: "USD",
      jobId: "job-1",
      costMinor: 1,
      inputTokens: 10,
      outputTokens: 4,
      latencyMs: 20,
      model: "fixture",
    }),
    JSON.stringify({
      kind: "run_metric",
      agentVersionId: "version-1",
      currency: "USD",
      jobId: "job-1",
      groundedClaimRate: 0.3333,
      latencyMs: 80,
      costMinor: 4,
    }),
    JSON.stringify({ kind: "draft", agentVersionId: "version-1", jobId: "job-1" }),
  ].join("\n");
  const rows = metricsFromLog(log);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].groundedClaimRate, 0.3333);
  assert.equal(rows[0].inputTokens, 10);
  assert.equal(rows[0].outputTokens, 4);
  assert.equal(rows[0].jobCount, 1);
  assert.equal(metricsFromLog("").length, 0);
});
