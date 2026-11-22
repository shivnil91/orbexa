import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedLocale } from "./locale.ts";

test("the scaffold ships one locale catalog", () => {
  assert.equal(isSupportedLocale("en"), true);
  assert.equal(isSupportedLocale("fr"), false);
});
