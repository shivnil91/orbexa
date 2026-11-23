import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { packFor, transcriptFor, type DemoRun, type ServiceLevel } from "./catalog.ts";
import { readDb } from "./demo-store.ts";
import { publishedListing } from "./marketplace.ts";
import { buyerDraft, retrieveAssets, revisionDraft } from "./trust.ts";
import { validateFeedback, type FeedbackInput, type FeedbackKind } from "@orbexa/db/feedback.ts";
import { validateIntake } from "./intake.ts";
import {
  checkoutPlan,
  sendStripeTestCheckout,
  stripeTestNetworkEnabled,
  stripeTestTransport,
  type CheckoutPlan,
  type StripeTransport,
  type VerifiedStripeEvent,
} from "./payments.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEMO_ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export type JobStatus =
  | "checkout"
  | "queued"
  | "running"
  | "waiting_for_expert"
  | "waiting_for_buyer"
  | "accepted"
  | "rejected";

export type JobFeedback = {
  kind: FeedbackKind;
  reward: number;
  editDistance: number | null;
  rating: number | null;
  at: string;
};

export type JobRecord = {
  id: string;
  locale: string;
  vertical: string;
  listingSlug: string;
  title: string;
  serviceLevel: ServiceLevel;
  opportunityName: string;
  currency: string;
  priceMinor: number;
  reviewFeeMinor: number;
  platformFeeMinor: number;
  creatorRoyaltyMinor: number;
  deliveryDays: number;
  includedRevisions: number;
  cancellationCode: string;
  payoutRelease: string;
  agentVersionId: string;
  tenantId: string;
  payment: CheckoutPlan | null;
  stages: string[];
  cursor: number;
  status: JobStatus;
  transcript: DemoRun | null;
  paragraphs: string[];
  downloads: { code: string; href: string; filename: string }[];
  feedback: JobFeedback[];
  trainingConsent: boolean;
  approvalSignal: "approve" | null;
  startedAt: number | null;
  finishedAt: number | null;
  metricsWritten: boolean;
  processedStripeEvents: string[];
  refunded?: boolean;
  instructions?: string;
  sellerId?: string;
  createdAt?: number;
  stripeCheckoutUrl?: string;
  retrievedCount?: number;
  revisionCount?: number;
  guarantee?: {
    revisionUsed: boolean;
    revisionReason: string;
    refundRequested: boolean;
    refundReason: string;
  };
};

const locks = new Map<string, Promise<unknown>>();

function rootDir(): string {
  return process.env.ORBEXA_JOB_DIR ?? path.join(os.tmpdir(), "orbexa-m5-jobs");
}

function jobPath(id: string): string {
  if (!UUID.test(id)) {
    throw new Error("job id is not a uuid");
  }
  return path.join(rootDir(), `${id}.json`);
}

async function withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous.then(work, work);
  locks.set(id, run.then(() => undefined, () => undefined));
  return run;
}

export async function readJob(id: string): Promise<JobRecord | null> {
  try {
    return JSON.parse(await readFile(jobPath(id), "utf8")) as JobRecord;
  } catch {
    return null;
  }
}

async function writeJob(job: JobRecord): Promise<void> {
  await mkdir(rootDir(), { recursive: true });
  await writeFile(jobPath(job.id), JSON.stringify(job));
}

