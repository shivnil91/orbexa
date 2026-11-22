import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  applyVerifiedStripePayment,
  createJob,
  payJob,
  readConsent,
  readJob,
  recordExpertSignal,
  recordJobFeedback,
  revealNext,
} from "./jobs.ts";
import { verifyStripeTestWebhook } from "./payments.ts";

describe("job payments", { concurrency: false }, () => {
test("a buyer run keeps missing evidence and does not opt in by default", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-jobs-"));
  process.env.ORBEXA_JOB_DIR = directory;
  try {
    const job = await createJob({
      locale: "en",
      slug: "hospital-beds",
      tier: "expert_verified",
      intake: { opportunity_name: "Fictional beds" },
    });
    assert.equal(job.trainingConsent, false);
    assert.equal(await readConsent(job.tenantId), false);
    assert.equal(job.payment, null);
    const paid = await payJob(job.id);
    assert.equal(paid.status, "queued");
    assert.equal(paid.payment?.simulated, true);
    let current = paid;
    while (current.status === "queued" || current.status === "running") {
      current = await revealNext(current.id);
    }
    assert.equal(current.status, "waiting_for_expert");
    assert.equal(current.transcript?.matrix.every((row) => row.missing_evidence), true);
    assert.equal(current.transcript?.claims.some((claim) => claim.support_status === "supported" && claim.quote === "950 mm"), true);
    const signaled = await recordExpertSignal(current.id);
    assert.equal(signaled.approvalSignal, "approve");
    assert.equal(signaled.status, "waiting_for_buyer");
    const edited = await recordJobFeedback(current.id, { kind: "buyer_edit", editDistance: 12 });
    assert.equal(edited.feedback.at(-1)?.editDistance, 12);
    assert.equal(edited.status, "waiting_for_buyer");
  } finally {
    delete process.env.ORBEXA_JOB_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});

test("payment uses the stored snapshot and cannot be skipped or repeated", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-jobs-"));
  const previous = {
    provider: process.env.PAYMENT_PROVIDER,
    key: process.env.STRIPE_TEST_SECRET_KEY,
    network: process.env.STRIPE_TEST_NETWORK,
    webhook: process.env.STRIPE_TEST_WEBHOOK_SECRET,
  };
  process.env.ORBEXA_JOB_DIR = directory;
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.STRIPE_TEST_SECRET_KEY;
  delete process.env.STRIPE_TEST_NETWORK;
  delete process.env.STRIPE_TEST_WEBHOOK_SECRET;
  try {
    const job = await createJob({
      locale: "en",
      slug: "hospital-beds",
      tier: "expert_verified",
      intake: { opportunity_name: "Fictional beds" },
    });
    await assert.rejects(recordJobFeedback(job.id, { kind: "buyer_approve" }), /not available/);
    await assert.rejects(recordExpertSignal(job.id), /not available/);
    assert.equal((await readJob(job.id))?.status, "checkout");
    const stored = await readJob(job.id);
    if (!stored) {
      throw new Error("job missing");
    }
    stored.priceMinor = 4242;
    stored.reviewFeeMinor = 100;
    stored.platformFeeMinor = 414;
    stored.creatorRoyaltyMinor = 3728;
    await writeFile(path.join(directory, `${job.id}.json`), JSON.stringify(stored));
    const paid = await payJob(job.id);
    assert.equal(paid.payment?.amountMinor, 4242);
    assert.equal(paid.payment?.platformFeeMinor, 414);
    assert.equal(paid.payment?.creatorRoyaltyMinor, 3728);
    assert.equal(paid.payment?.reviewFeeMinor, 100);
    assert.equal(paid.status, "queued");
    const again = await payJob(job.id);
    assert.equal(again.status, "queued");
    assert.equal(again.cursor, 0);
  } finally {
    restoreEnv(previous);
    delete process.env.ORBEXA_JOB_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a signed test webhook queues the snapshot amount and a mismatch does not", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-jobs-"));
  const previous = {
    provider: process.env.PAYMENT_PROVIDER,
    key: process.env.STRIPE_TEST_SECRET_KEY,
    network: process.env.STRIPE_TEST_NETWORK,
    webhook: process.env.STRIPE_TEST_WEBHOOK_SECRET,
  };
  process.env.ORBEXA_JOB_DIR = directory;
  process.env.PAYMENT_PROVIDER = "stripe";
  process.env.STRIPE_TEST_SECRET_KEY = "sk_test_example";
  process.env.STRIPE_TEST_NETWORK = "1";
  process.env.STRIPE_TEST_WEBHOOK_SECRET = "whsec_test_local";
  try {
    const job = await createJob({
      locale: "en",
      slug: "hospital-beds",
      tier: "expert_verified",
      intake: { opportunity_name: "Fictional beds" },
    });
    const opened = await payJob(job.id, async (call) => {
      assert.equal(call.headers["idempotency-key"], `checkout_${job.id}`);
      assert.equal(
        new URLSearchParams(call.body).get("line_items[0][price_data][unit_amount]"),
        String(job.priceMinor),
      );
      return {
        status: 200,
        body: JSON.stringify({
          id: "cs_test_snapshot",
          livemode: false,
          amount_total: job.priceMinor,
          currency: "usd",
        }),
      };
    });
    assert.equal(opened.status, "checkout");
    assert.equal(opened.payment?.id, "cs_test_snapshot");
    const sign = (payload: string) => {
      const stamp = String(Math.floor(Date.now() / 1000));
      const digest = createHmac("sha256", "whsec_test_local").update(`${stamp}.${payload}`).digest("hex");
      return `t=${stamp},v1=${digest}`;
    };
    const payload = (amount: number, id: string) => JSON.stringify({
      id,
      type: "checkout.session.completed",
      data: {
        object: {
          amount_total: amount,
          currency: "usd",
          livemode: false,
          payment_status: "paid",
          client_reference_id: job.id,
          metadata: {
            platform_fee_minor: String(job.platformFeeMinor),
            creator_royalty_minor: String(job.creatorRoyaltyMinor),
            review_fee_minor: String(job.reviewFeeMinor),
            tax_minor: "0",
          },
        },
      },
    });
    const mismatch = payload(1, "evt_mismatch");
    await assert.rejects(
      applyVerifiedStripePayment(verifyStripeTestWebhook(mismatch, sign(mismatch), process.env)),
      /snapshot/,
    );
    assert.equal((await readJob(job.id))?.status, "checkout");
    const good = payload(job.priceMinor, "evt_paid");
    const settled = await applyVerifiedStripePayment(verifyStripeTestWebhook(good, sign(good), process.env));
    assert.equal(settled.status, "queued");
    assert.equal(settled.payment?.amountMinor, job.priceMinor);
    const stepped = await revealNext(job.id);
    const replayed = await applyVerifiedStripePayment(verifyStripeTestWebhook(good, sign(good), process.env));
    assert.equal(replayed.status, stepped.status);
    assert.equal(replayed.cursor, stepped.cursor);
    assert.equal(await readFile(path.join(directory, `${job.id}.json`), "utf8").then((text) => text.includes("sk_test_example")), false);
  } finally {
    restoreEnv(previous);
    delete process.env.ORBEXA_JOB_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});
});

function restoreEnv(previous: { provider?: string; key?: string; network?: string; webhook?: string }) {
  if (previous.provider === undefined) delete process.env.PAYMENT_PROVIDER;
  else process.env.PAYMENT_PROVIDER = previous.provider;
  if (previous.key === undefined) delete process.env.STRIPE_TEST_SECRET_KEY;
  else process.env.STRIPE_TEST_SECRET_KEY = previous.key;
  if (previous.network === undefined) delete process.env.STRIPE_TEST_NETWORK;
  else process.env.STRIPE_TEST_NETWORK = previous.network;
  if (previous.webhook === undefined) delete process.env.STRIPE_TEST_WEBHOOK_SECRET;
  else process.env.STRIPE_TEST_WEBHOOK_SECRET = previous.webhook;
}
