import assert from "node:assert/strict";
import test from "node:test";
import { parseAmountToMinor, splitServiceAmount } from "./money.ts";

test("platform fee truncates and the creator keeps the remainder", () => {
  const split = splitServiceAmount(101n, 0n, 1500);
  assert.equal(split.platformFeeMinor, 15n);
  assert.equal(split.creatorRoyaltyMinor, 86n);
  assert.equal(split.reviewFeeMinor, 0n);
});

test("review fee is removed before the basis-point split", () => {
  const split = splitServiceAmount(10000n, 1500n, 1500);
  assert.equal(split.reviewFeeMinor, 1500n);
  assert.equal(split.platformFeeMinor, 1275n);
  assert.equal(split.creatorRoyaltyMinor, 7225n);
  assert.equal(
    split.platformFeeMinor + split.creatorRoyaltyMinor + split.reviewFeeMinor,
    10000n,
  );
});

test("parseAmountToMinor respects currency exponents", () => {
  assert.equal(parseAmountToMinor("10.50", 2), 1050n);
  assert.equal(parseAmountToMinor("10", 0), 10n);
  assert.equal(parseAmountToMinor("1.234", 3), 1234n);
  assert.throws(() => parseAmountToMinor("10.5", 0), /too many decimal places/);
  assert.throws(() => parseAmountToMinor("10.999", 2), /too many decimal places/);
});
