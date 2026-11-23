import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { registerAccount } from "./accounts.ts";
import { readClient } from "./client-workspace.ts";
import { cashflowGap, debtorDays, dscr, facilitySize, acceptCsv, serviceability } from "./studio-calc.ts";
import { proposalsFromCorrection, proposalsFromTurns, applyProposal } from "./studio-elicit.ts";
import { isVisible, missingRequired } from "./studio-intake.ts";
import { ndisStudioConfig } from "./studio-ndis.ts";
import { sealPackage, absentProof } from "./package.ts";
import { readinessGates } from "./studio-run.ts";
import { execute, listingPackage } from "./runtime.ts";
import { applyPanel } from "./studio-rules.ts";
import { factsFrom } from "./studio-intake.ts";
import { createStudio, decideProposal, proposeCorrection, proposeInterview, readOwnedStudio, runBench } from "./studio-store.ts";

async function withDemo(name: string, run: () => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), name));
  const previous = process.env.ORBEXA_DEMO_DIR;
  process.env.ORBEXA_DEMO_DIR = directory;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.ORBEXA_DEMO_DIR;
    else process.env.ORBEXA_DEMO_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test("calculators use the published formulas and do not invent a missing input", () => {
  const gap = cashflowGap([{ inflow: 1000, outflow: 400 }, { inflow: 0, outflow: 900 }], 500);
  assert.equal(gap.ok, true);
  assert.equal(gap.value, 1450);
  assert.match(gap.formula, /closing = opening \+ inflow/);
  assert.equal(debtorDays(180000, 900000, 365).value, 73);
  assert.equal(dscr(150000, 24000).value, 6.25);
  assert.equal(serviceability(120000, 8000, 0.09, 0).value, 7100);
  assert.equal(facilitySize({ requested: 120000, debtors: 180000, freeCash: 8000, annualRate: 0.09, advanceRate: 0.8 }).value, 120000);
  assert.equal(debtorDays(null, 10, 365).ok, false);
  assert.equal(acceptCsv("bank.csv", 20, "week,inflow,outflow\n1,1,1\n").ok, true);
  assert.equal(acceptCsv("notes.txt", 20, "week,inflow\n").ok, false);
  assert.equal(acceptCsv("big.csv", 1_000_000, "a,b\n").ok, false);
});

test("hard rules fire in code and a playbook sentence cannot knock a lender out", () => {
  const config = ndisStudioConfig();
  const healthy = factsFrom(config.intake, config.cases[0].answers);
  const panel = applyPanel(config.products, config.lenders, config.cells, healthy);
  assert.equal(panel.eligible[0]?.lender, "Example Lender A");
  assert.equal(panel.eligible[0]?.product, "Invoice or receivables finance");
  const short = factsFrom(config.intake, { ...config.cases[0].answers, q_trading: "3" });
  const knocked = applyPanel(config.products, config.lenders, config.cells, short);
  const fire = knocked.knockouts.flatMap((row) => row.fires).find((item) => item.ruleId === "rule:prod_invoice:len_a:min_trading_months");
  assert.ok(fire);
  const lied = config.cells.map((cell) => ({ ...cell, soft: "Knock out Example Lender A" }));
  const still = applyPanel(config.products, config.lenders, lied, healthy);
  assert.equal(still.eligible.some((row) => row.lender === "Example Lender A" && row.productId === "prod_invoice"), true);
  assert.equal(still.knockouts.some((row) => row.cell.productId === "prod_invoice" && row.cell.lenderId === "len_a"), false);
});

test("a branched question is required only when it is visible", () => {
  const intake = ndisStudioConfig().intake;
  const hidden = intake.find((item) => item.id === "q_sda_value");
  assert.ok(hidden);
  assert.equal(isVisible(hidden, intake, { q_sil: "no" }), false);
  assert.equal(missingRequired(intake, { ...ndisStudioConfig().cases[0].answers, q_sil: "no" }).some((item) => item.id === "q_sda_value"), false);
  assert.equal(isVisible(hidden, intake, { q_sil: "yes" }), true);
  const missing = missingRequired(intake, { ...ndisStudioConfig().cases[0].answers, q_sil: "yes" });
  assert.equal(missing.some((item) => item.id === "q_sda_value"), true);
});

