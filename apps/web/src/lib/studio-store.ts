import { randomBytes, randomUUID } from "node:crypto";
import type { AgentRecord, KnowledgeAsset } from "./demo-store.ts";
import { readDb, updateDb } from "./demo-store.ts";
import { applyProposal, containsPersonal, elicitWithModel, proposalsFromCorrection, proposalsFromTurns, type InterviewTurn } from "./studio-elicit.ts";
import { NDIS_EXAMPLE_NAME, NDIS_EXAMPLE_PITCH, NDIS_EXAMPLE_SLUG, ndisStudioConfig } from "./studio-ndis.ts";
import { acceptCsv, defaultCalculators } from "./studio-calc.ts";
import { visibleQuestions } from "./studio-intake.ts";
import { gatesPass, lineDiff, readinessGates, reportText, type Gate } from "./studio-run.ts";
import { emptyHard, type BenchResult, type OutputTemplate, type Proposal, type StudioConfig, type StudioRecord, type StudioReport, type StudioVersion } from "./studio-types.ts";
import { EXAMPLE_SELLER_ID, saveAgent } from "./marketplace.ts";
import { absentProof, sealPackage } from "./package.ts";
import { executeProof, hourlyOpen, proofConfig, scheduleProof } from "./proof.ts";
import { routerModelTransport } from "./model-router.ts";
import { execute } from "./runtime.ts";
import { steersJudge } from "./trust.ts";

