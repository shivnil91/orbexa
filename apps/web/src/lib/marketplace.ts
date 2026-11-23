import { randomBytes, randomUUID } from "node:crypto";
import { parseAmountToMinor } from "@orbexa/db/money.ts";
import type { Listing, Tier } from "./catalog.ts";
import { listingBySlug } from "./catalog.ts";
import { NDIS_EXAMPLE_NAME, NDIS_EXAMPLE_PITCH, NDIS_EXAMPLE_SLUG } from "./studio-ndis.ts";
import type { AgentRecord, AssetKind, ExpertReviewConfig, InterviewAnswer, KnowledgeAsset, KnowledgeNote, MarketplaceDb, ProofRecord, ReviewRecord } from "./demo-store.ts";
import { emptyDb, readDb, updateDb } from "./demo-store.ts";
import {
  cleanInterview,
  contentHash,
  emptyTrack,
  initials,
  interviewCount,
  knowledgeCounts,
  proofGroup,
  proofWeight,
  publicCredentials,
  publishInterviewReady,
  safeLinks,
  toPublicProof,
  trackFromJobs,
  trackWeight,
  type PublicCredential,
  type PublicProof,
  type TrackRecord,
} from "./trust.ts";

export const EXAMPLE_SELLER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const EXAMPLE_SELLER_NAME = "Example seller";
export const EXAMPLE_SELLER_BIO = "Seed profile for example listings. Not a real person or company.";

export const CATEGORIES = [
  { code: "tenders", label: "Tenders" },
  { code: "engineering", label: "Engineering" },
  { code: "design", label: "Design" },
  { code: "legal", label: "Legal drafting" },
  { code: "research", label: "Research" },
  { code: "operations", label: "Operations" },
  { code: "writing", label: "Writing" },
  { code: "support", label: "Support" },
] as const;

export type CategoryCode = (typeof CATEGORIES)[number]["code"];

export function categoryLabel(code: string): string {
  return CATEGORIES.find((item) => item.code === code)?.label ?? code;
}

export function isCategory(code: string): code is CategoryCode {
  return CATEGORIES.some((item) => item.code === code);
}

const STOP = new Set(["a", "an", "the", "to", "for", "and", "or", "of", "in", "on", "with", "my", "me", "i", "you", "your"]);

export type PublicReview = {
  id: string;
  buyerName: string;
  rating: number;
  body: string;
  createdAt: string;
  example: boolean;
  jobId?: string;
};

export type CatalogItem = {
  slug: string;
  name: string;
  pitch: string;
  description: string;
  category: string;
  instructions: string;
  knowledge: KnowledgeNote[];
  exampleOutputs: { title: string; body: string }[];
  sellerId: string;
  sellerName: string;
  sellerBio: string;
  ownerId: string;
  example: boolean;
  featured: boolean;
  status: "published" | "draft" | "rejected" | "suspended";
  priceMinor: number;
  currency: "USD";
  tiers: Tier[];
  ratingAverage: number | null;
  ratingCount: number;
  ratingExample: boolean;
  runs: number;
  runsExample: boolean;
  createdAt: string;
  listing: Listing;
  reviews: PublicReview[];
  assets: KnowledgeAsset[];
  interview: InterviewAnswer[];
  trainingConsent: boolean;
  expertReview: ExpertReviewConfig;
  proof: PublicProof | null;
  knowledgeCounts: { kind: AssetKind; count: number }[];
  interviewCount: number;
  track: TrackRecord;
  experience: string;
  links: { label: string; href: string }[];
  credentials: PublicCredential[];
  initials: string;
  photoDataUrl: string;
  hasStudio?: boolean;
  examplePanel?: boolean;
};

type ExampleAgent = {
  slug: string;
  name: string;
  category: CategoryCode;
  pitch: string;
  description: string;
  instructions: string;
  priceMinor: number;
  exampleRuns: number;
  featured: boolean;
  createdAt: string;
  output: { title: string; body: string };
  reviews: { rating: number; body: string; createdAt: string }[];
  agentVersionId: string;
};

