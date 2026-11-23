import { randomBytes, randomUUID } from "node:crypto";
import { parseAmountToMinor } from "@orbexa/db/money.ts";
import type { Listing, Tier } from "./catalog.ts";
import { listingBySlug } from "./catalog.ts";
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
    instructions: "List missing dimensions, units, and clashes. Never invent a measurement.",
    priceMinor: 4500,
    exampleRuns: 18,
    featured: true,
    createdAt: "2025-12-01T00:00:00.000Z",
    output: { title: "Example output", body: "Example only. Sheet S-2 has no unit on the grid spacing. No measurement was added." },
    reviews: [
      { rating: 5, body: "Example review. The gaps were listed without invented sizes.", createdAt: "2026-01-08T00:00:00.000Z" },
      { rating: 4, body: "Example review. Clear notes. Not a real project.", createdAt: "2026-02-12T00:00:00.000Z" },
    ],
    agentVersionId: "11111111-1111-4111-8111-111111111111",
  },
  {
    slug: "example-interface-critique",
    name: "Interface critique",
    category: "design",
    pitch: "Review a screen for hierarchy, contrast, and empty states.",
    description: "Example agent for product design feedback. It does not ship a redesign file.",
    instructions: "Comment on hierarchy, contrast, labels, and the empty state. Do not invent brand metrics.",
    priceMinor: 3500,
    exampleRuns: 11,
    featured: false,
    createdAt: "2026-01-04T00:00:00.000Z",
    output: { title: "Example output", body: "Example only. The primary action sits below the fold and the empty state has no next step." },
    reviews: [{ rating: 5, body: "Example review. Useful as a sample critique.", createdAt: "2026-02-01T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111112",
  },
  {
    slug: "example-clause-drafter",
    name: "Clause drafter",
    category: "legal",
    pitch: "Draft a plain-language clause from a short brief.",
    description: "Example agent. It drafts sample clause language. It is not a law firm and this is not legal advice.",
    instructions: "Draft one plain-language clause. State assumptions. Do not claim the text is legal advice.",
    priceMinor: 6000,
    exampleRuns: 9,
    featured: true,
    createdAt: "2026-01-20T00:00:00.000Z",
    output: { title: "Example output", body: "Example only. A sample limitation clause, with a note that a lawyer has not reviewed it." },
    reviews: [{ rating: 4, body: "Example review. The draft is marked as a sample.", createdAt: "2026-03-01T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111113",
  },
  {
    slug: "example-research-brief",
    name: "Research brief",
    category: "research",
    pitch: "Turn a question into a short brief and leave the gaps open.",
    description: "Example agent. It outlines a question, what would need a source, and what is unknown.",
    instructions: "Write a short brief. Separate known points from gaps. Do not invent citations.",
    priceMinor: 4000,
    exampleRuns: 7,
    featured: false,
    createdAt: "2026-02-11T00:00:00.000Z",
    output: { title: "Example output", body: "Example only. Three questions are listed as unanswered. No source was invented." },
    reviews: [{ rating: 4, body: "Example review. Gaps stayed visible.", createdAt: "2026-03-04T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111114",
  },
  {
    slug: "example-ops-checklist",
    name: "Ops checklist",
    category: "operations",
    pitch: "Turn a recurring operations task into a checklist a teammate can run.",
    description: "Example agent for an internal checklist. It does not connect to a live operations tool.",
    instructions: "Write a numbered checklist. Mark any step that needs a human to confirm.",
    priceMinor: 2500,
    exampleRuns: 5,
    featured: false,
    createdAt: "2026-03-02T00:00:00.000Z",
    output: { title: "Example output", body: "Example only. Step 1 is confirm the source system. No system was queried." },
    reviews: [{ rating: 5, body: "Example review. The checklist is easy to follow.", createdAt: "2026-03-20T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111115",
  },
  {
    slug: "example-support-reply",
    name: "Support reply",
    category: "support",
    pitch: "Draft a calm reply that restates the issue and the next step.",
    description: "Example agent for a support draft. It does not send the reply.",
    instructions: "Restate the issue, the next step, and what you do not know yet.",
    priceMinor: 1500,
    exampleRuns: 14,
    featured: false,
    createdAt: "2026-03-18T00:00:00.000Z",
    output: { title: "Example output", body: "Example only. The reply asks for the order number instead of guessing it." },
    reviews: [{ rating: 4, body: "Example review. Tone is calm and it does not invent an order.", createdAt: "2026-04-02T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111116",
  },
  {
    slug: "example-scope-note",
    name: "Scope note",
    category: "writing",
    pitch: "Rewrite a vague request into scope, assumptions, and out-of-scope items.",
    description: "Example writing agent. It clarifies a request. It does not start the work.",
    instructions: "List scope, assumptions, and out-of-scope items in plain language.",
    priceMinor: 3000,
    exampleRuns: 4,
    featured: false,
    createdAt: "2026-04-09T00:00:00.000Z",
    output: { title: "Example output", body: "Example only. Out of scope: visual design. Assumption: one reviewer." },
    reviews: [{ rating: 5, body: "Example review. The out-of-scope list is the useful part.", createdAt: "2026-04-18T00:00:00.000Z" }],
    agentVersionId: "11111111-1111-4111-8111-111111111117",
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
      description: "Example tender-writing pack. The run drafts from fixture notes and leaves a missing certificate as missing evidence. This is not a live procurement offer.",
      category: "tenders",
      instructions: "Use only the fixture notes. Cite a source for every claim. Leave gaps empty.",
      knowledge: [],
      exampleOutputs: [{ title: "Example fixture excerpt", body: "Example output only. A supported claim can cite 950 mm from the fixture notes. A requirement with no certificate stays missing evidence." }],
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
      listing: { ...hospital, sellerId: EXAMPLE_SELLER_ID, instructions: "Use only the fixture notes. Cite a source for every claim. Leave gaps empty." },
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
  const notes = input.knowledge.trim();
  return [
    `Demo fixture for ${input.name.trim() || "this agent"}. This is not a live model response.`,
    `You asked: ${input.need.trim()}`,
    `Instructions used: ${input.instructions.trim() || "No instructions were saved."}`,
    notes ? `Knowledge notes considered: ${notes.slice(0, 500)}` : "No knowledge notes were attached.",
    "Nothing here is a finished professional work product.",
  ];
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
  const expertReview = input.expertReview?.enabled
    ? { enabled: true, priceMinor: input.expertReview.priceMinor, slaHours: input.expertReview.slaHours }
    : OFF_REVIEW;
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
      expertReview,
      exampleTitle,
      exampleBody,
      priceMinor: priceMinor ?? 0,
    },
  };
}

function slugify(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  let slug = `${base || "agent"}-${randomBytes(3).toString("hex")}`;
  while (taken.has(slug)) {
    slug = `${base || "agent"}-${randomBytes(3).toString("hex")}`;
  }
  return slug;
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
    .filter((job) => job.status === "accepted" && job.refunded !== true && (job.sellerId === sellerId || slugs.includes(job.listingSlug)))
    .reduce((sum, job) => sum + job.creatorRoyaltyMinor, 0);
}
