import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_DASHBOARD, formatMinor, formatRate, metricsByAgentVersion } from "./dashboard.ts";

test("fixture dashboard rows come from run metrics, invocations, and drafts", () => {
  assert.equal(FIXTURE_DASHBOARD.length, 1);
  const row = FIXTURE_DASHBOARD[0];
  assert.equal(row.groundedClaimRate, 0.5);
  assert.equal(row.latencyMs, 1200);
  assert.equal(row.costPerJobMinor, 40);
  assert.equal(row.invocationCostMinor, 40);
  assert.equal(row.revisionRate, 1);
  assert.equal(row.jobCount, 1);
  assert.equal(formatRate(row.groundedClaimRate), "50%");
  assert.equal(formatMinor(row.costPerJobMinor, row.currency), "USD 0.40");
});

test("two jobs average the grounded-claim rate and the revision rate", () => {
  const rows = metricsByAgentVersion(
    [
      {
        agentVersionId: "version-1",
        currency: "USD",
        groundedClaimRate: 1,
        latencyMs: 100,
        costMinor: 10,
      },
      {
        agentVersionId: "version-1",
        currency: "USD",
        groundedClaimRate: 0,
        latencyMs: 300,
        costMinor: 30,
      },
    ],
    [
      { agentVersionId: "version-1", currency: "USD", jobId: "j1", costMinor: 10 },
      { agentVersionId: "version-1", currency: "USD", jobId: "j2", costMinor: 30 },
    ],
    [
      { agentVersionId: "version-1", jobId: "j1" },
      { agentVersionId: "version-1", jobId: "j2" },
      { agentVersionId: "version-1", jobId: "j2" },
    ],
  );
  assert.equal(rows[0].groundedClaimRate, 0.5);
  assert.equal(rows[0].latencyMs, 200);
  assert.equal(rows[0].costPerJobMinor, 20);
  assert.equal(rows[0].invocationCostMinor, 20);
  assert.equal(rows[0].revisionRate, 0.5);
  assert.equal(rows[0].jobCount, 2);
});
