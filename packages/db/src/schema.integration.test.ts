import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadMigrations } from "./migrations.ts";
import { recreateDatabase, type PgHandle } from "./pg16.ts";

type Sql = {
  exec(sql: string): Promise<unknown>;
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

const buyerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const buyerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const creator = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const userA = "11111111-1111-4111-8111-111111111111";
const hash = "ab".repeat(32);
const ones = `('[' || repeat('1,', 1535) || '1]')::vector(1536)`;
const zeros = `('[' || repeat('0,', 1535) || '1]')::vector(1536)`;

let db: Sql;
let pg: PgHandle | undefined;
let modelId = "";
let jobA = "";
let jobA2 = "";
let runA = "";
let chunkA = "";
let chunkB = "";

before(async () => {
  if (process.env.PG16 === "1") {
    pg = await recreateDatabase("orbexa_test");
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
    VALUES ('test-1536', 'test', 1536, 'active');
    INSERT INTO model_routes (code, primary_model, fallback_model)
    VALUES ('tender-default', 'primary-test', 'fallback-test');
  `);
  modelId = (await db.query<{ id: string }>("SELECT id FROM embedding_models")).rows[0].id;
  const routeId = (await db.query<{ id: string }>("SELECT id FROM model_routes")).rows[0].id;
  await db.exec(`
    INSERT INTO agents (id, creator_org_id, slug, name, vertical, source_locale)
    VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '${creator}', 'beds', 'Hospital bed tender', 'tender_writing', 'en');
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
  await insertJob(buyerA, "job-a", "order-a");
  await insertJob(buyerA, "job-a2", "order-a2");
  await insertJob(buyerB, "job-b", "order-b");
  const jobs = await db.query<{ id: string; tenant_id: string }>(
    "SELECT id, tenant_id::text FROM jobs ORDER BY created_at",
  );
  jobA = jobs.rows.find((row) => row.tenant_id === buyerA)!.id;
  jobA2 = jobs.rows.filter((row) => row.tenant_id === buyerA)[1]!.id;
  const jobB = jobs.rows.find((row) => row.tenant_id === buyerB)!.id;
  runA = (
    await db.query<{ id: string }>(
      `SELECT id FROM job_runs WHERE job_id = '${jobA}'`,
    )
  ).rows[0].id;
  chunkA = await insertChunk(buyerA, jobA, "mandatory insurance certificate for hospital beds");
  chunkB = await insertChunk(buyerB, jobB, "secret pricing schedule for the other buyer");
});

after(async () => {
  await pg?.end();
});

async function insertJob(tenant: string, idem: string, orderIdem: string): Promise<void> {
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
    ) RETURNING id
  `);
  const job = await db.query<{ id: string }>(`
    INSERT INTO jobs (tenant_id, home_region, order_id, agent_version_id, status)
    VALUES ('${tenant}', 'local', '${order.rows[0].id}', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'running')
    RETURNING id
  `);
  await db.exec(`
    INSERT INTO job_runs (job_id, tenant_id, home_region, status, idempotency_key)
    VALUES ('${job.rows[0].id}', '${tenant}', 'local', 'running', '${idem}');
    INSERT INTO job_budgets (job_id, tenant_id, home_region, currency, limit_minor)
    VALUES ('${job.rows[0].id}', '${tenant}', 'local', 'USD', 500);
  `);
  void orderIdem;
}

async function insertChunk(tenant: string, job: string, body: string): Promise<string> {
  const document = await db.query<{ id: string }>(`
    INSERT INTO documents (
      tenant_id, home_region, job_id, kind, filename, media_type, byte_size, sha256, storage_key
    ) VALUES (
      '${tenant}', 'local', '${job}', 'tender_source', 'tender.pdf', 'application/pdf', 10,
      '${hash}', '${tenant}/local/${job}.pdf'
    ) RETURNING id
  `);
  const chunk = await db.query<{ id: string }>(`
    INSERT INTO document_chunks (
      tenant_id, home_region, document_id, job_id, chunker_version, chunk_index, kind, body,
      locator_kind, page
    ) VALUES (
      '${tenant}', 'local', '${document.rows[0].id}', '${job}', 'v1', 0, 'prose', '${body}',
      'page', 1
    ) RETURNING id
  `);
  await db.exec(`
    INSERT INTO chunk_embeddings (chunk_id, tenant_id, home_region, model_id, embedding)
    VALUES ('${chunk.rows[0].id}', '${tenant}', 'local', '${modelId}', ${tenant === buyerA ? ones : zeros});
  `);
  return chunk.rows[0].id;
}

async function asApp(settings: Record<string, string>, sql: string) {
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE orbexa_app");
  for (const [key, value] of Object.entries(settings)) {
    await db.query("SELECT set_config($1, $2, false)", [`app.${key}`, value]);
  }
  try {
    return await db.query<{ id: string }>(sql);
  } finally {
    await db.exec("RESET ROLE");
  }
}

test("schema applies on Postgres and reports its version", async () => {
  const version = await db.query<{ version: string }>("SELECT version()");
  const extension = await db.query<{ extversion: string }>(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  assert.equal(extension.rows.length, 1);
  assert.match(extension.rows[0].extversion, /^\d+\.\d+/);
  if (process.env.PG16 === "1") {
    assert.match(version.rows[0].version, /PostgreSQL 16\./);
  } else {
    assert.match(version.rows[0].version, /PostgreSQL/);
  }
});

test("currency exponents follow ISO and checkout stays disabled", async () => {
  const rows = await db.query<{ code: string; minor_unit_exponent: number; checkout_enabled: boolean }>(
    "SELECT code, minor_unit_exponent, checkout_enabled FROM currencies WHERE code IN ('USD', 'JPY', 'KWD', 'FJD')",
  );
  const byCode = Object.fromEntries(rows.rows.map((row) => [row.code.trim(), row]));
  assert.equal(byCode.USD.minor_unit_exponent, 2);
  assert.equal(byCode.JPY.minor_unit_exponent, 0);
  assert.equal(byCode.KWD.minor_unit_exponent, 3);
  assert.equal(byCode.FJD.minor_unit_exponent, 2);
  assert.equal(rows.rows.every((row) => row.checkout_enabled === false), true);
});

test("invalid time zones are rejected", async () => {
  await assert.rejects(
    db.exec(
      "INSERT INTO users (email, display_name, time_zone) VALUES ('bad-zone@example.com', 'Bad', 'Not/AZone')",
    ),
    /time zone/i,
  );
});

test("private rows cannot be written into another cell", async () => {
  await assert.rejects(
    db.exec(`
      INSERT INTO documents (
        tenant_id, home_region, kind, filename, media_type, byte_size, sha256, storage_key
      ) VALUES (
        '${buyerA}', 'eu-central-1', 'evidence', 'x.pdf', 'application/pdf', 1,
        '${hash}', '${buyerA}/eu-central-1/x.pdf'
      )
    `),
    /does not match this cell|not active/i,
  );
});

test("an unbalanced ledger transaction cannot post", async () => {
  const txn = await db.query<{ id: string }>(`
    INSERT INTO ledger_transactions (
      buyer_org_id, home_region, kind, currency, idempotency_key
    ) VALUES ('${buyerA}', 'local', 'charge_captured', 'USD', 'unbalanced')
    RETURNING id
  `);
  await db.exec(`
    INSERT INTO ledger_entries (
      transaction_id, buyer_org_id, home_region, account_code, direction, amount_minor, currency
    ) VALUES (
      '${txn.rows[0].id}', '${buyerA}', 'local', 'provider_cash', 'debit', 100, 'USD'
    )
  `);
  await assert.rejects(
    db.exec(`UPDATE ledger_transactions SET posted = true, posted_at = now() WHERE id = '${txn.rows[0].id}'`),
    /not balanced/i,
  );
});

test("a balanced ledger transaction posts", async () => {
  const txn = await db.query<{ id: string }>(`
    INSERT INTO ledger_transactions (
      buyer_org_id, home_region, kind, currency, idempotency_key
    ) VALUES ('${buyerA}', 'local', 'charge_captured', 'USD', 'balanced')
    RETURNING id
  `);
  await db.exec(`
    INSERT INTO ledger_entries (
      transaction_id, buyer_org_id, home_region, account_code, direction, amount_minor, currency
    ) VALUES
      ('${txn.rows[0].id}', '${buyerA}', 'local', 'provider_cash', 'debit', 100, 'USD'),
      ('${txn.rows[0].id}', '${buyerA}', 'local', 'platform_fee_revenue', 'credit', 100, 'USD')
  `);
  await db.exec(
    `UPDATE ledger_transactions SET posted = true, posted_at = now() WHERE id = '${txn.rows[0].id}'`,
  );
  const posted = await db.query<{ posted: boolean }>(
    `SELECT posted FROM ledger_transactions WHERE id = '${txn.rows[0].id}'`,
  );
  assert.equal(posted.rows[0].posted, true);
});

test("app roles are not superuser and cannot bypass row security", async () => {
  const roles = await db.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
    WHERE rolname IN ('orbexa_app', 'orbexa_worker', 'orbexa_finance')
  `);
  assert.equal(roles.rows.length, 3);
  assert.equal(roles.rows.every((role) => role.rolsuper === false && role.rolbypassrls === false), true);
});

