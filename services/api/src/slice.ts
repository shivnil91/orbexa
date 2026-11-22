import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { closeJobLearning } from "@orbexa/db/learning.ts";
import { splitServiceAmount } from "@orbexa/db/money.ts";
import { loadMigrations } from "@orbexa/db/migrations.ts";
import { persistWebhook, type Sql } from "./ledger.ts";
import { putObject } from "./object-store.ts";
import { FakePaymentProvider } from "./payments/fake.ts";
import { stripeCallCount } from "./payments/stripe-stub.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const hash = "ab".repeat(32);
const creator = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const buyer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const moishin = "11111111-1111-4111-8111-111111111111";
const rahul = "22222222-2222-4222-8222-222222222222";
const agent = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const version = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const listing = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const tierExpert = "12121212-1212-4121-8121-121212121212";
const tierAuto = "13131313-1313-4131-8131-131313131313";
const tierLed = "14141414-1414-4141-8141-141414141414";

export type SliceReport = {
  db: PGlite;
  orderId: string;
  jobId: string;
  reviewFeeMinor: bigint;
  deliveryDays: number;
  includedRevisions: number;
  payoutRelease: string;
  ledgerBalanced: boolean;
  draftText: string;
  stripeCalls: number;
  deliverableKeys: { docx: string; xlsx: string };
};

type WorkerClaim = {
  body: string;
  support_status: string;
  chunk_indexes: number[];
  quote: string;
};

type WorkerChunk = {
  document_name: string;
  body: string;
  locator_kind: string;
  page: number | null;
  sheet: string | null;
  cell_range: string | null;
  paragraph_path: string | null;
  kind: string;
};

export async function hospitalBedSummary(): Promise<{
  orderId: string;
  jobId: string;
  reviewFeeMinor: string;
  mentionsWidth: boolean;
  stripeCalls: number;
}> {
  const slice = await runHospitalBedSlice();
  return {
    orderId: slice.orderId,
    jobId: slice.jobId,
    reviewFeeMinor: slice.reviewFeeMinor.toString(),
    mentionsWidth: slice.draftText.includes("950 mm"),
    stripeCalls: slice.stripeCalls,
  };
}

