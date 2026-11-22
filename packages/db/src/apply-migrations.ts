import { loadMigrations } from "./migrations.ts";

const LOCK_KEY_A = 8726;
const LOCK_KEY_B = 345110;

type QueryRows = { rows: Array<{ name: string }> };

export type MigrationClient = {
  query(sql: string, params?: readonly unknown[]): Promise<QueryRows | QueryRows[]>;
};

function asRows(result: QueryRows | QueryRows[]): QueryRows {
  if (Array.isArray(result)) {
    return result.at(-1) ?? { rows: [] };
  }
  return result;
}

/**
 * Apply pending SQL files in filename order.
 * Each file is one transaction. A session advisory lock keeps two starters
 * from applying the same file. This does not seed local rows.
 */
export async function applySchemaMigrations(client: MigrationClient): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1, $2)", [LOCK_KEY_A, LOCK_KEY_B]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = new Set(
      asRows(await client.query("SELECT name FROM schema_migrations")).rows.map((row) => row.name),
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
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_KEY_A, LOCK_KEY_B]);
    } catch {
      // A dropped connection releases the session lock.
    }
  }
}