test("retrieval as one buyer cannot see another buyer's chunks", async () => {
  const seen = await asApp(
    { tenant_id: buyerA, access: "org", job_id: jobA, user_id: userA },
    `SELECT chunk_id::text AS id FROM app.retrieve_chunks(
      '${buyerA}', '${jobA}', '${modelId}', ${ones}, 'insurance', 10
    )`,
  );
  assert.deepEqual(seen.rows.map((row) => row.id), [chunkA]);
  assert.equal(seen.rows.some((row) => row.id === chunkB), false);
});

test("a query that forgets the tenant predicate still hides the other buyer", async () => {
  const seen = await asApp(
    { tenant_id: buyerA, access: "org", job_id: jobA, user_id: userA },
    "SELECT id::text AS id FROM document_chunks",
  );
  assert.deepEqual(seen.rows.map((row) => row.id), [chunkA]);
});

test("a supported claim cannot cite another tenant, even as superuser", async () => {
  const draft = await db.query<{ id: string }>(`
    INSERT INTO drafts (
      tenant_id, home_region, job_id, kind, locale, storage_key, version
    ) VALUES (
      '${buyerA}', 'local', '${jobA}', 'section', 'en', '${buyerA}/local/draft.txt', 1
    ) RETURNING id
  `);
  const claim = await db.query<{ id: string }>(`
    INSERT INTO draft_claims (tenant_id, home_region, draft_id, job_id, body, support_status)
    VALUES ('${buyerA}', 'local', '${draft.rows[0].id}', '${jobA}', 'We hold ISO 13485.', 'unsupported')
    RETURNING id
  `);
  await assert.rejects(
    db.exec(`
      INSERT INTO claim_citations (tenant_id, home_region, claim_id, chunk_id, quote)
      VALUES ('${buyerA}', 'local', '${claim.rows[0].id}', '${chunkB}', 'stolen')
    `),
    /foreign key|same job|violates/i,
  );
});

