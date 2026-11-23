import assert from "node:assert/strict";
import test from "node:test";
import { healthBody, healthReport } from "./health.ts";

test("health body matches the API contract", () => {
  assert.deepEqual(healthBody(), { service: "orbexa-api", status: "ok" });
});

test("health checks the database only when the dev task points at one", async () => {
  assert.deepEqual(await healthReport({}, async () => false), { status: 200, body: healthBody() });
  assert.deepEqual(await healthReport({ DB_HOST: "db.internal" }, async () => true), {
    status: 200,
    body: { service: "orbexa-api", status: "ok", database: "ok" },
  });
  assert.equal((await healthReport({ DB_HOST: "db.internal" }, async () => false)).status, 503);
});
