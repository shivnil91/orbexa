import { randomBytes } from "node:crypto";
import type { PublicUser } from "./accounts.ts";
import type { ConnectState } from "./demo-store.ts";
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

function returnUrl(value: string, expectedOrigin?: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:")) {
      return null;
    }
    if (expectedOrigin) {
      if (url.origin !== expectedOrigin) {
        return null;
      }
    } else if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && url.hostname !== "::1") {
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
  expectedOrigin?: string;
}): Promise<ConnectStart> {
  const env = input.env ?? process.env;
  assertNoLiveStripeKey(env);
  if (!stripeTestNetworkEnabled(env)) {
    return { mode: "simulated", url: null, accountId: input.user.connect.accountId, chargesEnabled: false, detailsSubmitted: false };
  }
  const key = env.STRIPE_TEST_SECRET_KEY ?? "";
  const back = returnUrl(input.returnUrl, input.expectedOrigin);
  const refresh = returnUrl(input.refreshUrl, input.expectedOrigin);
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
    const parsed = JSON.parse(created.body) as { id?: string; livemode?: boolean; metadata?: { user_id?: string } };
    if (parsed.livemode !== false || !parsed.id || !/^acct_[A-Za-z0-9]+$/.test(parsed.id) || (parsed.metadata?.user_id != null && parsed.metadata.user_id !== input.user.id)) {
      return { mode: "stripe_test", url: null, accountId: null, chargesEnabled: false, detailsSubmitted: false, error: "stripe" };
    }
    accountId = parsed.id;
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    return { mode: "stripe_test", url: null, accountId: null, chargesEnabled: false, detailsSubmitted: false, error: "stripe" };
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
  return randomBytes(8).toString("hex");
}

export async function syncConnectAccount(input: {
  user: PublicUser;
  env?: NodeJS.ProcessEnv;
  transport: StripeTransport;
}): Promise<ConnectState> {
  const env = input.env ?? process.env;
  assertNoLiveStripeKey(env);
  const stored = input.user.connect;
  if (!stripeTestNetworkEnabled(env) || !stored.accountId || !/^acct_[A-Za-z0-9]+$/.test(stored.accountId)) {
    return { ...stored, chargesEnabled: false, detailsSubmitted: false };
  }
  const key = env.STRIPE_TEST_SECRET_KEY ?? "";
  const result = await input.transport({
    method: "GET",
    url: `https://api.stripe.com/v1/accounts/${stored.accountId}`,
    headers: { authorization: `Bearer ${key}` },
    body: "",
  });
  if (result.status < 200 || result.status >= 300) {
    return { ...stored, mode: "stripe_test", chargesEnabled: false, detailsSubmitted: false };
  }
  const parsed = JSON.parse(result.body) as {
    id?: string;
    livemode?: boolean;
    charges_enabled?: boolean;
    details_submitted?: boolean;
    metadata?: { user_id?: string };
  };
  const owns = parsed.metadata?.user_id === input.user.id;
  if (parsed.livemode !== false || parsed.id !== stored.accountId || !owns) {
    return { ...stored, mode: "stripe_test", chargesEnabled: false, detailsSubmitted: false };
  }
  const detailsSubmitted = parsed.details_submitted === true;
  return {
    mode: "stripe_test",
    accountId: stored.accountId,
    detailsSubmitted,
    chargesEnabled: detailsSubmitted && parsed.charges_enabled === true,
  };
}