test("a supported claim without a citation is rejected", async () => {
  const draft = await db.query<{ id: string }>(`
    INSERT INTO drafts (
      tenant_id, home_region, job_id, kind, locale, storage_key, version
    ) VALUES (
      '${buyerA}', 'local', '${jobA}', 'full_bid', 'en', '${buyerA}/local/full.txt', 1
    ) RETURNING id
  `);
  await assert.rejects(
    db.exec(`
      INSERT INTO draft_claims (tenant_id, home_region, draft_id, job_id, body, support_status)
      VALUES (
        '${buyerA}', 'local', '${draft.rows[0].id}', '${jobA}',
        'The beds are TGA registered.', 'supported'
      )
    `),
    /citation/i,
  );
});

test("the worker cannot read memory provenance", async () => {
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE orbexa_worker");
  await assert.rejects(db.query("SELECT id FROM memory_provenance"), /permission denied/i);
  await db.exec("RESET ROLE");
});

test("execution memory from another run is hidden", async () => {
  const provenance = await db.query<{ id: string }>(`
    INSERT INTO memory_provenance (tenant_id, home_region, source_type, content_hash)
    VALUES ('${buyerA}', 'local', 'model_scratch', '${hash}')
    RETURNING id
  `);
  await db.exec(`
    INSERT INTO memory_items (
      logical_id, version, owner_org_id, tenant_id, home_region, scope, authority,
      provenance_id, job_id, run_id, retain_until, body, content_hash
    ) VALUES (
      gen_random_uuid(), 1, '${buyerA}', '${buyerA}', 'local', 'execution', 'contract',
      '${provenance.rows[0].id}', '${jobA}', '${runA}', now() + interval '1 day',
      'scratch for this run', '${hash}'
    )
  `);
  const otherRun = "22222222-2222-4222-8222-222222222222";
  const seen = await asApp(
    { tenant_id: buyerA, access: "org", job_id: jobA, run_id: otherRun, user_id: userA },
    "SELECT id::text AS id FROM memory_items WHERE scope = 'execution'",
  );
  assert.equal(seen.rows.length, 0);
});

