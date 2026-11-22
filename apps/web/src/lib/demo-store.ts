import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type Role = "buyer" | "seller" | "both";

export type ConnectState = {
  mode: "simulated" | "stripe_test";
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
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
};

export type SessionRecord = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
};

export type KnowledgeNote = { name: string; text: string };

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
  exampleOutputs: { title: string; body: string }[];
  priceMinor: number;
  currency: "USD";
  status: "draft" | "published" | "rejected" | "suspended";
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
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

export type MarketplaceDb = {
  users: UserRecord[];
  sessions: SessionRecord[];
  agents: AgentRecord[];
  reviews: ReviewRecord[];
  searches: SearchRecord[];
  overrides: Record<string, "suspended" | "rejected">;
};

export function emptyConnect(): ConnectState {
  return { mode: "simulated", accountId: null, chargesEnabled: false, detailsSubmitted: false };
}

export function emptyDb(): MarketplaceDb {
  return { users: [], sessions: [], agents: [], reviews: [], searches: [], overrides: {} };
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