export async function createJob(input: {
  locale: string;
  slug: string;
  tier: ServiceLevel;
  intake: Record<string, unknown>;
  tenantId?: string;
}): Promise<JobRecord> {
  const listing = await publishedListing(input.slug);
  if (!listing) {
    throw new Error("listing not found");
  }
  const pack = packFor(listing);
  const properties = pack.intakeSchema.properties ?? {};
  const intake: Record<string, unknown> = {};
  for (const key of Object.keys(properties)) {
    if (key in input.intake) {
      intake[key] = input.intake[key];
    }
  }
  validateIntake(pack.intakeSchema, intake);
  const tier = listing.tiers.find((item) => item.serviceLevel === input.tier);
  if (!tier) {
    throw new Error("service level not found");
  }
  const name = intake.opportunity_name ?? intake.need;
  const transcript = transcriptFor(listing.vertical);
  const needText = typeof name === "string" ? name : "";
  const retrievedCount = retrieveAssets(listing.assets ?? [], needText).length;
  const tenantId = input.tenantId && UUID.test(input.tenantId) ? input.tenantId : DEMO_ORG_ID;
  const job: JobRecord = {
    id: randomUUID(),
    locale: input.locale,
    vertical: listing.vertical,
    listingSlug: listing.slug,
    title: listing.title,
    serviceLevel: tier.serviceLevel,
    opportunityName: typeof name === "string" ? name : "",
    instructions: listing.instructions ?? "",
    retrievedCount,
    sellerId: listing.sellerId,
    createdAt: Date.now(),
    currency: tier.currency,
    priceMinor: tier.priceMinor,
    reviewFeeMinor: tier.reviewFeeMinor,
    platformFeeMinor: 0,
    creatorRoyaltyMinor: 0,
    deliveryDays: tier.deliveryDays,
    includedRevisions: tier.includedRevisions,
    cancellationCode: tier.cancellationCode,
    payoutRelease: tier.payoutRelease,
    agentVersionId: listing.agentVersionId,
    tenantId,
    payment: null,
    stages: pack.workflow,
    cursor: 0,
    status: "checkout",
    transcript,
    paragraphs: transcript?.paragraphs ?? [],
    downloads: transcript
      ? [
          { code: "bid_docx", href: "/samples/tender-writing/response.docx", filename: "response.docx" },
          { code: "bid_xlsx", href: "/samples/tender-writing/matrix.xlsx", filename: "matrix.xlsx" },
        ]
      : [],
    feedback: [],
    trainingConsent: tenantId === DEMO_ORG_ID ? false : await readConsent(tenantId),
    approvalSignal: null,
    startedAt: null,
    finishedAt: null,
    metricsWritten: false,
    processedStripeEvents: [],
  };
  const plan = checkoutPlan({
    orderId: job.id,
    amountMinor: tier.priceMinor,
    currency: tier.currency,
    reviewFeeMinor: tier.reviewFeeMinor,
    platformFeeBps: tier.platformFeeBps,
  });
  job.platformFeeMinor = plan.platformFeeMinor;
  job.creatorRoyaltyMinor = plan.creatorRoyaltyMinor;
  job.reviewFeeMinor = plan.reviewFeeMinor;
  await writeJob(job);
  return job;
}

function snapshotInput(job: JobRecord) {
  return {
    orderId: job.id,
    amountMinor: job.priceMinor,
    currency: job.currency,
    reviewFeeMinor: job.reviewFeeMinor,
    platformFeeBps: 0,
    platformFeeMinor: job.platformFeeMinor,
    creatorRoyaltyMinor: job.creatorRoyaltyMinor,
  };
}

export async function payJob(
  id: string,
  transport: StripeTransport = stripeTestTransport,
  urls?: { successUrl?: string; cancelUrl?: string },
): Promise<JobRecord> {
  return withLock(id, async () => {
    const job = await readJob(id);
    if (!job) {
      throw new Error("job not found");
    }
    if (job.status !== "checkout") {
      return job;
    }
    if (job.refunded) {
      throw new Error("job is refunded");
    }
    const input = snapshotInput(job);
    const plan = checkoutPlan(input);
    if (!stripeTestNetworkEnabled(process.env)) {
      job.payment = plan;
      job.status = "queued";
      await writeJob(job);
      return job;
    }
    if (job.payment?.id.startsWith("cs_test_")) {
      return job;
    }
    const session = await sendStripeTestCheckout(input, process.env, transport, {
      ...urls,
      destinationAccountId: await sellerDestination(job.sellerId),
    });
    job.payment = { ...plan, mode: "stripe_test", simulated: true, id: session.id };
    if (session.url) {
      job.stripeCheckoutUrl = session.url;
    }
    await writeJob(job);
    return job;
  });
}

