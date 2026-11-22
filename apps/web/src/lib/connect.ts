import type { PublicUser } from "./accounts.ts";
import { assertNoLiveStripeKey, stripeTestNetworkEnabled, type StripeTransport } from "./payments.ts";

export { stripeTestNetworkEnabled };

export type ConnectStart = {
  mode: "simulated" | "stripe_test";
  url: string | null;
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  error?: string;
};

function allowUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "connect.stripe.com") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function returnUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function beginConnectOnboarding(input: {
  user: PublicUser;
  env?: NodeJS.ProcessEnv;
  transport: StripeTransport;
  returnUrl: string;
  refreshUrl: string;
}): Promise<ConnectStart> {
  const env = input.env ?? process.env;
  assertNoLiveStripeKey(env);
  if (!stripeTestNetworkEnabled(env)) {
    return { mode: "simulated", url: null, accountId: input.user.connect.accountId, chargesEnabled: false, detailsSubmitted: false };
  }
  const key = env.STRIPE_TEST_SECRET_KEY ?? "";
  const back = returnUrl(input.returnUrl);
  const refresh = returnUrl(input.refreshUrl);
  if (!back || !refresh) {
    return { mode: "stripe_test", url: null, accountId: null, chargesEnabled: false, detailsSubmitted: false, error: "url" };
  }
  let accountId = input.user.connect.accountId;
  if (!accountId) {
    const body = new URLSearchParams({
      type: "express",
      country: "US",
      email: input.user.email,
      "capabilities[card_payments][requested]": "true",
      "capabilities[transfers][requested]": "true",
      "metadata[user_id]": input.user.id,
    });
    const created = await input.transport({
      url: "https://api.stripe.com/v1/accounts",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": `connect_account_${input.user.id}`,
      },
      body: body.toString(),
    });
    if (created.status < 200 || created.status >= 300) {
      return { mode: "stripe_test", url: null, accountId: null, chargesEnabled: false, detailsSubmitted: false, error: "stripe" };
    }
    const parsed = JSON.parse(created.body) as { id?: string; livemode?: boolean };
    if (parsed.livemode !== false || !parsed.id || !/^acct_[A-Za-z0-9]+$/.test(parsed.id)) {
      return { mode: "stripe_test", url: null, accountId: null, chargesEnabled: false, detailsSubmitted: false, error: "stripe" };
    }
    accountId = parsed.id;
  }
  const linkBody = new URLSearchParams({
    account: accountId,
    refresh_url: refresh,
    return_url: back,
    type: "account_onboarding",
  });
  const link = await input.transport({
    url: "https://api.stripe.com/v1/account_links",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": `connect_link_${input.user.id}_${randomKey()}`,
    },
    body: linkBody.toString(),
  });
  if (link.status < 200 || link.status >= 300) {
    return { mode: "stripe_test", url: null, accountId, chargesEnabled: false, detailsSubmitted: false, error: "stripe" };
  }
  const parsed = JSON.parse(link.body) as { url?: string; livemode?: boolean };
  if (parsed.livemode === true) {
    return { mode: "stripe_test", url: null, accountId, chargesEnabled: false, detailsSubmitted: false, error: "stripe" };
  }
  const url = allowUrl(parsed.url);
  if (!url) {
    return { mode: "stripe_test", url: null, accountId, chargesEnabled: false, detailsSubmitted: false, error: "stripe" };
  }
  return { mode: "stripe_test", url, accountId, chargesEnabled: false, detailsSubmitted: false };
}

function randomKey(): string {
  return Math.random().toString(16).slice(2);
}
