import { createHmac, timingSafeEqual } from "node:crypto";
import type { CheckoutInput, CheckoutSession, PaymentProvider, RefundInput, WebhookEvent } from "./provider.ts";

const STRIPE_API = "https://api.stripe.com";

export type StripeCall = {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export type StripeTransport = (call: StripeCall) => Promise<{ status: number; body: string }>;

export type StripeTestProvider = PaymentProvider & {
  readonly mode: "test";
  createCheckoutAsync(input: CheckoutInput): Promise<CheckoutSession>;
  refundAsync(input: RefundInput): Promise<{ id: string }>;
  fetchBalanceTransactions(day: string): Promise<string>;
};

function assertTestKey(secretKey: string): void {
  if (secretKey.includes("sk_live_") || !secretKey.startsWith("sk_test_")) {
    throw new Error("Stripe test adapter requires a test secret key");
  }
}

function syncBlocked(): never {
  throw new Error("Stripe test adapter sends HTTPS asynchronously and does not call the live account");
}

async function defaultTransport(call: StripeCall): Promise<{ status: number; body: string }> {
  const response = await fetch(call.url, {
    method: call.method,
    headers: call.headers,
    body: call.body,
  });
  return { status: response.status, body: await response.text() };
}

export function createStripeTestProvider(options: {
  secretKey: string;
  webhookSecret?: string;
  transport?: StripeTransport;
}): StripeTestProvider {
  assertTestKey(options.secretKey);
  const transport = options.transport ?? defaultTransport;
  const auth = `Bearer ${options.secretKey}`;

  async function post(path: string, body: URLSearchParams, idempotencyKey: string): Promise<string> {
    const result = await transport({
      method: "POST",
      url: `${STRIPE_API}${path}`,
      headers: {
        authorization: auth,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": idempotencyKey,
      },
      body: body.toString(),
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Stripe test API returned ${result.status}`);
    }
    return result.body;
  }

  return {
    name: "stripe",
    mode: "test",
    createCheckout: syncBlocked,
    capture: syncBlocked,
    refund: syncBlocked,
    verifyWebhook(body: string, signature: string): WebhookEvent {
      const secret = options.webhookSecret;
      if (!secret) {
        throw new Error("Stripe test webhook secret is not configured");
      }
      if (secret.includes("sk_live_")) {
        throw new Error("Stripe test adapter requires a test secret key");
      }
      const parts = new Map(signature.split(",").map((part) => {
        const [name, value] = part.split("=");
        return [name, value] as const;
      }));
      const timestamp = parts.get("t");
      const expected = parts.get("v1");
      if (!timestamp || !expected) {
        throw new Error("webhook signature mismatch");
      }
      const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
      const left = Buffer.from(digest);
      const right = Buffer.from(expected);
      if (left.length !== right.length || !timingSafeEqual(left, right)) {
        throw new Error("webhook signature mismatch");
      }
      const parsed = JSON.parse(body) as {
        id?: string;
        type?: string;
        data?: { object?: Record<string, unknown> };
      };
      const object = parsed.data?.object ?? {};
      const metadata = (object.metadata ?? {}) as Record<string, string>;
      const amount = object.amount_total ?? object.amount;
      if (typeof parsed.id !== "string" || typeof amount !== "number") {
        throw new Error("Stripe test webhook is missing an id or amount");
      }
      const required = ["platform_fee_minor", "creator_royalty_minor", "review_fee_minor", "tax_minor"] as const;
      if (required.some((field) => metadata[field] === undefined)) {
        throw new Error("Stripe test webhook has no ledger split");
      }
      return {
        id: parsed.id,
        type: parsed.type === "charge.refunded" ? "refund.succeeded" : "payment.captured",
        orderId: String(object.client_reference_id ?? metadata.order_id ?? ""),
        amountMinor: BigInt(amount),
        currency: String(object.currency ?? "").toUpperCase(),
        platformFeeMinor: BigInt(metadata.platform_fee_minor),
        creatorRoyaltyMinor: BigInt(metadata.creator_royalty_minor),
        reviewFeeMinor: BigInt(metadata.review_fee_minor),
        taxMinor: BigInt(metadata.tax_minor),
      };
    },
    async createCheckoutAsync(input: CheckoutInput): Promise<CheckoutSession> {
      const body = new URLSearchParams({
        mode: "payment",
        success_url: "https://example.invalid/success",
        cancel_url: "https://example.invalid/cancel",
        client_reference_id: input.orderId,
        "metadata[order_id]": input.orderId,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": input.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": input.amountMinor.toString(),
        "line_items[0][price_data][product_data][name]": "Orbexa order",
      });
      const raw = await post("/v1/checkout/sessions", body, input.idempotencyKey);
      const parsed = JSON.parse(raw) as { id?: string };
      if (!parsed.id) {
        throw new Error("Stripe test checkout did not return an id");
      }
      return {
        id: parsed.id,
        orderId: input.orderId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      };
    },
    async refundAsync(input: RefundInput): Promise<{ id: string }> {
      const body = new URLSearchParams({
        amount: input.amountMinor.toString(),
        "metadata[order_id]": input.orderId,
      });
      const raw = await post("/v1/refunds", body, input.idempotencyKey);
      const parsed = JSON.parse(raw) as { id?: string };
      if (!parsed.id) {
        throw new Error("Stripe test refund did not return an id");
      }
      return { id: parsed.id };
    },
    async fetchBalanceTransactions(day: string): Promise<string> {
      const start = Date.parse(`${day}T00:00:00.000Z`);
      if (Number.isNaN(start)) {
        throw new Error("sandbox day must be YYYY-MM-DD");
      }
      const end = start + 86_400_000;
      const url = `${STRIPE_API}/v1/balance_transactions?created[gte]=${Math.floor(start / 1000)}&created[lt]=${Math.floor(end / 1000)}&limit=100`;
      const result = await transport({
        method: "GET",
        url,
        headers: { authorization: auth },
      });
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Stripe test API returned ${result.status}`);
      }
      return result.body;
    },
  };
}
