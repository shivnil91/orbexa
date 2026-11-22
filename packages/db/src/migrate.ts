import pg from "pg";
import { assertLocalDatabaseHost } from "./local-guard.ts";
import { loadMigrations } from "./migrations.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const applied = new Set(
    (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
      (row) => row.name,
    ),
  );
  for (const migration of await loadMigrations()) {
    if (applied.has(migration.name)) {
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
      await client.query("COMMIT");
      console.log(`applied ${migration.name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}

if (process.argv.includes("--seed-local")) {
  const hostname = new URL(databaseUrl).hostname;
  assertLocalDatabaseHost(hostname);
  const seed = new pg.Client({ connectionString: databaseUrl });
  await seed.connect();
  try {
    await seed.query(`
      INSERT INTO processing_regions (id, status) VALUES ('local', 'active')
      ON CONFLICT (id) DO UPDATE SET status = 'active';
      INSERT INTO cell_identity (region, environment) VALUES ('local', 'local')
      ON CONFLICT (id) DO UPDATE SET region = EXCLUDED.region, environment = EXCLUDED.environment;
    `);
  } finally {
    await seed.end();
  }
}
