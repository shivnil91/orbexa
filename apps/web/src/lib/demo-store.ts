import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentPackage } from "./package.ts";
import type { StudioRecord } from "./studio-types.ts";

export type Role = "buyer" | "seller" | "both";

export type ConnectState = {
  mode: "simulated" | "stripe_test";
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
};

export type ProfileLink = { label: string; href: string };

export type CredentialStatus = "self_declared" | "verified";

export type CredentialRecord = {
  id: string;
  title: string;
  issuer: string;
  status: CredentialStatus;
};

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  bio: string;
  role: Role;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  connect: ConnectState;
  operator?: boolean;
  experience?: string;
  links?: ProfileLink[];
  credentials?: CredentialRecord[];
  trainingConsent?: boolean;
  photoDataUrl?: string;
  proofRuns?: string[];
};

export type SessionRecord = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
};

export type KnowledgeNote = { name: string; text: string };

export type AssetKind = "template" | "checklist" | "example" | "rule";

export type KnowledgeAsset = {
  id: string;
  kind: AssetKind;
  name: string;
  text: string;
};

export type InterviewAnswer = { questionId: string; answer: string };

export type ExpertReviewConfig = {
  enabled: boolean;
  priceMinor: number;
  slaHours: number;
};

export type ProofTaskSource = "held_out" | "category" | "expert_fact" | "seller_example";

export type ProofExample = {
  task: string;
  source: ProofTaskSource;
  agentOutput: string;
  baselineOutput: string;
  winner: "agent" | "baseline" | "tie";
  agentScore: number;
  baselineScore: number;
};

export type ProofOutcome = {
  task: string;
  source: ProofTaskSource;
  winner: "agent" | "baseline" | "tie";
  flagged?: boolean;
};

export type ProofRecord = {
  id: string;
  version: number;
  status: "queued" | "running" | "complete" | "failed";
  startedAt: string;
  finishedAt: string | null;
  model: string;
  judgeModel: string;
  fixture: boolean;
  tests: number;
  wins: number;
  ties: number;
  losses: number;
  winRate: number;
  proven: boolean;
  categoryTests?: number;
  categoryWins?: number;
  expertTests?: number;
  expertWins?: number;
  judgeUnparsed?: number;
  rubric: { code: string; agent: number; baseline: number }[];
  examples: ProofExample[];
  outcomes?: ProofOutcome[];
  costMinor: number;
  capped: boolean;
  error?: string;
  /** Hash of the seller material this proof was queued against. */
  sourceHash?: string;
};

export type AgentRecord = {
  id: string;
  slug: string;
  ownerId: string;
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
  version?: number;
  contentHash?: string;
  proof?: ProofRecord | null;
  exampleOutputs: { title: string; body: string }[];
  priceMinor: number;
  currency: "USD";
  status: "draft" | "published" | "rejected" | "suspended";
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  studio?: StudioRecord;
  packages?: AgentPackage[];
};

export type ReviewRecord = {
  id: string;
  agentSlug: string;
  jobId: string;
  buyerId: string;
  buyerName: string;
  rating: number;
  body: string;
  createdAt: string;
};

export type SearchRecord = {
  id: string;
  ownerId: string;
  name: string;
  need: string;
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  at: string;
  actorId: string;
  action: "credential_verify" | "refund_approve";
  targetId: string;
  detail: string;
};

export type ClientWorkspaceRecord = {
  clientId: string;
  sellerId: string;
  answers: Record<string, string>;
  docs: { id: string; name: string; text: string }[];
  memory: { at: string; summary: string }[];
};

export type StoredStudioRun = {
  id: string;
  slug: string;
  sellerId: string;
  buyerId: string;
  clientId: string;
  tier: string;
  priceMinor: number;
  answers: Record<string, string>;
  csv: string;
  report: unknown;
  brokerRequested: boolean;
  shareToken: string;
  createdAt: string;
  exampleData: boolean;
};

export type MarketplaceDb = {
  users: UserRecord[];
  sessions: SessionRecord[];
  agents: AgentRecord[];
  reviews: ReviewRecord[];
  searches: SearchRecord[];
  overrides: Record<string, "suspended" | "rejected">;
  audit?: AuditEvent[];
  clients?: ClientWorkspaceRecord[];
  studioRuns?: StoredStudioRun[];
  exampleProofs?: Record<string, ProofRecord>;
  exampleProofRuns?: string[];
};

export function emptyConnect(): ConnectState {
  return { mode: "simulated", accountId: null, chargesEnabled: false, detailsSubmitted: false };
}

export function emptyDb(): MarketplaceDb {
  return { users: [], sessions: [], agents: [], reviews: [], searches: [], overrides: {}, audit: [], clients: [], studioRuns: [], exampleProofs: {}, exampleProofRuns: [] };
}

export function marketplaceDir(): string {
  if (process.env.ORBEXA_DEMO_DIR) {
    return process.env.ORBEXA_DEMO_DIR;
  }
  const jobs = process.env.ORBEXA_JOB_DIR ?? path.join(os.tmpdir(), "orbexa-m5-jobs");
  return path.join(jobs, "marketplace");
}

function dbPath(): string {
  return path.join(marketplaceDir(), "marketplace.json");
}

function normalize(value: unknown): MarketplaceDb {
  const record = value && typeof value === "object" ? (value as Partial<MarketplaceDb>) : {};
  return {
    users: Array.isArray(record.users) ? record.users : [],
    sessions: Array.isArray(record.sessions) ? record.sessions : [],
    agents: Array.isArray(record.agents) ? record.agents : [],
    reviews: Array.isArray(record.reviews) ? record.reviews : [],
    searches: Array.isArray(record.searches) ? record.searches : [],
    overrides: record.overrides && typeof record.overrides === "object" && !Array.isArray(record.overrides) ? record.overrides : {},
    audit: Array.isArray(record.audit) ? record.audit : [],
    clients: Array.isArray(record.clients) ? record.clients : [],
    studioRuns: Array.isArray(record.studioRuns) ? record.studioRuns : [],
    exampleProofs: record.exampleProofs && typeof record.exampleProofs === "object" ? record.exampleProofs : {},
    exampleProofRuns: Array.isArray(record.exampleProofRuns) ? record.exampleProofRuns : [],
  };
}

export async function readDb(): Promise<MarketplaceDb> {
  try {
    return normalize(JSON.parse(await readFile(dbPath(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyDb();
    }
    throw error;
  }
}

let pending: Promise<unknown> = Promise.resolve();

export function withStoreLock<T>(work: () => Promise<T>): Promise<T> {
  const run = pending.then(work, work);
  pending = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function updateDb<T>(mutate: (db: MarketplaceDb) => T): Promise<T> {
  return withStoreLock(async () => {
    const db = await readDb();
    const result = mutate(db);
    await mkdir(marketplaceDir(), { recursive: true });
    const file = dbPath();
    const next = JSON.stringify(db);
    const temporary = `${file}.tmp`;
    await writeFile(temporary, next);
    await rename(temporary, file);
    return result;
  });
}
