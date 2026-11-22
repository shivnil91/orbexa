import assert from "node:assert/strict";
import test from "node:test";
import { splitServiceAmount } from "@orbexa/db/money.ts";
import { IdempotentLedger, linesForEvent } from "./ledger.ts";
import { FakePaymentProvider } from "./payments/fake.ts";
import { paymentProviderFromEnv } from "./payments/select.ts";
import { resetStripeCalls, stripeCallCount } from "./payments/stripe-stub.ts";

test("Given Expert Verified When Rahul checks out Then the order stores the review fee", () => {
  const split = splitServiceAmount(100000n, 15000n, 1500);
  assert.equal(split.reviewFeeMinor > 0n, true);
  assert.equal(split.platformFeeMinor + split.creatorRoyaltyMinor + split.reviewFeeMinor, 100000n);
  const provider = new FakePaymentProvider("test-secret");
  const session = provider.createCheckout({
    idempotencyKey: "rahul-expert",
    amountMinor: 100000n,
    currency: "USD",
    orderId: "order-expert",
  });
  const again = provider.createCheckout({
    idempotencyKey: "rahul-expert",
    amountMinor: 100000n,
    currency: "USD",
    orderId: "order-expert",
  });
  assert.equal(again.id, session.id);
  provider.rememberSplit(session.id, { ...split, taxMinor: 0n });
  const signed = provider.capture(session.id);
  const event = provider.verifyWebhook(signed.body, signed.signature);
  const ledger = new IdempotentLedger();
  ledger.apply(event);
  ledger.apply(event);
  assert.equal(ledger.transactionCount(), 1);
  const lines = linesForEvent(event);
  const debit = lines.filter((line) => line.direction === "debit").reduce((sum, line) => sum + line.amountMinor, 0n);
  const credit = lines.filter((line) => line.direction === "credit").reduce((sum, line) => sum + line.amountMinor, 0n);
  assert.equal(debit, credit);
  assert.equal(event.reviewFeeMinor, 15000n);
});

test("Given Autonomous When the order is created Then the review fee is zero", () => {
  const split = splitServiceAmount(80000n, 0n, 2000);
  assert.equal(split.reviewFeeMinor, 0n);
  assert.equal(split.platformFeeMinor + split.creatorRoyaltyMinor, 80000n);
});

test("Given a JPY payment When it is ledgered Then it does not mix with USD", () => {
  const provider = new FakePaymentProvider("test-secret");
  const usd = provider.createCheckout({
    idempotencyKey: "usd",
    amountMinor: 100000n,
    currency: "USD",
    orderId: "usd-order",
  });
  const jpy = provider.createCheckout({
    idempotencyKey: "jpy",
    amountMinor: 10000n,
    currency: "JPY",
    orderId: "jpy-order",
  });
  provider.rememberSplit(usd.id, {
    platformFeeMinor: 15000n,
    creatorRoyaltyMinor: 85000n,
    reviewFeeMinor: 0n,
    taxMinor: 0n,
  });
  provider.rememberSplit(jpy.id, {
    platformFeeMinor: 1500n,
    creatorRoyaltyMinor: 8500n,
    reviewFeeMinor: 0n,
    taxMinor: 0n,
  });
  const ledger = new IdempotentLedger();
  const usdLines = ledger.apply(provider.verifyWebhook(provider.capture(usd.id).body, provider.capture(usd.id).signature));
  const jpySigned = provider.capture(jpy.id);
  const jpyLines = ledger.apply(provider.verifyWebhook(jpySigned.body, jpySigned.signature));
  assert.equal(new Set(usdLines.map((line) => line.currency)).size, 1);
  assert.equal(usdLines[0].currency, "USD");
  assert.equal(jpyLines[0].currency, "JPY");
  assert.equal(ledger.transactionCount(), 2);
});

test("Given a refund When it is applied Then the reversal balances", () => {
  const provider = new FakePaymentProvider("test-secret");
  const signed = provider.refund({
    idempotencyKey: "refund-1",
    orderId: "order-expert",
    amountMinor: 10000n,
    currency: "USD",
    platformFeeMinor: 1500n,
    creatorRoyaltyMinor: 7000n,
    reviewFeeMinor: 1500n,
    taxMinor: 0n,
  });
  const event = provider.verifyWebhook(signed.body, signed.signature);
  const lines = linesForEvent(event);
  const debit = lines.filter((line) => line.direction === "debit").reduce((sum, line) => sum + line.amountMinor, 0n);
  assert.equal(debit, 10000n);
});

test("Given a bad signature When the webhook is verified Then it is rejected", () => {
  const provider = new FakePaymentProvider("test-secret");
  assert.throws(() => provider.verifyWebhook("{}", "00"), /signature/);
});

test("Given the live ThirdRoc account When Stripe is selected Then the stub throws and the slice does not call it", () => {
  resetStripeCalls();
  const provider = paymentProviderFromEnv({ PAYMENT_PROVIDER: "stripe" });
  assert.equal(provider.name, "stripe");
  assert.throws(() => provider.createCheckout({
    idempotencyKey: "nope",
    amountMinor: 1n,
    currency: "USD",
    orderId: "x",
  }), /ThirdRoc/);
  assert.equal(stripeCallCount(), 1);
  resetStripeCalls();
  const fake = paymentProviderFromEnv({ PAYMENT_PROVIDER: "fake" });
  fake.createCheckout({
    idempotencyKey: "ok",
    amountMinor: 1n,
    currency: "USD",
    orderId: "y",
  });
  assert.equal(stripeCallCount(), 0);
});
