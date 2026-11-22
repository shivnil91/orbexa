import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

export async function loadMigrations(): Promise<Array<{ name: string; sql: string }>> {
  const names = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(path.join(migrationsDir, name), "utf8"),
    })),
  );
  return files;
}
