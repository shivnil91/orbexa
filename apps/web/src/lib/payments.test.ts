import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { LiveStripeKeyError, checkoutPlan, sendStripeTestCheckout, sendStripeTestRefund, stripeTestTransport, verifyStripeTestWebhook } from "./payments.ts";

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
    const params = new URLSearchParams(call.body);
    assert.equal(params.get("line_items[0][price_data][unit_amount]"), "80000");
    assert.equal(params.get("payment_intent_data[transfer_data][destination]"), null);
    assert.equal(params.get("payment_intent_data[metadata][order_id]"), orderId);
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
  const routed = await sendStripeTestCheckout(input, { ...env, STRIPE_TEST_NETWORK: "1" }, async (call) => {
    const params = new URLSearchParams(call.body);
    assert.equal(params.get("payment_intent_data[transfer_data][destination]"), "acct_seller123");
    assert.equal(params.get("payment_intent_data[application_fee_amount]"), String(plan.platformFeeMinor + plan.reviewFeeMinor));
    return {
      status: 200,
      body: JSON.stringify({ id: "cs_test_123", livemode: false, amount_total: 80000, currency: "usd" }),
    };
  }, { destinationAccountId: "acct_seller123" });
  assert.equal(routed.id, "cs_test_123");
  await sendStripeTestCheckout(input, { ...env, STRIPE_TEST_NETWORK: "1" }, async (call) => {
    assert.equal(new URLSearchParams(call.body).get("payment_intent_data[transfer_data][destination]"), null);
    return {
      status: 200,
      body: JSON.stringify({ id: "cs_test_123", livemode: false, amount_total: 80000, currency: "usd" }),
    };
  }, { destinationAccountId: "https://evil.example" });
  await assert.rejects(
    stripeTestTransport({ url: "https://evil.example/v1/charges", headers: { authorization: "Bearer sk_test_example" }, body: "" }),
    /host/,
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

test("a Stripe test refund uses the order amount, an idempotency key, and refuses live mode", async () => {
  const env = { PAYMENT_PROVIDER: "stripe", STRIPE_TEST_SECRET_KEY: "sk_test_example", STRIPE_TEST_NETWORK: "1" };
  const input = { orderId, sessionId: "cs_test_order", amountMinor: 1500, currency: "USD" };
  await assert.rejects(sendStripeTestRefund(input, { PAYMENT_PROVIDER: "stripe", STRIPE_TEST_SECRET_KEY: "sk_test_example" }, async () => {
    throw new Error("network");
  }), /not enabled/);
  await assert.rejects(sendStripeTestRefund(input, { ...env, STRIPE_TEST_SECRET_KEY: "sk_live_refused" }, async () => {
    throw new Error("network");
  }), LiveStripeKeyError);
  let calls = 0;
  const refunded = await sendStripeTestRefund(input, env, async (call) => {
    calls += 1;
    assert.equal(new URL(call.url).host, "api.stripe.com");
    assert.equal(call.headers.authorization, "Bearer sk_test_example");
    if (call.method === "GET") {
      return {
        status: 200,
        body: JSON.stringify({
          id: "cs_test_order",
          livemode: false,
          amount_total: 1500,
          currency: "usd",
          payment_status: "paid",
          payment_intent: { id: "pi_test_order", livemode: false, amount: 1500, currency: "usd", transfer_data: { destination: "acct_seller123" } },
        }),
      };
    }
    const params = new URLSearchParams(call.body);
    assert.equal(params.get("amount"), "1500");
    assert.equal(params.get("payment_intent"), "pi_test_order");
    assert.equal(params.get("metadata[order_id]"), orderId);
    assert.equal(params.get("reverse_transfer"), "true");
    assert.equal(params.get("refund_application_fee"), "true");
    assert.equal(call.headers["idempotency-key"], `refund_${orderId}`);
    return { status: 200, body: JSON.stringify({ id: "re_test_order", livemode: false, amount: 1500, status: "succeeded", payment_intent: "pi_test_order" }) };
  });
  assert.equal(refunded.id, "re_test_order");
  assert.equal(calls, 2);
  await assert.rejects(sendStripeTestRefund(input, env, async () => ({
    status: 200,
    body: JSON.stringify({ id: "cs_test_order", livemode: true, amount_total: 1500, currency: "usd", payment_status: "paid", payment_intent: "pi_test_order" }),
  })), /live mode/);
  await assert.rejects(sendStripeTestRefund(input, env, async (call) => {
    if (call.method === "GET") {
      return {
        status: 200,
        body: JSON.stringify({ id: "cs_test_order", livemode: false, amount_total: 999, currency: "usd", payment_status: "paid", payment_intent: { id: "pi_test_order", livemode: false, amount: 999, currency: "usd" } }),
      };
    }
    throw new Error("refund should not be sent");
  }), /snapshot/);
});
