import assert from "node:assert/strict";
import test from "node:test";
import { formatInstant, formatMoney } from "./format.ts";

test("money formatting follows the locale and the currency", () => {
  assert.equal(formatMoney(1050n, "USD", "en-US"), "$10.50");
  assert.match(formatMoney(1050n, "EUR", "de-DE"), /10,50/);
  assert.equal(formatMoney(10n, "JPY", "ja-JP"), "￥10");
});

test("an instant is rendered in the requested time zone", () => {
  const auckland = formatInstant("Pacific/Auckland", "en-NZ");
  const london = formatInstant("Europe/London", "en-GB");
  assert.notEqual(auckland, london);
  assert.match(auckland, /23 Nov 2026/);
  assert.match(london, /22 Nov 2026/);
});
