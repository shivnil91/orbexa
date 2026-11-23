import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MarketplaceDb } from "./demo-store.ts";
import { marketplaceDir, readJsonDb, updateJsonDb } from "./demo-store.ts";
import { listJobFiles, readJobFile, writeJobFile } from "./job-files.ts";
import { databaseUrlFromEnv } from "./database-url.ts";
import type { AgentPackage } from "./package.ts";
import { orderFromJob, PgMarketRepository, type DbPool } from "./pg-store.ts";

export type MarketScope = {
  access: "none" | "catalog" | "seller" | "client" | "operator";
  sellerId?: string | null;
  clientId?: string | null;
  userId?: string | null;
};

export type PersistedJob = {
  id: string;
  listingSlug: string;
  status: string;
  tenantId: string;
  sellerId?: string;
  currency: string;
  priceMinor: number;
} & Record<string, unknown>;

export type StoredOrder = {
  id: string;
  jobId: string;
  sellerId: string;
  clientId: string;
  currency: string;
  priceMinor: number;
  status: string;
};

export type UploadRecord = {
  id: string;
  sellerId: string;
  clientId: string | null;
  objectKey: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
};

export type ExampleListingSeed = {
  id: string;
  slug: string;
  sellerId: string;
  body: unknown;
  package?: AgentPackage;
};

export interface MarketRepository {
  read(scope?: MarketScope): Promise<MarketplaceDb>;
  update<T>(mutate: (db: MarketplaceDb) => T, scope?: MarketScope): Promise<T>;
  readJob(id: string): Promise<PersistedJob | null>;
  writeJob(job: PersistedJob): Promise<void>;
  listJobs(): Promise<PersistedJob[]>;
  listOrders(scope?: MarketScope): Promise<StoredOrder[]>;
  writeUpload(row: UploadRecord): Promise<void>;
  readUpload(id: string, scope?: MarketScope): Promise<UploadRecord | null>;
  seedExampleListings(rows: ExampleListingSeed[]): Promise<void>;
}

export function usesPostgres(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ORBEXA_STORE === "postgres" || Boolean(env.DB_HOST);
}

function sortJobs(jobs: PersistedJob[]): PersistedJob[] {
  return jobs.sort((left, right) => {
    const leftAt = typeof left.createdAt === "number" ? left.createdAt : typeof left.startedAt === "number" ? left.startedAt : 0;
    const rightAt = typeof right.createdAt === "number" ? right.createdAt : typeof right.startedAt === "number" ? right.startedAt : 0;
    return rightAt - leftAt;
  });
}

async function readUploadFile(): Promise<UploadRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(path.join(marketplaceDir(), "uploads.json"), "utf8")) as UploadRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeUploadFile(rows: UploadRecord[]): Promise<void> {
  await mkdir(marketplaceDir(), { recursive: true });
  await writeFile(path.join(marketplaceDir(), "uploads.json"), JSON.stringify(rows));
}

export const fileMarket: MarketRepository = {
  read() {
    return readJsonDb();
  },
  update(mutate) {
    return updateJsonDb(mutate);
  },
  async readJob(id) {
    return readJobFile(id) as Promise<PersistedJob | null>;
  },
  async writeJob(job) {
    await writeJobFile(job);
  },
  async listJobs() {
    return sortJobs((await listJobFiles()) as PersistedJob[]);
  },
  async listOrders() {
    return sortJobs((await listJobFiles()) as PersistedJob[]).map(orderFromJob);
  },
  async writeUpload(row) {
    const rows = await readUploadFile();
    const next = rows.filter((item) => item.id !== row.id).concat(row);
    await writeUploadFile(next);
  },
  async readUpload(id) {
    return (await readUploadFile()).find((item) => item.id === id) ?? null;
  },
  async seedExampleListings(rows) {
    await mkdir(marketplaceDir(), { recursive: true });
    const file = path.join(marketplaceDir(), "example-listings.json");
    let current: ExampleListingSeed[] = [];
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as ExampleListingSeed[];
      if (Array.isArray(parsed)) current = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const seen = new Set(current.map((row) => row.id));
    const adding = rows.filter((row) => !seen.has(row.id));
    if (adding.length === 0) return;
    await writeFile(file, JSON.stringify(current.concat(adding)));
  },
};

let pool: DbPool | undefined;
let postgres: PgMarketRepository | undefined;

function connectionString(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_URL && env.DATABASE_URL.startsWith("postgres")) return env.DATABASE_URL;
  return databaseUrlFromEnv(env);
}

async function postgresPool(env: NodeJS.ProcessEnv = process.env): Promise<DbPool> {
  if (pool) return pool;
  const { default: pg } = await import("pg");
  const connection = connectionString(env);
  const created = new pg.Pool({
    connectionString: connection,
    max: 5,
    connectionTimeoutMillis: 2000,
    ssl: connection.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });
  pool = created;
  return created;
}

export async function pingMarket(): Promise<boolean> {
  if (!usesPostgres()) return true;
  try {
    const active = await postgresPool();
    const client = await active.connect();
    try {
      await client.query("SELECT 1 AS ok");
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

export function getMarket(): MarketRepository {
  if (!usesPostgres()) return fileMarket;
  postgres ??= new PgMarketRepository({
    connect: async () => {
      const active = await postgresPool();
      const client = await active.connect();
      return client;
    },
  });
  return postgres;
}

export function marketForTests(store: DbPool): MarketRepository {
  return new PgMarketRepository(store);
}