const EXAMPLES: ExampleAgent[] = [
  {
    slug: "example-drawing-check",
    name: "Drawing check",
    category: "engineering",
    pitch: "Flag missing dimensions and clashes in an engineering drawing.",
    description: "Example agent. It lists gaps in a drawing set. It does not stamp drawings or replace an engineer.",
    instructions: "You check a description of a drawing. List each missing dimension, unit, or clash as its own bullet. Quote the buyer's words. Never invent a measurement. End with the questions a reviewer should ask before anyone builds from the sheet.",
    priceMinor: 4500,
    exampleRuns: 18,
    featured: true,
    createdAt: "2025-12-01T00:00:00.000Z",
    output: { title: "Example output", body: "Missing from the brief\n\nThe grid spacing has no unit.\nThe clash at the stair is named, but no clearance is given.\n\nNo measurement was added. Ask for the unit and the clearance before anyone builds from this sheet." },
    reviews: [
      { rating: 5, body: "Example review. The gaps were listed without invented sizes.", createdAt: "2026-01-08T00:00:00.000Z" },
      { rating: 4, body: "Example review. Clear notes. Not a real project.", createdAt: "2026-02-12T00:00:00.000Z" },
    ],
    agentVersionId: "11111111-1111-4111-8111-111111111111",
  },
  {
    slug: "example-clause-drafter",
    name: "Clause drafter",
    category: "legal",
    pitch: "Draft a plain-language clause from a short brief.",
    description: "Example agent. It drafts sample clause language. It is not a law firm and this is not legal advice.",
    instructions: "Draft one plain-language clause from the buyer's brief. State the assumptions in a short list. End with one sentence that a lawyer has not reviewed it. Do not claim this is legal advice.",
    priceMinor: 6000,
    exampleRuns: 9,
    featured: true,
    createdAt: "2026-01-20T00:00:00.000Z",
    output: { title: "Example output", body: "Limitation of liability\n\nThe supplier's liability for this work is limited to the fees paid for the job, except where the law does not allow a limit.\n\nAssumptions\n- One written brief.\n- This sentence does not cover personal injury.\n\nA lawyer has not reviewed this clause. This is not legal advice." },
    reviews: [{ rating: 4, body: "Example review. The draft is marked as a sample.", createdAt: "2026-03-01T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111113",
  },
  {
    slug: "example-ops-checklist",
    name: "Ops checklist",
    category: "operations",
    pitch: "Turn a recurring operations task into a checklist a teammate can follow.",
    description: "Example agent for an internal checklist. It does not connect to a live operations tool.",
    instructions: "Turn the buyer's recurring task into a numbered checklist a teammate can follow on the first day. Each step is one action. Mark any step that needs a person to confirm it. Do not invent software, logins, or measurements.",
    priceMinor: 2500,
    exampleRuns: 5,
    featured: false,
    createdAt: "2026-03-02T00:00:00.000Z",
    output: { title: "Example output", body: "1. Confirm who owns the task today.\n2. Write each step in the order a new person would do it.\n3. Mark the step that needs a person to say it is done.\n4. Leave a note of where the source system is, without logging in.\n5. Hand the list to the teammate and ask them to read it back.\n\nNo system was queried." },
    reviews: [{ rating: 5, body: "Example review. The checklist is easy to follow.", createdAt: "2026-03-20T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111115",
  },
  {
    slug: "example-support-reply",
    name: "Support reply",
    category: "support",
    pitch: "Draft a calm reply that restates the issue and the next step.",
    description: "Example agent for a support draft. It does not send the reply.",
    instructions: "Write a reply the buyer can send. Open by restating the customer's issue in their words. Give one clear next step. Say what you still need and do not guess an order number, a date, or a dollar amount. Keep it under 120 words.",
    priceMinor: 1500,
    exampleRuns: 14,
    featured: false,
    createdAt: "2026-03-18T00:00:00.000Z",
    output: { title: "Example output", body: "Hi,\n\nThanks for writing about the catering order. I have your note, and I do not yet have the date or the headcount.\n\nNext step: reply with the event date and how many people, and I will confirm the deposit in the same thread.\n\nI will not guess an amount or an order number.\n\nBest," },
    reviews: [{ rating: 4, body: "Example review. Tone is calm and it does not invent an order.", createdAt: "2026-04-02T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111116",
  },
  {
    slug: "example-scope-note",
    name: "Scope note",
    category: "writing",
    pitch: "Rewrite a vague request into scope, assumptions, and out-of-scope items.",
    description: "Example writing agent. It clarifies a request. It does not start the work.",
    instructions: "Rewrite the buyer's request as three short lists: what is in scope, what you are assuming, and what is out of scope. Use the buyer's words. Do not add a price or a timeline they did not mention.",
    priceMinor: 3000,
    exampleRuns: 4,
    featured: false,
    createdAt: "2026-04-09T00:00:00.000Z",
    output: { title: "Example output", body: "In scope\nOne written note that turns the request into a job, a list of assumptions, and a list of what is not included.\n\nAssumptions\nOne reviewer. The request you pasted is the whole brief.\n\nOut of scope\nVisual design, and any price or timeline that was not in the request." },
    reviews: [{ rating: 5, body: "Example review. The out-of-scope list is the useful part.", createdAt: "2026-04-18T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111117",
  },
  {
    slug: "example-monthly-close",
    name: "Monthly close checklist",
    category: "operations",
    pitch: "Turn a month of shop expenses into a close checklist and the questions to ask.",
    description: "Example agent for a bookkeeper's monthly close. It does not file a return or connect to accounting software.",
    instructions: "Prepare a month-end close note for a small shop. List the expenses that still need a receipt, the questions for the owner, and the accounts that should not be closed yet. Do not invent totals or say a return was filed.",
    priceMinor: 3500,
    exampleRuns: 6,
    featured: true,
    createdAt: "2026-04-12T00:00:00.000Z",
    output: { title: "Sample draft", body: "Still needs a receipt\n1. Fuel card, last Tuesday.\n2. The market run on Friday.\n3. The repair that was paid in cash.\n\nAsk who bought the fuel, and whether the cash repair is for the shop or for home. Do not close those three until the receipts are in the folder. No total was calculated." },
    reviews: [{ rating: 5, body: "Example review. The missing receipts were listed.", createdAt: "2026-04-20T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111118",
  },
  {
    slug: "example-practice-plan",
    name: "Soccer practice plan",
    category: "writing",
    pitch: "Write a one-hour youth soccer practice a parent can lead at the park.",
    description: "Example agent for a practice plan. It does not replace a coach on the field.",
    instructions: "Write a one-hour youth practice a parent can lead at a park. Include a warm-up, one game, and a cool-down, with times and the equipment they already named. Do not invent league rules or a roster.",
    priceMinor: 2000,
    exampleRuns: 3,
    featured: false,
    createdAt: "2026-04-22T00:00:00.000Z",
    output: { title: "Sample draft", body: "One hour at the park\n\n0:00 Warm-up. Jog the sideline, then ten easy passes in pairs.\n0:15 Game. Two small goals. First team to five. Everyone must touch the ball.\n0:45 Cool-down. Walk the field and stretch calves.\n\nBring one ball and two cones. No league rule was added." },
    reviews: [{ rating: 5, body: "Example review. A parent could follow the plan.", createdAt: "2026-04-28T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111119",
  },
  {
    slug: "example-review-reply",
    name: "Review reply",
    category: "support",
    pitch: "Answer a public review without sounding defensive.",
    description: "Example listing. A short public reply. It does not post the reply anywhere.",
    instructions: "Write a public reply to the review the buyer pastes. Thank them in one sentence, restate the specific point they raised, and offer one next step that does not promise a refund or a free item unless the buyer already said that is the policy. Stay under 80 words.",
    priceMinor: 1800,
    exampleRuns: 4,
    featured: false,
    createdAt: "2026-04-23T00:00:00.000Z",
    output: { title: "Sample draft", body: "Thanks for telling us about the wait on Saturday.\n\nThat is on us. If you write to the shop with the time you came in, we will make the next visit the one we owed you.\n\nWe are not promising a refund in this note." },
    reviews: [{ rating: 5, body: "Example review. It did not pick a fight with the guest.", createdAt: "2026-04-24T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111120",
  },
  {
    slug: "example-late-note",
    name: "Late job note",
    category: "support",
    pitch: "Tell a customer a job is late and what happens next.",
    description: "Example listing. A delay note. It does not change a calendar.",
    instructions: "Write a note the buyer can send when a job is late. Name the job they described, apologize once, give the new timing only if they provided it, and say what the customer should do if the new timing does not work. Do not invent a date.",
    priceMinor: 2000,
    exampleRuns: 3,
    featured: false,
    createdAt: "2026-04-25T00:00:00.000Z",
    output: { title: "Sample draft", body: "Hi,\n\nThe install is running late, and I am sorry for the change.\n\nIf the day we last agreed no longer works, reply and we will pick another. I have not put a new date in this note." },
    reviews: [{ rating: 4, body: "Example review. Clear, and it did not invent a date.", createdAt: "2026-04-26T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111121",
  },
  {
    slug: "example-refund-note",
    name: "Refund note",
    category: "support",
    pitch: "Explain a refund using only the policy the buyer gives you.",
    description: "Example listing. A refund explanation. It does not move money.",
    instructions: "Explain the refund in the customer's language. Use only the policy and the amount the buyer wrote. If the amount or the reason is missing, ask for it instead of guessing. Close with the one next step.",
    priceMinor: 1500,
    exampleRuns: 6,
    featured: false,
    createdAt: "2026-04-27T00:00:00.000Z",
    output: { title: "Sample draft", body: "Hi,\n\nThe deposit comes back the way you paid it.\n\nI do not have an amount in front of me, so I have not written one. Reply if you need the date it should appear." },
    reviews: [{ rating: 5, body: "Example review. It stayed inside the policy I pasted.", createdAt: "2026-04-28T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111122",
  },
  {
    slug: "example-quote-followup",
    name: "Quote follow-up",
    category: "support",
    pitch: "Nudge a quote that has gone quiet, without pressure.",
    description: "Example listing. A follow-up note. It does not send email.",
    instructions: "Write a follow-up to a quote. Mention the job and the price only if the buyer included them. Ask one question that helps the customer decide. Do not invent a discount or a deadline.",
    priceMinor: 1800,
    exampleRuns: 2,
    featured: false,
    createdAt: "2026-04-29T00:00:00.000Z",
    output: { title: "Sample draft", body: "Hi,\n\nChecking whether the kitchen quote still fits this month.\n\nOne question: is the scope the same as the note I sent? I have not added a discount." },
    reviews: [{ rating: 4, body: "Example review. Polite, and it did not cut the price.", createdAt: "2026-04-30T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111123",
  },
  {
    slug: "example-receipt-chase",
    name: "Receipt chase",
    category: "operations",
    pitch: "List the receipts a shop still needs before the month can close.",
    description: "Example listing. A receipt list. It does not connect to accounting software.",
    instructions: "From the buyer's list of expenses, name the ones that still need a receipt and the one question to ask the person who spent the money. Ignore anything they already marked as having a receipt. Do not invent amounts.",
    priceMinor: 2900,
    exampleRuns: 5,
    featured: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    output: { title: "Sample draft", body: "Still needs a receipt\n1. Fuel card, last Tuesday.\n2. The market run on Friday.\n\nAsk who bought the fuel. Do not close the month until those receipts are in the folder. No total was calculated." },
    reviews: [{ rating: 5, body: "Example review. It only chased the missing ones.", createdAt: "2026-05-02T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111124",
  },
  {
    slug: "example-sales-tax-questions",
    name: "Sales tax questions",
    category: "operations",
    pitch: "List the questions to answer before someone prepares sales tax.",
    description: "Example listing. A question list. It does not file a return or calculate tax.",
    instructions: "Write the questions a bookkeeper should ask before preparing sales tax for the period the buyer names. Cover what was collected, what was paid, and which sales might be exempt. Do not compute a tax amount or say a return was filed.",
    priceMinor: 4000,
    exampleRuns: 2,
    featured: false,
    createdAt: "2026-05-03T00:00:00.000Z",
    output: { title: "Sample draft", body: "Questions before sales tax is prepared\n1. Which sales were shipped out of state?\n2. Which sales were already marked exempt?\n3. What was collected, and what was paid, in the period you named?\n\nNo tax was calculated, and nothing here files a return." },
    reviews: [{ rating: 4, body: "Example review. Questions only, which is what I wanted.", createdAt: "2026-05-04T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111125",
  },
  {
    slug: "example-payday-checklist",
    name: "Payday checklist",
    category: "operations",
    pitch: "A checklist for the day a small shop pays people.",
    description: "Example listing. A payday checklist. It does not submit payroll.",
    instructions: "Write a payday checklist for the shop the buyer describes. Include hours to confirm, deductions they already named, and who has to approve the run. Mark every step that a person must confirm. Do not invent pay rates or say payroll was filed.",
    priceMinor: 2500,
    exampleRuns: 3,
    featured: false,
    createdAt: "2026-05-05T00:00:00.000Z",
    output: { title: "Sample draft", body: "1. Confirm hours with the lead. A person has to sign this.\n2. Check the deductions the shop already named.\n3. Ask the owner to approve the run before anyone is paid.\n\nNo pay rate was written down, and payroll was not filed." },
    reviews: [{ rating: 5, body: "Example review. Safe to hand to a new manager.", createdAt: "2026-05-06T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111126",
  },
  {
    slug: "example-estimate-check",
    name: "Estimate check",
    category: "writing",
    pitch: "Flag what a small-job estimate forgot to include.",
    description: "Example listing. A gap list for an estimate. It does not price the job.",
    instructions: "Read the buyer's estimate notes. List materials, labor, access, and cleanup they did not mention. Ask one question per gap. Do not invent a price or a quantity.",
    priceMinor: 3500,
    exampleRuns: 4,
    featured: false,
    createdAt: "2026-05-07T00:00:00.000Z",
    output: { title: "Sample draft", body: "Not in the estimate yet\n- Who hauls the old fixture away?\n- Is access to the room included, or is that a separate trip?\n- Who patches the wall after the removal?\n\nNo price and no quantity were added." },
    reviews: [{ rating: 5, body: "Example review. The missing haul-away was the useful part.", createdAt: "2026-05-08T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111127",
  },
  {
    slug: "example-shop-open",
    name: "Shop opening list",
    category: "writing",
    pitch: "A morning opening list for a counter, a salon, or a shop.",
    description: "Example listing. An opening list. It does not connect to a register.",
    instructions: "Write the morning opening list for the kind of shop the buyer runs. Use the tasks they already do, in the order a new person could follow. Mark anything that needs a manager. Do not invent alarm codes, passwords, or sales targets.",
    priceMinor: 2200,
    exampleRuns: 3,
    featured: false,
    createdAt: "2026-05-09T00:00:00.000Z",
    output: { title: "Sample draft", body: "1. Lights on. A person confirms the shop is safe to open.\n2. Count the till and write the number in the book.\n3. Start the coffee or the first station the shop already uses.\n4. Unlock the door only after the count is written.\n\nNo alarm code was written here." },
    reviews: [{ rating: 4, body: "Example review. A new opener could follow it.", createdAt: "2026-05-10T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111128",
  },
  {
    slug: NDIS_EXAMPLE_SLUG,
    name: NDIS_EXAMPLE_NAME,
    category: "research",
    pitch: NDIS_EXAMPLE_PITCH,
    description: "Example data. A specialist desk for an accounting firm whose client is an NDIS provider. The lender names are Example Lender A, B, and C. This is not a credit offer.",
    instructions: "Example data. Apply the specialist checks in the package. Do not invent a lender, a rate, or a measurement. Leave a missing document blank.",
    priceMinor: 49000,
    exampleRuns: 0,
    featured: false,
    createdAt: "2025-11-01T00:00:00.000Z",
    output: { title: "Example funding note", body: "Example data: replace with your panel. The note ranks structures that passed the hard rules. Indicative, not a credit offer." },
    reviews: [],
    agentVersionId: "11111111-1111-4111-8111-111111111130",
  },
];

const HOSPITAL_REVIEWS: PublicReview[] = [
  {
    id: "example-review-beds-1",
    buyerName: "Example buyer",
    rating: 5,
    body: "Example review. The matrix left the missing certificate visible.",
    createdAt: "2026-01-15T00:00:00.000Z",
    example: true,
  },
  {
    id: "example-review-beds-2",
    buyerName: "Example buyer",
    rating: 4,
    body: "Example review. Useful as a sample of cited gaps, not a real bid.",
    createdAt: "2026-02-02T00:00:00.000Z",
    example: true,
  },
];

export function tiersForPrice(priceMinor: number): Tier[] {
  const verified = Math.max(priceMinor + 100, Math.round(priceMinor * 1.25));
  const led = Math.max(verified + 100, Math.round(priceMinor * 1.8));
  const reviewVerified = Math.min(verified - 1, Math.max(0, Math.round(verified * 0.15)));
  const reviewLed = Math.min(led - 1, Math.max(0, Math.round(led * 0.25)));
  return [
    { serviceLevel: "autonomous", currency: "USD", priceMinor, platformFeeBps: 2000, creatorRoyaltyBps: 8000, reviewFeeMinor: 0, deliveryDays: 2, includedRevisions: 1, cancellationCode: "before_draft_full_refund", payoutRelease: "on_acceptance" },
    { serviceLevel: "expert_verified", currency: "USD", priceMinor: verified, platformFeeBps: 1500, creatorRoyaltyBps: 8500, reviewFeeMinor: reviewVerified, deliveryDays: 5, includedRevisions: 2, cancellationCode: "before_draft_full_refund", payoutRelease: "after_dispute_window" },
    { serviceLevel: "expert_led", currency: "USD", priceMinor: led, platformFeeBps: 1000, creatorRoyaltyBps: 9000, reviewFeeMinor: reviewLed, deliveryDays: 10, includedRevisions: 4, cancellationCode: "before_draft_full_refund", payoutRelease: "after_dispute_window" },
  ];
}

const OFF_REVIEW: ExpertReviewConfig = { enabled: false, priceMinor: 0, slaHours: 48 };

function cleanExpertReview(basePrice: number, review: ExpertReviewConfig | undefined): ExpertReviewConfig {
  if (!review?.enabled) return OFF_REVIEW;
  const slaHours = review.slaHours === 24 || review.slaHours === 72 ? review.slaHours : 48;
  const asked = Number.isSafeInteger(review.priceMinor) && review.priceMinor > 0 ? Math.min(review.priceMinor, 500_000) : 0;
  const anchor = basePrice >= 500 ? basePrice : 500;
  const tier = expertReviewTier(anchor, { enabled: true, priceMinor: asked, slaHours });
  if (!tier) return OFF_REVIEW;
  return { enabled: true, priceMinor: tier.priceMinor, slaHours: tier.slaHours ?? slaHours };
}

export function expertReviewTier(priceMinor: number, review: ExpertReviewConfig): Tier | null {
  if (!review.enabled) return null;
  const led = Math.max(priceMinor + 100, Math.round(priceMinor * 1.8));
  const floor = led + 100;
  const asked = review.priceMinor >= floor ? review.priceMinor : Math.round(led * 1.35);
  const price = Math.min(500_000, Math.max(floor, asked));
  const slaHours = review.slaHours === 24 || review.slaHours === 72 ? review.slaHours : 48;
  const reviewFee = Math.min(price - 1, Math.max(0, Math.round(price * 0.3)));
  return {
    serviceLevel: "expert_review",
    currency: "USD",
    priceMinor: price,
    platformFeeBps: 1000,
    creatorRoyaltyBps: 9000,
    reviewFeeMinor: reviewFee,
    deliveryDays: Math.max(1, Math.ceil(slaHours / 24)),
    includedRevisions: 1,
    cancellationCode: "before_draft_full_refund",
    payoutRelease: "after_dispute_window",
    slaHours,
  };
}

export function tiersForAgent(priceMinor: number, review: ExpertReviewConfig = OFF_REVIEW): Tier[] {
  const tiers = priceMinor >= 500 ? tiersForPrice(priceMinor) : [];
  const extra = expertReviewTier(priceMinor, review);
  return extra ? tiers.concat(extra) : tiers;
}

function blankTrust(example: boolean) {
  return {
    assets: [] as KnowledgeAsset[],
    interview: [] as InterviewAnswer[],
    trainingConsent: false,
    expertReview: OFF_REVIEW,
    proof: null as PublicProof | null,
    knowledgeCounts: [] as { kind: AssetKind; count: number }[],
    interviewCount: 0,
    track: emptyTrack(example),
    experience: "",
    links: [] as { label: string; href: string }[],
    credentials: [] as PublicCredential[],
    initials: example ? "EX" : "?",
    photoDataUrl: "",
  };
}

function studioFlags(agent: AgentRecord): { hasStudio: boolean; examplePanel: boolean } {
  const studio = agent.studio;
  if (!studio || typeof studio.publishedVersion !== "number") return { hasStudio: false, examplePanel: false };
  const version = studio.versions.find((item) => item.number === studio.publishedVersion);
  return { hasStudio: true, examplePanel: version?.config.exampleData === true };
}

function average(reviews: { rating: number }[]): { average: number | null; count: number } {
  if (reviews.length === 0) {
    return { average: null, count: 0 };
  }
  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return { average: Math.round((total / reviews.length) * 10) / 10, count: reviews.length };
}

function listingFrom(input: {
  slug: string;
  name: string;
  pitch: string;
  vertical: string;
  tiers: Tier[];
  agentVersionId: string;
  expertStatus: "verified" | "pending";
  instructions: string;
  knowledge: KnowledgeNote[];
  assets?: Listing["assets"];
  sellerId: string;
}): Listing {
  return {
    slug: input.slug,
    vertical: input.vertical,
    title: input.name,
    summary: input.pitch,
    expertStatus: input.expertStatus,
    certificationClaimed: false,
    model: "fixture",
    agentVersionId: input.agentVersionId,
    tiers: input.tiers,
    instructions: input.instructions,
    knowledge: input.knowledge,
    assets: input.assets,
    sellerId: input.sellerId,
  };
}

function exampleReviews(agent: ExampleAgent): PublicReview[] {
  return agent.reviews.map((review, index) => ({
    id: `example-review-${agent.slug}-${index}`,
    buyerName: "Example buyer",
    rating: review.rating,
    body: review.body,
    createdAt: review.createdAt,
    example: true,
  }));
}

function withRatings(item: Omit<CatalogItem, "ratingAverage" | "ratingCount" | "ratingExample">, example: boolean): CatalogItem {
  const live = item.reviews.filter((review) => !review.example);
  const sample = item.reviews.filter((review) => review.example);
  const chosen = live.length > 0 ? live : sample;
  const rating = average(chosen);
  return { ...item, ratingAverage: rating.average, ratingCount: rating.count, ratingExample: live.length === 0 && example && rating.count > 0 };
}

export function buildCatalog(db: MarketplaceDb = emptyDb()): CatalogItem[] {
  const items: CatalogItem[] = [];
  const hospital = listingBySlug("hospital-beds");
  if (hospital) {
    const status = db.overrides["hospital-beds"] ?? "published";
    items.push(withRatings({
      slug: hospital.slug,
      name: hospital.title,
      pitch: hospital.summary,
      description: "Example tender pack. A sourced bid draft that leaves a missing certificate as missing evidence. This is not a live procurement offer.",
      category: "tenders",
      instructions: "Use only the sample notes. Cite a source for every claim. Leave gaps empty.",
      knowledge: [],
      exampleOutputs: [{ title: "Sample draft", body: "Example output only. A supported claim can cite 950 mm from the sample notes. A requirement with no certificate stays missing evidence." }],
      sellerId: EXAMPLE_SELLER_ID,
      sellerName: EXAMPLE_SELLER_NAME,
      sellerBio: EXAMPLE_SELLER_BIO,
      ownerId: EXAMPLE_SELLER_ID,
      example: true,
      featured: true,
      status,
      priceMinor: Math.min(...hospital.tiers.map((tier) => tier.priceMinor)),
      currency: "USD",
      tiers: hospital.tiers,
      runs: 24,
      runsExample: true,
      createdAt: "2025-11-01T00:00:00.000Z",
      listing: { ...hospital, sellerId: EXAMPLE_SELLER_ID, instructions: "Use only the sample notes. Cite a source for every claim. Leave gaps empty." },
      reviews: HOSPITAL_REVIEWS,
      ...blankTrust(true),
    }, true));
  }
  for (const agent of EXAMPLES) {
    const status = db.overrides[agent.slug] ?? "published";
    const reviews = exampleReviews(agent);
    const tiers = tiersForPrice(agent.priceMinor);
    items.push(withRatings({
      slug: agent.slug,
      name: agent.name,
      pitch: agent.pitch,
      description: agent.description,
      category: agent.category,
      instructions: agent.instructions,
      knowledge: [],
      exampleOutputs: [agent.output],
      sellerId: EXAMPLE_SELLER_ID,
      sellerName: EXAMPLE_SELLER_NAME,
      sellerBio: EXAMPLE_SELLER_BIO,
      ownerId: EXAMPLE_SELLER_ID,
      example: true,
      featured: agent.featured,
      status,
      priceMinor: agent.priceMinor,
      currency: "USD",
      tiers,
      runs: agent.exampleRuns,
      runsExample: true,
      createdAt: agent.createdAt,
      listing: listingFrom({
        slug: agent.slug,
        name: agent.name,
        pitch: agent.pitch,
        vertical: agent.category,
        tiers,
        agentVersionId: agent.agentVersionId,
        expertStatus: "pending",
        instructions: agent.instructions,
        knowledge: [],
        sellerId: EXAMPLE_SELLER_ID,
      }),
      reviews,
      ...blankTrust(true),
      hasStudio: agent.slug === NDIS_EXAMPLE_SLUG,
      examplePanel: agent.slug === NDIS_EXAMPLE_SLUG,
      proof: db.exampleProofs?.[agent.slug] ? toPublicProof(db.exampleProofs[agent.slug], true) : null,
    }, true));
  }
  for (const agent of db.agents) {
    const seller = db.users.find((user) => user.id === agent.ownerId);
    const reviews = db.reviews
      .filter((review) => review.agentSlug === agent.slug)
      .map((review) => ({ ...review, example: false }));
    const expertReview = agent.expertReview ?? OFF_REVIEW;
    const tiers = tiersForAgent(agent.priceMinor, expertReview);
    const status = db.overrides[agent.slug] ?? agent.status;
    const assets = agent.assets ?? [];
    const interview = agent.interview ?? [];
    items.push(withRatings({
      slug: agent.slug,
      name: agent.name,
      pitch: agent.pitch,
      description: agent.description,
      category: agent.category,
      instructions: agent.instructions,
      knowledge: agent.knowledge,
      exampleOutputs: agent.exampleOutputs,
      sellerId: agent.ownerId,
      sellerName: seller?.name ?? "Seller",
      sellerBio: seller?.bio ?? "",
      ownerId: agent.ownerId,
      example: false,
      featured: false,
      status,
      priceMinor: agent.priceMinor,
      currency: "USD",
      tiers,
      runs: 0,
      runsExample: false,
      createdAt: agent.publishedAt ?? agent.createdAt,
      listing: listingFrom({
        slug: agent.slug,
        name: agent.name,
        pitch: agent.pitch,
        vertical: agent.category,
        tiers,
        agentVersionId: agent.id,
        expertStatus: "pending",
        instructions: agent.instructions,
        knowledge: agent.knowledge,
        assets,
        sellerId: agent.ownerId,
      }),
      reviews,
      assets,
      interview,
      trainingConsent: agent.trainingConsent === true,
      expertReview,
      proof: agent.proof ? toPublicProof(agent.proof) : null,
      knowledgeCounts: knowledgeCounts(assets),
      interviewCount: interviewCount(interview),
      track: emptyTrack(false),
      experience: seller?.experience ?? "",
      links: safeLinks(seller?.links ?? []),
      credentials: publicCredentials(seller?.credentials ?? []),
      initials: initials(seller?.name ?? "Seller"),
      photoDataUrl: seller?.photoDataUrl ?? "",
      ...studioFlags(agent),
    }, false));
  }
  return items;
}

export function applyRunCounts(items: CatalogItem[], live: Record<string, number>): CatalogItem[] {
  return items.map((item) => {
    const count = live[item.slug] ?? 0;
    if (count > 0) {
      return { ...item, runs: count, runsExample: false };
    }
    return item;
  });
}

export function attachTrack(items: CatalogItem[], jobs: Parameters<typeof trackFromJobs>[0]): CatalogItem[] {
  return items.map((item) => ({
    ...item,
    track: trackFromJobs(jobs, item.slug, item.reviews, item.example),
  }));
}

export async function getCatalog(): Promise<CatalogItem[]> {
  return buildCatalog(await readDb());
}

export async function publishedListing(slug: string): Promise<Listing | undefined> {
  const item = buildCatalog(await readDb()).find((entry) => entry.slug === slug && entry.status === "published");
  return item?.listing;
}

export function findItem(items: CatalogItem[], slug: string, viewerId?: string | null, admin = false): CatalogItem | undefined {
  const item = items.find((entry) => entry.slug === slug);
  if (!item) {
    return undefined;
  }
  if (item.status === "published" || admin || (viewerId && item.ownerId === viewerId)) {
    return item;
  }
  return undefined;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => (word.endsWith("s") && word.length > 4 ? word.slice(0, -1) : word))
    .filter((word) => word.length > 1 && !STOP.has(word));
}

export function scoreMatch(query: string, item: Pick<CatalogItem, "name" | "pitch" | "category" | "description" | "instructions">): number {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) {
    return 0;
  }
  const fields = [
    { text: item.name, weight: 4 },
    { text: categoryLabel(item.category), weight: 3 },
    { text: item.category, weight: 3 },
    { text: item.pitch, weight: 2 },
    { text: item.description, weight: 2 },
    { text: item.instructions, weight: 1 },
  ];
  let score = 0;
  for (const token of queryTokens) {
    for (const field of fields) {
      if (tokens(field.text).includes(token)) {
        score += field.weight;
      }
    }
  }
  const haystack = `${item.name} ${item.pitch} ${item.description}`.toLowerCase();
  if (query.trim().length > 3 && haystack.includes(query.trim().toLowerCase())) {
    score += 3;
  }
  return score;
}

export function matchReason(query: string, item: CatalogItem): string {
  const words = [...new Set(tokens(query).filter((word) => tokens(`${item.name} ${item.pitch} ${item.category} ${categoryLabel(item.category)} ${item.description} ${item.instructions}`).includes(word)))];
  if (words.length === 0) {
    return "Listed in this marketplace.";
  }
  return `Matched ${words.slice(0, 4).join(", ")}`;
}

export type BrowseSort = "recommended" | "newest" | "price_asc" | "price_desc" | "rating" | "runs";

export type BrowseQuery = {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  sort?: BrowseSort;
  page?: number;
};

export type Page<T> = { items: T[]; page: number; pages: number; total: number };

const SORTS = new Set<BrowseSort>(["recommended", "newest", "price_asc", "price_desc", "rating", "runs"]);

export function parseBrowseQuery(input: Record<string, string | undefined>): BrowseQuery & { priceError: boolean } {
  const query: BrowseQuery & { priceError: boolean } = { priceError: false };
  const q = (input.q ?? "").trim();
  if (q) {
    query.q = q.slice(0, 500);
  }
  if (input.category && isCategory(input.category)) {
    query.category = input.category;
  }
  if (input.sort && SORTS.has(input.sort as BrowseSort)) {
    query.sort = input.sort as BrowseSort;
  }
  const page = Number(input.page ?? "1");
  query.page = Number.isInteger(page) && page > 0 ? Math.min(page, 100) : 1;
  const rating = Number(input.minRating ?? "0");
  if (rating === 3 || rating === 4) {
    query.minRating = rating;
  }
  for (const [key, target] of [["minPrice", "minPrice"], ["maxPrice", "maxPrice"]] as const) {
    const raw = (input[key] ?? "").trim();
    if (!raw) {
      continue;
    }
    try {
      const minor = Number(parseAmountToMinor(raw, 2));
      query[target] = minor;
    } catch {
      query.priceError = true;
    }
  }
  return query;
}

export function browseCatalog(items: CatalogItem[], query: BrowseQuery, pageSize = 6): Page<CatalogItem> {
  let rows = items.filter((item) => item.status === "published");
  if (query.category) {
    rows = rows.filter((item) => item.category === query.category);
  }
  if (query.minPrice != null) {
    rows = rows.filter((item) => item.priceMinor >= (query.minPrice ?? 0));
  }
  if (query.maxPrice != null) {
    rows = rows.filter((item) => item.priceMinor <= (query.maxPrice ?? 0));
  }
  if (query.minRating != null && query.minRating > 0) {
    rows = rows.filter((item) => (item.ratingAverage ?? 0) >= (query.minRating ?? 0));
  }
  const scored = (query.q ? rows.map((item) => ({ item, score: scoreMatch(query.q ?? "", item) })).filter((row) => row.score > 0) : rows.map((item) => ({ item, score: 0 })));
  const sort = query.sort ?? (query.q ? "recommended" : "newest");
  scored.sort((left, right) => {
    if (sort === "price_asc") return left.item.priceMinor - right.item.priceMinor;
    if (sort === "price_desc") return right.item.priceMinor - left.item.priceMinor;
    if (sort === "rating") return (right.item.ratingAverage ?? -1) - (left.item.ratingAverage ?? -1);
    if (sort === "runs") return right.item.runs - left.item.runs;
    if (sort === "recommended") {
      const group = proofGroup(right.item.proof) - proofGroup(left.item.proof);
      if (group !== 0) return group;
      const leftRank = left.score * proofWeight(left.item.proof) * trackWeight(left.item.track);
      const rightRank = right.score * proofWeight(right.item.proof) * trackWeight(right.item.track);
      if (rightRank !== leftRank) return rightRank - leftRank;
      if (left.item.featured !== right.item.featured) return left.item.featured ? -1 : 1;
      return right.item.createdAt.localeCompare(left.item.createdAt);
    }
    return right.item.createdAt.localeCompare(left.item.createdAt);
  });
  const total = scored.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const start = (page - 1) * pageSize;
  return { items: scored.slice(start, start + pageSize).map((row) => row.item), page, pages, total };
}

export function recommend(need: string, items: CatalogItem[]): { item: CatalogItem; score: number; reason: string }[] {
  return items
    .filter((item) => item.status === "published")
    .map((item) => ({ item, score: scoreMatch(need, item), reason: matchReason(need, item) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => {
      const group = proofGroup(right.item.proof) - proofGroup(left.item.proof);
      if (group !== 0) return group;
      const leftRank = left.score * proofWeight(left.item.proof) * trackWeight(left.item.track);
      const rightRank = right.score * proofWeight(right.item.proof) * trackWeight(right.item.track);
      return rightRank - leftRank || right.item.runs - left.item.runs;
    });
}

export function sandboxReply(input: { name: string; instructions: string; knowledge: string; need: string }): string[] {
  const text = `${input.name} ${input.need}`.toLowerCase();
  const load = `${input.need} ${input.knowledge}`.match(/\bLC\d+\b/i)?.[0]?.toUpperCase();
  if (/scope|assumption|out of scope|out-of-scope/.test(text)) {
    return [
      "In scope",
      "One written note that turns the request into a job, a list of assumptions, and a list of what is not included.",
      "Assumptions",
      "One reviewer. The request you pasted is the whole brief.",
      "Out of scope",
      "Visual design, and any price or timeline that was not in the request.",
    ];
  }
  if (/soccer|practice plan|youth sport|park practice/.test(text)) {
    return [
      "One hour at the park",
      "0:00 Warm-up. Jog the sideline, then ten easy passes in pairs.",
      "0:15 Game. Two small goals. First team to five. Everyone must touch the ball.",
      "0:45 Cool-down. Walk the field and stretch calves.",
      "Bring one ball and two cones. No league rule was added.",
    ];
  }
  if (/draw|dimension|clash|engineer|load case|bridge|load checker/.test(text)) {
    return [
      "Missing from the brief",
      "The grid spacing has no unit.",
      load ? `${load} is named, but the load combination is not given.` : "The clash is named, but no clearance is given.",
      "No measurement was added. Ask for the unit and the missing combination before anyone builds from this sheet.",
    ];
  }
  if (/book|receipt|close the books|monthly close|sales tax|payday|payroll/.test(text)) {
    return [
      "Still needs a receipt",
      "1. Fuel card, last Tuesday.",
      "2. The market run on Friday.",
      "3. The repair that was paid in cash.",
      "Ask who bought the fuel, and whether the cash repair is for the shop or for home. Do not close those three until the receipts are in the folder. No total was calculated.",
    ];
  }
  if (/checklist|onboarding|operations|teammate|technician|opening|shop/.test(text)) {
    return [
      "1. Confirm who owns the task today.",
      "2. Write each step in the order a new person would do it.",
      "3. Mark the step that needs a person to say it is done.",
      "4. Leave a note of where the source system is, without logging in.",
      "5. Hand the list to the teammate and ask them to read it back.",
      "No system was queried.",
    ];
  }
  if (/review/.test(text)) {
    return [
      "Thanks for telling us about the wait on Saturday.",
      "That is on us. If you write to the shop with the time you came in, we will make the next visit the one we owed you.",
      "We are not promising a refund in this note.",
    ];
  }
  if (/late/.test(text)) {
    return [
      "Hi,",
      "The install is running late, and I am sorry for the change.",
      "If the day we last agreed no longer works, reply and we will pick another. I have not put a new date in this note.",
    ];
  }
  if (/refund/.test(text)) {
    return [
      "Hi,",
      "The deposit comes back the way you paid it.",
      "I do not have an amount in front of me, so I have not written one. Reply if you need the date it should appear.",
    ];
  }
  if (/quote|follow-up|follow up/.test(text)) {
    return [
      "Hi,",
      "Checking whether the kitchen quote still fits this month.",
      "One question: is the scope the same as the note I sent? I have not added a discount.",
    ];
  }
  return [
    "Hi,",
    "Thanks for writing about the catering order. I have your note, and I do not yet have the date or the headcount.",
    "Next step: reply with the event date and how many people, and I will confirm the deposit in the same thread.",
    "I will not guess an amount or an order number.",
    "Best,",
  ];
}

export type SkillDraft = {
  name: string;
  pitch: string;
  description: string;
  category: CategoryCode;
  instructions: string;
  exampleTitle: string;
  exampleBody: string;
  priceRaw: string;
  priceMinor: number;
};

function clip(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return cleaned.slice(0, max).trim();
}

export function draftFromSkill(skillRaw: string): SkillDraft | null {
  const skill = skillRaw.replace(/\s+/g, " ").trim();
  if (skill.length < 12 || skill.length > 500) {
    return null;
  }
  const guessed = guessSkill(skill);
  const pitch = clip(`Buyers get a draft for this: ${skill}`, 180);
  return {
    name: clip(skill, 80),
    pitch,
    description: clip(`${skill} The draft uses only what the buyer writes and does not invent facts.`, 500),
    category: guessed.category,
    instructions: `Use only what the buyer wrote. Skill: ${skill} Do not invent facts, numbers, prices, or sources.`,
    exampleTitle: "Sample draft",
    exampleBody: clip(sandboxReply({ name: clip(skill, 80), instructions: skill, knowledge: "", need: skill }).join("\n\n"), 2000),
    priceRaw: guessed.priceRaw,
    priceMinor: Number(guessed.priceRaw) * 100,
  };
}

function guessSkill(skill: string): { category: CategoryCode; priceRaw: string } {
  const text = skill.toLowerCase();
  if (/soccer|practice plan|youth sport/.test(text)) return { category: "writing", priceRaw: "20" };
  if (/bookkeep|invoice|expense|closing the books|close the books|receipt/.test(text)) return { category: "operations", priceRaw: "35" };
  if (/drawing|dimension|engineer|clash|structural|load case/.test(text)) return { category: "engineering", priceRaw: "45" };
  if (/support reply|customer reply|\breply\b/.test(text)) return { category: "support", priceRaw: "15" };
  if (/clause|contract|legal/.test(text)) return { category: "legal", priceRaw: "60" };
  if (/checklist|onboarding|operations/.test(text)) return { category: "operations", priceRaw: "35" };
  if (/research|citation/.test(text)) return { category: "research", priceRaw: "40" };
  if (/interface|screen|design/.test(text)) return { category: "design", priceRaw: "35" };
  return { category: "writing", priceRaw: "25" };
}

export function parsePriceDollars(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const minor = parseAmountToMinor(trimmed, 2);
    if (minor < 500n || minor > 500_000n) {
      return null;
    }
    return Number(minor);
  } catch {
    return null;
  }
}

export type AgentInput = {
  name: string;
  pitch: string;
  description: string;
  category: string;
  instructions: string;
  knowledge: KnowledgeNote[];
  assets?: KnowledgeAsset[];
  interview?: InterviewAnswer[];
  trainingConsent?: boolean;
  expertReview?: ExpertReviewConfig;
  exampleTitle: string;
  exampleBody: string;
  priceRaw: string;
};

export function validateAgent(input: AgentInput, intent: "draft" | "publish"): { ok: true; value: Omit<AgentInput, "priceRaw"> & { priceMinor: number } } | { ok: false; error: string } {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "name" };
  }
  const pitch = input.pitch.trim();
  const description = input.description.trim();
  const instructions = input.instructions.trim();
  const exampleTitle = input.exampleTitle.trim();
  const exampleBody = input.exampleBody.trim();
  if (pitch.length > 180 || description.length > 4000 || instructions.length > 8000 || exampleTitle.length > 80 || exampleBody.length > 2000) {
    return { ok: false, error: "length" };
  }
  if (input.knowledge.some((note) => note.text.length > 60_000)) {
    return { ok: false, error: "knowledge" };
  }
  const assets = (input.assets ?? []).filter((asset) => asset.text.trim().length > 0).slice(0, 8);
  if (assets.some((asset) => asset.text.length > 60_000)) {
    return { ok: false, error: "knowledge" };
  }
  const interview = cleanInterview(input.interview ?? []);
  const priceMinor = input.priceRaw.trim() ? parsePriceDollars(input.priceRaw) : 0;
  if (input.priceRaw.trim() && priceMinor == null) {
    return { ok: false, error: "price" };
  }
  if (intent === "publish") {
    if (!isCategory(input.category)) return { ok: false, error: "category" };
    if (pitch.length < 8) return { ok: false, error: "pitch" };
    if (description.length < 8) return { ok: false, error: "description" };
    if (instructions.length < 20) return { ok: false, error: "instructions" };
    if (exampleTitle.length < 2 || exampleBody.length < 8) return { ok: false, error: "output" };
    if (!priceMinor) return { ok: false, error: "price" };
    if (!publishInterviewReady(interview)) return { ok: false, error: "interview" };
  }
  return {
    ok: true,
    value: {
      name,
      pitch,
      description,
      category: isCategory(input.category) ? input.category : "writing",
      instructions,
      knowledge: input.knowledge,
      assets,
      interview,
      trainingConsent: input.trainingConsent === true,
      expertReview: cleanExpertReview(priceMinor ?? 0, input.expertReview),
      exampleTitle,
      exampleBody,
      priceMinor: priceMinor ?? 0,
    },
  };
}

export function listingSlugFromName(name: string, taken: Set<string> = new Set()): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  let slug = `${base || "agent"}-${randomBytes(3).toString("hex")}`;
  while (taken.has(slug)) {
    slug = `${base || "agent"}-${randomBytes(3).toString("hex")}`;
  }
  return slug;
}

function slugify(name: string, taken: Set<string>): string {
  return listingSlugFromName(name, taken);
}

function takenSlugs(db: MarketplaceDb): Set<string> {
  return new Set(["hospital-beds", "new", "dashboard", ...EXAMPLES.map((agent) => agent.slug), ...db.agents.map((agent) => agent.slug)]);
}

function applySellerMaterial(agent: AgentRecord, value: { assets?: KnowledgeAsset[]; interview?: InterviewAnswer[]; trainingConsent?: boolean; expertReview?: ExpertReviewConfig }): void {
  agent.assets = value.assets ?? [];
  agent.interview = value.interview ?? [];
  agent.trainingConsent = value.trainingConsent === true;
  agent.expertReview = value.expertReview ?? OFF_REVIEW;
}

function queueProof(agent: AgentRecord, now: string): void {
  const examples = agent.exampleOutputs;
  const hash = contentHash({
    category: agent.category,
    instructions: agent.instructions,
    assets: agent.assets ?? [],
    interview: agent.interview ?? [],
    examples,
  });
  const changed = hash !== agent.contentHash;
  agent.version = changed ? (agent.version ?? 0) + 1 : (agent.version ?? 1);
  agent.contentHash = hash;
  if (
    !changed
    && agent.proof?.status === "complete"
    && agent.proof.fixture === false
    && agent.proof.proven === true
    && agent.proof.sourceHash === hash
    && (agent.proof.tests ?? 0) >= 10
    && agent.proof.winRate >= 0.7
  ) {
    return;
  }
  const proof: ProofRecord = {
    id: randomUUID(),
    version: agent.version,
    status: "queued",
    startedAt: now,
    finishedAt: null,
    model: "pending",
    judgeModel: "pending",
    fixture: true,
    tests: 0,
    wins: 0,
    ties: 0,
    losses: 0,
    winRate: 0,
    proven: false,
    rubric: [],
    examples: [],
    costMinor: 0,
    capped: false,
    sourceHash: hash,
  };
  agent.proof = proof;
}

export async function saveAgent(ownerId: string, input: AgentInput, intent: "draft" | "publish" | "unpublish", slug?: string): Promise<{ ok: true; slug: string; proofQueued: boolean } | { ok: false; error: string }> {
  const validated = validateAgent(input, intent === "publish" ? "publish" : "draft");
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const now = new Date().toISOString();
  const outputs = value.exampleTitle && value.exampleBody ? [{ title: value.exampleTitle, body: value.exampleBody }] : [];
  try {
    const saved = await updateDb((db) => {
      const existing = slug ? db.agents.find((agent) => agent.slug === slug && agent.ownerId === ownerId) : undefined;
      if (slug && !existing) {
        return null;
      }
      if (existing) {
        if (intent === "publish" && db.overrides[existing.slug]) {
          return "suspended" as const;
        }
        existing.name = value.name;
        existing.pitch = value.pitch;
        existing.description = value.description;
        existing.category = value.category;
        existing.instructions = value.instructions;
        existing.knowledge = value.knowledge;
        applySellerMaterial(existing, value);
        existing.exampleOutputs = outputs.length > 0 ? outputs : existing.exampleOutputs;
        existing.priceMinor = value.priceMinor || existing.priceMinor;
        existing.updatedAt = now;
        if (intent === "publish") {
          existing.status = "published";
          existing.publishedAt = existing.publishedAt ?? now;
          queueProof(existing, now);
        } else if (intent === "unpublish" && !db.overrides[existing.slug]) {
          existing.status = "draft";
          existing.publishedAt = null;
        }
        return { slug: existing.slug, proofQueued: intent === "publish" };
      }
      const created: AgentRecord = {
        id: randomUUID(),
        slug: slugify(value.name, takenSlugs(db)),
        ownerId,
        name: value.name,
        pitch: value.pitch,
        description: value.description,
        category: value.category,
        instructions: value.instructions,
        knowledge: value.knowledge,
        exampleOutputs: outputs,
        priceMinor: value.priceMinor,
        currency: "USD",
        status: intent === "publish" ? "published" : "draft",
        createdAt: now,
        updatedAt: now,
        publishedAt: intent === "publish" ? now : null,
      };
      applySellerMaterial(created, value);
      if (intent === "publish") queueProof(created, now);
      db.agents.push(created);
      return { slug: created.slug, proofQueued: intent === "publish" };
    });
    if (saved === "suspended") {
      return { ok: false, error: "suspended" };
    }
    if (!saved) {
      return { ok: false, error: "missing" };
    }
    return { ok: true, slug: saved.slug, proofQueued: saved.proofQueued };
  } catch {
    return { ok: false, error: "store" };
  }
}

export async function moderateListing(slug: string, action: "suspend" | "restore" | "reject"): Promise<boolean> {
  if (!isListingSlug(slug)) {
    return false;
  }
  const known = slug === "hospital-beds" || EXAMPLES.some((agent) => agent.slug === slug);
  return updateDb((db) => {
    const agent = db.agents.find((item) => item.slug === slug);
    if (!agent && !known) {
      return false;
    }
    if (action === "restore") {
      delete db.overrides[slug];
      if (agent) {
        agent.status = "published";
        agent.publishedAt = agent.publishedAt ?? new Date().toISOString();
      }
      return true;
    }
    const status = action === "suspend" ? "suspended" : "rejected";
    db.overrides[slug] = status;
    if (agent) {
      agent.status = status;
    }
    return true;
  });
}

export async function addReview(input: { agentSlug: string; jobId: string; buyerId: string; buyerName: string; rating: number; body: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = input.body.trim();
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: "rating" };
  }
  if (body.length < 2 || body.length > 1000) {
    return { ok: false, error: "body" };
  }
  const result = await updateDb((db) => {
    if (db.reviews.some((review) => review.jobId === input.jobId)) {
      return "once" as const;
    }
    const review: ReviewRecord = {
      id: randomUUID(),
      agentSlug: input.agentSlug,
      jobId: input.jobId,
      buyerId: input.buyerId,
      buyerName: input.buyerName,
      rating: input.rating,
      body,
      createdAt: new Date().toISOString(),
    };
    db.reviews.push(review);
    return "ok" as const;
  });
  return result === "ok" ? { ok: true } : { ok: false, error: result };
}

export async function saveSearch(ownerId: string, name: string, need: string): Promise<void> {
  const trimmed = need.trim();
  if (trimmed.length < 3) {
    return;
  }
  await updateDb((db) => {
    db.searches.push({
      id: randomUUID(),
      ownerId,
      name: name.trim().slice(0, 80) || trimmed.slice(0, 60),
      need: trimmed.slice(0, 500),
      createdAt: new Date().toISOString(),
    });
    const mine = db.searches.filter((item) => item.ownerId === ownerId).slice(-20);
    const others = db.searches.filter((item) => item.ownerId !== ownerId);
    db.searches = others.concat(mine);
  });
}

export async function searchesFor(ownerId: string) {
  const db = await readDb();
  return db.searches.filter((item) => item.ownerId === ownerId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

const LISTING_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isListingSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 80 && LISTING_SLUG.test(slug);
}

export function acceptedEarnings(jobs: { sellerId?: string; listingSlug: string; status: string; creatorRoyaltyMinor: number; refunded?: boolean }[], sellerId: string, slugs: string[]): number {
  return jobs
    .filter((job) => job.status === "accepted" && job.refunded !== true && job.sellerId === sellerId && slugs.includes(job.listingSlug))
    .reduce((sum, job) => sum + job.creatorRoyaltyMinor, 0);
}
