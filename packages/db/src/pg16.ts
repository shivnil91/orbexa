import { Client } from "pg";

const adminUrl = "postgres://orbexa:orbexa_local_only@127.0.0.1:5432/postgres";

export type PgHandle = {
  exec(sql: string): Promise<void>;
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};

export async function recreateDatabase(name: string): Promise<PgHandle> {
  assertName(name);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return connectDatabase(name);
}

export async function connectDatabase(name: string): Promise<PgHandle> {
  assertName(name);
  const client = new Client({
    connectionString: `postgres://orbexa:orbexa_local_only@127.0.0.1:5432/${name}`,
  });
  await client.connect();
  return {
    async exec(sql: string) {
      await client.query(sql);
    },
    async query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const result = params ? await client.query(sql, [...params]) : await client.query(sql);
      if (Array.isArray(result)) {
        const last = result.at(-1);
        return { rows: (last?.rows ?? []) as T[] };
      }
      return { rows: result.rows as T[] };
    },
    end() {
      return client.end();
    },
  };
}

function assertName(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error("invalid database name");
  }
}
