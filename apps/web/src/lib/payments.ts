import { createHmac, timingSafeEqual } from "node:crypto";
import { splitServiceAmount } from "@orbexa/db/money.ts";

const LIVE_MARKERS = ["sk_live_", "rk_live_"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Za-z]{3}$/;
const CAPTURES = new Set([
  "checkout.session.completed",
  "payment_intent.succeeded",
  "charge.succeeded",
]);
const REFUNDS = new Set(["charge.refunded", "refund.updated"]);

export class LiveStripeKeyError extends Error {
  constructor(variable: string) {
    super(`refusing to start: ${variable} contains a live Stripe secret`);
    this.name = "LiveStripeKeyError";
  }
}

export type CheckoutPlan = {
  mode: "simulated" | "stripe_test";
  simulated: boolean;
  id: string;
  amountMinor: number;
  currency: string;
  platformFeeMinor: number;
  creatorRoyaltyMinor: number;
  reviewFeeMinor: number;
};

export type CheckoutInput = {
  orderId: string;
  amountMinor: number;
  currency: string;
  reviewFeeMinor: number;
  platformFeeBps: number;
  platformFeeMinor?: number;
  creatorRoyaltyMinor?: number;
};

export async function stripeTestTransport(call: {
  url: string;
  headers: Record<string, string>;
  body: string;
  method?: "GET" | "POST";
}): Promise<{ status: number; body: string }> {
  const url = new URL(call.url);
  if (url.protocol !== "https:" || url.host !== "api.stripe.com") {
    throw new Error("Stripe test transport refused the host");
  }
  const method = call.method ?? "POST";
  const response = await fetch(url, {
    method,
    headers: call.headers,
    body: method === "GET" ? undefined : call.body,
    redirect: "error",
  });
  return { status: response.status, body: await response.text() };
}

export type StripeTransport = (call: {
  url: string;
  headers: Record<string, string>;
  body: string;
  method?: "GET" | "POST";
}) => Promise<{ status: number; body: string }>;

export type VerifiedStripeEvent = {
  id: string;
  type: "payment.captured" | "refund.succeeded";
  orderId: string;
  amountMinor: number;
  currency: string;
  platformFeeMinor: number;
  creatorRoyaltyMinor: number;
  reviewFeeMinor: number;
  taxMinor: number;
  livemode: false;
};

// SECURITY REVIEW: simulated by default. A Stripe test key can build a test
// Checkout request. Live keys throw. Independent review is required before a
// real charge, including before STRIPE_TEST_NETWORK is enabled in any deploy.

export function assertNoLiveStripeKey(env: NodeJS.ProcessEnv): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && LIVE_MARKERS.some((marker) => value.includes(marker))) {
      throw new LiveStripeKeyError(key);
    }
  }
}

function assertOrderAmount(input: CheckoutInput): void {
  if (!UUID.test(input.orderId)) {
    throw new Error("order id is not a uuid");
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("order amount must be a positive integer");
  }
  if (!CURRENCY.test(input.currency)) {
    throw new Error("order currency is invalid");
  }
}

export function stripeTestNetworkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  assertNoLiveStripeKey(env);
  const key = env.STRIPE_TEST_SECRET_KEY ?? "";
  return env.PAYMENT_PROVIDER === "stripe" && key.startsWith("sk_test_") && env.STRIPE_TEST_NETWORK === "1";
}

function browserReturnUrl(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return fallback;
    }
    return url.toString();
  } catch {
    return fallback;
  }
}

