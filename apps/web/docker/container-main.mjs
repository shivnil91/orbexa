import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applySchemaMigrations } from "../../../packages/db/src/apply-migrations.ts";
import { databaseUrlFromEnv } from "../src/lib/database-url.ts";
import { assertNoLiveStripeKey } from "../src/lib/live-key.ts";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "serve";

function redact(error, password) {
  let message = error instanceof Error ? error.message : String(error);
  if (password) {
    message = message.split(password).join("[redacted]");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    message = message.split(databaseUrl).join("[redacted]");
  }
  return message;
}

async function migrate() {
  const password = process.env.DB_PASSWORD ?? "";
  let connectionString = "";
  try {
    connectionString = databaseUrlFromEnv(process.env);
    process.env.DATABASE_URL = connectionString;
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      await applySchemaMigrations(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  } catch (error) {
    console.error(redact(error, password));
    process.exit(1);
  }
}

function serve() {
  process.env.HOSTNAME = "0.0.0.0";
  if (!process.env.PORT) {
    process.env.PORT = "43124";
  }
  const child = spawn(process.execPath, ["server.js"], {
    cwd: appDir,
    env: process.env,
    stdio: "inherit",
  });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

try {
  assertNoLiveStripeKey(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "refusing to start");
  process.exit(1);
}

if (mode === "migrate") {
  await migrate();
  process.exit(0);
}

if (mode !== "serve") {
  console.error("usage: node container-main.mjs [serve|migrate]");
  process.exit(1);
}

if (process.env.DB_HOST) {
  await migrate();
}
serve();
