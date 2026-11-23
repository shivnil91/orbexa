import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import assert from "node:assert/strict";
import test from "node:test";
import { applySchemaMigrations, revertSchemaMigration, type MigrationClient } from "./apply-migrations.ts";
import { recreateDatabase, type PgHandle } from "./pg16.ts";

const sellerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sellerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const clientA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const hash = "ab".repeat(32);

type Sql = {
  query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
  exec?(sql: string): Promise<unknown>;
};

function pgliteClient(memory: PGlite): MigrationClient & Sql {
  const client = {
    async query(sql: string, params?: readonly unknown[]) {
      const text = sql.trim();
      if (params && params.length > 0) {
        const result = await memory.query(sql, [...params]);
        return { rows: result.rows as Array<{ name: string }> };
      }
      if (/^(SELECT|WITH)\b/i.test(text) && !text.includes(";")) {
        const result = await memory.query(sql);
        return { rows: result.rows as Array<{ name: string }> };
      }
      await memory.exec(sql);
      return { rows: [] };
    },
  };
  return client as MigrationClient & Sql;
}

async function applyAll(client: MigrationClient): Promise<void> {
  await applySchemaMigrations(client);
}

test("market migration applies, reverses, and applies again", async () => {
  const memory = new PGlite({ extensions: { vector } });
  const client = pgliteClient(memory);
  await applyAll(client);
  const present = await client.query<{ name: string }>(
    "SELECT nspname AS name FROM pg_namespace WHERE nspname = 'market'",
  );
  assert.equal(present.rows.length, 1);
  const owner = await client.query<{ owner: string }>(
    `SELECT pg_get_userbyid(relowner) AS owner
     FROM pg_class
     JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
     WHERE nspname = 'market' AND relname = 'packages'`,
  );
  assert.notEqual(owner.rows[0]?.owner, "orbexa_app");
  await revertSchemaMigration(client, "0016_workspace.sql");
  await revertSchemaMigration(client, "0015_market.sql");
  const gone = await client.query<{ name: string }>(
    "SELECT nspname AS name FROM pg_namespace WHERE nspname = 'market'",
  );
  assert.equal(gone.rows.length, 0);
  const users = await client.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users'",
  );
  assert.equal(users.rows.length, 1);
  await applySchemaMigrations(client);
  const back = await client.query<{ name: string; secured: boolean }>(
    `SELECT relname AS name, relrowsecurity AS secured
     FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
     WHERE nspname = 'market' AND relname IN ('client_workspaces', 'knowledge_chunks')`,
  );
  assert.equal(back.rows.length, 2);
  assert.equal(back.rows.every((row) => row.secured === true), true);
  await memory.close();
});

async function withRole(db: Sql, seller: string, client: string, access: string): Promise<void> {
  await db.query("BEGIN");
  await db.query("SET LOCAL ROLE orbexa_app");
  await db.query("SELECT set_config('app.access', $1, true)", [access]);
  await db.query("SELECT set_config('app.seller_id', $1, true)", [seller]);
  await db.query("SELECT set_config('app.client_id', $1, true)", [client]);
}

test("row-level security denies cross-tenant reads and writes", async () => {
  const memory = new PGlite({ extensions: { vector } });
  const db = pgliteClient(memory);
  await applyAll(db);
  await db.query(
    `INSERT INTO market.client_workspaces (id, seller_id, client_id, body)
     VALUES ($1, $2, $3, $4::jsonb), ($5, $6, $7, $8::jsonb)`,
    [
      `${sellerA}:${clientA}`,
      sellerA,
      clientA,
      JSON.stringify({ clientId: clientA, sellerId: sellerA, answers: {}, docs: [], memory: [{ summary: "seller A note" }] }),
      `${sellerB}:${clientA}`,
      sellerB,
      clientA,
      JSON.stringify({ clientId: clientA, sellerId: sellerB, answers: {}, docs: [], memory: [{ summary: "seller B note" }] }),
    ],
  );
  await withRole(db, sellerA, "", "seller");
  const seen = await db.query<{ seller_id: string; body: { memory: Array<{ summary: string }> } }>(
    "SELECT seller_id, body FROM market.client_workspaces",
  );
  assert.deepEqual(seen.rows.map((row) => row.seller_id), [sellerA]);
  assert.equal(JSON.stringify(seen.rows).includes("seller B note"), false);
  await assert.rejects(
    () => db.query(
      `INSERT INTO market.client_workspaces (id, seller_id, client_id, body) VALUES ($1, $2, $3, $4::jsonb)`,
      [`${sellerB}:other`, sellerB, "other", JSON.stringify({ clientId: "other", sellerId: sellerB })],
    ),
    /row-level security|new row violates/,
  );
  await db.query("ROLLBACK");
  await memory.close();
});

