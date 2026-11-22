import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { insertFeedback, setTrainingConsent } from "./feedback.ts";
import { loadMigrations } from "./migrations.ts";
import { recreateDatabase, type PgHandle } from "./pg16.ts";

const buyerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const buyerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const creator = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const userA = "11111111-1111-4111-8111-111111111111";
const hash = "ab".repeat(32);
const otherHash = "cd".repeat(32);

type Sql = {
  exec(sql: string): Promise<unknown>;
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

let db: Sql;
let pg: PgHandle | undefined;
let jobA = "";
let jobB = "";

before(async () => {
  if (process.env.PG16 === "1") {
    pg = await recreateDatabase("orbexa_rl");
    db = pg;
  } else {
    const memory = new PGlite({ extensions: { vector } });
    db = {
      exec: (sql) => memory.exec(sql),
      query: (sql, params) => (params ? memory.query(sql, [...params]) : memory.query(sql)),
    };
  }
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector");
  for (const migration of await loadMigrations()) {
    await db.exec(migration.sql);
  }
  await db.exec(`
    INSERT INTO processing_regions (id, status) VALUES ('local', 'active');
    INSERT INTO cell_identity (region, environment) VALUES ('local', 'local');
    INSERT INTO users (id, email, display_name, locale, time_zone, country_of_residence)
    VALUES ('${userA}', 'rahul@example.com', 'Rahul', 'en', 'Pacific/Auckland', 'FJ');
    INSERT INTO orgs (id, kind, legal_name, country_code, home_region, default_locale, default_time_zone, status)
    VALUES
      ('${buyerA}', 'buyer', 'Rahul Distributors', 'FJ', 'local', 'en', 'Pacific/Auckland', 'active'),
      ('${buyerB}', 'buyer', 'Other Buyer', 'DE', 'local', 'de', 'Europe/Berlin', 'active'),
      ('${creator}', 'creator', 'Moishin Studio', 'NZ', 'local', 'en', 'Pacific/Auckland', 'active');
    INSERT INTO embedding_models (code, provider, dims, status)
    VALUES ('rl-1536', 'test', 1536, 'active');
    INSERT INTO model_routes (code, primary_model) VALUES ('rl-fixture', 'fixture');
  `);
  const modelId = (await db.query<{ id: string }>("SELECT id::text AS id FROM embedding_models")).rows[0].id;
  const routeId = (await db.query<{ id: string }>("SELECT id::text AS id FROM model_routes")).rows[0].id;
  await db.exec(`
    INSERT INTO agents (id, creator_org_id, slug, name, vertical, source_locale)
    VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '${creator}', 'beds-rl', 'Hospital bed tender', 'tender_writing', 'en');
    INSERT INTO agent_versions (
      id, agent_id, version, status, promotion_basis, pipeline_hash, prompt_bundle_hash,
      tool_catalog_hash, model_route_id, embedding_model_id
    ) VALUES (
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 1, 'draft',
      'initial_human', '${hash}', '${hash}', '${hash}', '${routeId}', '${modelId}'
    );
    INSERT INTO listings (id, creator_org_id, agent_version_id, vertical, source_locale, title, summary)
    VALUES (
      'ffffffff-ffff-4fff-8fff-ffffffffffff', '${creator}', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'tender_writing', 'en', 'Hospital bed response', 'Draft a sourced bid'
    );
    INSERT INTO listing_tiers (
      id, listing_id, service_level, currency, price_minor, platform_fee_bps, creator_royalty_bps,
      review_fee_minor, delivery_days, included_revisions, cancellation_code, payout_release
    ) VALUES (
      '12121212-1212-4121-8121-121212121212', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'expert_verified',
      'USD', 100000, 1500, 8500, 15000, 5, 2, 'before_draft_full_refund', 'after_dispute_window'
    );
  `);
  jobA = await insertJob(buyerA, "rl-a");
  jobB = await insertJob(buyerB, "rl-b");
});

after(async () => {
  await pg?.end();
});

async function insertJob(tenant: string, idem: string): Promise<string> {
  const order = await db.query<{ id: string }>(`
    INSERT INTO orders (
      buyer_org_id, home_region, listing_tier_id, listing_currency, service_amount_minor,
      platform_fee_minor, creator_royalty_minor, review_fee_minor, tax_behavior, tax_amount_minor,
      charge_currency, charge_amount_minor, buyer_country_code, creator_country_code,
      buyer_locale, buyer_time_zone, status
    ) VALUES (
      '${tenant}', 'local', '12121212-1212-4121-8121-121212121212', 'USD', 100000,
      12750, 72250, 15000, 'exclusive', 0,
      'USD', 100000, 'FJ', 'NZ', 'en', 'Pacific/Auckland', 'paid'
    ) RETURNING id::text AS id
  `);
  const job = await db.query<{ id: string }>(`
    INSERT INTO jobs (tenant_id, home_region, order_id, agent_version_id, status)
    VALUES ('${tenant}', 'local', '${order.rows[0].id}', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'running')
    RETURNING id::text AS id
  `);
  await db.exec(`
    INSERT INTO job_runs (job_id, tenant_id, home_region, status, idempotency_key)
    VALUES ('${job.rows[0].id}', '${tenant}', 'local', 'running', '${idem}')
  `);
  return job.rows[0].id;
}

async function asApp<T extends Record<string, unknown>>(settings: Record<string, string>, sql: string, params?: unknown[]) {
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE orbexa_app");
  for (const [key, value] of Object.entries(settings)) {
    await db.query("SELECT set_config($1, $2, false)", [`app.${key}`, value]);
  }
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("RESET ROLE");
  }
}

