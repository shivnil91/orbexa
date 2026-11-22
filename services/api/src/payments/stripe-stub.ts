import type { PaymentProvider } from "./provider.ts";

let calls = 0;

export function stripeCallCount(): number {
  return calls;
}

export function resetStripeCalls(): void {
  calls = 0;
}

function blocked(): never {
  calls += 1;
  throw new Error(
    "Stripe adapter is disabled. The connected account is the live ThirdRoc account and is not called.",
  );
}

export function createStripeStub(): PaymentProvider {
  return {
    name: "stripe",
    createCheckout: blocked,
    capture: blocked,
    refund: blocked,
    verifyWebhook: blocked,
  };
}