export type StudioRunRecord = {
  id: string;
  slug: string;
  sellerId: string;
  buyerId: string;
  clientId: string;
  tier: string;
  priceMinor: number;
  answers: Record<string, string>;
  csv: string;
  report: StudioReport | null;
  brokerRequested: boolean;
  shareToken: string;
  createdAt: string;
  exampleData: boolean;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function blankStudioConfig(): StudioConfig {
  return {
    exampleData: false,
    specialty: { niche: "", audience: "", scope: [] },
    intake: [{
      id: "q_need",
      prompt: "What do you need to know first?",
      why: "The first question is the one a specialist asks before anything else.",
      required: true,
      kind: "text",
      options: [],
      fact: "",
      showWhen: null,
    }],
    products: [{ id: "prod_1", name: "Product" }],
    lenders: [{ id: "len_1", name: "Lender" }],
    cells: [{ productId: "prod_1", lenderId: "len_1", hard: emptyHard(), soft: "", softScore: 0 }],
    calculators: defaultCalculators(),
    playbooks: [],
    templates: [
      { id: "tpl_funding", kind: "funding_report", title: "Funding options report", preface: "" },
      { id: "tpl_pack", kind: "lender_pack", title: "Lender-ready pack", preface: "" },
      { id: "tpl_summary", kind: "client_summary", title: "Client summary", preface: "" },
    ],
    handoff: [{ id: "hand_deal", kind: "deal_size", threshold: 250000, note: "Stop and book the broker when the amount is this large." }],
    cases: [],
  };
}

export function initialStudio(config: StudioConfig, note: string): StudioRecord {
  const savedAt = new Date().toISOString();
  return {
    trainingConsent: false,
    publishedVersion: null,
    provenAt: null,
    versions: [{ number: 1, status: "draft", note, savedAt, config: clone(config) }],
    changelog: [{ at: savedAt, version: 1, action: "draft", note }],
    proposals: [],
    lastBench: null,
  };
}

export function latestConfig(studio: StudioRecord): StudioConfig {
  const version = studio.versions[studio.versions.length - 1];
  return version?.config ?? blankStudioConfig();
}

export function publishedConfig(studio: StudioRecord): StudioConfig | null {
  if (studio.publishedVersion == null) return null;
  return studio.versions.find((version) => version.number === studio.publishedVersion)?.config ?? null;
}

function commit(studio: StudioRecord, config: StudioConfig, note: string, status: StudioVersion["status"]): void {
  const savedAt = new Date().toISOString();
  const number = (studio.versions[studio.versions.length - 1]?.number ?? 0) + 1;
  studio.versions.push({ number, status, note, savedAt, config: clone(config) });
  studio.changelog.push({ at: savedAt, version: number, action: status, note });
  const keep = new Set<number>();
  if (studio.publishedVersion != null) keep.add(studio.publishedVersion);
  for (const version of studio.versions.slice(-30)) keep.add(version.number);
  studio.versions = studio.versions.filter((version) => keep.has(version.number));
}

function owned(dbAgents: AgentRecord[], ownerId: string, slug: string): AgentRecord | undefined {
  return dbAgents.find((agent) => agent.slug === slug && agent.ownerId === ownerId && agent.studio);
}

async function updateOwned(ownerId: string, slug: string, note: string, status: StudioVersion["status"], change: (config: StudioConfig, studio: StudioRecord) => StudioConfig | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await updateDb((db) => {
    const agent = owned(db.agents, ownerId, slug);
    if (!agent?.studio) return "missing" as const;
    const studio = agent.studio;
    const next = change(clone(latestConfig(studio)), studio);
    if (!next) return "reject" as const;
    commit(studio, next, note, status);
    agent.updatedAt = new Date().toISOString();
    agent.trainingConsent = studio.trainingConsent === true;
    return "ok" as const;
  });
  if (result !== "ok") return { ok: false, error: result === "missing" ? "missing" : "generic" };
  return { ok: true };
}

export async function createStudio(ownerId: string, name: string, fromExample: boolean): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 80) return { ok: false, error: "name" };
  const config = fromExample ? ndisStudioConfig() : blankStudioConfig();
  const saved = await saveAgent(ownerId, {
    name: clean,
    pitch: fromExample ? NDIS_EXAMPLE_PITCH : `Specialist agent: ${clean}`,
    description: fromExample
      ? "Example data. A specialist desk for an accounting firm with an NDIS provider client. Replace the panel before you treat it as your own."
      : `A specialist agent for ${clean}. The studio holds the intake, the rules, and the handoff.`,
    category: fromExample ? "research" : "operations",
    instructions: "Use only the buyer's answers. Do not invent a lender, a rate, or a measurement.",
    knowledge: [],
    trainingConsent: false,
    exampleTitle: "Sample",
    exampleBody: "Example output. Indicative, not a credit offer.",
    priceRaw: "490",
  }, "draft");
  if (!saved.ok) return saved;
  await updateDb((db) => {
    const agent = db.agents.find((item) => item.slug === saved.slug && item.ownerId === ownerId);
    if (!agent) return;
    agent.studio = initialStudio(config, fromExample ? "Started from the NDIS example. Example data." : "Blank studio.");
    agent.trainingConsent = false;
  });
  return { ok: true, slug: saved.slug };
}

export async function readOwnedStudio(ownerId: string, slug: string): Promise<{ agent: AgentRecord; studio: StudioRecord; config: StudioConfig } | null> {
  const db = await readDb();
  const agent = owned(db.agents, ownerId, slug);
  if (!agent?.studio) return null;
  return { agent, studio: agent.studio, config: latestConfig(agent.studio) };
}

export async function saveSpecialty(ownerId: string, slug: string, input: { niche: string; audience: string; scope: StudioConfig["specialty"]["scope"] }): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, "Saved specialty", "draft", (config) => {
    config.specialty = {
      niche: input.niche.trim().slice(0, 400),
      audience: input.audience.trim().slice(0, 400),
      scope: input.scope.length > 0
        ? input.scope.slice(0, 20).flatMap((rule) => {
          const action: "refuse" | "handoff" = rule.action === "handoff" ? "handoff" : "refuse";
          const match = rule.match.trim().slice(0, 120);
          const reason = rule.reason.trim().slice(0, 400);
          if (!match || !reason) return [];
          return [{ id: rule.id || `scope_${randomBytes(3).toString("hex")}`, field: rule.field, match, action, reason }];
        })
        : config.specialty.scope,
    };
    return config;
  });
}

