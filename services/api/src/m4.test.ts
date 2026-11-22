import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertNoLiveStripeKey } from "./payments/guard.ts";
import { pageForMismatch, reconcileSandboxDay, sumsFromBalanceTransactions } from "./payments/reconcile.ts";
import { paymentProviderFromEnv } from "./payments/select.ts";
import { stripeCallCount, resetStripeCalls } from "./payments/stripe-stub.ts";
import { createStripeTestProvider } from "./payments/stripe-test.ts";
import { restorePriorVersion, VersionedObjectStore } from "./versioned-store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("startup refuses a live Stripe key and does not echo it", () => {
  const secret = "sk_live_example_should_not_echo";
  assert.throws(
    () => assertNoLiveStripeKey({ STRIPE_SECRET_KEY: secret }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /STRIPE_SECRET_KEY/);
      assert.equal(error.message.includes("should_not_echo"), false);
      return true;
    },
  );
  assert.throws(
    () => paymentProviderFromEnv({ PAYMENT_PROVIDER: "fake", OPENAI_API_KEY: secret }),
    /refusing to start/,
  );
});

test("stripe test mode is selected only by a test key and does not call the network", async () => {
  resetStripeCalls();
  const blocked = paymentProviderFromEnv({ PAYMENT_PROVIDER: "stripe" });
  assert.equal(blocked.name, "stripe");
  assert.throws(() => blocked.createCheckout({
    idempotencyKey: "nope",
    amountMinor: 1n,
    currency: "USD",
    orderId: "x",
  }), /ThirdRoc|disabled/);
  assert.equal(stripeCallCount(), 1);

  const calls: string[] = [];
  const provider = createStripeTestProvider({
    secretKey: "sk_test_local_only",
    webhookSecret: "whsec_test_local",
    transport: async (call) => {
      calls.push(`${call.method} ${call.url}`);
      assert.equal(call.headers.authorization, "Bearer sk_test_local_only");
      assert.equal(JSON.stringify(call).includes("sk_live_"), false);
      if (call.url.includes("checkout/sessions")) {
        return { status: 200, body: JSON.stringify({ id: "cs_test_123" }) };
      }
      return {
        status: 200,
        body: JSON.stringify({
          data: [
            { type: "charge", amount: 4242, currency: "usd" },
            { type: "refund", amount: -500, currency: "usd" },
          ],
        }),
      };
    },
  });
  const session = await provider.createCheckoutAsync({
    idempotencyKey: "local-1",
    amountMinor: 4242n,
    currency: "USD",
    orderId: "order-1",
  });
  assert.equal(session.id, "cs_test_123");
  assert.match(calls[0], /^POST https:\/\/api\.stripe\.com\/v1\/checkout\/sessions$/);
  const report = sumsFromBalanceTransactions(await provider.fetchBalanceTransactions("2026-11-22"));
  const result = reconcileSandboxDay("2026-11-22", [
    { currency: "USD", capturedMinor: 4242n, refundedMinor: 500n },
  ], report);
  assert.equal(result.matched, true);
  assert.equal(result.pageHuman, false);
  assert.equal(pageForMismatch(result), null);
  assert.equal(stripeCallCount(), 1);
  resetStripeCalls();
});

test("a sandbox mismatch pages a human and a match does not", () => {
  const matched = reconcileSandboxDay(
    "2026-11-22",
    [{ currency: "USD", capturedMinor: 100n, refundedMinor: 0n }],
    [{ currency: "USD", capturedMinor: 100n, refundedMinor: 0n }],
  );
  assert.equal(matched.pageHuman, false);
  const mismatch = reconcileSandboxDay(
    "2026-11-22",
    [{ currency: "USD", capturedMinor: 100n, refundedMinor: 0n }],
    [{ currency: "USD", capturedMinor: 90n, refundedMinor: 0n }],
  );
  const page = pageForMismatch(mismatch);
  assert.equal(mismatch.pageHuman, true);
  assert.equal(page?.severity, "page");
  assert.equal(page?.mismatches[0]?.ledgerMinor, 100n);
  assert.equal(page?.mismatches[0]?.providerMinor, 90n);
});

test("a stripe test webhook signature is checked and the split is not invented", () => {
  const provider = createStripeTestProvider({
    secretKey: "sk_test_local_only",
    webhookSecret: "whsec_test_local",
    transport: async () => {
      throw new Error("network");
    },
  });
  const body = JSON.stringify({
    id: "evt_test_1",
    type: "checkout.session.completed",
    data: {
      object: {
        amount_total: 1000,
        currency: "usd",
        client_reference_id: "order-1",
        metadata: {
          platform_fee_minor: "150",
          creator_royalty_minor: "850",
          review_fee_minor: "0",
          tax_minor: "0",
        },
      },
    },
  });
  const timestamp = "1700000000";
  const signature = createHmac("sha256", "whsec_test_local").update(`${timestamp}.${body}`).digest("hex");
  const event = provider.verifyWebhook(body, `t=${timestamp},v1=${signature}`);
  assert.equal(event.amountMinor, 1000n);
  assert.equal(event.platformFeeMinor, 150n);
  assert.throws(() => provider.verifyWebhook(body, "t=1,v1=00"), /signature/);
  assert.throws(
    () => provider.verifyWebhook(JSON.stringify({ id: "evt_test_2", type: "checkout.session.completed", data: { object: { amount_total: 1, currency: "usd" } } }), `t=${timestamp},v1=${createHmac("sha256", "whsec_test_local").update(`${timestamp}.${JSON.stringify({ id: "evt_test_2", type: "checkout.session.completed", data: { object: { amount_total: 1, currency: "usd" } } })}`).digest("hex")}`),
    /ledger split/,
  );
});

test("versioned object restore reads the prior chunk and redaction removes it", () => {
  const store = new VersionedObjectStore(mkdtempSync(path.join(tmpdir(), "orbexa-versions-")));
  const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/local/chunk.txt";
  const original = Buffer.from("restored chunk marker 950 mm");
  const first = store.put(key, original);
  store.put(key, Buffer.from("overwrite"));
  assert.equal(store.get(key).toString(), "overwrite");
  const record = restorePriorVersion(store, key, first.versionId, original);
  assert.equal(record.body_matches, true);
  assert.equal(record.aws_rds_snapshot_restore, false);
  assert.equal(record.aws_s3_get_object_version, false);
  assert.equal(Number.isFinite(record.elapsed_ms), true);
  assert.ok(record.elapsed_ms >= 0);
  store.redactAllVersions(key);
  assert.equal(store.get(key, first.versionId).toString(), "[redacted]");
  assert.equal(store.get(key).toString(), "[redacted]");
});

test("the cell contract keeps the Terraform WAF rule set and does not copy tenants", () => {
  const cell = readFileSync(path.join(root, "infra/modules/cell/main.tf"), "utf8");
  const eu = readFileSync(path.join(root, "infra/envs/prod-eu-central-1/main.tf"), "utf8");
  const moduleTree = cell + eu;
  assert.match(cell, /name\s+=\s+"AWSManagedRulesCommonRuleSet"/);
  assert.match(cell, /vendor_name\s+=\s+"AWS"/);
  assert.match(cell, /desired_count\s+=\s+0/);
  assert.equal(moduleTree.includes("AdministratorAccess"), false);
  assert.equal(moduleTree.includes("aws_s3_bucket_replication"), false);
  assert.equal(moduleTree.includes("aws_dms"), false);
  assert.match(eu, /region\s+=\s+"eu-central-1"/);
  assert.match(eu, /cell_name\s+=\s+"prod-euc1"/);
  assert.equal(eu.includes("us-east-1"), false);
});
