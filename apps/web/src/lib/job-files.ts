import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const locks = new Map<string, Promise<unknown>>();

export function jobDirectory(): string {
  return process.env.ORBEXA_JOB_DIR ?? path.join(os.tmpdir(), "orbexa-m5-jobs");
}

function jobPath(id: string): string {
  if (!UUID.test(id)) {
    throw new Error("job id is not a uuid");
  }
  return path.join(jobDirectory(), `${id}.json`);
}

export async function withJobLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous.then(work, work);
  locks.set(id, run.then(() => undefined, () => undefined));
  return run;
}

export async function readJobFile(id: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(jobPath(id), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function writeJobFile(job: { id: string }): Promise<void> {
  await mkdir(jobDirectory(), { recursive: true });
  await writeFile(jobPath(job.id), JSON.stringify(job));
}

export async function listJobFiles(): Promise<Record<string, unknown>[]> {
  let names: string[] = [];
  try {
    names = await readdir(/*turbopackIgnore: true*/ jobDirectory());
  } catch {
    return [];
  }
  const jobs: Record<string, unknown>[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!UUID.test(id)) continue;
    const job = await readJobFile(id);
    if (job) jobs.push(job);
  }
  return jobs;
}