export async function saveIntake(ownerId: string, slug: string, intake: StudioConfig["intake"]): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, "Saved intake", "draft", (config) => {
    if (intake.length === 0 || intake.length > 40) return null;
    config.intake = intake.map((question) => ({
      ...question,
      prompt: question.prompt.trim().slice(0, 200),
      why: question.why.trim().slice(0, 400),
      options: question.options.map((option) => option.trim()).filter(Boolean).slice(0, 12),
    })).filter((question) => question.prompt.length > 0);
    return config.intake.length > 0 ? config : null;
  });
}

export async function savePanel(ownerId: string, slug: string, input: Pick<StudioConfig, "products" | "lenders" | "cells">): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, "Saved the panel", "draft", (config) => {
    config.products = input.products.slice(0, 12);
    config.lenders = input.lenders.slice(0, 12);
    config.cells = input.cells.slice(0, 80);
    config.exampleData = config.exampleData && config.lenders.some((lender) => lender.name.startsWith("Example Lender"));
    return config;
  });
}

export async function saveCalculators(ownerId: string, slug: string, calculators: StudioConfig["calculators"]): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, "Saved calculators", "draft", (config) => {
    config.calculators = calculators;
    return config;
  });
}

export async function savePlaybooks(ownerId: string, slug: string, playbooks: StudioConfig["playbooks"]): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, "Saved playbooks", "draft", (config) => {
    config.playbooks = playbooks.slice(0, 30).filter((playbook) => playbook.see.trim() && playbook.do.trim() && playbook.because.trim());
    return config;
  });
}

export async function saveTemplates(ownerId: string, slug: string, templates: OutputTemplate[]): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, "Saved templates", "draft", (config) => {
    config.templates = templates.slice(0, 6);
    return config;
  });
}

export async function saveHandoff(ownerId: string, slug: string, handoff: StudioConfig["handoff"]): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, "Saved handoff", "draft", (config) => {
    config.handoff = handoff.slice(0, 8);
    return config;
  });
}

export async function setTrainingConsent(ownerId: string, slug: string, granted: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, granted ? "Training consent on" : "Training consent off", "draft", (config, studio) => {
    studio.trainingConsent = granted === true;
    return config;
  });
}

export async function addBenchCase(ownerId: string, slug: string, bench: StudioConfig["cases"][number]): Promise<{ ok: true } | { ok: false; error: string }> {
  const blob = `${bench.title}\n${bench.expect}\n${Object.values(bench.answers).join("\n")}\n${bench.csv}`;
  if (!bench.confirmedNoPersonal || containsPersonal(blob)) return { ok: false, error: "personal" };
  return updateOwned(ownerId, slug, "Added a test case", "draft", (config) => {
    config.cases = config.cases.concat({ ...bench, title: bench.title.trim().slice(0, 80), expect: bench.expect.trim().slice(0, 200) }).slice(-20);
    return config;
  });
}

