import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readDb } from "./demo-store.ts";
import { seedExamples } from "./seed.ts";
import { NDIS_EXAMPLE_SLUG } from "./studio-ndis.ts";

test("example listings and the NDIS proof seed once and do not call a model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-seed-"));
  const previous = process.env.ORBEXA_DEMO_DIR;
  const previousStore = process.env.ORBEXA_STORE;
  const previousHost = process.env.DB_HOST;
  delete process.env.ORBEXA_STORE;
  delete process.env.DB_HOST;
  process.env.ORBEXA_DEMO_DIR = directory;
  const started = Date.now();
  try {
    const first = await seedExamples();
    const second = await seedExamples();
    assert.equal(first.proof, "written");
    assert.equal(second.proof, "kept");
    assert.equal(first.listings, second.listings);
    assert.ok(Date.now() - started < 3000);
    const db = await readDb();
    const proof = db.exampleProofs?.[NDIS_EXAMPLE_SLUG];
    assert.equal(proof?.status, "complete");
    assert.equal(proof?.fixture, true);
    assert.equal(proof?.model, "fixture");
    const sellers = db.users.filter((user) => user.email === "example-seller@orbexa.invalid");
    assert.equal(sellers.length, 1);
    const stored = JSON.parse(await readFile(path.join(directory, "example-listings.json"), "utf8")) as Array<{ slug: string }>;
    const slugs = stored.map((row) => row.slug);
    assert.equal(slugs.filter((slug) => slug === NDIS_EXAMPLE_SLUG).length, 1);
    assert.ok(slugs.length > 1);
  } finally {
    if (previous === undefined) delete process.env.ORBEXA_DEMO_DIR;
    else process.env.ORBEXA_DEMO_DIR = previous;
    if (previousStore === undefined) delete process.env.ORBEXA_STORE;
    else process.env.ORBEXA_STORE = previousStore;
    if (previousHost === undefined) delete process.env.DB_HOST;
    else process.env.DB_HOST = previousHost;
    await rm(directory, { recursive: true, force: true });
  }
});
