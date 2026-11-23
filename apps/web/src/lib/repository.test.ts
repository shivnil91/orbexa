import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client, Pool } from "pg";
import { applySchemaMigrations } from "@orbexa/db/apply-migrations.ts";
import { emptyConnect, type MarketplaceDb } from "./demo-store.ts";
import { absentProof, listingConfig, sealPackage } from "./package.ts";
import { fileMarket, marketForTests, type PersistedJob } from "./repository.ts";
import { exampleNdisFixtureProof } from "./seed.ts";

const sellerA = "11111111-1111-4111-8111-111111111111";
const sellerB = "22222222-2222-4222-8222-222222222222";
const buyer = "33333333-3333-4333-8333-333333333333";
const adminUrl = "postgres://orbexa:orbexa_local_only@127.0.0.1:5432/postgres";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function sortedDb(db: MarketplaceDb): unknown {
  return stable({
    ...db,
    users: [...db.users].sort((left, right) => left.id.localeCompare(right.id)),
    sessions: [...db.sessions].sort((left, right) => left.tokenHash.localeCompare(right.tokenHash)),
    agents: [...db.agents].sort((left, right) => left.id.localeCompare(right.id)).map((agent) => ({
      ...agent,
      packages: [...(agent.packages ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    })),
    reviews: [...db.reviews].sort((left, right) => left.id.localeCompare(right.id)),
    searches: [...db.searches].sort((left, right) => left.id.localeCompare(right.id)),
    audit: [...(db.audit ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    clients: [...(db.clients ?? [])].sort((left, right) => `${left.sellerId}:${left.clientId}`.localeCompare(`${right.sellerId}:${right.clientId}`)),
    studioRuns: [...(db.studioRuns ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    exampleProofRuns: [...(db.exampleProofRuns ?? [])],
  });
}

function fill(db: MarketplaceDb): void {
  const pack = sealPackage({
    id: "pkg_parity",
    packageVersion: 1,
    sellerId: sellerA,
    slug: "parity-desk",
    name: "Parity desk",
    kind: "listing",
    config: listingConfig("Restate the request. Do not invent a number."),
    proof: absentProof(),
    instructions: "Restate the request. Do not invent a number.",
    trainingConsent: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  db.users.push({
    id: sellerA,
    email: "ada-parity@example.test",
    name: "Ada",
    bio: "",
    role: "seller",
    passwordHash: "ab".repeat(32),
    passwordSalt: "cd".repeat(16),
    createdAt: "2026-01-01T00:00:00.000Z",
    connect: emptyConnect(),
    credentials: [{ id: "44444444-4444-4444-8444-444444444444", title: "Certificate", issuer: "Example board", status: "self_declared" }],
  });
  db.sessions.push({ tokenHash: "ef".repeat(32), userId: sellerA, expiresAt: "2026-12-01T00:00:00.000Z" });
  db.agents.push({
    id: "55555555-5555-4555-8555-555555555555",
    slug: "parity-desk",
    ownerId: sellerA,
    name: "Parity desk",
    pitch: "A parity listing",
    description: "Stored the same way in both repositories.",
    category: "writing",
    instructions: "Restate the request. Do not invent a number.",
    knowledge: [],
    exampleOutputs: [],
    priceMinor: 2500,
    currency: "USD",
    status: "published",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    publishedAt: "2026-01-02T00:00:00.000Z",
    packages: [pack],
    studio: {
      trainingConsent: false,
      publishedVersion: 1,
      publishedPackageHash: pack.contentHash,
      provenAt: null,
      versions: [{
        number: 1,
        status: "draft",
        note: "first",
        savedAt: "2026-01-01T00:00:00.000Z",
        config: listingConfig("Restate the request. Do not invent a number."),
      }],
      changelog: [],
      proposals: [],
      lastBench: null,
    },
    proof: exampleNdisFixtureProof("66666666-6666-4666-8666-666666666666"),
  });
  db.clients = [{ clientId: "client-1", sellerId: sellerA, answers: { q: "wages" }, docs: [], memory: [{ at: "2026-01-03T00:00:00.000Z", summary: "Ada note" }] }];
  db.studioRuns = [{
    id: "77777777-7777-4777-8777-777777777777",
    slug: "parity-desk",
    sellerId: sellerA,
    buyerId: buyer,
    clientId: "client-1",
    tier: "autonomous",
    priceMinor: 2500,
    answers: {},
    csv: "",
    report: { coverage: 1 },
    brokerRequested: false,
    shareToken: "ab".repeat(16),
    createdAt: "2026-01-03T00:00:00.000Z",
    exampleData: false,
  }];
  db.reviews.push({ id: "88888888-8888-4888-8888-888888888888", agentSlug: "parity-desk", jobId: "99999999-9999-4999-8999-999999999999", buyerId: buyer, buyerName: "Buyer", rating: 5, body: "Useful.", createdAt: "2026-01-04T00:00:00.000Z" });
  db.searches.push({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", ownerId: sellerA, name: "Wages", need: "wages bridge", createdAt: "2026-01-04T00:00:00.000Z" });
  db.audit = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", at: "2026-01-04T00:00:00.000Z", actorId: sellerA, action: "credential_verify", targetId: sellerA, detail: "44444444-4444-4444-8444-444444444444" }];
  db.exampleProofs = { "example-ndis-broker": exampleNdisFixtureProof() };
  db.overrides["example-ndis-broker"] = "suspended";
  db.exampleProofRuns = ["2026-01-01T00:00:00.000Z"];
}

const job: PersistedJob = {
  id: "99999999-9999-4999-8999-999999999999",
  listingSlug: "parity-desk",
  status: "accepted",
  tenantId: buyer,
  sellerId: sellerA,
  currency: "USD",
  priceMinor: 2500,
  createdAt: 1,
};

async function withDatabase(): Promise<{ pool: Pool; drop: () => Promise<void> }> {
  const name = "orbexa_repo_parity";
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = `postgres://orbexa:orbexa_local_only@127.0.0.1:5432/${name}`;
  const client = new Client({ connectionString: url });
  await client.connect();
  await applySchemaMigrations({
    async query(sql, params) {
      const result = await client.query(sql, params ? [...params] : undefined);
      const packed = result as { rows?: Array<{ name: string }> } | Array<{ rows?: Array<{ name: string }> }>;
      if (Array.isArray(packed)) {
        return { rows: packed.at(-1)?.rows ?? [] };
      }
      return { rows: packed.rows ?? [] };
    },
  });
  await client.end();
  const pool = new Pool({ connectionString: url, max: 4 });
  return {
    pool,
    async drop() {
      await pool.end();
      const again = new Client({ connectionString: adminUrl });
      await again.connect();
      await again.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
      await again.query(`DROP DATABASE IF EXISTS ${name}`);
      await again.end();
    },
  };
}

test("postgres repository matches the JSON store and hides the other tenant", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-parity-"));
  const previous = process.env.ORBEXA_DEMO_DIR;
  process.env.ORBEXA_DEMO_DIR = directory;
  const database = await withDatabase();
  const postgres = marketForTests(database.pool);
  try {
    await fileMarket.update(fill);
    await postgres.update(fill);
    assert.deepEqual(sortedDb(await postgres.read()), sortedDb(await fileMarket.read()));
    await fileMarket.writeJob(job);
    await postgres.writeJob(job);
    assert.deepEqual(await postgres.readJob(job.id), await fileMarket.readJob(job.id));
    assert.deepEqual(await postgres.listOrders(), await fileMarket.listOrders());
    const upload = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      sellerId: sellerA,
      clientId: "client-1",
      objectKey: `sellers/${sellerA}/uploads/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1`,
      contentType: "text/plain",
      byteSize: 5,
      createdAt: "2026-01-05T00:00:00.000Z",
    };
    await fileMarket.writeUpload(upload);
    await postgres.writeUpload(upload);
    assert.deepEqual(await postgres.readUpload(upload.id, { access: "seller", sellerId: sellerA, clientId: "client-1" }), upload);

    await postgres.update((db) => {
      db.users.push({
        id: sellerB,
        email: "bea-parity@example.test",
        name: "Bea",
        bio: "",
        role: "seller",
        passwordHash: "aa".repeat(32),
        passwordSalt: "bb".repeat(16),
        createdAt: "2026-01-06T00:00:00.000Z",
        connect: emptyConnect(),
      });
      db.clients = (db.clients ?? []).concat({ clientId: "client-1", sellerId: sellerB, answers: {}, docs: [], memory: [{ at: "2026-01-06T00:00:00.000Z", summary: "Bea secret" }] });
    });
    const visible = await postgres.read({ access: "seller", sellerId: sellerA });
    assert.equal(visible.clients?.some((client) => client.sellerId === sellerB), false);
    assert.equal(JSON.stringify(visible).includes("Bea secret"), false);
    assert.ok(visible.clients?.some((client) => client.sellerId === sellerA));
    const orders = await postgres.listOrders({ access: "client", sellerId: sellerA, clientId: buyer });
    assert.deepEqual(orders.map((order) => order.sellerId), [sellerA]);
  } finally {
    if (previous === undefined) delete process.env.ORBEXA_DEMO_DIR;
    else process.env.ORBEXA_DEMO_DIR = previous;
    await database.drop();
    await rm(directory, { recursive: true, force: true });
  }
});