export async function runBench(ownerId: string, slug: string): Promise<{ ok: true; results: BenchResult[]; coverage: number; gates: Gate[] } | { ok: false; error: string }> {
  const db = await readDb();
  const agent = owned(db.agents, ownerId, slug);
  if (!agent?.studio) return { ok: false, error: "missing" };
  const config = latestConfig(agent.studio);
  const results: BenchResult[] = [];
  for (const item of config.cases) {
    const sealed = sealPackage({
      id: `bench-${item.id}`,
      packageVersion: agent.studio.versions.at(-1)?.number ?? 1,
      sellerId: ownerId,
      slug,
      name: agent.name,
      kind: "studio",
      config,
      proof: absentProof(),
      instructions: agent.instructions,
      trainingConsent: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const response = await execute({
      channel: "studio",
      package: sealed,
      clientId: `bench-${ownerId}-${item.id}`,
      sellerId: ownerId,
      requestId: item.id,
      answers: item.answers,
      csv: item.csv,
      recordMemory: false,
    });
    const actual = response.report ? reportText(response.report).slice(0, 2000) : `Missing intake.`;
    const missing = response.report ? lineDiff(item.expect, actual) : [item.expect];
    results.push({
      id: item.id,
      title: item.title,
      pass: Boolean(response.report) && missing.length === 0,
      hardRule: item.hardRule,
      expected: item.expect,
      actual,
      missing,
      coverage: response.report?.coverage ?? 0,
    });
  }
  const coverage = results.length === 0 ? 0 : Math.round((results.reduce((sum, row) => sum + row.coverage, 0) / results.length) * 1000) / 1000;
  await updateDb((current) => {
    const row = owned(current.agents, ownerId, slug);
    if (!row?.studio) return;
    row.studio.lastBench = { at: new Date().toISOString(), coverage, results };
    commit(row.studio, latestConfig(row.studio), "Ran the test bench", "test");
  });
  const fresh = await readOwnedStudio(ownerId, slug);
  const gates = readinessGates({
    results,
    proof: fresh?.agent.proof ?? null,
    coverage: results.length === 0 ? null : coverage,
  });
  return { ok: true, results, coverage, gates };
}

export function proofMaterial(config: StudioConfig): { instructions: string; assets: KnowledgeAsset[]; examples: { title: string; body: string }[] } {
  const instructions = [
    `Specialist check for ${config.specialty.niche || "this desk"}.`,
    "Use the checklist. Leave a missing item left blank.",
    "Do not invent a lender, a rate, a certificate, or a measurement.",
    "If a required fact is missing, say it is missing.",
  ].join(" ");
  const assets: KnowledgeAsset[] = [];
  for (const playbook of config.playbooks) {
    const text = `If you see ${playbook.see}, do ${playbook.do} because ${playbook.because}`;
    if (steersJudge(text) || containsPersonal(text)) continue;
    assets.push({ id: playbook.id, kind: "rule", name: `${playbook.id}.txt`, text: text.slice(0, 4000) });
    if (assets.length >= 8) break;
  }
  const examples = config.cases.filter((item) => item.confirmedNoPersonal && !containsPersonal(item.expect)).slice(0, 2).map((item) => ({
    title: item.title.slice(0, 80),
    body: item.expect.slice(0, 500),
  }));
  return { instructions, assets, examples };
}

export async function publishStudio(ownerId: string, slug: string, mode: "listing" | "proven"): Promise<{ ok: true; slug: string; proofQueued: boolean } | { ok: false; error: string }> {
  const current = await readOwnedStudio(ownerId, slug);
  if (!current) return { ok: false, error: "missing" };
  const gates = readinessGates({
    results: current.studio.lastBench?.results ?? null,
    proof: current.agent.proof ?? null,
    coverage: current.studio.lastBench ? current.studio.lastBench.coverage : null,
  });
  if (mode === "proven" && !gatesPass(gates)) return { ok: false, error: "gates" };
  const config = current.config;
  const material = proofMaterial(config);
  const saved = await saveAgent(ownerId, {
    name: current.agent.name,
    pitch: current.agent.pitch,
    description: current.agent.description,
    category: current.agent.category,
    instructions: material.instructions,
    knowledge: material.assets.map((asset) => ({ name: asset.name, text: asset.text })),
    assets: material.assets,
    interview: [],
    trainingConsent: current.studio.trainingConsent === true,
    exampleTitle: material.examples[0]?.title || "Sample",
    exampleBody: material.examples[0]?.body || "Indicative, not a credit offer. A missing item is left blank.",
    priceRaw: String(current.agent.priceMinor / 100),
  }, "publish", slug);
  if (!saved.ok) return saved;
  await updateDb((db) => {
    const agent = owned(db.agents, ownerId, slug);
    if (!agent?.studio) return;
    const configNow = latestConfig(agent.studio);
    commit(agent.studio, configNow, mode === "proven" ? "Published as proven" : "Published the listing", "published");
    agent.studio.publishedVersion = agent.studio.versions[agent.studio.versions.length - 1]?.number ?? null;
    if (mode === "proven") agent.studio.provenAt = new Date().toISOString();
    agent.trainingConsent = agent.studio.trainingConsent === true;
    const sealed = sealPackage({
      id: randomUUID(),
      packageVersion: agent.studio.publishedVersion ?? 1,
      sellerId: ownerId,
      slug,
      name: agent.name,
      kind: "studio",
      config: latestConfig(agent.studio),
      proof: agent.proof
        ? { status: agent.proof.status, winRate: agent.proof.winRate, proven: agent.proof.proven, fixture: agent.proof.fixture, version: agent.proof.version }
        : absentProof(),
      instructions: agent.instructions,
      trainingConsent: agent.studio.trainingConsent === true,
    });
    agent.packages = (agent.packages ?? []).concat(sealed);
  });
  return { ok: true, slug: saved.slug, proofQueued: saved.proofQueued };
}

export async function rollbackStudio(ownerId: string, slug: string, version: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, `Rolled back to version ${version}`, "draft", (config, studio) => {
    const previous = studio.versions.find((item) => item.number === version);
    if (!previous) return null;
    return previous.config;
  });
}

export async function proposeInterview(ownerId: string, slug: string, turns: InterviewTurn[], env: Record<string, string | undefined> = process.env): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const current = await readOwnedStudio(ownerId, slug);
  if (!current) return { ok: false, error: "missing" };
  const made = await elicitWithModel(turns, current.config, env);
  if (!made.ok) return made;
  const saved = await updateOwned(ownerId, slug, "Proposed items from three cases", "draft", (config, studio) => {
    studio.proposals = studio.proposals.filter((item) => item.status !== "proposed" || item.source !== "interview").concat(made.proposals);
    return config;
  });
  if (!saved.ok) return saved;
  return { ok: true, count: made.proposals.length };
}

