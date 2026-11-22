import { splitServiceAmount } from "@orbexa/db/money.ts";

const LIVE_MARKERS = ["sk_live_", "rk_live_"];

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
};

export type StripeTransport = (call: {
  url: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; body: string }>;

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

export function checkoutPlan(input: CheckoutInput, env: NodeJS.ProcessEnv = process.env): CheckoutPlan {
  assertNoLiveStripeKey(env);
  const split = splitServiceAmount(
    BigInt(input.amountMinor),
    BigInt(input.reviewFeeMinor),
    input.platformFeeBps,
  );
  const amounts = {
    amountMinor: input.amountMinor,
    currency: input.currency,
    platformFeeMinor: Number(split.platformFeeMinor),
    creatorRoyaltyMinor: Number(split.creatorRoyaltyMinor),
    reviewFeeMinor: Number(split.reviewFeeMinor),
  };
  const key = env.STRIPE_TEST_SECRET_KEY ?? "";
  const wantsStripe = env.PAYMENT_PROVIDER === "stripe" && key.startsWith("sk_test_");
  if (!wantsStripe) {
    return { mode: "simulated", simulated: true, id: `sim_${input.orderId}`, ...amounts };
  }
  return { mode: "stripe_test", simulated: true, id: `sim_${input.orderId}`, ...amounts };
}

export async function sendStripeTestCheckout(
  input: CheckoutInput,
  env: NodeJS.ProcessEnv,
  transport: StripeTransport,
): Promise<{ id: string }> {
  assertNoLiveStripeKey(env);
  const key = env.STRIPE_TEST_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_") || env.PAYMENT_PROVIDER !== "stripe" || env.STRIPE_TEST_NETWORK !== "1") {
    throw new Error("Stripe test network is not enabled");
  }
  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.amountMinor),
    "line_items[0][price_data][product_data][name]": "Orbexa order",
    success_url: "https://example.invalid/return",
    cancel_url: "https://example.invalid/cancel",
  });
  const result = await transport({
    url: "https://api.stripe.com/v1/checkout/sessions",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Stripe test API returned ${result.status}`);
  }
  const parsed = JSON.parse(result.body) as { id?: string };
  if (!parsed.id || !parsed.id.startsWith("cs_test_")) {
    throw new Error("Stripe test session id was not returned");
  }
  return { id: parsed.id };
}