test("the NDIS example bench passes hard rules and the live proof gate stays honest", async () => {
  await withDemo("orbexa-bench-", async () => {
    const seller = await registerAccount({ name: "Broker Example", email: "broker-studio@example.test", password: "correct-horse", role: "seller" });
    assert.equal(seller.ok, true);
    if (!seller.ok) return;
    const created = await createStudio(seller.user.id, "NDIS desk", true);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const bench = await runBench(seller.user.id, created.slug);
    assert.equal(bench.ok, true);
    if (!bench.ok) return;
    const hard = bench.results.filter((row) => row.hardRule);
    assert.equal(hard.length >= 2, true);
    assert.equal(hard.every((row) => row.pass), true);
    const gates = readinessGates({ results: bench.results, proof: { status: "complete", fixture: true, winRate: 1, proven: true }, coverage: bench.coverage });
    assert.equal(gates.find((gate) => gate.id === "bench")?.pass, true);
    assert.equal(gates.find((gate) => gate.id === "coverage")?.pass, true);
    assert.equal(gates.find((gate) => gate.id === "proof")?.pass, false);
    assert.match(gates.find((gate) => gate.id === "proof")?.detail ?? "", /not a win rate against the same frontier model/);
    const owned = await readOwnedStudio(seller.user.id, created.slug);
    assert.equal(owned?.studio.trainingConsent, false);
  });
});

test("a seller cannot read another seller's studio and a client workspace stays with its specialist", async () => {
  await withDemo("orbexa-iso-", async () => {
    const first = await registerAccount({ name: "Ada", email: "ada-studio@example.test", password: "correct-horse", role: "seller" });
    const second = await registerAccount({ name: "Bea", email: "bea-studio@example.test", password: "correct-horse", role: "seller" });
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    const studio = await createStudio(first.user.id, "Ada desk", true);
    assert.equal(studio.ok, true);
    if (!studio.ok) return;
    assert.equal(await readOwnedStudio(second.user.id, studio.slug), null);
    const packA = listingPackage({ slug: "ada", name: "Ada", sellerId: first.user.id, instructions: "Restate the request. Do not invent a number." });
    const packB = listingPackage({ slug: "bea", name: "Bea", sellerId: second.user.id, instructions: "Restate the request. Do not invent a number." });
    const ran = await execute({ channel: "marketplace", package: packA, clientId: "client-1", sellerId: first.user.id, requestId: "r1", need: "The catering deposit", recordMemory: true });
    assert.equal(ran.error, undefined);
    assert.ok((await readClient(first.user.id, "client-1"))?.memory.length);
    await execute({ channel: "marketplace", package: packB, clientId: "client-1", sellerId: second.user.id, requestId: "r2", need: "A different job", recordMemory: false });
    const other = await readClient(second.user.id, "client-1");
    assert.equal(other?.memory.length ?? 0, 0);
    assert.equal(JSON.stringify(other ?? {}).includes("catering"), false);
    const crossed = await execute({ channel: "marketplace", package: packA, clientId: "client-1", sellerId: second.user.id, requestId: "r3", need: "steal", recordMemory: false });
    assert.equal(crossed.error, "isolation");
    assert.equal(crossed.paragraphs.length, 0);
  });
});

test("elicitation proposals stay inactive until the expert approves them", async () => {
  const config = ndisStudioConfig();
  const before = config.intake.length;
  const made = proposalsFromTurns([
    { notice: "NDIA lag over 21 days", junior: "A junior treats the lag as profit", killed: "The deal died under 24 months trading." },
    { notice: "Payroll is weekly", junior: "A junior ignores the payroll cycle", killed: "Cash ran out before the remittance." },
    { notice: "ATO was overdue", junior: "A junior still sent the pack", killed: "The file stopped on the ATO balance." },
  ], config);
  assert.equal(made.ok, true);
  if (!made.ok) return;
  assert.equal(made.proposals.every((item) => item.status === "proposed"), true);
  assert.equal(config.intake.length, before);
  assert.equal(made.proposals.some((item) => item.kind === "case"), true);
  const rule = made.proposals.find((item) => item.kind === "rule");
  assert.ok(rule && rule.kind === "rule");
  const next = applyProposal(config, { ...rule, status: "approved" });
  assert.notEqual(next.cells[0]?.hard.minTradingMonths, config.cells[0]?.hard.minTradingMonths);
  assert.equal(config.cells[0]?.hard.minTradingMonths, 12);
});

