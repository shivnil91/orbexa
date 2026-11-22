import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  applyVerifiedStripePayment,
  applyVerifiedStripeRefund,
  createJob,
  deliverPaidDraft,
  MODEL_MAX_ATTEMPTS,
  payJob,
  readConsent,
  readJob,
  recordExpertSignal,
  recordJobFeedback,
  refundUnreleasedJob,
  revealNext,
  setJobConsent,
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
    const unpaid = await revealNext(job.id);
    assert.equal(unpaid.status, "checkout");
    assert.equal(unpaid.cursor, 0);
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
    const refund = {
      id: "evt_refund",
      type: "refund.succeeded" as const,
      orderId: job.id,
      amountMinor: job.priceMinor,
      currency: "USD",
      platformFeeMinor: job.platformFeeMinor,
      creatorRoyaltyMinor: job.creatorRoyaltyMinor,
      reviewFeeMinor: job.reviewFeeMinor,
      taxMinor: 0,
      livemode: false as const,
    };
    const cursor = (await readJob(job.id))?.cursor ?? 0;
    const refunded = await applyVerifiedStripeRefund(refund);
    assert.equal(refunded.refunded, true);
    assert.equal(refunded.status, "rejected");
    const stayed = await revealNext(job.id);
    assert.equal(stayed.cursor, cursor);
    assert.equal(stayed.status, "rejected");
    await assert.rejects(recordJobFeedback(job.id, { kind: "buyer_approve" }), /refunded/);
    const replay = await applyVerifiedStripeRefund(refund);
    assert.equal(replay.cursor, stayed.cursor);
    await assert.rejects(applyVerifiedStripeRefund({ ...refund, id: "evt_refund_currency", currency: "EUR" }), /snapshot/);
  } finally {
    restoreEnv(previous);
    delete process.env.ORBEXA_JOB_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared demo consent does not opt in another job", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-jobs-"));
  process.env.ORBEXA_JOB_DIR = directory;
  try {
    const first = await createJob({
      locale: "en",
      slug: "hospital-beds",
      tier: "autonomous",
      intake: { opportunity_name: "One" },
    });
    await setJobConsent(first.id, true);
    assert.equal((await readJob(first.id))?.trainingConsent, true);
    assert.equal(await readConsent(first.tenantId), false);
    const second = await createJob({
      locale: "en",
      slug: "hospital-beds",
      tier: "autonomous",
      intake: { opportunity_name: "Two" },
    });
    assert.equal(second.trainingConsent, false);
    const tenant = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const owned = await createJob({
      locale: "en",
      slug: "hospital-beds",
      tier: "autonomous",
      intake: { opportunity_name: "Owned" },
      tenantId: tenant,
    });
    await setJobConsent(owned.id, true);
    assert.equal(await readConsent(tenant), true);
  } finally {
    delete process.env.ORBEXA_JOB_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a paid everyday job returns the draft without another step", async () => {
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
      slug: "example-support-reply",
      tier: "autonomous",
      intake: { need: "Draft a calm support reply" },
    });
    const paid = await payJob(job.id);
    assert.equal(paid.status, "waiting_for_buyer");
    assert.match(paid.paragraphs.join("\n"), /Thanks for writing about the catering order/);
    assert.equal(paid.paragraphs.join("\n").includes("Instructions used"), false);
    assert.equal(paid.paragraphs.join("\n").toLowerCase().includes("fixture"), false);
    let called = false;
    const again = await refundUnreleasedJob(paid.id, async () => {
      called = true;
      throw new Error("released draft");
    });
    assert.equal(called, false);
    assert.equal(again?.refunded, undefined);
    assert.equal(again?.status, "waiting_for_buyer");
  } finally {
    restoreEnv(previous);
    delete process.env.ORBEXA_JOB_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a draft is not run or refunded before payment", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-jobs-"));
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ORBEXA_JOB_DIR = directory;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-a-secret-value";
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("should not run");
  }) as typeof fetch;
  try {
    const job = await createJob({
      locale: "en",
      slug: "example-support-reply",
      tier: "autonomous",
      intake: { need: "Draft a calm support reply" },
    });
    const delivered = await deliverPaidDraft(job.id);
    assert.equal(called, false);
    assert.equal(delivered.status, "checkout");
    assert.equal(delivered.payment, null);
    const refunded = await refundUnreleasedJob(job.id, async () => {
      throw new Error("unpaid");
    });
    assert.equal(refunded?.refunded, undefined);
    assert.equal(refunded?.status, "checkout");
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
    delete process.env.ORBEXA_JOB_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a model-backed job waits for the provider and refunds when it fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-jobs-"));
  const previous = {
    provider: process.env.PAYMENT_PROVIDER,
    key: process.env.STRIPE_TEST_SECRET_KEY,
    network: process.env.STRIPE_TEST_NETWORK,
    webhook: process.env.STRIPE_TEST_WEBHOOK_SECRET,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };
  const originalFetch = globalThis.fetch;
  process.env.ORBEXA_JOB_DIR = directory;
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.STRIPE_TEST_SECRET_KEY;
  delete process.env.STRIPE_TEST_NETWORK;
  delete process.env.STRIPE_TEST_WEBHOOK_SECRET;
  delete process.env.ORBEXA_MODEL_HOURLY_CAP;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-a-secret-value";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("provider down sk-ant-test-key-not-a-secret-value Draft a calm support reply");
  }) as typeof fetch;
  try {
    const job = await createJob({
      locale: "en",
      slug: "example-support-reply",
      tier: "autonomous",
      intake: { need: "Draft a calm support reply" },
    });
    const stepped = await revealNext(job.id);
    assert.equal(stepped.status, "checkout");
    const paid = await payJob(job.id);
    assert.equal(paid.modelDelivery, true);
    assert.equal(paid.status, "running");
    assert.equal(paid.paragraphs.length, 0);
    const held = await revealNext(paid.id);
    assert.equal(held.cursor, 0);
    assert.equal(held.status, "running");
    assert.equal(calls, 0);
    const failed = await deliverPaidDraft(paid.id);
    assert.equal(failed.refunded, undefined);
    assert.equal(failed.modelError, "provider");
    assert.equal(failed.modelAttempts, 1);
    assert.equal(failed.paragraphs.length, 0);
    assert.equal(JSON.stringify(failed).includes("sk-ant-test"), false);
    assert.equal(JSON.stringify(failed).includes("provider down"), false);
    const marked = await refundUnreleasedJob(failed.id, async () => {
      throw new Error("simulated payment has no Stripe charge");
    });
    assert.equal(marked?.refunded, true);
    assert.equal(marked?.status, "rejected");
    const replay = await refundUnreleasedJob(failed.id, async () => {
      throw new Error("second refund");
    });
    assert.equal(replay?.refunded, true);
    assert.equal(calls, 1);
    for (let extra = 0; extra < 3; extra += 1) {
      await deliverPaidDraft(failed.id);
    }
    assert.equal(calls, 1);

    const retry = await createJob({
      locale: "en",
      slug: "example-support-reply",
      tier: "autonomous",
      intake: { need: "Draft a calm support reply" },
    });
    const retryPaid = await payJob(retry.id);
    const first = await deliverPaidDraft(retryPaid.id);
    const second = await deliverPaidDraft(retryPaid.id);
    const third = await deliverPaidDraft(retryPaid.id);
    assert.equal(first.modelAttempts, 1);
    assert.equal(second.modelAttempts, 2);
    assert.equal(third.modelAttempts, MODEL_MAX_ATTEMPTS);
    assert.equal(calls, 3);

    const stripeJob = JSON.parse(await readFile(path.join(directory, `${retry.id}.json`), "utf8")) as {
      payment: { id: string; mode: string };
      refunded?: boolean;
    };
    stripeJob.payment.id = "cs_test_failed";
    stripeJob.payment.mode = "stripe_test";
    stripeJob.refunded = undefined;
    await writeFile(path.join(directory, `${retry.id}.json`), JSON.stringify(stripeJob));
    process.env.PAYMENT_PROVIDER = "stripe";
    process.env.STRIPE_TEST_SECRET_KEY = "sk_test_example";
    process.env.STRIPE_TEST_NETWORK = "1";
    let stripeCalls = 0;
    const stripeRefund = await refundUnreleasedJob(retry.id, async (call) => {
      stripeCalls += 1;
      assert.equal(new URL(call.url).host, "api.stripe.com");
      if (call.method === "GET") {
        const stored = JSON.parse(await readFile(path.join(directory, `${retry.id}.json`), "utf8")) as { priceMinor: number; currency: string };
        return {
          status: 200,
          body: JSON.stringify({
            livemode: false,
            amount_total: stored.priceMinor,
            currency: stored.currency.toLowerCase(),
            payment_status: "paid",
            payment_intent: { id: "pi_test_failed", livemode: false, amount: stored.priceMinor, currency: stored.currency.toLowerCase() },
          }),
        };
      }
      const params = new URLSearchParams(call.body);
      const stored = JSON.parse(await readFile(path.join(directory, `${retry.id}.json`), "utf8")) as { priceMinor: number };
      assert.equal(params.get("amount"), String(stored.priceMinor));
      assert.equal(call.headers["idempotency-key"], `refund_${retry.id}`);
      assert.equal(params.get("reverse_transfer"), null);
      return {
        status: 200,
        body: JSON.stringify({ id: "re_test_failed", livemode: false, amount: Number(params.get("amount")), status: "succeeded", payment_intent: "pi_test_failed" }),
      };
    });
    assert.equal(stripeRefund?.refunded, true);
    assert.equal(stripeCalls, 2);
    stripeCalls = 0;
    await refundUnreleasedJob(retry.id, async () => {
      stripeCalls += 1;
      throw new Error("second stripe refund");
    });
    assert.equal(stripeCalls, 0);
    const saved = JSON.parse(await readFile(path.join(directory, `${retry.id}.json`), "utf8")) as { refunded?: boolean };
    saved.refunded = false;
    await writeFile(path.join(directory, `${retry.id}.json`), JSON.stringify(saved));
    await assert.rejects(refundUnreleasedJob(retry.id, async () => ({
      status: 200,
      body: JSON.stringify({ livemode: true, amount_total: 1, currency: "usd", payment_status: "paid", payment_intent: "pi_test_failed" }),
    })), /live mode/);
    const unchanged = await readJob(retry.id);
    assert.equal(unchanged?.refunded, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous.anthropic;
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
