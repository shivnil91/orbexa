import { readFileSync } from "node:fs";
import path from "node:path";

export type ServiceLevel = "autonomous" | "expert_verified" | "expert_led";

export type IntakeSchema = {
  type: "object";
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, { type?: string; enum?: string[]; minLength?: number }>;
};

export type Tier = {
  serviceLevel: ServiceLevel;
  currency: string;
  priceMinor: number;
  platformFeeBps: number;
  creatorRoyaltyBps: number;
  reviewFeeMinor: number;
  deliveryDays: number;
  includedRevisions: number;
  cancellationCode: string;
  payoutRelease: "on_acceptance" | "after_dispute_window";
};

export type Listing = {
  slug: string;
  vertical: string;
  title: string;
  summary: string;
  expertStatus: "verified" | "pending";
  certificationClaimed: false;
  model: "fixture";
  agentVersionId: string;
  tiers: Tier[];
};

export type VerticalPack = {
  code: string;
  intakeSchema: IntakeSchema;
  workflow: string[];
  rubric: string[];
  deliverableTypes: { code: string; role: "intake" | "deliverable"; accept: string }[];
};

export type DemoRun = {
  model: "fixture";
  certificationClaimed: false;
  stages: string[];
  requirements: { kind: string; body: string; chunk_index: number }[];
  matrix: {
    body: string;
    missing_evidence: boolean;
    response_status: string;
    source?: string;
    chunk_index?: number;
  }[];
  paragraphs: string[];
  claims: {
    body: string;
    support_status: "supported" | "unsupported" | "missing_evidence";
    quote: string;
    source?: string;
    chunk_indexes?: number[];
  }[];
};

const hospitalBeds: Listing = {
  slug: "hospital-beds",
  vertical: "tender_writing",
  title: "Hospital bed response",
  summary: "Draft a sourced bid from authorised supplier notes.",
  expertStatus: "verified",
  certificationClaimed: false,
  model: "fixture",
  agentVersionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  tiers: [
    {
      serviceLevel: "autonomous",
      currency: "USD",
      priceMinor: 80000,
      platformFeeBps: 2000,
      creatorRoyaltyBps: 8000,
      reviewFeeMinor: 0,
      deliveryDays: 2,
      includedRevisions: 1,
      cancellationCode: "before_draft_full_refund",
      payoutRelease: "on_acceptance",
    },
    {
      serviceLevel: "expert_verified",
      currency: "USD",
      priceMinor: 100000,
      platformFeeBps: 1500,
      creatorRoyaltyBps: 8500,
      reviewFeeMinor: 15000,
      deliveryDays: 5,
      includedRevisions: 2,
      cancellationCode: "before_draft_full_refund",
      payoutRelease: "after_dispute_window",
    },
    {
      serviceLevel: "expert_led",
      currency: "USD",
      priceMinor: 180000,
      platformFeeBps: 1000,
      creatorRoyaltyBps: 9000,
      reviewFeeMinor: 60000,
      deliveryDays: 10,
      includedRevisions: 4,
      cancellationCode: "before_draft_full_refund",
      payoutRelease: "after_dispute_window",
    },
  ],
};

const tenderPack: VerticalPack = {
  code: "tender_writing",
  intakeSchema: {
    type: "object",
    additionalProperties: false,
    required: ["opportunity_name"],
    properties: {
      opportunity_name: { type: "string", minLength: 1 },
    },
  },
  workflow: ["extract", "matrix", "draft", "ground"],
  rubric: ["grounded_claim", "missing_evidence"],
  deliverableTypes: [
    { code: "tender_source", role: "intake", accept: ".pdf,.docx" },
    { code: "supplier_info", role: "intake", accept: ".docx" },
    {
      code: "bid_docx",
      role: "deliverable",
      accept: ".docx",
    },
    { code: "bid_xlsx", role: "deliverable", accept: ".xlsx" },
  ],
};

export const listings: Listing[] = [hospitalBeds];
export const packs: Record<string, VerticalPack> = { tender_writing: tenderPack };

export function listingBySlug(slug: string): Listing | undefined {
  return listings.find((item) => item.slug === slug);
}

export function packFor(listing: Listing): VerticalPack {
  const pack = packs[listing.vertical];
  if (!pack) {
    throw new Error(`vertical pack ${listing.vertical} is not loaded`);
  }
  return pack;
}

export function lowestTier(listing: Listing): Tier {
  return [...listing.tiers].sort((left, right) => left.priceMinor - right.priceMinor)[0];
}

let transcript: DemoRun | undefined;

export function transcriptFor(vertical: string): DemoRun | null {
  if (vertical !== "tender_writing") {
    return null;
  }
  if (!transcript) {
    const file = path.join(process.cwd(), "src/data/demo-run.json");
    transcript = JSON.parse(readFileSync(file, "utf8")) as DemoRun;
  }
  return transcript;
}
