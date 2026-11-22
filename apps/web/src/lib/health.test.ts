import assert from "node:assert/strict";
import test from "node:test";
import { healthBody } from "./health.ts";

test("health body matches the API contract", () => {
  assert.deepEqual(healthBody(), { service: "orbexa-api", status: "ok" });
});
