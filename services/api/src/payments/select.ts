import { FakePaymentProvider } from "./fake.ts";
import type { PaymentProvider } from "./provider.ts";
import { createStripeStub } from "./stripe-stub.ts";

export function paymentProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PaymentProvider {
  const name = env.PAYMENT_PROVIDER ?? "fake";
  if (name === "fake") {
    return new FakePaymentProvider(env.FAKE_WEBHOOK_SECRET ?? "orbexa-local-webhook");
  }
  if (name === "stripe") {
    return createStripeStub();
  }
  throw new Error(`unknown payment provider: ${name}`);
}