test("feedback is tenant-isolated and a fake edit is flagged", async () => {
  await insertFeedback(db, {
    tenantId: buyerA,
    homeRegion: "local",
    jobId: jobA,
    kind: "buyer_reject",
  });
  await insertFeedback(db, {
    tenantId: buyerA,
    homeRegion: "local",
    jobId: jobA,
    kind: "buyer_edit",
    reward: 1,
    editDistance: 0,
  });
  const flagged = await db.query<{ suspect: boolean }>(
    "SELECT suspect FROM feedback_events WHERE kind = 'buyer_edit'",
  );
  assert.equal(flagged.rows[0].suspect, true);
  const other = await asApp(
    { tenant_id: buyerB, job_id: jobB, access: "org", user_id: userA },
    "SELECT kind FROM feedback_events",
  );
  assert.equal(other.rows.length, 0);
  const own = await asApp(
    { tenant_id: buyerA, job_id: jobA, access: "org", user_id: userA },
    "SELECT kind FROM feedback_events ORDER BY kind",
  );
  assert.equal(own.rows.length, 2);
});

test("training export needs org opt-in and founder authorisation, and does not train", async () => {
  const pair = await db.query<{ id: string }>(
    `INSERT INTO preference_pairs (tenant_id, home_region, job_id, chosen_hash, rejected_hash, source)
     VALUES ($1, 'local', $2, $3, $4, 'buyer') RETURNING id::text AS id`,
    [buyerA, jobA, hash, otherHash],
  );
  const pairId = pair.rows[0].id;
  await db.query("SELECT set_config('app.tenant_id', $1, false)", [buyerA]);
  await assert.rejects(db.query("SELECT * FROM app.consider_preference_export($1)", [pairId]), /consent/i);
  await setTrainingConsent(db, { orgId: buyerA, homeRegion: "local", granted: true, userId: userA });
  await assert.rejects(
    db.query("SELECT * FROM app.consider_preference_export($1)", [pairId]),
    /founder/i,
  );
  await assert.rejects(
    asApp({}, "SELECT app.grant_founder_authorisation($1, $2)", [buyerA, "not from the app"]),
    /application/i,
  );
  await db.query("SELECT app.grant_founder_authorisation($1, $2)", [buyerA, "founder recorded this gate"]);
  const exported = await db.query<{ chosen_hash: string }>(
    "SELECT chosen_hash FROM app.consider_preference_export($1)",
    [pairId],
  );
  assert.equal(exported.rows[0].chosen_hash, hash);
  const used = await db.query<{ training_used: boolean }>(
    "SELECT training_used FROM preference_pairs WHERE id = $1",
    [pairId],
  );
  assert.equal(used.rows[0].training_used, false);
  await assert.rejects(
    db.query("UPDATE preference_pairs SET training_used = true WHERE id = $1", [pairId]),
    /training_used|check/i,
  );
});

test("a policy cannot go active without an offline score, and the bandit flag gates arms", async () => {
  const proposed = await db.query<{ id: string }>(
    `INSERT INTO policy_candidates (tenant_id, home_region, code, status)
     VALUES ($1, 'local', 'prompt-v2', 'proposed') RETURNING id::text AS id`,
    [buyerA],
  );
  await db.query("SELECT set_config('app.tenant_id', $1, false)", [buyerA]);
  await assert.rejects(db.query("SELECT app.activate_policy($1)", [proposed.rows[0].id]), /offline/i);
  await db.query(
    `UPDATE policy_candidates
     SET status = 'offline_passed', offline_score = 0.8, baseline_score = 0.6
     WHERE id = $1`,
    [proposed.rows[0].id],
  );
  await db.query("SELECT app.activate_policy($1)", [proposed.rows[0].id]);
  const active = await db.query<{ status: string }>("SELECT status FROM policy_candidates WHERE code = 'prompt-v2'");
  assert.equal(active.rows[0].status, "active");
  await db.query(
    `INSERT INTO bandit_arms (
       tenant_id, home_region, kind, arm_code, pulls, reward_sum, status, offline_score
     ) VALUES ($1, 'local', 'model', 'fixture-b', 2, 1.0, 'active', 0.5)`,
    [buyerA],
  );
  const gated = await db.query<{ arm: string | null }>(
    "SELECT app.select_bandit_arm($1, 'model') AS arm",
    [buyerA],
  );
  assert.equal(gated.rows[0].arm, null);
  await db.query("SELECT set_config('app.bandit', '1', false)");
  const chosen = await db.query<{ arm: string | null }>(
    "SELECT app.select_bandit_arm($1, 'model') AS arm",
    [buyerA],
  );
  assert.equal(chosen.rows[0].arm, "fixture-b");
});
