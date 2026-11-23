import type { AgentRecord, MarketplaceDb, ProofRecord, UserRecord } from "./demo-store.ts";
import { emptyDb } from "./demo-store.ts";
import type { AgentPackage } from "./package.ts";
import type { MarketRepository, MarketScope, PersistedJob, StoredOrder, UploadRecord } from "./repository.ts";

const EXAMPLE_SELLER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PLAIN = new Set([
  "credentials",
  "studios",
  "drafts",
  "client_workspaces",
  "runs",
  "reports",
  "reviews",
  "searches",
  "overrides",
  "proofs",
  "example_proof_runs",
  "uploads",
]);

type Conn = {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
};

export type DbConn = Conn & { release(): void };

export type DbPool = {
  connect(): Promise<DbConn>;
};

type PackageRow = { id: string; seller_id: string; slug: string; sealed: boolean; content_hash: string; body: AgentPackage };

const OPERATOR: MarketScope = { access: "operator" };

function scopeOf(scope?: MarketScope): MarketScope {
  return scope ?? OPERATOR;
}

async function scoped<T>(pool: DbPool, scope: MarketScope, work: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query("SET LOCAL ROLE orbexa_app");
    await conn.query("SELECT set_config('app.access', $1, true)", [scope.access]);
    await conn.query("SELECT set_config('app.seller_id', $1, true)", [scope.sellerId ?? ""]);
    await conn.query("SELECT set_config('app.client_id', $1, true)", [scope.clientId ?? ""]);
    await conn.query("SELECT set_config('app.user_id', $1, true)", [scope.userId ?? ""]);
    const result = await work(conn);
    await conn.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await conn.query("ROLLBACK");
    } catch {
      // The connection is already aborted.
    }
    throw error;
  } finally {
    conn.release();
  }
}

function table(name: string): string {
  if (!PLAIN.has(name) && !["users", "sessions", "listings", "packages", "jobs", "orders", "audit_log"].includes(name)) {
    throw new Error("unknown market table");
  }
  return name;
}

async function upsertPlain(conn: Conn, name: string, id: string, sellerId: string, clientId: string, body: unknown): Promise<void> {
  await conn.query(
    `INSERT INTO market.${table(name)} (id, seller_id, client_id, body)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET seller_id = EXCLUDED.seller_id, client_id = EXCLUDED.client_id, body = EXCLUDED.body
     WHERE market.${table(name)}.body IS DISTINCT FROM EXCLUDED.body
        OR market.${table(name)}.seller_id IS DISTINCT FROM EXCLUDED.seller_id
        OR market.${table(name)}.client_id IS DISTINCT FROM EXCLUDED.client_id`,
    [id, sellerId, clientId, JSON.stringify(body)],
  );
}

async function removeIds(conn: Conn, name: string, previous: string[], next: Set<string>): Promise<void> {
  for (const id of previous) {
    if (!next.has(id)) {
      await conn.query(`DELETE FROM market.${table(name)} WHERE id = $1`, [id]);
    }
  }
}

async function upsertProof(conn: Conn, id: string, sellerId: string, slug: string, body: unknown): Promise<void> {
  await conn.query(
    `INSERT INTO market.proofs (id, seller_id, client_id, slug, body)
     VALUES ($1, $2, '', $3, $4::jsonb)
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, body = EXCLUDED.body
     WHERE market.proofs.body IS DISTINCT FROM EXCLUDED.body OR market.proofs.slug IS DISTINCT FROM EXCLUDED.slug`,
    [id, sellerId, slug, JSON.stringify(body)],
  );
}

export class PgMarketRepository implements MarketRepository {
  private readonly pool: DbPool;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  read(scope?: MarketScope): Promise<MarketplaceDb> {
    return scoped(this.pool, scopeOf(scope), (conn) => this.load(conn));
  }

  update<T>(mutate: (db: MarketplaceDb) => T, scope?: MarketScope): Promise<T> {
    return scoped(this.pool, scopeOf(scope), async (conn) => {
      const current = await this.load(conn);
      const draft = structuredClone(current);
      const result = mutate(draft);
      await this.save(conn, current, draft);
      return result;
    });
  }

  async readJob(id: string): Promise<PersistedJob | null> {
    return scoped(this.pool, OPERATOR, async (conn) => {
      const rows = await conn.query<{ body: PersistedJob }>("SELECT body FROM market.jobs WHERE id = $1", [id]);
      return rows.rows[0]?.body ?? null;
    });
  }