export async function proposeCorrection(ownerId: string, slug: string, input: { before: string; after: string; reason: string }): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const current = await readOwnedStudio(ownerId, slug);
  if (!current) return { ok: false, error: "missing" };
  const made = proposalsFromCorrection({ ...input, config: current.config });
  if (!made.ok) return made;
  const saved = await updateOwned(ownerId, slug, "Proposed a correction", "draft", (config, studio) => {
    studio.proposals = studio.proposals.concat(made.proposals);
    return config;
  });
  if (!saved.ok) return saved;
  return { ok: true, count: made.proposals.length };
}

export async function decideProposal(ownerId: string, slug: string, proposalId: string, decision: "approved" | "rejected", months: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, decision === "approved" ? "Approved a proposal" : "Rejected a proposal", "draft", (config, studio) => {
    const proposal = studio.proposals.find((item) => item.id === proposalId && item.status === "proposed");
    if (!proposal) return null;
    proposal.status = decision;
    if (decision === "rejected") return config;
    const edited: Proposal = proposal.kind === "rule" && months != null
      ? { ...proposal, hard: { ...proposal.hard, minTradingMonths: months } }
      : proposal;
    return applyProposal(config, edited);
  });
}

export function studioGates(agent: AgentRecord): Gate[] {
  const studio = agent.studio;
  if (!studio) return [];
  return readinessGates({
    results: studio.lastBench?.results ?? null,
    proof: agent.proof ?? null,
    coverage: studio.lastBench ? studio.lastBench.coverage : null,
  });
}

