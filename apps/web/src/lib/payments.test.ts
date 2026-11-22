import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { LiveStripeKeyError, checkoutPlan, sendStripeTestCheckout, verifyStripeTestWebhook } from "./payments.ts";

const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("checkout is simulated and live Stripe keys are refused", () => {
  const plan = checkoutPlan(
    { orderId, amountMinor: 100000, currency: "USD", reviewFeeMinor: 15000, platformFeeBps: 1500 },
    {},
  );
  assert.equal(plan.mode, "simulated");
  assert.equal(plan.simulated, true);
  assert.equal(plan.reviewFeeMinor, 15000);
  assert.equal(plan.platformFeeMinor + plan.creatorRoyaltyMinor + plan.reviewFeeMinor, 100000);
  assert.throws(() => checkoutPlan(
    { orderId, amountMinor: 1000, currency: "USD", reviewFeeMinor: 0, platformFeeBps: 2000 },
    { STRIPE_SECRET_KEY: "sk_live_refused" },
  ), LiveStripeKeyError);
  assert.throws(() => checkoutPlan(
    { orderId, amountMinor: 1000, currency: "USD", reviewFeeMinor: 0, platformFeeBps: 2000 },
    { STRIPE_TEST_SECRET_KEY: "rk_live_example" },
  ), LiveStripeKeyError);
});

test("a Stripe test key does not hit the network unless that switch is on", async () => {
  const input = { orderId, amountMinor: 80000, currency: "USD", reviewFeeMinor: 0, platformFeeBps: 2000 };
  const env = { PAYMENT_PROVIDER: "stripe", STRIPE_TEST_SECRET_KEY: "sk_test_example" };
  const plan = checkoutPlan(input, env);
  assert.equal(plan.mode, "stripe_test");
  assert.equal(plan.simulated, true);
  await assert.rejects(sendStripeTestCheckout(input, env, async () => ({ status: 200, body: "{}" })), /not enabled/);
  let seen = "";
  let idempotency = "";
  const sent = await sendStripeTestCheckout(input, { ...env, STRIPE_TEST_NETWORK: "1" }, async (call) => {
    seen = call.headers.authorization;
    idempotency = call.headers["idempotency-key"];
    assert.equal(new URLSearchParams(call.body).get("line_items[0][price_data][unit_amount]"), "80000");
    return {
      status: 200,
      body: JSON.stringify({ id: "cs_test_123", livemode: false, amount_total: 80000, currency: "usd" }),
    };
  });
  assert.equal(sent.id, "cs_test_123");
  assert.equal(seen, "Bearer sk_test_example");
  assert.equal(idempotency, `checkout_${orderId}`);
  await assert.rejects(
    sendStripeTestCheckout(input, { ...env, STRIPE_TEST_NETWORK: "1" }, async () => ({
      status: 200,
      body: JSON.stringify({ id: "cs_test_123", livemode: true, amount_total: 80000, currency: "usd" }),
    })),
    /live mode/,
  );
  await assert.rejects(
    sendStripeTestCheckout(input, { ...env, STRIPE_TEST_NETWORK: "1" }, async () => ({
      status: 200,
      body: JSON.stringify({ id: "cs_test_123", livemode: false, amount_total: 1, currency: "usd" }),
    })),
    /order snapshot/,
  );
});

test("a stripe test webhook checks the signature and the event allow-list", () => {
  const env = {
    PAYMENT_PROVIDER: "stripe",
    STRIPE_TEST_NETWORK: "1",
    STRIPE_TEST_WEBHOOK_SECRET: "whsec_test_local",
  };
  const sign = (payload: string, stamp = String(Math.floor(Date.now() / 1000))) =>
    `t=${stamp},v1=${createHmac("sha256", "whsec_test_local").update(`${stamp}.${payload}`).digest("hex")}`;
  const body = JSON.stringify({
    id: "evt_test_1",
    type: "checkout.session.completed",
    data: {
      object: {
        amount_total: 100000,
        currency: "usd",
        livemode: false,
        payment_status: "paid",
        client_reference_id: orderId,
        metadata: {
          platform_fee_minor: "12750",
          creator_royalty_minor: "72250",
          review_fee_minor: "15000",
          tax_minor: "0",
        },
      },
    },
  });
  const event = verifyStripeTestWebhook(body, sign(body), env);
  assert.equal(event.type, "payment.captured");
  assert.equal(event.amountMinor, 100000);
  assert.equal(event.livemode, false);
  assert.throws(() => verifyStripeTestWebhook(body, sign(body).replace(/v1=.*/, "v1=00"), env), /signature/);
  const unknown = JSON.stringify({
    id: "evt_test_2",
    type: "payment_intent.payment_failed",
    data: { object: { amount: 100000, currency: "usd", livemode: false, client_reference_id: orderId, metadata: {
      platform_fee_minor: "0", creator_royalty_minor: "0", review_fee_minor: "0", tax_minor: "0",
    } } },
  });
  assert.throws(() => verifyStripeTestWebhook(unknown, sign(unknown), env), /allow-list/);
  const live = body.replace('"livemode":false', '"livemode":true');
  assert.throws(() => verifyStripeTestWebhook(live, sign(live), env), /live mode/);
  assert.throws(
    () => verifyStripeTestWebhook(body, sign(body), { ...env, STRIPE_TEST_WEBHOOK_SECRET: "whsec_sk_live_hidden" }),
    LiveStripeKeyError,
  );
});