  writeJob(job: PersistedJob): Promise<void> {
    return scoped(this.pool, OPERATOR, async (conn) => {
      const sellerId = typeof job.sellerId === "string" ? job.sellerId : "";
      const clientId = typeof job.tenantId === "string" ? job.tenantId : "";
      await conn.query(
        `INSERT INTO market.jobs (id, seller_id, client_id, listing_slug, status, body)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (id) DO UPDATE
           SET seller_id = EXCLUDED.seller_id, client_id = EXCLUDED.client_id,
               listing_slug = EXCLUDED.listing_slug, status = EXCLUDED.status, body = EXCLUDED.body`,
        [job.id, sellerId, clientId, job.listingSlug, job.status, JSON.stringify(job)],
      );
      await conn.query(
        `INSERT INTO market.orders (id, seller_id, client_id, job_id, currency, price_minor, status, body)
         VALUES ($1, $2, $3, $1, $4, $5, $6, $7::jsonb)
         ON CONFLICT (id) DO UPDATE
           SET seller_id = EXCLUDED.seller_id, client_id = EXCLUDED.client_id, currency = EXCLUDED.currency,
               price_minor = EXCLUDED.price_minor, status = EXCLUDED.status, body = EXCLUDED.body`,
        [job.id, sellerId, clientId, job.currency, job.priceMinor, job.status, JSON.stringify({ jobId: job.id, sellerId, clientId, currency: job.currency, priceMinor: job.priceMinor, status: job.status })],
      );
    });
  }

  async listJobs(): Promise<PersistedJob[]> {
    return scoped(this.pool, OPERATOR, async (conn) => {
      const rows = await conn.query<{ body: PersistedJob }>("SELECT body FROM market.jobs");
      return rows.rows.map((row) => row.body);
    });
  }

  async listOrders(scope?: MarketScope): Promise<StoredOrder[]> {
    return scoped(this.pool, scopeOf(scope), async (conn) => {
      const rows = await conn.query<StoredOrder>(
        `SELECT id, job_id AS "jobId", seller_id AS "sellerId", client_id AS "clientId", currency, price_minor AS "priceMinor", status
         FROM market.orders`,
      );
      return rows.rows;
    });
  }

  writeUpload(row: UploadRecord): Promise<void> {
    return scoped(this.pool, { access: "seller", sellerId: row.sellerId, clientId: row.clientId }, async (conn) => {
      await conn.query(
        `INSERT INTO market.uploads (id, seller_id, client_id, object_key, content_type, byte_size, body)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (id) DO UPDATE
           SET object_key = EXCLUDED.object_key, content_type = EXCLUDED.content_type, byte_size = EXCLUDED.byte_size, body = EXCLUDED.body
         WHERE market.uploads.body IS DISTINCT FROM EXCLUDED.body`,
        [row.id, row.sellerId, row.clientId ?? "", row.objectKey, row.contentType, row.byteSize, JSON.stringify(row)],
      );
    });
  }

  async readUpload(id: string, scope?: MarketScope): Promise<UploadRecord | null> {
    return scoped(this.pool, scopeOf(scope), async (conn) => {
      const rows = await conn.query<{ body: UploadRecord }>("SELECT body FROM market.uploads WHERE id = $1", [id]);
      return rows.rows[0]?.body ?? null;
    });
  }

