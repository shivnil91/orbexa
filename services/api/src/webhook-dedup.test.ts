import assert from "node:assert/strict";
import test from "node:test";
import { loadMigrations } from "@orbexa/db/migrations.ts";
import { splitServiceAmount } from "@orbexa/db/money.ts";
import { connectDatabase, recreateDatabase, type PgHandle } from "@orbexa/db/pg16.ts";
import { persistWebhook, type WebhookPost } from "./ledger.ts";
import { FakePaymentProvider } from "./payments/fake.ts";

const buyer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("two Postgres sessions persist one webhook exactly once", async () => {
  const left = await recreateDatabase("orbexa_webhook");
  let right: PgHandle | undefined;
  try {
    for (const migration of await loadMigrations()) {
      await left.exec(migration.sql);
    }
    await left.exec(`
      INSERT INTO processing_regions (id, status) VALUES ('local', 'active');
      INSERT INTO cell_identity (region, environment) VALUES ('local', 'local');
      INSERT INTO orgs (
        id, kind, legal_name, country_code, home_region, default_locale, default_time_zone, status
      ) VALUES (
        '${buyer}', 'buyer', 'Rahul Distributors', 'FJ', 'local', 'en', 'Pacific/Auckland', 'active'
      );
    `);
    right = await connectDatabase("orbexa_webhook");
    const split = splitServiceAmount(100000n, 15000n, 1500);
    const provider = new FakePaymentProvider("orbexa-local-webhook");
    const session = provider.createCheckout({
      idempotencyKey: "cross-process",
      amountMinor: 100000n,
      currency: "USD",
      orderId: buyer,
    });
    provider.rememberSplit(session.id, { ...split, taxMinor: 0n });
    const signed = provider.capture(session.id);
    const event = provider.verifyWebhook(signed.body, signed.signature);
    const post: WebhookPost = {
      event,
      buyerOrgId: buyer,
      homeRegion: "local",
      orderId: buyer,
    };
    const [first, second] = await Promise.all([persistWebhook(left, post), persistWebhook(right, post)]);
    assert.equal(first.transactionId, second.transactionId);
    assert.equal(first.created !== second.created, true);
    const txns = await left.query<{ count: string }>("SELECT count(*)::text AS count FROM ledger_transactions");
    const keys = await left.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM idempotency_keys WHERE scope = 'webhook'",
    );
    const sums = await left.query<{ debit: string; credit: string }>(`
      SELECT
        COALESCE(sum(amount_minor) FILTER (WHERE direction = 'debit'), 0)::text AS debit,
        COALESCE(sum(amount_minor) FILTER (WHERE direction = 'credit'), 0)::text AS credit
      FROM ledger_entries
    `);
    assert.equal(txns.rows[0].count, "1");
    assert.equal(keys.rows[0].count, "1");
    assert.equal(sums.rows[0].debit, sums.rows[0].credit);
    assert.equal(sums.rows[0].debit, "100000");
    const changed = {
      ...event,
      platformFeeMinor: event.platformFeeMinor + 1n,
      creatorRoyaltyMinor: event.creatorRoyaltyMinor - 1n,
    };
    await assert.rejects(persistWebhook(left, { ...post, event: changed }), /different payload/);
  } finally {
    await right?.end();
    await left.end();
  }
});
