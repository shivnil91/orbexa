import assert from "node:assert/strict";
import test from "node:test";
import { splitServiceAmount } from "@orbexa/db/money.ts";
import { runHospitalBedSlice } from "./slice.ts";

const buyer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("end to end: Moishin publishes, Rahul buys, the fixture agent drafts, and the ledger balances", async () => {
  const slice = await runHospitalBedSlice();
  const tier = await slice.db.query<{
    delivery_days: number;
    included_revisions: number;
    payout_release: string;
    review_fee_minor: string;
  }>(`
    SELECT delivery_days, included_revisions, payout_release, review_fee_minor::text
    FROM listing_tiers
    WHERE service_level = 'expert_verified'
  `);
  assert.equal(tier.rows[0].delivery_days, slice.deliveryDays);
  assert.equal(tier.rows[0].included_revisions, 2);
  assert.equal(tier.rows[0].payout_release, "after_dispute_window");
  assert.equal(BigInt(tier.rows[0].review_fee_minor) > 0n, true);

  const order = await slice.db.query<{ review_fee_minor: string; charge_amount_minor: string }>(
    `SELECT review_fee_minor::text, charge_amount_minor::text FROM orders WHERE id = '${slice.orderId}'`,
  );
  const split = splitServiceAmount(100000n, 15000n, 1500);
  assert.equal(BigInt(order.rows[0].review_fee_minor), split.reviewFeeMinor);
  assert.equal(
    split.platformFeeMinor + split.creatorRoyaltyMinor + split.reviewFeeMinor,
    BigInt(order.rows[0].charge_amount_minor),
  );

  const posted = await slice.db.query<{ debit: string; credit: string; currencies: number }>(`
    SELECT
      COALESCE(sum(amount_minor) FILTER (WHERE direction = 'debit'), 0)::text AS debit,
      COALESCE(sum(amount_minor) FILTER (WHERE direction = 'credit'), 0)::text AS credit,
      count(DISTINCT currency)::int AS currencies
    FROM ledger_entries
  `);
  assert.equal(posted.rows[0].debit, posted.rows[0].credit);
  assert.equal(posted.rows[0].currencies, 1);

  const requirements = await slice.db.query<{ body: string }>("SELECT body FROM requirements");
  const requirementText = requirements.rows.map((row) => row.body).join(" ");
  assert.match(requirementText, /how many hospital beds/);
  assert.match(requirementText, /regulatory certificate/);
  assert.match(slice.draftText, /950 mm/);
  assert.equal(/ISO\s*\d|TGA|CERT-\d/.test(slice.draftText), false);

  const claims = await slice.db.query<{ support_status: string; body: string }>(
    "SELECT support_status, body FROM draft_claims",
  );
  const matrix = await slice.db.query<{ missing_evidence: boolean; body: string }>(`
    SELECT row.missing_evidence, requirement.body
    FROM compliance_matrix_rows AS row
    JOIN requirements AS requirement ON requirement.id = row.requirement_id
  `);
  assert.equal(
    matrix.rows.some((row) => row.missing_evidence && /certificate/i.test(row.body)),
    true,
  );
  assert.equal(claims.rows.some((row) => row.support_status === "missing_evidence" && /certificate/i.test(row.body)), true);
  assert.equal(claims.rows.some((row) => row.support_status === "supported"), true);

  const job = await slice.db.query<{ status: string }>(
    `SELECT status FROM jobs WHERE id = '${slice.jobId}'`,
  );
  assert.equal(job.rows[0].status, "accepted");
  const files = await slice.db.query<{ kind: string }>(
    `SELECT kind FROM documents WHERE job_id = '${slice.jobId}' AND kind IN ('bid_docx', 'bid_xlsx')`,
  );
  assert.equal(files.rows.length, 2);
  const rating = await slice.db.query<{ score: number }>(
    `SELECT score FROM job_ratings WHERE job_id = '${slice.jobId}'`,
  );
  assert.equal(rating.rows[0].score, 5);
  const lesson = await slice.db.query<{ status: string }>(
    "SELECT status FROM lesson_candidates",
  );
  assert.equal(lesson.rows[0].status, "proposed");
  assert.equal(slice.stripeCalls, 0);

  await slice.db.exec("RESET ROLE");
  await slice.db.exec("SET ROLE orbexa_app");
  await slice.db.query("SELECT set_config('app.tenant_id', $1, false)", [buyer]);
  await slice.db.query("SELECT set_config('app.access', 'org', false)");
  await slice.db.query("SELECT set_config('app.job_id', $1, false)", [slice.jobId]);
  await slice.db.query("SELECT set_config('app.user_id', $1, false)", [
    "22222222-2222-4222-8222-222222222222",
  ]);
  const visible = await slice.db.query<{ body: string }>("SELECT body FROM document_chunks");
  assert.equal(visible.rows.some((row) => row.body.includes("secret pricing")), false);
  assert.equal(visible.rows.length > 0, true);
  await slice.db.exec("RESET ROLE");

  const obligation = await slice.db.query<{ id: string }>(
    "SELECT id FROM payout_obligations",
  );
  await assert.rejects(
    slice.db.exec(`
      INSERT INTO payouts (
        obligation_id, payee_org_id, home_region, provider, source_currency, source_amount_minor,
        status, idempotency_key
      ) VALUES (
        '${obligation.rows[0].id}', '${"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}', 'local',
        'wise', 'USD', 100, 'processing', 'blocked-payout'
      )
    `),
    /screening/i,
  );

  const draft = await slice.db.query<{ id: string; job_id: string }>(
    `SELECT id::text, job_id::text FROM drafts WHERE job_id = '${slice.jobId}'`,
  );
  await assert.rejects(
    slice.db.exec(`
      INSERT INTO draft_claims (tenant_id, home_region, draft_id, job_id, body, support_status)
      VALUES (
        '${buyer}', 'local', '${draft.rows[0].id}', '${slice.jobId}',
        'The beds are TGA registered.', 'supported'
      )
    `),
    /citation/i,
  );
});
