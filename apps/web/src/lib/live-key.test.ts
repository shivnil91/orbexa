import assert from "node:assert/strict";
import test from "node:test";
import { assertNoLiveStripeKey as appGuard, LiveStripeKeyError } from "./payments.ts";
import { assertNoLiveStripeKey as containerGuard } from "./live-key.ts";

function thrown(run: () => void): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error("expected a thrown Error");
}

test("container startup uses the same live-key abort", () => {
  const samples = [
    { STRIPE_SECRET_KEY: "sk_live_example" },
    { STRIPE_TEST_SECRET_KEY: "rk_live_example" },
    { OPENAI_API_KEY: "prefix sk_live_ hidden" },
  ];
  for (const env of samples) {
    const appError = thrown(() => appGuard(env));
    const containerError = thrown(() => containerGuard(env));
    assert.ok(appError instanceof LiveStripeKeyError);
    assert.equal(containerError.message, appError.message);
  }
  appGuard({ STRIPE_TEST_SECRET_KEY: "sk_test_example" });
  containerGuard({ STRIPE_TEST_SECRET_KEY: "sk_test_example", ANTHROPIC_API_KEY: "" });
});
