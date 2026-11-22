import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalDatabaseHost } from "./local-guard.ts";

test("local seed hosts are limited to the loopback addresses", () => {
  assert.doesNotThrow(() => assertLocalDatabaseHost("127.0.0.1"));
  assert.doesNotThrow(() => assertLocalDatabaseHost("localhost"));
  assert.throws(() => assertLocalDatabaseHost("orbexa.example"), /non-local/);
});
