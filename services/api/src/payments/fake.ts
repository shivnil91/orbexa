import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CheckoutInput,
  CheckoutSession,
  PaymentProvider,
  RefundInput,
  WebhookEvent,
} from "./provider.ts";

type Stored = CheckoutSession & {
  platformFeeMinor: bigint;
  creatorRoyaltyMinor: bigint;
  reviewFeeMinor: bigint;
  taxMinor: bigint;
};

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake" as const;
  private readonly sessions = new Map<string, Stored>();
  private readonly checkouts = new Map<string, CheckoutSession>();
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  createCheckout(input: CheckoutInput): CheckoutSession {
    const existing = this.checkouts.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }
    const session: CheckoutSession = {
      id: `cs_${input.idempotencyKey}`,
      orderId: input.orderId,
      amountMinor: input.amountMinor,
      currency: input.currency,
    };
    this.checkouts.set(input.idempotencyKey, session);
    return session;
  }

  rememberSplit(
    sessionId: string,
    split: Pick<Stored, "platformFeeMinor" | "creatorRoyaltyMinor" | "reviewFeeMinor" | "taxMinor">,
  ): void {
    const session = [...this.checkouts.values()].find((item) => item.id === sessionId);
    if (!session) {
      throw new Error("unknown checkout session");
    }
    this.sessions.set(sessionId, { ...session, ...split });
  }

  capture(sessionId: string): { body: string; signature: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("checkout has no recorded split");
    }
    return this.sign({
      id: `evt_capture_${sessionId}`,
      type: "payment.captured",
      orderId: session.orderId,
      amountMinor: session.amountMinor.toString(),
      currency: session.currency,
      platformFeeMinor: session.platformFeeMinor.toString(),
      creatorRoyaltyMinor: session.creatorRoyaltyMinor.toString(),
      reviewFeeMinor: session.reviewFeeMinor.toString(),
      taxMinor: session.taxMinor.toString(),
    });
  }

  refund(input: RefundInput): { body: string; signature: string } {
    return this.sign({
      id: `evt_refund_${input.idempotencyKey}`,
      type: "refund.succeeded",
      orderId: input.orderId,
      amountMinor: input.amountMinor.toString(),
      currency: input.currency,
      platformFeeMinor: input.platformFeeMinor.toString(),
      creatorRoyaltyMinor: input.creatorRoyaltyMinor.toString(),
      reviewFeeMinor: input.reviewFeeMinor.toString(),
      taxMinor: input.taxMinor.toString(),
    });
  }

  verifyWebhook(body: string, signature: string): WebhookEvent {
    const expected = createHmac("sha256", this.secret).update(body).digest("hex");
    const left = Buffer.from(expected);
    const right = Buffer.from(signature);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new Error("webhook signature mismatch");
    }
    const parsed = JSON.parse(body) as Record<string, string>;
    return {
      id: parsed.id,
      type: parsed.type as WebhookEvent["type"],
      orderId: parsed.orderId,
      amountMinor: BigInt(parsed.amountMinor),
      currency: parsed.currency,
      platformFeeMinor: BigInt(parsed.platformFeeMinor),
      creatorRoyaltyMinor: BigInt(parsed.creatorRoyaltyMinor),
      reviewFeeMinor: BigInt(parsed.reviewFeeMinor),
      taxMinor: BigInt(parsed.taxMinor),
    };
  }

  private sign(payload: Record<string, string>): { body: string; signature: string } {
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", this.secret).update(body).digest("hex");
    return { body, signature };
  }
}
