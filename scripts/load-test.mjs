#!/usr/bin/env node
/**
 * Constant-concurrency load against a local API.
 * Usage: node scripts/load-test.mjs http://127.0.0.1:4317
 * Reports p95 for listing, hire, and runtime execute at 50 concurrent clients.
 */

const base = (process.argv[2] ?? "http://127.0.0.1:4317").replace(/\/$/, "");
const users = 50;
const each = 8;
const origin = base;

function percentile(samples, p) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function hammer(name, run) {
  const samples = [];
  let failures = 0;
  async function one() {
    for (let i = 0; i < each; i += 1) {
      const started = performance.now();
      try {
        const response = await run();
        if (!response.ok && response.status !== 303) {
          failures += 1;
        }
      } catch {
        failures += 1;
      }
      samples.push(performance.now() - started);
    }
  }
  await Promise.all(Array.from({ length: users }, () => one()));
  return {
    name,
    requests: samples.length,
    failures,
    p50: Math.round(percentile(samples, 50)),
    p95: Math.round(percentile(samples, 95)),
    max: Math.round(Math.max(...samples)),
  };
}

const listing = await hammer("listing", () => fetch(`${base}/en/listings/example-ndis-broker`));

const hire = await hammer("hire", () => {
  const body = new URLSearchParams({
    locale: "en",
    slug: "example-ndis-broker",
    tier: "autonomous",
    need: "Example wages bridge",
  });
  return fetch(`${base}/api/jobs`, {
    method: "POST",
    redirect: "manual",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body,
  });
});

const execute = await hammer("runtime execute", () =>
  fetch(`${base}/api/runtime/execute`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ need: "Example wages bridge" }),
  }),
);

console.log(JSON.stringify({ users, each, base, results: [listing, hire, execute] }, null, 2));
if ([listing, hire, execute].some((row) => row.failures > 0)) {
  process.exitCode = 1;
}
