import { FakePaymentProvider } from "./fake.ts";
import { assertNoLiveStripeKey } from "./guard.ts";
import type { PaymentProvider } from "./provider.ts";
import { createStripeStub } from "./stripe-stub.ts";
import { createStripeTestProvider, type StripeTestProvider } from "./stripe-test.ts";

export function paymentProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PaymentProvider | StripeTestProvider {
  assertNoLiveStripeKey(env);
  const name = env.PAYMENT_PROVIDER ?? "fake";
  if (name === "fake") {
    return new FakePaymentProvider(env.FAKE_WEBHOOK_SECRET ?? "orbexa-local-webhook");
  }
  if (name === "stripe") {
    const key = env.STRIPE_TEST_SECRET_KEY ?? "";
    if (key.length === 0) {
      return createStripeStub();
    }
    return createStripeTestProvider({
      secretKey: key,
      webhookSecret: env.STRIPE_TEST_WEBHOOK_SECRET,
    });
  }
  throw new Error(`unknown payment provider: ${name}`);
}