export async function applyVerifiedStripePayment(event: VerifiedStripeEvent): Promise<JobRecord> {
  if (event.type !== "payment.captured" || event.livemode !== false) {
    throw new Error("event is not a test capture");
  }
  return withLock(event.orderId, async () => {
    const job = await readJob(event.orderId);
    if (!job) {
      throw new Error("job not found");
    }
    const seen = job.processedStripeEvents ?? [];
    if (seen.includes(event.id)) {
      return job;
    }
    if (
      event.amountMinor !== job.priceMinor
      || event.currency !== job.currency
      || event.platformFeeMinor !== job.platformFeeMinor
      || event.creatorRoyaltyMinor !== job.creatorRoyaltyMinor
      || event.reviewFeeMinor !== job.reviewFeeMinor
      || event.taxMinor !== 0
    ) {
      throw new Error("amount does not match the order snapshot");
    }
    if (job.refunded) {
      if (!seen.includes(event.id)) {
        job.processedStripeEvents = [...seen, event.id];
        await writeJob(job);
      }
      return job;
    }
    if (job.status !== "checkout") {
      if (job.payment) {
        return job;
      }
      throw new Error("job is not awaiting payment");
    }
    const plan = checkoutPlan(snapshotInput(job));
    const sessionId = job.payment?.id.startsWith("cs_test_") ? job.payment.id : plan.id;
    job.payment = { ...plan, mode: "stripe_test", simulated: true, id: sessionId };
    job.status = "queued";
    job.processedStripeEvents = [...seen, event.id];
    await writeJob(job);
    return job;
  });
}

export async function applyVerifiedStripeRefund(event: VerifiedStripeEvent): Promise<JobRecord> {
  if (event.type !== "refund.succeeded" || event.livemode !== false) {
    throw new Error("event is not a test refund");
  }
  if (!Number.isSafeInteger(event.amountMinor) || event.amountMinor <= 0) {
    throw new Error("refund amount is invalid");
  }
  return withLock(event.orderId, async () => {
    const job = await readJob(event.orderId);
    if (!job) {
      throw new Error("job not found");
    }
    if (event.currency !== job.currency || event.amountMinor > job.priceMinor) {
      throw new Error("amount does not match the order snapshot");
    }
    const seen = job.processedStripeEvents ?? [];
    if (seen.includes(event.id)) {
      return job;
    }
    job.refunded = true;
    job.processedStripeEvents = [...seen, event.id];
    if (job.status !== "rejected") {
      job.status = "rejected";
    }
    await writeJob(job);
    return job;
  });
}

async function sellerDestination(sellerId: string | undefined): Promise<string | undefined> {
  if (!sellerId) {
    return undefined;
  }
  try {
    const db = await readDb();
    const seller = db.users.find((user) => user.id === sellerId);
    const accountId = seller?.connect.accountId;
    if (!seller?.connect.chargesEnabled || !accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
      return undefined;
    }
    return accountId;
  } catch {
    return undefined;
  }
}

export async function revealNext(id: string): Promise<JobRecord> {
  return withLock(id, async () => {
    const job = await readJob(id);
    if (!job) {
      throw new Error("job not found");
    }
    if (job.refunded || job.status === "rejected" || job.status === "checkout" || !job.payment) {
      return job;
    }
    if (job.status !== "queued" && job.status !== "running") {
      return job;
    }
    job.startedAt = job.startedAt ?? Date.now();
    job.cursor += 1;
    job.status = "running";
    if (job.cursor >= job.stages.length) {
      job.status = job.serviceLevel === "autonomous" ? "waiting_for_buyer" : "waiting_for_expert";
      job.finishedAt = Date.now();
      if (!job.transcript) {
        job.paragraphs = buyerDraft({
          name: job.title,
          need: job.opportunityName,
          retrieved: job.retrievedCount ?? 0,
        });
      }
      await writeMetrics(job);
      job.metricsWritten = true;
    }
    await writeJob(job);
    return job;
  });
}

