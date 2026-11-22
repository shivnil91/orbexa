import assert from "node:assert/strict";
import test from "node:test";
import { route } from "./routes.ts";

test("the demo route is absent outside local and dev", () => {
  assert.equal(route("POST", "/v1/demo/hospital-beds", "prod"), "missing");
  assert.equal(route("POST", "/v1/demo/hospital-beds", "staging"), "missing");
  assert.equal(route("POST", "/v1/demo/hospital-beds", "local"), "demo");
  assert.equal(route("POST", "/v1/demo/hospital-beds", "dev"), "demo");
  assert.equal(route("POST", "/v1/demo/hospital-beds", undefined), "demo");
  assert.equal(route("GET", "/health", "prod"), "health");
  assert.equal(route("GET", "/v1/demo/hospital-beds", "local"), "missing");
});