export function checkoutPlan(input: CheckoutInput, env: NodeJS.ProcessEnv = process.env): CheckoutPlan {
  assertNoLiveStripeKey(env);
  assertOrderAmount(input);
  const split = input.platformFeeMinor != null && input.creatorRoyaltyMinor != null
    ? {
        platformFeeMinor: BigInt(input.platformFeeMinor),
        creatorRoyaltyMinor: BigInt(input.creatorRoyaltyMinor),
        reviewFeeMinor: BigInt(input.reviewFeeMinor),
      }
    : splitServiceAmount(BigInt(input.amountMinor), BigInt(input.reviewFeeMinor), input.platformFeeBps);
  const platformFeeMinor = Number(split.platformFeeMinor);
  const creatorRoyaltyMinor = Number(split.creatorRoyaltyMinor);
  const reviewFeeMinor = Number(split.reviewFeeMinor);
  if (platformFeeMinor + creatorRoyaltyMinor + reviewFeeMinor !== input.amountMinor) {
    throw new Error("order snapshot does not balance");
  }
  const amounts = {
    amountMinor: input.amountMinor,
    currency: input.currency.toUpperCase(),
    platformFeeMinor,
    creatorRoyaltyMinor,
    reviewFeeMinor,
  };
  const key = env.STRIPE_TEST_SECRET_KEY ?? "";
  const wantsStripe = env.PAYMENT_PROVIDER === "stripe" && key.startsWith("sk_test_");
  if (!wantsStripe) {
    return { mode: "simulated", simulated: true, id: `sim_${input.orderId}`, ...amounts };
  }
  return { mode: "stripe_test", simulated: true, id: `sim_${input.orderId}`, ...amounts };
}

function stripeTestEnabled(env: NodeJS.ProcessEnv): string {
  assertNoLiveStripeKey(env);
  const key = env.STRIPE_TEST_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_") || env.PAYMENT_PROVIDER !== "stripe" || env.STRIPE_TEST_NETWORK !== "1") {
    throw new Error("Stripe test network is not enabled");
  }
  return key;
}

function connectedAccount(id: string | undefined): string | undefined {
  if (!id || !/^acct_[A-Za-z0-9]+$/.test(id)) {
    return undefined;
  }
  return id;
}

