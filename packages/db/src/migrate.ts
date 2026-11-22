import pg from "pg";
import { applySchemaMigrations, type MigrationClient } from "./apply-migrations.ts";
import { assertLocalDatabaseHost } from "./local-guard.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const migrationClient: MigrationClient = {
    query(sql, params) {
      return params ? client.query(sql, [...params]) : client.query(sql);
    },
  };
  await applySchemaMigrations(migrationClient);
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
