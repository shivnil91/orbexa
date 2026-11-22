export type CheckoutInput = {
  idempotencyKey: string;
  amountMinor: bigint;
  currency: string;
  orderId: string;
};

export type CheckoutSession = {
  id: string;
  orderId: string;
  amountMinor: bigint;
  currency: string;
};

export type WebhookEvent = {
  id: string;
  type: "payment.captured" | "refund.succeeded";
  orderId: string;
  amountMinor: bigint;
  currency: string;
  platformFeeMinor: bigint;
  creatorRoyaltyMinor: bigint;
  reviewFeeMinor: bigint;
  taxMinor: bigint;
};

export type RefundInput = {
  idempotencyKey: string;
  orderId: string;
  amountMinor: bigint;
  currency: string;
  platformFeeMinor: bigint;
  creatorRoyaltyMinor: bigint;
  reviewFeeMinor: bigint;
  taxMinor: bigint;
};

export interface PaymentProvider {
  readonly name: "fake" | "stripe";
  createCheckout(input: CheckoutInput): CheckoutSession;
  capture(sessionId: string): { body: string; signature: string };
  refund(input: RefundInput): { body: string; signature: string };
  verifyWebhook(body: string, signature: string): WebhookEvent;
}