async function priceFor(slug: string): Promise<{ sellerId: string; priceMinor: number; name: string; config: StudioConfig } | null> {
  if (slug === NDIS_EXAMPLE_SLUG) {
    return { sellerId: EXAMPLE_SELLER_ID, priceMinor: 49000, name: NDIS_EXAMPLE_NAME, config: ndisStudioConfig() };
  }
  const db = await readDb();
  const agent = db.agents.find((item) => item.slug === slug && item.status === "published" && item.studio);
  const config = agent?.studio ? publishedConfig(agent.studio) : null;
  if (!agent || !config) return null;
  return { sellerId: agent.ownerId, priceMinor: agent.priceMinor, name: agent.name, config };
}

export async function startRun(buyerId: string, slug: string, tier: string): Promise<{ ok: true; run: StudioRunRecord } | { ok: false; error: string }> {
  const published = await priceFor(slug);
  if (!published) return { ok: false, error: "missing" };
  const run: StudioRunRecord = {
    id: randomUUID(),
    slug,
    sellerId: published.sellerId,
    buyerId,
    clientId: randomUUID(),
    tier,
    priceMinor: published.priceMinor,
    answers: {},
    csv: "",
    report: null,
    brokerRequested: false,
    shareToken: randomBytes(16).toString("hex"),
    createdAt: new Date().toISOString(),
    exampleData: published.config.exampleData,
  };
  await updateDb((db) => {
    db.studioRuns = db.studioRuns ?? [];
    db.studioRuns.push(run);
  });
  return { ok: true, run };
}

export async function readRun(viewerId: string, runId: string, admin = false): Promise<{ run: StudioRunRecord; config: StudioConfig } | null> {
  const db = await readDb();
  const run = (db.studioRuns ?? []).find((item) => item.id === runId);
  if (!run) return null;
  if (!admin && run.buyerId !== viewerId && run.sellerId !== viewerId) return null;
  const published = await priceFor(run.slug);
  if (!published) return null;
  return { run: run as StudioRunRecord, config: published.config };
}

export async function saveRunAnswers(viewerId: string, runId: string, answers: Record<string, string>): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await updateDb((db) => {
    const run = (db.studioRuns ?? []).find((item) => item.id === runId && item.buyerId === viewerId);
    if (!run) return false;
    run.answers = { ...run.answers, ...answers };
    run.report = null;
    return true;
  });
  return result ? { ok: true } : { ok: false, error: "missing" };
}

export async function completeRun(viewerId: string, runId: string, csvName: string, csvBytes: number, csvText: string, env: Record<string, string | undefined> = process.env): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const accepted = csvBytes === 0 && csvText === "" ? { ok: true as const, text: "" } : acceptCsv(csvName, csvBytes, csvText);
  if (!accepted.ok) return accepted;
  const loaded = await readRun(viewerId, runId);
  if (!loaded || loaded.run.buyerId !== viewerId) return { ok: false, error: "missing" };
  const sealed = sealPackage({
    id: `run-${runId}`,
    packageVersion: 1,
    sellerId: loaded.run.sellerId,
    slug: loaded.run.slug,
    name: "Studio run",
    kind: "studio",
    config: loaded.config,
    proof: absentProof(),
    instructions: "Apply the sealed package. Do not invent a lender or a rate.",
    trainingConsent: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const response = await execute({
    channel: "studio",
    package: sealed,
    clientId: loaded.run.clientId,
    sellerId: loaded.run.sellerId,
    requestId: runId,
    answers: loaded.run.answers,
    csv: accepted.text,
    recordMemory: true,
  }, env);
  if (response.error === "intake" || !response.report) return { ok: false, error: "intake" };
  const report = response.report;
  await updateDb((db) => {
    const run = (db.studioRuns ?? []).find((item) => item.id === runId && item.buyerId === viewerId);
    if (!run) return;
    run.csv = accepted.text;
    run.report = report;
  });
  return { ok: true, runId };
}

export async function requestBroker(viewerId: string, runId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await updateDb((db) => {
    const run = (db.studioRuns ?? []).find((item) => item.id === runId && item.buyerId === viewerId);
    if (!run?.report) return false;
    run.brokerRequested = true;
    return true;
  });
  return result ? { ok: true } : { ok: false, error: "missing" };
}

export async function readShare(token: string): Promise<{ token: string; questions: StudioConfig["intake"]; answers: Record<string, string>; exampleData: boolean; name: string } | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const db = await readDb();
  const run = (db.studioRuns ?? []).find((item) => item.shareToken === token);
  if (!run) return null;
  const published = await priceFor(run.slug);
  if (!published) return null;
  return {
    token,
    questions: visibleQuestions(published.config.intake, run.answers),
    answers: run.answers,
    exampleData: published.config.exampleData,
    name: published.name,
  };
}