test("a sealed package rejects updates from the app role and from the table owner", async () => {
  const memory = new PGlite({ extensions: { vector } });
  const db = pgliteClient(memory);
  await applyAll(db);
  await db.query(
    `INSERT INTO market.packages (id, seller_id, client_id, slug, sealed, content_hash, body)
     VALUES ($1, $2, '', 'desk', true, $3, $4::jsonb)`,
    ["pkg_desk", sellerA, hash, JSON.stringify({ id: "pkg_desk", contentHash: hash, sealed: true })],
  );
  await assert.rejects(
    () => db.query("UPDATE market.packages SET content_hash = $1 WHERE id = 'pkg_desk'", ["cd".repeat(32)]),
    /sealed package is immutable/,
  );
  await withRole(db, sellerA, "", "seller");
  await assert.rejects(
    () => db.query("UPDATE market.packages SET slug = 'other' WHERE id = 'pkg_desk'"),
    /sealed package is immutable/,
  );
  await db.query("ROLLBACK");
  await memory.close();
});

test("a seller cannot read another seller's document chunks, and bench history is append-only", async () => {
  const memory = new PGlite({ extensions: { vector } });
  const db = pgliteClient(memory);
  await applyAll(db);
  await db.query(
    `INSERT INTO market.knowledge_documents (id, seller_id, title, object_key, content_type, byte_size, status)
     VALUES ($1, $2, 'Ada notes', $3, 'text/plain', 5, 'stored'),
            ($4, $5, 'Bea notes', $6, 'text/plain', 5, 'stored')`,
    [
      "doc-a",
      sellerA,
      `sellers/${sellerA}/documents/doc-a`,
      "doc-b",
      sellerB,
      `sellers/${sellerB}/documents/doc-b`,
    ],
  );
  await db.query(
    `INSERT INTO market.knowledge_chunks (id, document_id, seller_id, ordinal, content)
     VALUES ('chunk-a', 'doc-a', $1, 0, 'Ada wages note'),
            ('chunk-b', 'doc-b', $2, 0, 'Bea secret note')`,
    [sellerA, sellerB],
  );
  await db.query(
    `INSERT INTO market.bench_cases (id, seller_id, title, body)
     VALUES ('bench-a', $1, 'Healthy file', '{"expect":"pass"}'::jsonb)`,
    [sellerA],
  );
  await db.query(
    `INSERT INTO market.bench_case_revisions (id, bench_case_id, seller_id, revision, body, note)
     VALUES ('bench-a-r1', 'bench-a', $1, 1, '{"expect":"pass"}'::jsonb, 'created')`,
    [sellerA],
  );
  await assert.rejects(
    () => db.query("UPDATE market.bench_case_revisions SET note = 'edited' WHERE id = 'bench-a-r1'"),
    /append-only/,
  );
  await assert.rejects(
    () => db.query(
      `INSERT INTO market.knowledge_chunks (id, document_id, seller_id, ordinal, content)
       VALUES ('chunk-mismatch', 'doc-a', $1, 1, 'wrong seller')`,
      [sellerB],
    ),
    /chunk seller does not match/,
  );
  await withRole(db, sellerA, "", "seller");
  const seen = await db.query<{ id: string; content: string }>("SELECT id, content FROM market.knowledge_chunks");
  assert.deepEqual(seen.rows.map((row) => row.id), ["chunk-a"]);
  assert.equal(JSON.stringify(seen.rows).includes("Bea secret"), false);
  await assert.rejects(
    () => db.query(
      `INSERT INTO market.knowledge_chunks (id, document_id, seller_id, ordinal, content)
       VALUES ('chunk-steal', 'doc-b', $1, 1, 'stolen')`,
      [sellerB],
    ),
    /row-level security|chunk seller|new row violates/,
  );
  await db.query("ROLLBACK");
  await memory.close();
});

test("market migration up and down on Postgres 16", { skip: process.env.PG16 === "1" ? false : true }, async () => {
  let pg: PgHandle | undefined;
  try {
    pg = await recreateDatabase("orbexa_market_mig");
  } catch {
    return;
  }
  const client: MigrationClient = {
    async query(sql: string, params?: readonly unknown[]) {
      const result = await pg!.query(sql, params);
      return { rows: result.rows as Array<{ name: string }> };
    },
  };
  await applySchemaMigrations(client);
  const owner = await pg.query<{ owner: string }>(
    `SELECT pg_get_userbyid(relowner) AS owner
     FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
     WHERE nspname = 'market' AND relname = 'packages'`,
  );
  assert.notEqual(owner.rows[0]?.owner, "orbexa_app");
  await revertSchemaMigration(client, "0016_workspace.sql");
  await revertSchemaMigration(client, "0015_market.sql");
  const gone = await pg.query<{ name: string }>("SELECT nspname AS name FROM pg_namespace WHERE nspname = 'market'");
  assert.equal(gone.rows.length, 0);
  await applySchemaMigrations(client);
  const back = await pg.query<{ name: string }>(
    "SELECT relname AS name FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE nspname = 'market' AND relname = 'packages'",
  );
  assert.equal(back.rows[0]?.name, "packages");
  await pg.end();
});
