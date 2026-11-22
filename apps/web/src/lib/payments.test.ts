import assert from "node:assert/strict";
import test from "node:test";
import { LiveStripeKeyError, checkoutPlan, sendStripeTestCheckout } from "./payments.ts";

test("checkout is simulated and live Stripe keys are refused", () => {
  const plan = checkoutPlan(
    { orderId: "order-1", amountMinor: 100000, currency: "USD", reviewFeeMinor: 15000, platformFeeBps: 1500 },
    {},
  );
  assert.equal(plan.mode, "simulated");
  assert.equal(plan.simulated, true);
  assert.equal(plan.reviewFeeMinor, 15000);
  assert.equal(plan.platformFeeMinor + plan.creatorRoyaltyMinor + plan.reviewFeeMinor, 100000);
  assert.throws(() => checkoutPlan(
    { orderId: "order-1", amountMinor: 1000, currency: "USD", reviewFeeMinor: 0, platformFeeBps: 2000 },
    { STRIPE_SECRET_KEY: "sk_live_refused" },
  ), LiveStripeKeyError);
});

test("a Stripe test key does not hit the network unless that switch is on", async () => {
  const input = { orderId: "order-1", amountMinor: 80000, currency: "USD", reviewFeeMinor: 0, platformFeeBps: 2000 };
  const env = { PAYMENT_PROVIDER: "stripe", STRIPE_TEST_SECRET_KEY: "sk_test_example" };
  const plan = checkoutPlan(input, env);
  assert.equal(plan.mode, "stripe_test");
  assert.equal(plan.simulated, true);
  await assert.rejects(sendStripeTestCheckout(input, env, async () => ({ status: 200, body: "{}" })), /not enabled/);
  let seen = "";
  const sent = await sendStripeTestCheckout(input, { ...env, STRIPE_TEST_NETWORK: "1" }, async (call) => {
    seen = call.headers.authorization;
    return { status: 200, body: JSON.stringify({ id: "cs_test_123" }) };
  });
  assert.equal(sent.id, "cs_test_123");
  assert.equal(seen, "Bearer sk_test_example");
});