export async function saveShare(token: string, answers: Record<string, string>): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[a-f0-9]{32}$/.test(token)) return { ok: false, error: "missing" };
  const result = await updateDb((db) => {
    const run = (db.studioRuns ?? []).find((item) => item.shareToken === token);
    if (!run) return false;
    run.answers = { ...run.answers, ...answers };
    run.report = null;
    return true;
  });
  return result ? { ok: true } : { ok: false, error: "missing" };
}

export async function leadsFor(ownerId: string, slug: string): Promise<StudioRunRecord[]> {
  const db = await readDb();
  return (db.studioRuns ?? []).filter((run) => run.sellerId === ownerId && run.slug === slug && run.brokerRequested) as StudioRunRecord[];
}

export async function ensureExampleProof(env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = proofConfig(env);
  const gate = await updateDb((db) => {
    db.exampleProofs = db.exampleProofs ?? {};
    const existing = db.exampleProofs[NDIS_EXAMPLE_SLUG];
    if (existing?.status === "complete" && (!config.live || existing.fixture === false)) return { action: "skip" as const };
    if (existing?.status === "running" || existing?.status === "queued") return { action: "skip" as const };
    const recent = (db.exampleProofRuns ?? []).filter((stamp) => Date.parse(stamp) >= Date.now() - 60 * 60 * 1000);
    if (!hourlyOpen(recent, Date.now(), config.hourlyCap)) {
      return { action: "hourly" as const };
    }
    db.exampleProofRuns = recent.concat(new Date().toISOString()).slice(-50);
    db.exampleProofs[NDIS_EXAMPLE_SLUG] = {
      id: existing?.id ?? randomUUID(),
      version: 1,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      model: "pending",
      judgeModel: "pending",
      fixture: !config.live,
      tests: 0,
      wins: 0,
      ties: 0,
      losses: 0,
      winRate: 0,
      proven: false,
      rubric: [],
      examples: [],
      costMinor: 0,
      capped: false,
    };
    return { action: "run" as const };
  });
  if (gate.action !== "run") return;
  const material = proofMaterial(ndisStudioConfig());
  try {
    const result = await executeProof({
      category: "research",
      instructions: material.instructions,
      assets: material.assets,
      interview: [],
      examples: material.examples.length > 0 ? material.examples : [{ title: "Wages file", body: "A missing document is left blank. No lender rate was invented." }],
      version: 1,
      config,
      transport: config.live ? routerModelTransport(env) : undefined,
    });
    await updateDb((db) => {
      const current = db.exampleProofs?.[NDIS_EXAMPLE_SLUG];
      if (!current || current.status !== "running") return;
      db.exampleProofs = db.exampleProofs ?? {};
      db.exampleProofs[NDIS_EXAMPLE_SLUG] = { ...result, id: current.id, startedAt: current.startedAt };
    });
  } catch {
    await updateDb((db) => {
      const current = db.exampleProofs?.[NDIS_EXAMPLE_SLUG];
      if (!current || current.status !== "running") return;
      current.status = "failed";
      current.finishedAt = new Date().toISOString();
      current.error = "run";
      current.proven = false;
    });
  }
}

export function queueStudioProof(slug: string): void {
  scheduleProof(slug);
}

export { proposalsFromTurns };
