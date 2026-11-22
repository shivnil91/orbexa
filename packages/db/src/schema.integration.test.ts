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

async function asApp<T extends Record<string, unknown> = { id: string }>(
  settings: Record<string, string>,
  sql: string,
) {
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE orbexa_app");
  for (const [key, value] of Object.entries(settings)) {
    await db.query("SELECT set_config($1, $2, false)", [`app.${key}`, value]);
  }
  try {
    return await db.query<T>(sql);
  } finally {
    await db.exec("RESET ROLE");
    await db.exec("RESET ALL");
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

test("a second region does not receive a copy of this cell's tenant", async () => {
  const region = await db.query<{ status: string }>(
    "SELECT status FROM processing_regions WHERE id = 'eu-central-1'",
  );
  assert.equal(region.rows[0].status, "planned");
  const cell = await db.query<{ region: string }>("SELECT region FROM cell_identity");
  assert.equal(cell.rows[0].region, "local");
  await assert.rejects(
    db.exec(`
      INSERT INTO documents (
        tenant_id, home_region, kind, filename, media_type, byte_size, sha256, storage_key
      ) VALUES (
        '${buyerA}', 'eu-central-1', 'evidence', 'copy.pdf', 'application/pdf', 1,
        '${hash}', '${buyerA}/eu-central-1/copy.pdf'
      )
    `),
    /does not match this cell|not active/i,
  );
});

test("bm25 uses the same retrieve_chunks signature and can change rank", async () => {
  const document = await db.query<{ id: string }>(`
    INSERT INTO documents (
      tenant_id, home_region, job_id, kind, filename, media_type, byte_size, sha256, storage_key
    ) VALUES (
      '${buyerA}', 'local', '${jobA}', 'tender_source', 'rank.pdf', 'application/pdf', 10,
      '${hash}', '${buyerA}/local/${jobA}-rank.pdf'
    ) RETURNING id
  `);
  const certificate = await db.query<{ id: string }>(`
    INSERT INTO document_chunks (
      tenant_id, home_region, document_id, job_id, chunker_version, chunk_index, kind, body,
      locator_kind, page
    ) VALUES (
      '${buyerA}', 'local', '${document.rows[0].id}', '${jobA}', 'v1', 0, 'prose',
      'regulatory xylophone',
      'page', 1
    ) RETURNING id
  `);
  const noisy = "regulatory xylophone ".repeat(25);
  const repeated = await db.query<{ id: string }>(
    `INSERT INTO document_chunks (
      tenant_id, home_region, document_id, job_id, chunker_version, chunk_index, kind, body,
      locator_kind, page
    ) VALUES (
      '${buyerA}', 'local', '${document.rows[0].id}', '${jobA}', 'v1', 1, 'prose',
      $1, 'page', 2
    ) RETURNING id`,
    [noisy],
  );
  const query = `SELECT chunk_id::text AS id, lexical_rank FROM app.retrieve_chunks(
    '${buyerA}', '${jobA}', '${modelId}', ${ones}, 'regulatory xylophone', 10
  )`;
  const tsRank = await asApp<{ id: string; lexical_rank: number | null }>(
    { tenant_id: buyerA, access: "org", job_id: jobA, user_id: userA, lexical_scorer: "ts_rank_cd" },
    query,
  );
  const bm25 = await asApp<{ id: string; lexical_rank: number | null }>(
    { tenant_id: buyerA, access: "org", job_id: jobA, user_id: userA, lexical_scorer: "bm25" },
    query,
  );
  const scores = await db.query<{
    bm25_short: string;
    bm25_long: string;
    ts_short: string;
    ts_long: string;
  }>(`
    SELECT
      app.bm25_job_score('${certificate.rows[0].id}', 'regulatory xylophone', '${buyerA}', '${jobA}')::text AS bm25_short,
      app.bm25_job_score('${repeated.rows[0].id}', 'regulatory xylophone', '${buyerA}', '${jobA}')::text AS bm25_long,
      ts_rank_cd((SELECT search_vector FROM document_chunks WHERE id = '${certificate.rows[0].id}'), plainto_tsquery('simple', 'regulatory xylophone'))::text AS ts_short,
      ts_rank_cd((SELECT search_vector FROM document_chunks WHERE id = '${repeated.rows[0].id}'), plainto_tsquery('simple', 'regulatory xylophone'))::text AS ts_long
  `);
  const measured = scores.rows[0];
  const bm25Ratio = Number(measured.bm25_long) / Number(measured.bm25_short);
  const tsRatio = Number(measured.ts_long) / Number(measured.ts_short);
  assert.equal(bm25.rows.some((row) => row.id === certificate.rows[0].id), true);
  assert.equal(tsRank.rows.some((row) => row.id === certificate.rows[0].id), true);
  assert.ok(tsRatio > 10, JSON.stringify(measured));
  assert.ok(bm25Ratio < 3, JSON.stringify(measured));
  await assert.rejects(
    asApp(
      { tenant_id: buyerA, access: "org", job_id: jobA, user_id: userA, lexical_scorer: "parade" },
      query,
    ),
    /unknown lexical scorer/i,
  );
});

test("the agent version dashboard reads run metrics and invocations", async () => {
  const routeId = (await db.query<{ id: string }>("SELECT id FROM model_routes")).rows[0].id;
  await db.exec(`
    INSERT INTO drafts (
      tenant_id, home_region, job_id, kind, locale, storage_key, version
    ) VALUES (
      '${buyerA}', 'local', '${jobA}', 'full_bid', 'en', '${buyerA}/local/revision.txt', 2
    )
  `);
  await db.exec(`
    INSERT INTO llm_invocations (
      tenant_id, home_region, job_id, run_id, route_id, requested_model, served_model,
      input_tokens, output_tokens, cost_currency, cost_minor, latency_ms, prompt_hash
    ) VALUES (
      '${buyerA}', 'local', '${jobA}', '${runA}', '${routeId}', 'primary-test', 'primary-test',
      20, 5, 'USD', 40, 1200, '${hash}'
    )
  `);
  await db.exec(`
    INSERT INTO run_metrics (
      tenant_id, home_region, job_id, run_id, agent_version_id, kind,
      grounded_claim_rate, cost_currency, cost_minor, latency_ms
    ) VALUES (
      '${buyerA}', 'local', '${jobA}', '${runA}', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'final',
      0.5, 'USD', 40, 1200
    )
  `);
  const rows = await db.query<{
    grounded_claim_rate: string;
    latency_ms: string;
    cost_per_job_minor: string;
    invocation_cost_minor: string;
    revision_rate: string;
    job_count: number;
  }>(`
    SELECT grounded_claim_rate::text, latency_ms::text, cost_per_job_minor::text,
           invocation_cost_minor::text, revision_rate::text, job_count
    FROM app.agent_version_metrics
    WHERE agent_version_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      AND cost_currency = 'USD'
  `);
  assert.equal(rows.rows.length, 1);
  assert.equal(Number(rows.rows[0].grounded_claim_rate), 0.5);
  assert.equal(Number(rows.rows[0].latency_ms), 1200);
  assert.equal(Number(rows.rows[0].cost_per_job_minor), 40);
  assert.equal(Number(rows.rows[0].invocation_cost_minor), 40);
  assert.equal(Number(rows.rows[0].revision_rate), 1);
  assert.equal(Number(rows.rows[0].job_count), 1);
});

test("a job budget and a rate limit stop a runaway", async () => {
  const routeId = (await db.query<{ id: string }>("SELECT id FROM model_routes")).rows[0].id;
  await assert.rejects(
    db.exec(`
      INSERT INTO llm_invocations (
        tenant_id, home_region, job_id, run_id, route_id, requested_model, served_model,
        input_tokens, output_tokens, cost_currency, cost_minor, latency_ms, prompt_hash
      ) VALUES (
        '${buyerA}', 'local', '${jobA}', '${runA}', '${routeId}', 'primary-test', 'primary-test',
        1, 1, 'USD', 501, 1, '${hash}'
      )
    `),
    /budget/i,
  );
  await db.exec(`
    INSERT INTO rate_limit_policies (org_id, home_region, requests_per_minute)
    VALUES ('${buyerA}', 'local', 2)
  `);
  assert.equal((await db.query("SELECT app.consume_rate_limit($1) AS id", [buyerA])).rows.length, 1);
  await db.query("SELECT app.consume_rate_limit($1)", [buyerA]);
  await assert.rejects(db.query("SELECT app.consume_rate_limit($1)", [buyerA]), /rate limit/i);
});

test("privacy export and delete keep ledger amounts and drop fixture text", async () => {
  const privacyOrg = "99999999-9999-4999-8999-999999999999";
  const marker = "FIXTURE_TENDER_ALPHA";
  await db.exec(`
    INSERT INTO orgs (id, kind, legal_name, country_code, home_region, default_locale, default_time_zone, status)
    VALUES ('${privacyOrg}', 'buyer', 'Fixture Privacy Buyer', 'FJ', 'local', 'en', 'Pacific/Auckland', 'active')
  `);
  const order = await db.query<{ id: string }>(`
    INSERT INTO orders (
      buyer_org_id, home_region, listing_tier_id, listing_currency, service_amount_minor,
      platform_fee_minor, creator_royalty_minor, review_fee_minor, tax_behavior, tax_amount_minor,
      charge_currency, charge_amount_minor, buyer_country_code, creator_country_code,
      buyer_locale, buyer_time_zone, status
    ) VALUES (
      '${privacyOrg}', 'local', '12121212-1212-4121-8121-121212121212', 'USD', 4242,
      636, 3606, 0, 'exclusive', 0,
      'USD', 4242, 'FJ', 'NZ', 'en', 'Pacific/Auckland', 'paid'
    ) RETURNING id
  `);
  const job = await db.query<{ id: string }>(`
    INSERT INTO jobs (tenant_id, home_region, order_id, agent_version_id, status)
    VALUES ('${privacyOrg}', 'local', '${order.rows[0].id}', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'running')
    RETURNING id
  `);
  const run = await db.query<{ id: string }>(`
    INSERT INTO job_runs (job_id, tenant_id, home_region, status, idempotency_key)
    VALUES ('${job.rows[0].id}', '${privacyOrg}', 'local', 'running', 'privacy-job')
    RETURNING id
  `);
  const document = await db.query<{ id: string }>(`
    INSERT INTO documents (
      tenant_id, home_region, job_id, kind, filename, media_type, byte_size, sha256, storage_key
    ) VALUES (
      '${privacyOrg}', 'local', '${job.rows[0].id}', 'tender_source', 'tender.pdf', 'application/pdf', 10,
      '${hash}', '${privacyOrg}/local/tender.pdf'
    ) RETURNING id
  `);
  const chunk = await db.query<{ id: string }>(`
    INSERT INTO document_chunks (
      tenant_id, home_region, document_id, job_id, chunker_version, chunk_index, kind, body,
      locator_kind, page
    ) VALUES (
      '${privacyOrg}', 'local', '${document.rows[0].id}', '${job.rows[0].id}', 'v1', 0, 'prose',
      '${marker}', 'page', 1
    ) RETURNING id
  `);
  await db.exec(`
    INSERT INTO requirements (
      tenant_id, home_region, job_id, document_id, chunk_id, kind, body
    ) VALUES (
      '${privacyOrg}', 'local', '${job.rows[0].id}', '${document.rows[0].id}', '${chunk.rows[0].id}',
      'mandatory', '${marker}'
    )
  `);
  const draft = await db.query<{ id: string }>(`
    INSERT INTO drafts (
      tenant_id, home_region, job_id, kind, locale, storage_key, version
    ) VALUES (
      '${privacyOrg}', 'local', '${job.rows[0].id}', 'section', 'en', '${privacyOrg}/local/draft.txt', 1
    ) RETURNING id
  `);
  const claim = await db.query<{ id: string }>(`
    INSERT INTO draft_claims (tenant_id, home_region, draft_id, job_id, body, support_status)
    VALUES ('${privacyOrg}', 'local', '${draft.rows[0].id}', '${job.rows[0].id}', '${marker}', 'unsupported')
    RETURNING id
  `);
  await db.exec(`
    INSERT INTO claim_citations (tenant_id, home_region, claim_id, chunk_id, quote)
    VALUES ('${privacyOrg}', 'local', '${claim.rows[0].id}', '${chunk.rows[0].id}', '${marker}')
  `);
  await db.exec(`
    INSERT INTO job_messages (tenant_id, home_region, job_id, author_user_id, body)
    VALUES ('${privacyOrg}', 'local', '${job.rows[0].id}', '${userA}', '${marker}')
  `);
  const provenance = await db.query<{ id: string }>(`
    INSERT INTO memory_provenance (tenant_id, home_region, source_type, content_hash)
    VALUES ('${privacyOrg}', 'local', 'run_derivation', '${hash}')
    RETURNING id
  `);
  await db.exec(`
    INSERT INTO memory_items (
      logical_id, version, owner_org_id, tenant_id, home_region, scope, authority,
      provenance_id, job_id, retain_until, body, content_hash
    ) VALUES (
      gen_random_uuid(), 1, '${privacyOrg}', '${privacyOrg}', 'local', 'buyer_private', 'contract',
      '${provenance.rows[0].id}', '${job.rows[0].id}', now() + interval '30 days',
      '${marker}', '${hash}'
    )
  `);
  const scratch = await db.query<{ id: string }>(`
    INSERT INTO memory_provenance (tenant_id, home_region, source_type, content_hash)
    VALUES ('${privacyOrg}', 'local', 'model_scratch', '${hash}')
    RETURNING id
  `);
  await db.exec(`
    INSERT INTO memory_items (
      logical_id, version, owner_org_id, tenant_id, home_region, scope, authority,
      provenance_id, job_id, run_id, retain_until, body, content_hash
    ) VALUES (
      gen_random_uuid(), 1, '${privacyOrg}', '${privacyOrg}', 'local', 'execution', 'contract',
      '${scratch.rows[0].id}', '${job.rows[0].id}', '${run.rows[0].id}', now() + interval '1 day',
      '${marker}', '${hash}'
    )
  `);
  await db.exec(`
    INSERT INTO lesson_candidates (tenant_id, home_region, source_job_id, proposed_text, status)
    VALUES ('${privacyOrg}', 'local', '${job.rows[0].id}', '${marker} lesson', 'proposed')
  `);
  const txn = await db.query<{ id: string }>(`
    INSERT INTO ledger_transactions (
      buyer_org_id, home_region, kind, currency, idempotency_key
    ) VALUES (
      '${privacyOrg}', 'local', 'charge_captured', 'USD', 'privacy-charge'
    ) RETURNING id
  `);
  await db.exec(`
    INSERT INTO ledger_entries (
      transaction_id, buyer_org_id, home_region, account_code, direction, amount_minor, currency, memo
    ) VALUES
      ('${txn.rows[0].id}', '${privacyOrg}', 'local', 'provider_cash', 'debit', 4242, 'USD', '${marker}'),
      ('${txn.rows[0].id}', '${privacyOrg}', 'local', 'platform_fee_revenue', 'credit', 4242, 'USD', '${marker}')
  `);
  await db.exec(
    `UPDATE ledger_transactions SET posted = true, posted_at = now() WHERE id = '${txn.rows[0].id}'`,
  );
  await db.exec(`
    INSERT INTO chunk_embeddings (chunk_id, tenant_id, home_region, model_id, embedding)
    VALUES ('${chunk.rows[0].id}', '${privacyOrg}', 'local', '${modelId}', ${ones})
  `);
  const exportRequest = await db.query<{ id: string }>(`
    INSERT INTO privacy_requests (org_id, home_region, kind, status, due_at)
    VALUES ('${privacyOrg}', 'local', 'export', 'received', now() + interval '30 days')
    RETURNING id
  `);
  await assert.rejects(
    db.query("SELECT app.fulfill_privacy_request($1)", [exportRequest.rows[0].id]),
    /outside the session tenant/i,
  );
  await db.query("SELECT set_config('app.tenant_id', $1, false)", [buyerB]);
  await assert.rejects(
    db.query("SELECT app.fulfill_privacy_request($1)", [exportRequest.rows[0].id]),
    /outside the session tenant/i,
  );
  await db.query("SELECT set_config('app.tenant_id', $1, false)", [buyerA]);
  await db.query("SELECT set_config('app.job_id', $1, false)", [jobA]);
  await db.query("SELECT set_config('app.access', 'org', false)");
  await db.query("SELECT set_config('app.user_id', $1, false)", [userA]);
  await db.query("SELECT set_config('app.privacy_nonce', 'forged', false)");
  await db.exec("SET ROLE orbexa_app");
  await assert.rejects(
    db.query("UPDATE document_chunks SET body = '[redacted]' WHERE id = $1", [chunkA]),
    /immutable|privacy|permission/i,
  );
  await db.exec("RESET ROLE");
  await db.exec("RESET ALL");
  await db.query("SELECT set_config('app.tenant_id', $1, false)", [privacyOrg]);
  const exported = await db.query<{ payload: string }>(
    "SELECT app.fulfill_privacy_request($1)::text AS payload",
    [exportRequest.rows[0].id],
  );
  assert.match(exported.rows[0].payload, new RegExp(marker));
  assert.equal(exported.rows[0].payload.includes("secret pricing"), false);
  assert.match(exported.rows[0].payload, /4242/);
  const deleteRequest = await db.query<{ id: string }>(`
    INSERT INTO privacy_requests (org_id, home_region, kind, status, due_at)
    VALUES ('${privacyOrg}', 'local', 'delete', 'received', now() + interval '30 days')
    RETURNING id
  `);
  const deleted = await db.query<{ payload: string }>(
    "SELECT app.fulfill_privacy_request($1)::text AS payload",
    [deleteRequest.rows[0].id],
  );
  assert.equal(deleted.rows[0].payload.includes(marker), false);
  assert.match(deleted.rows[0].payload, /4242/);
  assert.match(deleted.rows[0].payload, /in_progress/);
  assert.match(deleted.rows[0].payload, new RegExp(`${privacyOrg}/local/tender.pdf`));
  const during = await db.query<{ status: string }>(
    `SELECT status FROM privacy_requests WHERE id = '${deleteRequest.rows[0].id}'`,
  );
  assert.equal(during.rows[0].status, "in_progress");
  const vectors = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM chunk_embeddings WHERE tenant_id = '${privacyOrg}'`,
  );
  assert.equal(vectors.rows[0].count, "0");
  await db.query("SELECT app.complete_privacy_request($1)", [deleteRequest.rows[0].id]);
  const chunkBody = await db.query<{ body: string }>(
    `SELECT body FROM document_chunks WHERE id = '${chunk.rows[0].id}'`,
  );
  assert.equal(chunkBody.rows[0].body, "[redacted]");
  const lesson = await db.query<{ proposed_text: string; status: string }>(
    `SELECT proposed_text, status FROM lesson_candidates WHERE tenant_id = '${privacyOrg}'`,
  );
  assert.equal(lesson.rows[0].proposed_text, "[redacted]");
  assert.equal(lesson.rows[0].status, "revoked");
  const quote = await db.query<{ quote: string }>(
    `SELECT quote FROM claim_citations WHERE tenant_id = '${privacyOrg}'`,
  );
  assert.equal(quote.rows[0].quote, "[redacted]");
  const amounts = await db.query<{ amount_minor: string; memo: string }>(
    `SELECT amount_minor::text, memo FROM ledger_entries WHERE buyer_org_id = '${privacyOrg}'`,
  );
  assert.equal(amounts.rows.length, 2);
  assert.equal(amounts.rows.every((row) => row.amount_minor === "4242" && row.memo === "[redacted]"), true);
  const other = await db.query<{ body: string }>(
    `SELECT body FROM document_chunks WHERE id = '${chunkB}'`,
  );
  assert.equal(other.rows[0].body, "secret pricing schedule for the other buyer");
  const audit = await db.query<{ metadata: string }>(
    `SELECT metadata::text FROM audit_log WHERE tenant_id = '${privacyOrg}'`,
  );
  assert.equal(audit.rows.some((row) => row.metadata.includes(marker)), false);
  await assert.rejects(
    db.query("SELECT app.fulfill_privacy_request($1)", [deleteRequest.rows[0].id]),
    /already completed/i,
  );
  await db.exec("RESET ALL");
});

test("a logical snapshot restore reads the chunk and records a timing", async () => {
  const marker = "restored chunk marker 950 mm";
  const chunkId = await insertChunk(buyerA, jobA, marker);
  const snap = await db.query<{
    id: string;
    tenant_id: string;
    home_region: string;
    document_id: string;
    job_id: string;
    chunker_version: string;
    chunk_index: number;
    kind: string;
    body: string;
    locator_kind: string;
    page: number;
  }>(`
    SELECT id::text, tenant_id::text, home_region, document_id::text, job_id::text,
           chunker_version, chunk_index, kind, body, locator_kind, page
    FROM document_chunks WHERE id = '${chunkId}'
  `);
  const encoded = JSON.stringify(snap.rows[0]);
  await db.query("DELETE FROM chunk_embeddings WHERE chunk_id = $1", [chunkId]);
  await db.query("DELETE FROM document_chunks WHERE id = $1", [chunkId]);
  const started = performance.now();
  const row = JSON.parse(encoded) as (typeof snap.rows)[0];
  await db.query(
    `INSERT INTO document_chunks (
      id, tenant_id, home_region, document_id, job_id, chunker_version, chunk_index, kind, body,
      locator_kind, page
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      row.id,
      row.tenant_id,
      row.home_region,
      row.document_id,
      row.job_id,
      row.chunker_version,
      Number(row.chunk_index),
      row.kind,
      row.body,
      row.locator_kind,
      Number(row.page),
    ],
  );
  const restored = await db.query<{ body: string }>(
    "SELECT body FROM document_chunks WHERE id = $1",
    [row.id],
  );
  const elapsedMs = performance.now() - started;
  assert.equal(restored.rows[0].body, marker);
  assert.equal(Number.isFinite(elapsedMs), true);
  assert.ok(elapsedMs >= 0);
});

test("a new vertical is intake, deliverables, and workflow data", async () => {
  const routeId = (await db.query<{ id: string }>("SELECT id FROM model_routes")).rows[0].id;
  await db.exec(`
    INSERT INTO verticals (code, display_name)
    VALUES ('grant_writing', 'Grant writing')
  `);
  const revision = await db.query<{ id: string }>(`
    INSERT INTO vertical_revisions (
      vertical_code, revision, intake_schema, deliverable_types, rubric, workflow
    ) VALUES (
      'grant_writing', 1,
      '{"type":"object","additionalProperties":false,"required":["sponsor"],"properties":{"sponsor":{"type":"string","minLength":3}}}'::jsonb,
      '[{"code":"proposal_docx","role":"deliverable"}]'::jsonb,
      '[{"code":"sponsor_fit","required":true}]'::jsonb,
      '["collect","draft","review"]'::jsonb
    ) RETURNING id
  `);
  await db.exec(`
    INSERT INTO agents (id, creator_org_id, slug, name, vertical, source_locale)
    VALUES ('88888888-8888-4888-8888-888888888888', '${creator}', 'grants', 'Grant memo', 'grant_writing', 'en');
    INSERT INTO agent_versions (
      id, agent_id, version, status, promotion_basis, pipeline_hash, prompt_bundle_hash,
      tool_catalog_hash, model_route_id, embedding_model_id
    ) VALUES (
      '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888888', 1, 'draft',
      'initial_human', '${hash}', '${hash}', '${hash}', '${routeId}', '${modelId}'
    );
    INSERT INTO listings (id, creator_org_id, agent_version_id, vertical, source_locale, title, summary)
    VALUES (
      '88888888-8888-4888-8888-888888888882', '${creator}', '88888888-8888-4888-8888-888888888881',
      'grant_writing', 'en', 'Grant memo', 'A sourced memo'
    );
    INSERT INTO listing_tiers (
      id, listing_id, service_level, currency, price_minor, platform_fee_bps, creator_royalty_bps,
      review_fee_minor, delivery_days, included_revisions, cancellation_code, payout_release
    ) VALUES (
      '88888888-8888-4888-8888-888888888883', '88888888-8888-4888-8888-888888888882', 'autonomous',
      'USD', 50000, 2000, 8000, 0, 3, 1, 'before_draft_full_refund', 'on_acceptance'
    );
  `);
  await assert.rejects(
    db.exec(`
      INSERT INTO listings (creator_org_id, agent_version_id, vertical, source_locale, title, summary)
      VALUES (
        '${creator}', '88888888-8888-4888-8888-888888888881',
        'tender_writing', 'en', 'Wrong category', 'no'
      )
    `),
    /listing vertical/i,
  );
  const order = await db.query<{ id: string; vertical_code: string }>(`
    INSERT INTO orders (
      buyer_org_id, home_region, listing_tier_id, listing_currency, service_amount_minor,
      platform_fee_minor, creator_royalty_minor, review_fee_minor, tax_behavior, tax_amount_minor,
      charge_currency, charge_amount_minor, buyer_country_code, creator_country_code,
      buyer_locale, buyer_time_zone, status
    ) VALUES (
      '${buyerA}', 'local', '88888888-8888-4888-8888-888888888883', 'USD', 50000,
      10000, 40000, 0, 'exclusive', 0,
      'USD', 50000, 'FJ', 'NZ', 'en', 'Pacific/Auckland', 'paid'
    ) RETURNING id::text, vertical_code
  `);
  assert.equal(order.rows[0].vertical_code, "grant_writing");
  const job = await db.query<{ id: string }>(`
    INSERT INTO jobs (tenant_id, home_region, order_id, agent_version_id, status)
    VALUES (
      '${buyerA}', 'local', '${order.rows[0].id}', '88888888-8888-4888-8888-888888888881', 'running'
    ) RETURNING id
  `);
  await db.query(
    `SELECT app.assert_intake('${revision.rows[0].id}', '{"sponsor":"Example Foundation"}'::jsonb)`,
  );
  await assert.rejects(
    db.query(`SELECT app.assert_intake('${revision.rows[0].id}', '{}'::jsonb)`),
    /missing sponsor/i,
  );
  await db.exec(`
    INSERT INTO job_intakes (job_id, tenant_id, home_region, vertical_revision_id, payload)
    VALUES (
      '${job.rows[0].id}', '${buyerA}', 'local', '${revision.rows[0].id}',
      '{"sponsor":"Example Foundation"}'::jsonb
    )
  `);
  await db.exec(`
    INSERT INTO documents (
      tenant_id, home_region, job_id, kind, filename, media_type, byte_size, sha256, storage_key
    ) VALUES (
      '${buyerA}', 'local', '${job.rows[0].id}', 'proposal_docx', 'memo.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10,
      '${hash}', '${buyerA}/local/grant-memo.docx'
    )
  `);
  await assert.rejects(
    db.exec(`
      INSERT INTO documents (
        tenant_id, home_region, job_id, kind, filename, media_type, byte_size, sha256, storage_key
      ) VALUES (
        '${buyerA}', 'local', '${job.rows[0].id}', 'bid_docx', 'bid.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10,
        '${hash}', '${buyerA}/local/grant-bid.docx'
      )
    `),
    /not declared/i,
  );
  const expert = "77777777-7777-4777-8777-777777777777";
  await db.exec(`
    INSERT INTO users (id, email, display_name, locale, time_zone, country_of_residence)
    VALUES ('${expert}', 'specialist@example.com', 'Specialist', 'en', 'UTC', 'NZ');
    INSERT INTO expert_profiles (user_id, org_id, verticals)
    VALUES ('${expert}', '${creator}', ARRAY['grant_writing'])
  `);
  await assert.rejects(
    db.exec(`
      UPDATE expert_profiles SET verticals = ARRAY['not_a_vertical'] WHERE user_id = '${expert}'
    `),
    /unknown vertical/i,
  );
  const workflow = await db.query<{ same: boolean }>(`
    SELECT workflow = '["extract","matrix","draft","ground"]'::jsonb AS same
    FROM vertical_revisions WHERE vertical_code = 'tender_writing'
  `);
  assert.equal(workflow.rows[0].same, true);
});