export async function recordJobFeedback(
  id: string,
  input: { kind: FeedbackKind; editDistance?: number | null; rating?: number | null; reason?: string | null },
): Promise<JobRecord> {
  return withLock(id, async () => {
    const job = await readJob(id);
    if (!job) {
      throw new Error("job not found");
    }
    if (job.refunded) {
      throw new Error("job is refunded");
    }
    const buyerSignal = input.kind === "buyer_approve"
      || input.kind === "buyer_edit"
      || input.kind === "buyer_reject"
      || input.kind === "edit_distance"
      || input.kind === "tender_win"
      || input.kind === "tender_loss";
    const reviewOpen = job.status === "waiting_for_buyer" || job.status === "accepted" || job.status === "rejected";
    const expertOpen = reviewOpen || job.status === "waiting_for_expert";
    if (buyerSignal && !reviewOpen) {
      throw new Error("feedback is not available for this job");
    }
    if (!buyerSignal && !expertOpen) {
      throw new Error("feedback is not available for this job");
    }
    const feedback: FeedbackInput = {
      tenantId: job.tenantId,
      homeRegion: "local",
      jobId: job.id,
      kind: input.kind,
      editDistance: input.editDistance ?? null,
      rating: input.rating ?? null,
    };
    validateFeedback(feedback);
    const reward = input.kind === "buyer_reject" || input.kind === "tender_loss"
      ? -1
      : input.kind === "buyer_edit" || input.kind === "edit_distance"
        ? 0
        : input.kind === "expert_rating"
          ? ((input.rating ?? 3) - 3) / 2
          : 1;
    job.feedback.push({
      kind: input.kind,
      reward,
      editDistance: input.editDistance ?? null,
      rating: input.rating ?? null,
      at: new Date().toISOString(),
    });
    if (input.kind === "buyer_approve" && job.status === "waiting_for_buyer") {
      if (job.guarantee?.refundRequested) {
        throw new Error("refund is in review");
      }
      job.status = "accepted";
    }
    if (input.kind === "buyer_reject" && job.status === "waiting_for_buyer") {
      const reason = (input.reason ?? "").trim();
      if (reason.length < 8 || reason.length > 500) {
        throw new Error("reason");
      }
      const guarantee = job.guarantee ?? { revisionUsed: false, revisionReason: "", refundRequested: false, refundReason: "" };
      if (!guarantee.revisionUsed) {
        guarantee.revisionUsed = true;
        guarantee.revisionReason = reason;
        job.guarantee = guarantee;
        job.revisionCount = (job.revisionCount ?? 0) + 1;
        const note = revisionDraft(reason);
        job.paragraphs = job.transcript ? job.paragraphs.concat(note.slice(0, 2)) : note;
      } else if (!guarantee.refundRequested) {
        guarantee.refundRequested = true;
        guarantee.refundReason = reason;
        job.guarantee = guarantee;
      }
    }
    await writeJob(job);
    return job;
  });
}

export async function recordExpertSignal(id: string): Promise<JobRecord> {
  return withLock(id, async () => {
    const job = await readJob(id);
    if (!job) {
      throw new Error("job not found");
    }
    if (job.refunded || job.serviceLevel === "autonomous") {
      return job;
    }
    if (job.serviceLevel === "expert_review") {
      throw new Error("expert review is released by the seller");
    }
    if (job.status !== "waiting_for_expert") {
      throw new Error("expert approval is not available for this job");
    }
    job.approvalSignal = "approve";
    job.status = "waiting_for_buyer";
    await writeJob(job);
    return job;
  });
}

