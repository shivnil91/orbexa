import assert from "node:assert/strict";
import test from "node:test";
import { applySchemaMigrations, type MigrationClient } from "./apply-migrations.ts";
import { loadMigrations } from "./migrations.ts";

function recordingClient(options?: {
  applied?: string[];
  failSql?: boolean;
}): { client: MigrationClient; queries: string[] } {
  const queries: string[] = [];
  let began = false;
  const client: MigrationClient = {
    async query(sql: string, params?: readonly unknown[]) {
      queries.push(params ? `${sql} :: ${params.join(",")}` : sql);
      if (options?.failSql && began && sql !== "ROLLBACK" && !sql.includes("pg_advisory")) {
        throw new Error("boom");
      }
      if (sql === "BEGIN") {
        began = true;
      }
      if (sql.includes("SELECT name FROM schema_migrations")) {
        return { rows: (options?.applied ?? []).map((name) => ({ name })) };
      }
      return { rows: [] };
    },
  };
  return { client, queries };
}

test("applySchemaMigrations records each pending file in its own transaction", async () => {
  const files = await loadMigrations();
  const { client, queries } = recordingClient();
  await applySchemaMigrations(client);
  for (const file of files) {
    assert.ok(
      queries.some((sql) => sql.endsWith(`:: ${file.name}`)),
      file.name,
    );
  }
  assert.equal(queries.filter((sql) => sql === "BEGIN").length, files.length);
  assert.equal(queries.filter((sql) => sql === "COMMIT").length, files.length);
  assert.match(queries[0] ?? "", /pg_advisory_lock/);
  assert.match(queries.at(-1) ?? "", /pg_advisory_unlock/);
});

test("applySchemaMigrations skips files already recorded", async () => {
  const files = await loadMigrations();
  const { client, queries } = recordingClient({ applied: files.map((file) => file.name) });
  await applySchemaMigrations(client);
  assert.equal(queries.includes("BEGIN"), false);
  assert.match(queries.at(-1) ?? "", /pg_advisory_unlock/);
});

test("applySchemaMigrations rolls back a failed file and releases the lock", async () => {
  const { client, queries } = recordingClient({ failSql: true });
  await assert.rejects(() => applySchemaMigrations(client), /boom/);
  assert.ok(queries.includes("ROLLBACK"));
  assert.match(queries.at(-1) ?? "", /pg_advisory_unlock/);
});