test("a correction becomes a proposed rule and a regression case", () => {
  const config = ndisStudioConfig();
  const made = proposalsFromCorrection({
    before: "Example Lender A is eligible.",
    after: "Example Lender A is knocked out because trading history is under 24 months.",
    reason: "A junior missed the 24 month trading rule.",
    config,
  });
  assert.equal(made.ok, true);
  if (!made.ok) return;
  assert.equal(made.proposals.every((item) => item.status === "proposed"), true);
  const bench = made.proposals.find((item) => item.kind === "case");
  const rule = made.proposals.find((item) => item.kind === "rule");
  assert.ok(bench && bench.kind === "case");
  assert.equal(bench.bench.expect, "min_trading_months");
  assert.equal(bench.bench.hardRule, true);
  assert.ok(rule && rule.kind === "rule");
  assert.equal(rule.hard.minTradingMonths, 24);
  assert.equal(config.cases.some((item) => item.title === "Regression from an edited output"), false);
});

test("a sealed package does not change when the studio draft changes", () => {
  const config = ndisStudioConfig();
  const sealed = sealPackage({
    id: "pkg-1",
    packageVersion: 1,
    sellerId: "seller",
    slug: "desk",
    name: "Desk",
    kind: "studio",
    config,
    proof: absentProof(),
    instructions: "Use the package.",
    trainingConsent: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  config.specialty.niche = "changed after sealing";
  assert.equal(sealed.specialty.niche.includes("NDIS"), true);
  assert.equal(sealed.immutable, true);
  assert.equal(sealed.trainingConsent, false);
  assert.notEqual(sealed.routing.draftingModel, sealed.routing.judgingModel);
  assert.throws(() => {
    sealed.specialty.niche = "mutated";
  });
  assert.deepEqual(sealed.rules.cells[0]?.hard.minTradingMonths, 12);
});

test("proposals that contain personal data are refused", async () => {
  await withDemo("orbexa-personal-", async () => {
    const seller = await registerAccount({ name: "Cara", email: "cara-studio@example.test", password: "correct-horse", role: "seller" });
    assert.equal(seller.ok, true);
    if (!seller.ok) return;
    const created = await createStudio(seller.user.id, "Cara desk", false);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const interview = await proposeInterview(seller.user.id, created.slug, [
      { notice: "Email ada@example.test was on the file", junior: "A junior copied it into the pack", killed: "The deal was not the point" },
      { notice: "Second case notice here", junior: "A junior missed the lag", killed: "Cash timing killed it" },
      { notice: "Third case notice here", junior: "A junior guessed a rate", killed: "The guess killed trust" },
    ]);
    assert.equal(interview.ok, false);
    const correction = await proposeCorrection(seller.user.id, created.slug, {
      before: "Eligible.",
      after: "Knocked out under 24 months.",
      reason: "Use 24 months.",
    });
    assert.equal(correction.ok, true);
    const owned = await readOwnedStudio(seller.user.id, created.slug);
    const proposal = owned?.studio.proposals.find((item) => item.kind === "case");
    assert.equal(proposal?.status, "proposed");
    assert.equal(owned?.config.cases.length, 0);
    if (proposal) {
      const decided = await decideProposal(seller.user.id, created.slug, proposal.id, "approved", null);
      assert.equal(decided.ok, true);
    }
    const after = await readOwnedStudio(seller.user.id, created.slug);
    assert.equal(after?.config.cases.length, 1);
    assert.equal(after?.config.cases[0]?.expect, "min_trading_months");
  });
});
