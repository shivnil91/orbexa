import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { registerAccount, updateProfile, verifyCredential } from "./accounts.ts";
import { buildCatalog, recommend } from "./marketplace.ts";
import { acceptKnowledgeFile, blindOrder, buyerDraft, cleanAssetName, proofGroup, retrieveAssets, toPublicProof } from "./trust.ts";
import type { ProofRecord } from "./demo-store.ts";

test("proven agents sort above a closer unproven match", () => {
  const items = buildCatalog();
  const proven = structuredClone(items.find((item) => item.slug === "example-support-reply"));
  const closer = items.find((item) => item.slug === "example-clause-drafter");
  if (!proven || !closer) throw new Error("examples missing");
  const proof: ProofRecord = {
    id: "proof",
    version: 1,
    status: "complete",
    startedAt: "2026-05-01T00:00:00.000Z",
    finishedAt: "2026-05-01T00:00:00.000Z",
    model: "fixture",
    judgeModel: "fixture",
    fixture: true,
    tests: 10,
    wins: 8,
    ties: 2,
    losses: 0,
    winRate: 0.8,
    proven: true,
    rubric: [],
    examples: [],
    costMinor: 30,
    capped: false,
  };
  proven.proof = toPublicProof(proof);
  proven.pitch = "A short limitation note";
  proven.description = "A calm reply.";
  proven.instructions = "Restate the next step.";
  const ranked = recommend("draft a limitation clause", items.map((item) => item.slug === proven.slug ? proven : item));
  assert.equal(proofGroup(proven.proof), 1);
  assert.equal(ranked[0]?.item.slug, proven.slug);
  assert.notEqual(ranked[0]?.item.slug, closer.slug);
});

test("retrieval stays on the assets it was given and the buyer draft hides them", () => {
  const own = retrieveAssets([
    { id: "1", kind: "rule", name: "own.txt", text: "Load case LC2 must be named before a result is given to the buyer." },
  ], "Check bridge load case LC2");
  const other = retrieveAssets([
    { id: "2", kind: "rule", name: "other.txt", text: "This other seller file mentions a different topic entirely." },
  ], "Check bridge load case LC2");
  assert.equal(own[0]?.name, "own.txt");
  assert.equal(other.some((asset) => asset.text.includes("other seller")), true);
  const draft = buyerDraft({ name: "Load checker", need: "Check LC2", retrieved: own.length });
  assert.equal(draft.join("\n").includes("must be named before a result"), false);
  assert.match(draft[0] ?? "", /Demo fixture/);
});

test("blind order is stable and uses both sides", () => {
  const orders = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => blindOrder(id)));
  assert.equal(orders.size, 2);
  assert.equal(blindOrder("a"), blindOrder("a"));
});

test("knowledge uploads are limited to small text files and names cannot carry markup", () => {
  assert.equal(cleanAssetName('<script>alert(1)</script>.txt'), "scriptalert1script.txt");
  const html = acceptKnowledgeFile("notes.html", 20, "<script>alert(1)</script>");
  assert.equal(html.ok, false);
  const svg = acceptKnowledgeFile("picture.svg", 20, "<svg onload=alert(1)>");
  assert.equal(svg.ok, false);
  const big = acceptKnowledgeFile("notes.txt", 100_001, "hello");
  assert.equal(big.ok, false);
  const fine = acceptKnowledgeFile("rules.txt", 32, "Do not invent a measurement.");
  assert.equal(fine.ok, true);
  if (fine.ok) assert.equal(fine.name, "rules.txt");
});

test("a seller cannot mark a credential verified", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-trust-"));
  const previous = process.env.ORBEXA_DEMO_DIR;
  process.env.ORBEXA_DEMO_DIR = directory;
  try {
    const created = await registerAccount({ name: "Ada Lovelace", email: "ada-trust@example.com", password: "correct-horse", role: "seller" });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const profile = await updateProfile(created.user.id, {
      experience: "Twelve years writing state bid matrices.",
      links: [{ label: "Notes", href: "https://example.com/notes" }],
      credentialTitle: "Professional engineer",
      credentialIssuer: "Self",
      trainingConsent: false,
    });
    assert.equal(profile.ok, true);
    if (!profile.ok) return;
    assert.equal(profile.user.credentials[0]?.status, "self_declared");
    assert.equal(profile.user.trainingConsent, false);
    const denied = await verifyCredential({ id: created.user.id, admin: false }, created.user.id, profile.user.credentials[0]?.id ?? "");
    assert.equal(denied.ok, false);
    const granted = await verifyCredential({ id: "admin-user", admin: true }, created.user.id, profile.user.credentials[0]?.id ?? "");
    assert.equal(granted.ok, true);
    const again = await updateProfile(created.user.id, {
      experience: "Twelve years writing state bid matrices.",
      links: [{ label: "Notes", href: "https://example.com/notes" }],
      credentialTitle: "Professional engineer",
      credentialIssuer: "Self",
      trainingConsent: false,
    });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.user.credentials[0]?.status, "verified");
  } finally {
    if (previous === undefined) delete process.env.ORBEXA_DEMO_DIR;
    else process.env.ORBEXA_DEMO_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