test("job-scoped buyer memory does not appear in another job of the same buyer", async () => {
  const provenance = await db.query<{ id: string }>(`
    INSERT INTO memory_provenance (tenant_id, home_region, source_type, source_document_id, content_hash)
    VALUES ('${buyerA}', 'local', 'run_derivation', NULL, '${hash}')
    RETURNING id
  `);
  await db.exec(`
    INSERT INTO memory_items (
      logical_id, version, owner_org_id, tenant_id, home_region, scope, authority,
      provenance_id, job_id, retain_until, body, content_hash
    ) VALUES (
      gen_random_uuid(), 1, '${buyerA}', '${buyerA}', 'local', 'buyer_private', 'contract',
      '${provenance.rows[0].id}', '${jobA}', now() + interval '90 days',
      'ward layout from this tender only', '${hash}'
    )
  `);
  const seen = await asApp(
    { tenant_id: buyerA, access: "org", job_id: jobA2, user_id: userA },
    "SELECT body FROM memory_items WHERE scope = 'buyer_private'",
  );
  assert.equal(seen.rows.length, 0);
});

test("a buyer session cannot read creator expertise", async () => {
  const provenance = await db.query<{ id: string }>(`
    INSERT INTO memory_provenance (tenant_id, home_region, source_type, content_hash)
    VALUES ('${creator}', 'local', 'creator_authored', '${hash}')
    RETURNING id
  `);
  await db.exec(`
    INSERT INTO memory_items (
      logical_id, version, owner_org_id, tenant_id, home_region, scope, authority,
      provenance_id, agent_id, body, content_hash
    ) VALUES (
      gen_random_uuid(), 1, '${creator}', '${creator}', 'local', 'creator_expertise', 'owner',
      '${provenance.rows[0].id}', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'Moishin method for equipment schedules', '${hash}'
    )
  `);
  const seen = await asApp(
    {
      tenant_id: buyerA,
      access: "org",
      job_id: jobA,
      agent_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      user_id: userA,
    },
    "SELECT id::text AS id FROM memory_items WHERE scope = 'creator_expertise'",
  );
  assert.equal(seen.rows.length, 0);
});

test("llm cache rows are isolated by tenant", async () => {
  await db.exec(`
    INSERT INTO llm_cache (tenant_id, home_region, model, prompt_hash, response_storage_key, expires_at)
    VALUES
      ('${buyerA}', 'local', 'primary-test', '${hash}', '${buyerA}/local/cache-a', now() + interval '1 day'),
      ('${buyerB}', 'local', 'primary-test', '${hash}', '${buyerB}/local/cache-b', now() + interval '1 day')
  `);
  const seen = await asApp(
    { tenant_id: buyerA, access: "org", job_id: jobA, user_id: userA },
    "SELECT tenant_id::text AS id FROM llm_cache",
  );
  assert.deepEqual(seen.rows.map((row) => row.id), [buyerA]);
});