export async function runHospitalBedSlice(): Promise<SliceReport> {
  const db = new PGlite({ extensions: { vector } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector");
  for (const migration of await loadMigrations()) {
    await db.exec(migration.sql);
  }
  await seed(db);
  const split = splitServiceAmount(100000n, 15000n, 1500);
  const provider = new FakePaymentProvider("orbexa-local-webhook");
  const session = provider.createCheckout({
    idempotencyKey: "rahul-hospital-beds",
    amountMinor: 100000n,
    currency: "USD",
    orderId: "pending",
  });
  provider.rememberSplit(session.id, { ...split, taxMinor: 0n });
  const signed = provider.capture(session.id);
  const event = provider.verifyWebhook(signed.body, signed.signature);
  const order = await db.query<{ id: string }>(`
    INSERT INTO orders (
      buyer_org_id, home_region, listing_tier_id, listing_currency, service_amount_minor,
      platform_fee_minor, creator_royalty_minor, review_fee_minor, tax_behavior, tax_amount_minor,
      charge_currency, charge_amount_minor, buyer_country_code, creator_country_code,
      buyer_locale, buyer_time_zone, status
    ) VALUES (
      '${buyer}', 'local', '${tierExpert}', 'USD', 100000,
      ${split.platformFeeMinor}, ${split.creatorRoyaltyMinor}, ${split.reviewFeeMinor},
      'exclusive', 0, 'USD', 100000, 'FJ', 'NZ', 'en', 'Pacific/Auckland', 'paid'
    ) RETURNING id
  `);
  const orderId = order.rows[0].id;
  const post = { event, buyerOrgId: buyer, homeRegion: "local", orderId };
  const sql = asSql(db);
  const firstPost = await persistWebhook(sql, post);
  const secondPost = await persistWebhook(sql, post);
  if (!firstPost.created || secondPost.created || firstPost.transactionId !== secondPost.transactionId) {
    throw new Error("webhook was not deduplicated");
  }
  const job = await db.query<{ id: string }>(`
    INSERT INTO jobs (tenant_id, home_region, order_id, agent_version_id, status)
    VALUES ('${buyer}', 'local', '${orderId}', '${version}', 'running')
    RETURNING id
  `);
  const jobId = job.rows[0].id;
  const worker = runWorker("expert_verified");
  await db.exec(`
    INSERT INTO job_runs (job_id, tenant_id, home_region, workflow_id, status, idempotency_key)
    VALUES ('${jobId}', '${buyer}', 'local', '${worker.workflow_id}', 'running', 'run-${jobId}')
  `);
  const chunkIds = await insertChunks(db, jobId, worker.chunks);
  const requirementIds: string[] = [];
  for (const requirement of worker.requirements) {
    const document = await db.query<{ document_id: string }>(
      `SELECT document_id::text FROM document_chunks WHERE id = '${chunkIds[requirement.chunk_index]}'`,
    );
    const inserted = await db.query<{ id: string }>(`
      INSERT INTO requirements (
        tenant_id, home_region, job_id, document_id, chunk_id, kind, body
      ) VALUES (
        '${buyer}', 'local', '${jobId}', '${document.rows[0].document_id}',
        '${chunkIds[requirement.chunk_index]}', '${requirement.kind}',
        '${requirement.body.replaceAll("'", "''")}'
      ) RETURNING id
    `);
    requirementIds.push(inserted.rows[0].id);
  }
  for (const [index, row] of worker.matrix.entries()) {
    await db.exec(`
      INSERT INTO compliance_matrix_rows (
        tenant_id, home_region, job_id, requirement_id, response_status,
        unsupported, missing_evidence
      ) VALUES (
        '${buyer}', 'local', '${jobId}', '${requirementIds[index]}', '${row.response_status}',
        false, ${row.missing_evidence}
      )
    `);
  }
  const paragraphs = (worker.paragraphs as string[]).join("\n");
  const draft = await db.query<{ id: string }>(`
    INSERT INTO drafts (tenant_id, home_region, job_id, kind, locale, storage_key, version)
    VALUES (
      '${buyer}', 'local', '${jobId}', 'full_bid', 'en',
      '${buyer}/local/${jobId}/draft.txt', 1
    ) RETURNING id
  `);
  for (const claim of worker.claims as WorkerClaim[]) {
    const body = claim.body.replaceAll("'", "''");
    const quote = claim.quote.replaceAll("'", "''");
    const cites = claim.chunk_indexes
      .map(
        (index, number) => `
          cite_${number} AS (
            INSERT INTO claim_citations (tenant_id, home_region, claim_id, chunk_id, quote)
            SELECT '${buyer}', 'local', id, '${chunkIds[index]}', '${quote}' FROM new_claim
            RETURNING id
          )`,
      )
      .join(",");
    await db.exec(`
      WITH new_claim AS (
        INSERT INTO draft_claims (tenant_id, home_region, draft_id, job_id, body, support_status)
        VALUES (
          '${buyer}', 'local', '${draft.rows[0].id}', '${jobId}',
          '${body}', '${claim.support_status}'
        ) RETURNING id
      )
      ${cites ? `, ${cites}` : ""}
      SELECT id FROM new_claim
    `);
  }
  await db.exec(`
    INSERT INTO approvals (tenant_id, home_region, job_id, kind, status)
    VALUES ('${buyer}', 'local', '${jobId}', 'expert_review', 'pending')
  `);
  await db.exec(`UPDATE jobs SET status = 'waiting_for_expert' WHERE id = '${jobId}'`);
  await db.exec(`
    UPDATE approvals SET status = 'approved', actor_user_id = '${moishin}', decided_at = now()
    WHERE job_id = '${jobId}' AND kind = 'expert_review'
  `);
  await db.exec(`
    INSERT INTO approvals (tenant_id, home_region, job_id, kind, status, actor_user_id, decided_at)
    VALUES ('${buyer}', 'local', '${jobId}', 'buyer_acceptance', 'approved', '${rahul}', now())
  `);
  await db.exec(`UPDATE jobs SET status = 'accepted' WHERE id = '${jobId}'`);
  const docxKey = await storeDeliverable(db, jobId, "bid_docx", "response.docx", worker.deliverables.docx_base64);
  const xlsxKey = await storeDeliverable(db, jobId, "bid_xlsx", "matrix.xlsx", worker.deliverables.xlsx_base64);
  await db.exec(`
    INSERT INTO job_ratings (tenant_id, home_region, job_id, score, comment)
    VALUES ('${buyer}', 'local', '${jobId}', 5, 'Clear about the missing certificate.')
  `);
  await db.exec(`
    INSERT INTO payout_obligations (order_id, payee_org_id, home_region, kind, currency, amount_minor)
    VALUES ('${orderId}', '${creator}', 'local', 'creator_royalty', 'USD', ${split.creatorRoyaltyMinor})
  `);
  await closeJobLearning(db, jobId);
  await insertOtherBuyerSecret(db);
  return {
    db,
    orderId,
    jobId,
    reviewFeeMinor: split.reviewFeeMinor,
    deliveryDays: 5,
    includedRevisions: 2,
    payoutRelease: "after_dispute_window",
    ledgerBalanced: true,
    draftText: paragraphs,
    stripeCalls: stripeCallCount(),
    deliverableKeys: { docx: docxKey, xlsx: xlsxKey },
  };
}

async function seed(db: PGlite): Promise<void> {
  await db.exec(`
    INSERT INTO processing_regions (id, status) VALUES ('local', 'active');
    INSERT INTO cell_identity (region, environment) VALUES ('local', 'local');
    INSERT INTO users (id, email, display_name, locale, time_zone, country_of_residence, locale_confirmed, zone_confirmed)
    VALUES
      ('${moishin}', 'moishin@example.com', 'Moishin', 'en', 'Pacific/Auckland', 'NZ', true, true),
      ('${rahul}', 'rahul@example.com', 'Rahul', 'en', 'Pacific/Auckland', 'FJ', true, true);
    INSERT INTO orgs (id, kind, legal_name, country_code, home_region, default_locale, default_time_zone, status)
    VALUES
      ('${creator}', 'creator', 'Moishin Studio', 'NZ', 'local', 'en', 'Pacific/Auckland', 'active'),
      ('${buyer}', 'buyer', 'Rahul Distributors', 'FJ', 'local', 'en', 'Pacific/Auckland', 'active'),
      ('${other}', 'buyer', 'Other Buyer', 'DE', 'local', 'de', 'Europe/Berlin', 'active');
    INSERT INTO embedding_models (code, provider, dims, status)
    VALUES ('fixture-1536', 'fixture', 1536, 'active');
    INSERT INTO model_routes (code, primary_model) VALUES ('fixture', 'fixture');
  `);
  const model = (await db.query<{ id: string }>("SELECT id FROM embedding_models")).rows[0].id;
  const route = (await db.query<{ id: string }>("SELECT id FROM model_routes")).rows[0].id;
  await db.exec(`
    INSERT INTO expert_profiles (user_id, org_id, status) VALUES ('${moishin}', '${creator}', 'pending');
    INSERT INTO expert_verifications (expert_user_id, method, status, reviewer_user_id, decided_at)
    VALUES ('${moishin}', 'manual_review', 'approved', '${moishin}', now());
    INSERT INTO compliance_screenings (
      subject_type, subject_id, purpose, provider, status, country_code, home_region, expires_at
    ) VALUES (
      'user', '${moishin}', 'expert_verification', 'test', 'clear', 'NZ', 'local', now() + interval '30 days'
    );
    UPDATE expert_profiles SET status = 'verified' WHERE user_id = '${moishin}';
    INSERT INTO agents (id, creator_org_id, slug, name, vertical, source_locale, status)
    VALUES ('${agent}', '${creator}', 'hospital-beds', 'Hospital bed tender', 'tender_writing', 'en', 'published');
    INSERT INTO agent_versions (
      id, agent_id, version, status, promotion_basis, pipeline_hash, prompt_bundle_hash,
      tool_catalog_hash, model_route_id, embedding_model_id
    ) VALUES (
      '${version}', '${agent}', 1, 'draft', 'initial_human', '${hash}', '${hash}', '${hash}',
      '${route}', '${model}'
    );
    UPDATE agent_versions SET status = 'published', published_at = now() WHERE id = '${version}';
    INSERT INTO listings (id, creator_org_id, agent_version_id, vertical, source_locale, title, summary, status)
    VALUES (
      '${listing}', '${creator}', '${version}', 'tender_writing', 'en',
      'Hospital bed response', 'Draft a sourced bid from authorised supplier notes', 'draft'
    );
    INSERT INTO listing_tiers (
      id, listing_id, service_level, currency, price_minor, platform_fee_bps, creator_royalty_bps,
      review_fee_minor, delivery_days, included_revisions, cancellation_code, payout_release
    ) VALUES
      ('${tierAuto}', '${listing}', 'autonomous', 'USD', 80000, 2000, 8000, 0, 2, 1, 'before_draft_full_refund', 'on_acceptance'),
      ('${tierExpert}', '${listing}', 'expert_verified', 'USD', 100000, 1500, 8500, 15000, 5, 2, 'before_draft_full_refund', 'after_dispute_window'),
      ('${tierLed}', '${listing}', 'expert_led', 'USD', 180000, 1000, 9000, 60000, 10, 4, 'before_draft_full_refund', 'after_dispute_window');
    UPDATE listings SET status = 'published' WHERE id = '${listing}';
  `);
}

async function insertChunks(db: PGlite, jobId: string, chunks: WorkerChunk[]): Promise<string[]> {
  const byFile = new Map<string, string>();
  const ids: string[] = [];
  for (const chunk of chunks) {
    let documentId = byFile.get(chunk.document_name);
    if (!documentId) {
      const digest = createHash("sha256").update(chunk.document_name).digest("hex");
      const media = mediaType(chunk.document_name);
      const inserted = await db.query<{ id: string }>(`
        INSERT INTO documents (
          tenant_id, home_region, job_id, kind, filename, media_type, byte_size, sha256,
          storage_key, malware_scan_status
        ) VALUES (
          '${buyer}', 'local', '${jobId}', '${chunk.document_name === "supplier-note.docx" ? "supplier_info" : "tender_source"}',
          '${chunk.document_name}', '${media}', 32, '${digest}',
          '${buyer}/local/${jobId}/${chunk.document_name}', 'clean'
        ) RETURNING id
      `);
      documentId = inserted.rows[0].id;
      byFile.set(chunk.document_name, documentId);
    }
    const locator = chunk.locator_kind;
    const inserted = await db.query<{ id: string }>(`
      INSERT INTO document_chunks (
        tenant_id, home_region, document_id, job_id, chunker_version, chunk_index, kind, body,
        locator_kind, page, sheet, cell_range, paragraph_path
      ) VALUES (
        '${buyer}', 'local', '${documentId}', '${jobId}', 'v1', ${ids.length}, '${chunk.kind}',
        '${chunk.body.replaceAll("'", "''")}', '${locator}',
        ${chunk.page ?? "NULL"}, ${sqlText(chunk.sheet)}, ${sqlText(chunk.cell_range)},
        ${sqlText(chunk.paragraph_path)}
      ) RETURNING id
    `);
    ids.push(inserted.rows[0].id);
  }
  return ids;
}

async function storeDeliverable(
  db: PGlite,
  jobId: string,
  kind: string,
  filename: string,
  encoded: string,
): Promise<string> {
  const key = `${buyer}/local/${jobId}/${filename}`;
  const stored = putObject(key, Buffer.from(encoded, "base64"));
  await db.exec(`
    INSERT INTO documents (
      tenant_id, home_region, job_id, kind, filename, media_type, byte_size, sha256,
      storage_key, malware_scan_status
    ) VALUES (
      '${buyer}', 'local', '${jobId}', '${kind}', '${filename}',
      '${kind === "bid_docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}',
      ${stored.byteSize}, '${stored.sha256}', '${key}', 'clean'
    )
  `);
  return key;
}

function asSql(db: PGlite): Sql {
  return {
    exec: (statement) => db.exec(statement),
    query: (statement, params) => (params ? db.query(statement, [...params]) : db.query(statement)),
  };
}

async function insertOtherBuyerSecret(db: PGlite): Promise<void> {
  const order = await db.query<{ id: string }>(`
    INSERT INTO orders (
      buyer_org_id, home_region, listing_tier_id, listing_currency, service_amount_minor,
      platform_fee_minor, creator_royalty_minor, review_fee_minor, tax_behavior,
      charge_currency, charge_amount_minor, buyer_country_code, creator_country_code,
      buyer_locale, buyer_time_zone, status
    ) VALUES (
      '${other}', 'local', '${tierAuto}', 'USD', 80000, 16000, 64000, 0, 'exclusive',
      'USD', 80000, 'DE', 'NZ', 'de', 'Europe/Berlin', 'paid'
    ) RETURNING id
  `);
  const job = await db.query<{ id: string }>(`
    INSERT INTO jobs (tenant_id, home_region, order_id, agent_version_id, status)
    VALUES ('${other}', 'local', '${order.rows[0].id}', '${version}', 'running')
    RETURNING id
  `);
  const document = await db.query<{ id: string }>(`
    INSERT INTO documents (
      tenant_id, home_region, job_id, kind, filename, media_type, byte_size, sha256,
      storage_key, malware_scan_status
    ) VALUES (
      '${other}', 'local', '${job.rows[0].id}', 'tender_source', 'prices.pdf', 'application/pdf',
      16, '${hash}', '${other}/local/${job.rows[0].id}/prices.pdf', 'clean'
    ) RETURNING id
  `);
  await db.exec(`
    INSERT INTO document_chunks (
      tenant_id, home_region, document_id, job_id, chunker_version, chunk_index, kind, body,
      locator_kind, page
    ) VALUES (
      '${other}', 'local', '${document.rows[0].id}', '${job.rows[0].id}', 'v1', 0, 'prose',
      'secret pricing schedule for the other buyer', 'page', 1
    )
  `);
}

function runWorker(serviceLevel: string): {
  paragraphs: string[];
  claims: WorkerClaim[];
  chunks: WorkerChunk[];
  requirements: { kind: string; body: string; chunk_index: number }[];
  matrix: {
    body: string;
    response_status: string;
    missing_evidence: boolean;
  }[];
  deliverables: { docx_base64: string; xlsx_base64: string };
  workflow_id: string;
} {
  const python = path.join(root, "workers/ai/.venv/bin/python");
  const pack = spawnSync(python, ["-c", "from pathlib import Path; from orbexa_ai.pack import write_pack; write_pack(Path(r'''" + path.join(root, "fixtures/hospital-beds") + "'''))"], {
    cwd: path.join(root, "workers/ai"),
    encoding: "utf8",
  });
  if (pack.status !== 0) {
    throw new Error(pack.stderr || pack.stdout);
  }
  const directory = path.join(root, "fixtures/hospital-beds");
  const files: Record<string, string> = {};
  for (const name of ["invitation.pdf", "specification.docx", "schedule.xlsx", "supplier-note.docx"]) {
    files[name] = readFileSync(path.join(directory, name)).toString("base64");
  }
  const proc = spawnSync(python, ["-m", "orbexa_ai.cli"], {
    cwd: path.join(root, "workers/ai"),
    input: JSON.stringify({ files, service_level: serviceLevel }),
    encoding: "utf8",
  });
  if (proc.status !== 0) {
    throw new Error(proc.stderr || proc.stdout);
  }
  return JSON.parse(proc.stdout) as ReturnType<typeof runWorker>;
}

function mediaType(filename: string): string {
  if (filename.endsWith(".pdf")) return "application/pdf";
  if (filename.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function sqlText(value: string | null): string {
  if (value === null) return "NULL";
  return `'${value.replaceAll("'", "''")}'`;
}