export async function sendStripeTestCheckout(
  input: CheckoutInput,
  env: NodeJS.ProcessEnv,
  transport: StripeTransport,
  urls?: { successUrl?: string; cancelUrl?: string; destinationAccountId?: string },
): Promise<{ id: string; url?: string }> {
  const key = stripeTestEnabled(env);
  assertOrderAmount(input);
  const plan = checkoutPlan(input, env);
  const body = new URLSearchParams({
    mode: "payment",
    client_reference_id: input.orderId,
    "metadata[order_id]": input.orderId,
    "metadata[platform_fee_minor]": String(plan.platformFeeMinor),
    "metadata[creator_royalty_minor]": String(plan.creatorRoyaltyMinor),
    "metadata[review_fee_minor]": String(plan.reviewFeeMinor),
    "metadata[tax_minor]": "0",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": plan.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(plan.amountMinor),
    "line_items[0][price_data][product_data][name]": "Orbexa order",
    success_url: browserReturnUrl(urls?.successUrl, "https://example.invalid/return"),
    cancel_url: browserReturnUrl(urls?.cancelUrl, "https://example.invalid/cancel"),
    "payment_intent_data[metadata][order_id]": input.orderId,
    "payment_intent_data[metadata][platform_fee_minor]": String(plan.platformFeeMinor),
    "payment_intent_data[metadata][creator_royalty_minor]": String(plan.creatorRoyaltyMinor),
    "payment_intent_data[metadata][review_fee_minor]": String(plan.reviewFeeMinor),
    "payment_intent_data[metadata][tax_minor]": "0",
  });
  const destination = connectedAccount(urls?.destinationAccountId);
  const applicationFee = plan.platformFeeMinor + plan.reviewFeeMinor;
  if (destination && applicationFee > 0 && applicationFee < plan.amountMinor) {
    body.set("payment_intent_data[transfer_data][destination]", destination);
    body.set("payment_intent_data[application_fee_amount]", String(applicationFee));
  }
  const result = await transport({
    url: "https://api.stripe.com/v1/checkout/sessions",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": `checkout_${input.orderId}`,
    },
    body: body.toString(),
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Stripe test API returned ${result.status}`);
  }
  const parsed = JSON.parse(result.body) as {
    id?: string;
    url?: string;
    livemode?: boolean;
    amount_total?: number;
    currency?: string;
  };
  if (parsed.livemode !== false) {
    throw new Error("live mode checkout rejected");
  }
  if (!parsed.id || !parsed.id.startsWith("cs_test_")) {
    throw new Error("Stripe test session id was not returned");
  }
  if (parsed.amount_total !== plan.amountMinor) {
    throw new Error("Stripe test amount does not match the order snapshot");
  }
  if (String(parsed.currency ?? "").toUpperCase() !== plan.currency) {
    throw new Error("Stripe test currency does not match the order snapshot");
  }
  if (typeof parsed.url === "string" && parsed.url.startsWith("https://checkout.stripe.com/")) {
    return { id: parsed.id, url: parsed.url };
  }
  return { id: parsed.id };
}

function headerValue(signature: string, name: string): string | undefined {
  const parts = signature.split(",");
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator) === name) {
      return part.slice(separator + 1);
    }
  }
  return undefined;
}

function minorField(metadata: Record<string, string>, field: string): number {
  const raw = metadata[field];
  if (raw == null || !/^\d+$/.test(raw)) {
    throw new Error("Stripe test webhook has no ledger split");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error("Stripe test webhook has no ledger split");
  }
  return value;
}

export function verifyStripeTestWebhook(
  body: string,
  signature: string,
  env: NodeJS.ProcessEnv,
): VerifiedStripeEvent {
  assertNoLiveStripeKey(env);
  const secret = env.STRIPE_TEST_WEBHOOK_SECRET ?? "";
  if (!secret || env.STRIPE_TEST_NETWORK !== "1" || env.PAYMENT_PROVIDER !== "stripe") {
    throw new Error("Stripe test webhook secret is not configured");
  }
  const timestamp = headerValue(signature, "t");
  const expected = headerValue(signature, "v1");
  if (!timestamp || !expected) {
    throw new Error("webhook signature mismatch");
  }
  const stamp = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(stamp) || Math.abs(now - stamp) > 300) {
    throw new Error("webhook timestamp is outside the allowed window");
  }
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  const right = Buffer.from(expected, "hex");
  if (right.length !== digest.length || !timingSafeEqual(digest, right)) {
    throw new Error("webhook signature mismatch");
  }
  const parsed = JSON.parse(body) as {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  const object = parsed.data?.object ?? {};
  if (object.livemode !== false) {
    throw new Error("live mode webhook rejected");
  }
  const eventType = CAPTURES.has(parsed.type ?? "")
    ? "payment.captured"
    : REFUNDS.has(parsed.type ?? "")
      ? "refund.succeeded"
      : null;
  if (eventType === null || typeof parsed.id !== "string" || !/^evt_/.test(parsed.id)) {
    throw new Error("Stripe test webhook type is not on the allow-list");
  }
  if (parsed.type === "checkout.session.completed" && object.payment_status !== "paid") {
    throw new Error("Stripe test checkout is not paid");
  }
  if (parsed.type === "refund.updated" && object.status !== "succeeded") {
    throw new Error("Stripe test refund is not succeeded");
  }
  const metadata = (object.metadata ?? {}) as Record<string, string>;
  const orderId = String(object.client_reference_id ?? metadata.order_id ?? "");
  if (!UUID.test(orderId)) {
    throw new Error("Stripe test webhook order is invalid");
  }
  const rawAmount = eventType === "refund.succeeded"
    ? object.amount_refunded ?? object.amount
    : object.amount_total ?? object.amount;
  if (typeof rawAmount !== "number" || !Number.isInteger(rawAmount) || rawAmount < 0) {
    throw new Error("Stripe test webhook amount is not a non-negative integer");
  }
  const currency = String(object.currency ?? "");
  if (!CURRENCY.test(currency)) {
    throw new Error("Stripe test webhook currency is invalid");
  }
  return {
    id: parsed.id,
    type: eventType,
    orderId,
    amountMinor: rawAmount,
    currency: currency.toUpperCase(),
    platformFeeMinor: minorField(metadata, "platform_fee_minor"),
    creatorRoyaltyMinor: minorField(metadata, "creator_royalty_minor"),
    reviewFeeMinor: minorField(metadata, "review_fee_minor"),
    taxMinor: minorField(metadata, "tax_minor"),
    livemode: false,
  };
}