test("later agent versions cannot publish unless the eval improves, and rollback is one step", async () => {
  await db.exec(`
    UPDATE agent_versions SET status = 'published', published_at = now()
    WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  `);
  const suite = await db.query<{ id: string }>(`
    INSERT INTO eval_suites (agent_id, name)
    VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'golden-beds')
    RETURNING id
  `);
  await db.exec(`
    INSERT INTO eval_runs (agent_version_id, suite_id, passed, score)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '${suite.rows[0].id}', true, 0.40)
  `);
  const routeId = (await db.query<{ id: string }>("SELECT id FROM model_routes")).rows[0].id;
  await db.exec(`
    INSERT INTO agent_versions (
      id, agent_id, version, status, promotion_basis, previous_version_id, pipeline_hash,
      prompt_bundle_hash, tool_catalog_hash, model_route_id, embedding_model_id
    ) VALUES (
      'abababab-abab-4aba-8aba-abababababab', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2, 'draft',
      'eval_improved', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '${hash}', '${hash}', '${hash}',
      '${routeId}', '${modelId}'
    )
  `);
  await assert.rejects(
    db.exec(`
      UPDATE agent_versions SET status = 'published', published_at = now()
      WHERE id = 'abababab-abab-4aba-8aba-abababababab'
    `),
    /eval/i,
  );
  await db.exec(`
    INSERT INTO eval_runs (agent_version_id, suite_id, passed, score)
    VALUES ('abababab-abab-4aba-8aba-abababababab', '${suite.rows[0].id}', true, 0.55)
  `);
  await db.exec(`
    UPDATE agent_versions SET status = 'published', published_at = now()
    WHERE id = 'abababab-abab-4aba-8aba-abababababab'
  `);
  await db.exec("SELECT app.rollback_agent_version('abababab-abab-4aba-8aba-abababababab')");
  const versions = await db.query<{ id: string; status: string }>(
    "SELECT id::text, status FROM agent_versions ORDER BY version",
  );
  assert.equal(versions.rows[0].status, "published");
  assert.equal(versions.rows[1].status, "rolled_back");
});

test("a payout cannot move to processing without a clear screening", async () => {
  const obligation = await db.query<{ id: string }>(`
    INSERT INTO payout_obligations (
      order_id, payee_org_id, home_region, kind, currency, amount_minor
    ) VALUES (
      gen_random_uuid(), '${creator}', 'local', 'creator_royalty', 'USD', 72250
    ) RETURNING id
  `);
  await assert.rejects(
    db.exec(`
      INSERT INTO payouts (
        obligation_id, payee_org_id, home_region, provider, source_currency, source_amount_minor,
        status, idempotency_key
      ) VALUES (
        '${obligation.rows[0].id}', '${creator}', 'local', 'wise', 'USD', 72250,
        'processing', 'payout-blocked'
      )
    `),
    /screening/i,
  );
});

test("expired execution memory can be purged without touching live rows", async () => {
  const provenance = await db.query<{ id: string }>(`
    INSERT INTO memory_provenance (tenant_id, home_region, source_type, content_hash)
    VALUES ('${buyerB}', 'local', 'model_scratch', '${hash}')
    RETURNING id
  `);
  const runB = (
    await db.query<{ id: string }>(
      `SELECT id FROM job_runs WHERE tenant_id = '${buyerB}'`,
    )
  ).rows[0].id;
  const jobB = (
    await db.query<{ id: string }>(`SELECT id FROM jobs WHERE tenant_id = '${buyerB}'`)
  ).rows[0].id;
  await db.exec(`
    INSERT INTO memory_items (
      logical_id, version, owner_org_id, tenant_id, home_region, scope, authority,
      provenance_id, job_id, run_id, retain_until, body, content_hash
    ) VALUES (
      gen_random_uuid(), 1, '${buyerB}', '${buyerB}', 'local', 'execution', 'contract',
      '${provenance.rows[0].id}', '${jobB}', '${runB}', now() - interval '1 hour',
      'expired scratch', '${hash}'
    )
  `);
  const purged = await db.query<{ count: number }>("SELECT app.purge_expired_memory() AS count");
  assert.ok(Number(purged.rows[0].count) >= 1);
  const bodies = await db.query<{ body: string }>(
    `SELECT body FROM memory_items WHERE tenant_id = '${buyerB}' AND scope = 'execution'`,
  );
  assert.equal(bodies.rows[0].body, "[purged]");
});