  async seedExampleListings(rows: Array<{ id: string; slug: string; sellerId: string; body: unknown; package?: AgentPackage }>): Promise<void> {
    await scoped(this.pool, OPERATOR, async (conn) => {
      for (const row of rows) {
        await conn.query(
          `INSERT INTO market.listings (id, seller_id, client_id, slug, published, example, body)
           VALUES ($1, $2, '', $3, true, true, $4::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [row.id, row.sellerId, row.slug, JSON.stringify(row.body)],
        );
        if (!row.package) continue;
        await conn.query(
          `INSERT INTO market.packages (id, seller_id, client_id, slug, sealed, content_hash, body)
           VALUES ($1, $2, '', $3, true, $4, $5::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [row.package.id, row.package.sellerId, row.package.slug, row.package.contentHash, JSON.stringify(row.package)],
        );
      }
    });
  }

  private async load(conn: Conn): Promise<MarketplaceDb> {
    const db = emptyDb();
    const users = await conn.query<{ body: UserRecord }>("SELECT body FROM market.users");
    db.users = users.rows.map((row) => row.body);
    const sessions = await conn.query<{ body: MarketplaceDb["sessions"][number] }>("SELECT body FROM market.sessions");
    db.sessions = sessions.rows.map((row) => row.body);
    const listings = await conn.query<{ id: string; example: boolean; body: AgentRecord }>(
      "SELECT id, example, body FROM market.listings WHERE example = false",
    );
    const packages = await conn.query<PackageRow>(
      `SELECT id, seller_id, slug, sealed, content_hash, body FROM market.packages p
       WHERE NOT EXISTS (SELECT 1 FROM market.listings l WHERE l.slug = p.slug AND l.example)`,
    );
    const studios = await conn.query<{ listing_id: string; body: AgentRecord["studio"] }>(
      `SELECT listing_id, body FROM market.studios s
       WHERE NOT EXISTS (SELECT 1 FROM market.listings l WHERE l.id = s.listing_id AND l.example)`,
    );
    const proofs = await conn.query<{ seller_id: string; slug: string; body: ProofRecord }>("SELECT seller_id, slug, body FROM market.proofs");
    db.agents = listings.rows.map((row) => {
      const agent = row.body;
      const packs = packages.rows.filter((pack) => pack.seller_id === agent.ownerId && pack.slug === agent.slug).map((pack) => pack.body);
      if (packs.length > 0) agent.packages = packs;
      const studio = studios.rows.find((item) => item.listing_id === agent.id);
      if (studio?.body) agent.studio = studio.body;
      const proof = proofs.rows.find((item) => item.seller_id === agent.ownerId && item.slug === agent.slug);
      if (proof) agent.proof = proof.body;
      return agent;
    });
    db.exampleProofs = {};
    for (const proof of proofs.rows) {
      const owned = db.agents.some((agent) => agent.ownerId === proof.seller_id && agent.slug === proof.slug);
      if (!owned) db.exampleProofs[proof.slug] = proof.body;
    }
    const runs = await conn.query<{ body: NonNullable<MarketplaceDb["studioRuns"]>[number] }>("SELECT body FROM market.runs");
    db.studioRuns = runs.rows.map((row) => row.body);
    const clients = await conn.query<{ body: NonNullable<MarketplaceDb["clients"]>[number] }>("SELECT body FROM market.client_workspaces");
    db.clients = clients.rows.map((row) => row.body);
    const reviews = await conn.query<{ body: MarketplaceDb["reviews"][number] }>("SELECT body FROM market.reviews");
    db.reviews = reviews.rows.map((row) => row.body);
    const searches = await conn.query<{ body: MarketplaceDb["searches"][number] }>("SELECT body FROM market.searches");
    db.searches = searches.rows.map((row) => row.body);
    const overrides = await conn.query<{ id: string; body: { status?: "suspended" | "rejected" } }>("SELECT id, body FROM market.overrides");
    db.overrides = {};
    for (const row of overrides.rows) {
      if (row.body.status === "suspended" || row.body.status === "rejected") db.overrides[row.id] = row.body.status;
    }
    const audit = await conn.query<{ body: NonNullable<MarketplaceDb["audit"]>[number] }>("SELECT body FROM market.audit_log");
    db.audit = audit.rows.map((row) => row.body);
    const stamps = await conn.query<{ body: { at?: string } }>("SELECT body FROM market.example_proof_runs");
    db.exampleProofRuns = stamps.rows.map((row) => row.body.at ?? "").filter((stamp) => stamp.length > 0);
    return db;
  }

  private async save(conn: Conn, before: MarketplaceDb, after: MarketplaceDb): Promise<void> {
    const userIds = new Set(after.users.map((user) => user.id));
    for (const user of after.users) {
      await conn.query(
        `INSERT INTO market.users (id, seller_id, client_id, email, body)
         VALUES ($1, $1, '', $2, $3::jsonb)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, body = EXCLUDED.body
         WHERE market.users.body IS DISTINCT FROM EXCLUDED.body OR market.users.email IS DISTINCT FROM EXCLUDED.email`,
        [user.id, user.email.toLowerCase(), JSON.stringify(user)],
      );
      const credentials = user.credentials ?? [];
      for (const credential of credentials) {
        await conn.query(
          `INSERT INTO market.credentials (id, seller_id, client_id, user_id, body)
           VALUES ($1, $2, '', $2, $3::jsonb)
           ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body
           WHERE market.credentials.body IS DISTINCT FROM EXCLUDED.body`,
          [credential.id, user.id, JSON.stringify(credential)],
        );
      }
      const previous = (before.users.find((item) => item.id === user.id)?.credentials ?? []).map((item) => item.id);
      await removeIds(conn, "credentials", previous, new Set(credentials.map((item) => item.id)));
    }

    const sessionIds = new Set(after.sessions.map((session) => session.tokenHash));
    for (const session of after.sessions) {
      await conn.query(
        `INSERT INTO market.sessions (id, seller_id, client_id, user_id, body)
         VALUES ($1, $2, '', $2, $3::jsonb)
         ON CONFLICT (id) DO UPDATE SET seller_id = EXCLUDED.seller_id, user_id = EXCLUDED.user_id, body = EXCLUDED.body
         WHERE market.sessions.body IS DISTINCT FROM EXCLUDED.body`,
        [session.tokenHash, session.userId, JSON.stringify(session)],
      );
    }
    await removeIds(conn, "sessions", before.sessions.map((session) => session.tokenHash), sessionIds);
    for (const user of before.users) {
      if (!userIds.has(user.id)) {
        await removeIds(conn, "credentials", (user.credentials ?? []).map((item) => item.id), new Set());
      }
    }
    await removeIds(conn, "users", before.users.map((user) => user.id), userIds);

    const listingIds = new Set(after.agents.map((agent) => agent.id));
    for (const agent of after.agents) {
      const published = agent.status === "published";
      await conn.query(
        `INSERT INTO market.listings (id, seller_id, client_id, slug, published, example, body)
         VALUES ($1, $2, '', $3, $4, false, $5::jsonb)
         ON CONFLICT (id) DO UPDATE
           SET seller_id = EXCLUDED.seller_id, slug = EXCLUDED.slug, published = EXCLUDED.published, body = EXCLUDED.body
         WHERE market.listings.body IS DISTINCT FROM EXCLUDED.body OR market.listings.published IS DISTINCT FROM EXCLUDED.published`,
        [agent.id, agent.ownerId, agent.slug, published, JSON.stringify(agent)],
      );
      if (agent.studio) {
        await conn.query(
          `INSERT INTO market.studios (id, seller_id, client_id, listing_id, body)
           VALUES ($1, $2, '', $1, $3::jsonb)
           ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body
           WHERE market.studios.body IS DISTINCT FROM EXCLUDED.body`,
          [agent.id, agent.ownerId, JSON.stringify(agent.studio)],
        );
        const versions = agent.studio.versions ?? [];
        const versionIds = new Set<string>();
        for (const version of versions) {
          const id = `${agent.id}:${version.number}`;
          versionIds.add(id);
          await conn.query(
            `INSERT INTO market.drafts (id, seller_id, client_id, listing_id, body)
             VALUES ($1, $2, '', $3, $4::jsonb)
             ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body
             WHERE market.drafts.body IS DISTINCT FROM EXCLUDED.body`,
            [id, agent.ownerId, agent.id, JSON.stringify(version)],
          );
        }
        const previousVersions = (before.agents.find((item) => item.id === agent.id)?.studio?.versions ?? []).map((version) => `${agent.id}:${version.number}`);
        await removeIds(conn, "drafts", previousVersions, versionIds);
      }
      const packs = agent.packages ?? [];
      const previousPacks = new Map((before.agents.find((item) => item.id === agent.id)?.packages ?? []).map((pack) => [pack.id, pack]));
      for (const pack of packs) {
        const prior = previousPacks.get(pack.id);
        if (prior?.contentHash === pack.contentHash && prior.immutable === true) continue;
        if (prior?.immutable === true) {
          await conn.query("UPDATE market.packages SET content_hash = $2, body = $3::jsonb WHERE id = $1", [pack.id, pack.contentHash, JSON.stringify(pack)]);
          continue;
        }
        await conn.query(
          `INSERT INTO market.packages (id, seller_id, client_id, slug, sealed, content_hash, body)
           VALUES ($1, $2, '', $3, $4, $5, $6::jsonb)
           ON CONFLICT (id) DO UPDATE
             SET body = EXCLUDED.body, content_hash = EXCLUDED.content_hash, sealed = EXCLUDED.sealed
           WHERE market.packages.sealed = false AND market.packages.body IS DISTINCT FROM EXCLUDED.body`,
          [pack.id, pack.sellerId, pack.slug, pack.immutable === true, pack.contentHash, JSON.stringify(pack)],
        );
      }
      if (agent.proof) {
        await upsertProof(conn, agent.proof.id, agent.ownerId, agent.slug, agent.proof);
      }
    }
    const previousDrafts = before.agents.flatMap((agent) => (agent.studio?.versions ?? []).map((version) => `${agent.id}:${version.number}`));
    const nextDrafts = new Set(after.agents.flatMap((agent) => (agent.studio?.versions ?? []).map((version) => `${agent.id}:${version.number}`)));
    const previousStudios = before.agents.filter((agent) => agent.studio).map((agent) => agent.id);
    const nextStudios = new Set(after.agents.filter((agent) => agent.studio).map((agent) => agent.id));
    await removeIds(conn, "drafts", previousDrafts, nextDrafts);
    await removeIds(conn, "studios", previousStudios, nextStudios);
    await removeIds(conn, "listings", before.agents.map((agent) => agent.id), listingIds);

    const previousProofIds = [
      ...before.agents.flatMap((agent) => (agent.proof ? [agent.proof.id] : [])),
      ...Object.values(before.exampleProofs ?? {}).map((proof) => proof.id),
    ];
    const nextProofIds = new Set<string>([
      ...after.agents.flatMap((agent) => (agent.proof ? [agent.proof.id] : [])),
      ...Object.values(after.exampleProofs ?? {}).map((proof) => proof.id),
    ]);
    await removeIds(conn, "proofs", previousProofIds, nextProofIds);
    for (const [slug, proof] of Object.entries(after.exampleProofs ?? {})) {
      await upsertProof(conn, proof.id, EXAMPLE_SELLER, slug, proof);
    }

    const runIds = new Set((after.studioRuns ?? []).map((run) => run.id));
    for (const run of after.studioRuns ?? []) {
      await upsertPlain(conn, "runs", run.id, run.sellerId, run.clientId, run);
      if (run.report) {
        await conn.query(
          `INSERT INTO market.reports (id, seller_id, client_id, run_id, body)
           VALUES ($1, $2, $3, $1, $4::jsonb)
           ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body
           WHERE market.reports.body IS DISTINCT FROM EXCLUDED.body`,
          [run.id, run.sellerId, run.clientId, JSON.stringify(run.report)],
        );
      }
    }
    await removeIds(conn, "reports", (before.studioRuns ?? []).filter((run) => run.report).map((run) => run.id), new Set((after.studioRuns ?? []).filter((run) => run.report).map((run) => run.id)));
    await removeIds(conn, "runs", (before.studioRuns ?? []).map((run) => run.id), runIds);

    const clientIds = new Set((after.clients ?? []).map((client) => `${client.sellerId}:${client.clientId}`));
    for (const client of after.clients ?? []) {
      await upsertPlain(conn, "client_workspaces", `${client.sellerId}:${client.clientId}`, client.sellerId, client.clientId, client);
    }
    await removeIds(conn, "client_workspaces", (before.clients ?? []).map((client) => `${client.sellerId}:${client.clientId}`), clientIds);

    for (const review of after.reviews) {
      await upsertPlain(conn, "reviews", review.id, "", review.buyerId, review);
    }
    await removeIds(conn, "reviews", before.reviews.map((review) => review.id), new Set(after.reviews.map((review) => review.id)));

    for (const search of after.searches) {
      await upsertPlain(conn, "searches", search.id, search.ownerId, "", search);
    }
    await removeIds(conn, "searches", before.searches.map((search) => search.id), new Set(after.searches.map((search) => search.id)));

    const overrideIds = new Set(Object.keys(after.overrides));
    for (const [slug, status] of Object.entries(after.overrides)) {
      await upsertPlain(conn, "overrides", slug, "", "", { status });
    }
    await removeIds(conn, "overrides", Object.keys(before.overrides), overrideIds);

    const previousAudit = new Set((before.audit ?? []).map((event) => event.id));
    for (const event of after.audit ?? []) {
      if (previousAudit.has(event.id)) continue;
      await conn.query(
        `INSERT INTO market.audit_log (id, seller_id, client_id, body) VALUES ($1, $2, '', $3::jsonb) ON CONFLICT (id) DO NOTHING`,
        [event.id, event.actorId, JSON.stringify(event)],
      );
    }

    const stamps = after.exampleProofRuns ?? [];
    const stampIds = stamps.map((stamp, index) => `${index}:${stamp}`);
    for (const id of stampIds) {
      const at = id.slice(id.indexOf(":") + 1);
      await upsertPlain(conn, "example_proof_runs", id, EXAMPLE_SELLER, "", { at });
    }
    const previousStamps = (before.exampleProofRuns ?? []).map((stamp, index) => `${index}:${stamp}`);
    await removeIds(conn, "example_proof_runs", previousStamps, new Set(stampIds));
  }
}

export function orderFromJob(job: PersistedJob): StoredOrder {
  return {
    id: job.id,
    jobId: job.id,
    sellerId: typeof job.sellerId === "string" ? job.sellerId : "",
    clientId: typeof job.tenantId === "string" ? job.tenantId : "",
    currency: job.currency,
    priceMinor: job.priceMinor,
    status: job.status,
  };
}