function paragraphsFrom(text: string): string[] {
  return text
    .replace(/\u0000/g, "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 8)
    .map((part) => part.slice(0, 2000));
}

export async function saveExpertDraft(id: string, sellerId: string, text: string): Promise<JobRecord> {
  return withLock(id, async () => {
    const job = await readJob(id);
    if (!job || job.sellerId !== sellerId || job.serviceLevel !== "expert_review" || job.status !== "waiting_for_expert" || job.refunded) {
      throw new Error("expert draft is not available");
    }
    const paragraphs = paragraphsFrom(text);
    if (paragraphs.length === 0) {
      throw new Error("draft is empty");
    }
    job.paragraphs = paragraphs;
    await writeJob(job);
    return job;
  });
}

export async function releaseExpertReview(id: string, sellerId: string): Promise<JobRecord> {
  return withLock(id, async () => {
    const job = await readJob(id);
    if (!job || job.sellerId !== sellerId || job.serviceLevel !== "expert_review" || job.status !== "waiting_for_expert" || job.refunded) {
      throw new Error("expert review is not available");
    }
    if (job.paragraphs.length === 0) {
      throw new Error("draft is empty");
    }
    job.approvalSignal = "approve";
    job.status = "waiting_for_buyer";
    await writeJob(job);
    return job;
  });
}

export async function approveReviewedRefund(id: string): Promise<JobRecord> {
  return withLock(id, async () => {
    const job = await readJob(id);
    if (!job) {
      throw new Error("job not found");
    }
    if (!job.payment || !job.guarantee?.refundRequested) {
      throw new Error("refund is not in review");
    }
    const eventId = `guarantee_refund_${job.id}`;
    const seen = job.processedStripeEvents ?? [];
    if (seen.includes(eventId)) {
      return job;
    }
    if (job.currency !== "USD" || job.priceMinor <= 0) {
      throw new Error("amount does not match the order snapshot");
    }
    job.refunded = true;
    job.status = "rejected";
    job.processedStripeEvents = [...seen, eventId];
    await writeJob(job);
    return job;
  });
}

export async function setJobConsent(id: string, granted: boolean): Promise<JobRecord> {
  return withLock(id, async () => {
    const job = await readJob(id);
    if (!job) {
      throw new Error("job not found");
    }
    job.trainingConsent = granted;
    if (job.tenantId !== DEMO_ORG_ID) {
      await writeConsent(job.tenantId, granted);
    }
    await writeJob(job);
    return job;
  });
}

async function consentPath(): Promise<string> {
  await mkdir(rootDir(), { recursive: true });
  return path.join(rootDir(), "training-consents.json");
}

export async function readConsent(orgId: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(await consentPath(), "utf8")) as Record<string, boolean>;
    return parsed[orgId] === true;
  } catch {
    return false;
  }
}

async function writeConsent(orgId: string, granted: boolean): Promise<void> {
  const file = await consentPath();
  let parsed: Record<string, boolean> = {};
  try {
    parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, boolean>;
  } catch {
    parsed = {};
  }
  parsed[orgId] = granted;
  await writeFile(file, JSON.stringify(parsed));
}

async function writeMetrics(job: JobRecord): Promise<void> {
  if (job.metricsWritten || !job.transcript) {
    return;
  }
  const claims = job.transcript.claims;
  const supported = claims.filter((claim) => claim.support_status === "supported").length;
  const rate = claims.length === 0 ? 0 : supported / claims.length;
  const latency = Math.max(1, (job.finishedAt ?? Date.now()) - (job.startedAt ?? Date.now()));
  const lines = job.stages.map((stage, index) =>
    JSON.stringify({
      kind: "invocation",
      agentVersionId: job.agentVersionId,
      currency: job.currency,
      jobId: job.id,
      costMinor: 1,
      inputTokens: 32 + index,
      outputTokens: 16 + index,
      latencyMs: Math.round(latency / job.stages.length),
      cacheHit: false,
      fallbackUsed: false,
      model: "fixture",
      stage,
    }),
  );
  lines.push(
    JSON.stringify({
      kind: "run_metric",
      agentVersionId: job.agentVersionId,
      currency: job.currency,
      jobId: job.id,
      groundedClaimRate: rate,
      latencyMs: latency,
      costMinor: job.stages.length,
    }),
  );
  lines.push(JSON.stringify({ kind: "draft", agentVersionId: job.agentVersionId, jobId: job.id }));
  await mkdir(rootDir(), { recursive: true });
  await writeFile(path.join(rootDir(), "invocations.jsonl"), `${lines.join("\n")}\n`, { flag: "a" });
}

export async function listJobs(): Promise<JobRecord[]> {
  let names: string[] = [];
  try {
    names = await readdir(/*turbopackIgnore: true*/ rootDir());
  } catch {
    return [];
  }
  const jobs: JobRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const id = name.slice(0, -".json".length);
    if (!UUID.test(id)) {
      continue;
    }
    const job = await readJob(id);
    if (job) {
      jobs.push(job);
    }
  }
  jobs.sort((left, right) => (right.createdAt ?? right.startedAt ?? 0) - (left.createdAt ?? left.startedAt ?? 0));
  return jobs;
}

export async function runCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const job of await listJobs()) {
    if (job.status === "checkout" || job.status === "queued" || job.status === "running") {
      continue;
    }
    counts[job.listingSlug] = (counts[job.listingSlug] ?? 0) + 1;
  }
  return counts;
}

export function metricsLogPath(): string {
  return path.join(rootDir(), "invocations.jsonl");
}
