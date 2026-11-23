import { randomBytes, randomUUID } from "node:crypto";
import type { AgentRecord, KnowledgeAsset } from "./demo-store.ts";
import { readDb, updateDb } from "./demo-store.ts";
import { applyProposal, containsPersonal, elicitWithModel, proposalsFromCorrection, proposalsFromTurns, type InterviewTurn } from "./studio-elicit.ts";
import { NDIS_EXAMPLE_NAME, NDIS_EXAMPLE_PITCH, NDIS_EXAMPLE_SLUG, ndisStudioConfig } from "./studio-ndis.ts";
import { acceptCsv, defaultCalculators } from "./studio-calc.ts";
import { visibleQuestions } from "./studio-intake.ts";
import { gatesPass, hardCaseSatisfied, lineDiff, readinessGates, reportText, studioConfigHash, type Gate } from "./studio-run.ts";
import { emptyHard, type BenchResult, type OutputTemplate, type Proposal, type StudioConfig, type StudioRecord, type StudioReport, type StudioVersion } from "./studio-types.ts";
import { EXAMPLE_SELLER_ID, saveAgent } from "./marketplace.ts";
import { absentProof, configFromPackage, sealPackage, verifyPackage, type AgentPackage } from "./package.ts";
import { scheduleProof } from "./proof.ts";
import { seedExamples } from "./seed.ts";
import { execute } from "./runtime.ts";
import { contentHash, steersJudge } from "./trust.ts";

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
    publishedPackageHash: null,
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

export async function runBench(ownerId: string, slug: string): Promise<{ ok: true; results: BenchResult[]; coverage: number; gates: Gate[]; configHash: string } | { ok: false; error: string }> {
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
    const hardOk = !item.hardRule || (response.report ? hardCaseSatisfied(item.expect, response.report) : false);
    results.push({
      id: item.id,
      title: item.title,
      pass: Boolean(response.report) && missing.length === 0 && hardOk,
      hardRule: item.hardRule,
      expected: item.expect,
      actual,
      missing,
      coverage: response.report?.coverage ?? 0,
    });
  }
  const coverage = results.length === 0 ? 0 : Math.round((results.reduce((sum, row) => sum + row.coverage, 0) / results.length) * 1000) / 1000;
  const configHash = studioConfigHash(config);
  await updateDb((current) => {
    const row = owned(current.agents, ownerId, slug);
    if (!row?.studio) return;
    row.studio.lastBench = { at: new Date().toISOString(), coverage, configHash, results };
    commit(row.studio, latestConfig(row.studio), "Ran the test bench", "test");
  });
  const fresh = await readOwnedStudio(ownerId, slug);
  const gates = fresh ? studioGates(fresh.agent) : [];
  return { ok: true, results, coverage, gates, configHash };
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
    if (steersJudge(text) || containsPersonal(text) || /[<>]/.test(text)) continue;
    assets.push({ id: playbook.id, kind: "rule", name: `${playbook.id}.txt`, text: text.slice(0, 4000) });
    if (assets.length >= 8) break;
  }
  const examples = config.cases.filter((item) => item.confirmedNoPersonal && !containsPersonal(item.expect)).slice(0, 2).map((item) => ({
    title: item.title.slice(0, 80),
    body: item.expect.slice(0, 500),
  }));
  return { instructions, assets, examples };
}

export function publishedMaterialHash(category: string, config: StudioConfig): string {
  const material = proofMaterial(config);
  const example = material.examples[0];
  return contentHash({
    category,
    instructions: material.instructions,
    assets: material.assets,
    interview: [],
    examples: example
      ? [{ title: example.title, body: example.body }]
      : [{ title: "Sample", body: "Indicative, not a credit offer. A missing item is left blank." }],
  });
}

function gatesFor(agent: AgentRecord, config: StudioConfig): Gate[] {
  const studio = agent.studio;
  return readinessGates({
    results: studio?.lastBench?.results ?? null,
    proof: agent.proof ?? null,
    coverage: studio?.lastBench ? studio.lastBench.coverage : null,
    configHash: studioConfigHash(config),
    benchHash: studio?.lastBench?.configHash,
    materialHash: publishedMaterialHash(agent.category, config),
  });
}

export async function publishStudio(ownerId: string, slug: string, mode: "listing" | "proven"): Promise<{ ok: true; slug: string; proofQueued: boolean } | { ok: false; error: string }> {
  const current = await readOwnedStudio(ownerId, slug);
  if (!current) return { ok: false, error: "missing" };
  if (mode === "proven" && !gatesPass(gatesFor(current.agent, current.config))) return { ok: false, error: "gates" };
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
  const sealed = await updateDb((db) => {
    const agent = owned(db.agents, ownerId, slug);
    if (!agent?.studio) return "missing" as const;
    const configNow = latestConfig(agent.studio);
    if (mode === "proven" && !gatesPass(gatesFor(agent, configNow))) return "gates" as const;
    commit(agent.studio, configNow, mode === "proven" ? "Published as proven" : "Published the listing", "published");
    const published = agent.studio.versions[agent.studio.versions.length - 1];
    agent.studio.publishedVersion = published?.number ?? null;
    agent.studio.provenAt = mode === "proven" ? new Date().toISOString() : null;
    agent.trainingConsent = agent.studio.trainingConsent === true;
    const proof = agent.proof && agent.proof.fixture === false && agent.proof.proven === true && agent.proof.status === "complete"
      ? { status: agent.proof.status, winRate: agent.proof.winRate, proven: true, fixture: false, version: agent.proof.version }
      : agent.proof
        ? { status: agent.proof.status, winRate: agent.proof.winRate, proven: false, fixture: agent.proof.fixture !== false, version: agent.proof.version }
        : absentProof();
    const pack = sealPackage({
      id: randomUUID(),
      packageVersion: agent.studio.publishedVersion ?? 1,
      sellerId: ownerId,
      slug,
      name: agent.name,
      kind: "studio",
      config: published?.config ?? configNow,
      proof,
      instructions: agent.instructions,
      trainingConsent: agent.studio.trainingConsent === true,
    });
    if (!verifyPackage(pack)) return "gates" as const;
    agent.packages = (agent.packages ?? []).concat(pack);
    agent.studio.publishedPackageHash = pack.contentHash;
    return "ok" as const;
  });
  if (sealed !== "ok") return { ok: false, error: sealed === "gates" ? "gates" : "missing" };
  return { ok: true, slug: saved.slug, proofQueued: saved.proofQueued };
}

export async function rollbackStudio(ownerId: string, slug: string, version: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOwned(ownerId, slug, `Rolled back to version ${version}`, "draft", (config, studio) => {
    const previous = studio.versions.find((item) => item.number === version);
    if (!previous) return null;
    return clone(previous.config);
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
  if (!agent.studio) return [];
  return gatesFor(agent, latestConfig(agent.studio));
}

function examplePackage(): AgentPackage {
  return sealPackage({
    id: `pkg_${NDIS_EXAMPLE_SLUG}`,
    packageVersion: 1,
    sellerId: EXAMPLE_SELLER_ID,
    slug: NDIS_EXAMPLE_SLUG,
    name: NDIS_EXAMPLE_NAME,
    kind: "studio",
    config: ndisStudioConfig(),
    proof: absentProof(),
    instructions: "Apply the example package. Do not invent a lender or a rate.",
    trainingConsent: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

function packageForAgent(agent: AgentRecord): AgentPackage | null {
  const hash = agent.studio?.publishedPackageHash;
  if (!hash) return null;
  const pack = (agent.packages ?? []).find((item) => item.contentHash === hash && item.sellerId === agent.ownerId);
  if (!pack || !verifyPackage(pack)) return null;
  return pack;
}

async function priceFor(slug: string): Promise<{ sellerId: string; priceMinor: number; name: string; config: StudioConfig; pack: AgentPackage } | null> {
  if (slug === NDIS_EXAMPLE_SLUG) {
    const pack = examplePackage();
    if (!verifyPackage(pack)) return null;
    return { sellerId: EXAMPLE_SELLER_ID, priceMinor: 49000, name: NDIS_EXAMPLE_NAME, config: configFromPackage(pack), pack };
  }
  const db = await readDb();
  const agent = db.agents.find((item) => item.slug === slug && item.status === "published" && item.studio);
  if (!agent) return null;
  const pack = packageForAgent(agent);
  if (!pack) return null;
  return { sellerId: agent.ownerId, priceMinor: agent.priceMinor, name: agent.name, config: configFromPackage(pack), pack };
}

const ANSWER_KEY = /^[a-z][a-z0-9_]{0,40}$/i;

function clipAnswers(config: StudioConfig, answers: Record<string, string>): Record<string, string> {
  const allowed = new Set(config.intake.map((question) => question.id));
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!ANSWER_KEY.test(key) || !allowed.has(key) || typeof value !== "string") continue;
    next[key] = value.replace(/\u0000/g, "").replace(/[<>]/g, "").slice(0, 500);
  }
  return next;
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
  const buyer = run.buyerId === viewerId;
  const broker = run.sellerId === viewerId && run.brokerRequested === true;
  if (!admin && !buyer && !broker) return null;
  const published = await priceFor(run.slug);
  if (!published || published.sellerId !== run.sellerId) return null;
  return { run: run as StudioRunRecord, config: published.config };
}

export async function saveRunAnswers(viewerId: string, runId: string, answers: Record<string, string>): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await updateDb((db) => {
    const run = (db.studioRuns ?? []).find((item) => item.id === runId && item.buyerId === viewerId);
    if (!run) return false;
    const config = run.slug === NDIS_EXAMPLE_SLUG
      ? ndisStudioConfig()
      : (() => {
        const agent = db.agents.find((item) => item.slug === run.slug && item.ownerId === run.sellerId && item.status === "published");
        const pack = agent ? packageForAgent(agent) : null;
        return pack ? configFromPackage(pack) : null;
      })();
    if (!config) return false;
    run.answers = clipAnswers(config, { ...run.answers, ...answers });
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
  const published = await priceFor(loaded.run.slug);
  if (!published || published.sellerId !== loaded.run.sellerId || !verifyPackage(published.pack)) return { ok: false, error: "missing" };
  const response = await execute({
    channel: "studio",
    package: published.pack,
    clientId: loaded.run.clientId,
    sellerId: published.pack.sellerId,
    requestId: runId,
    answers: clipAnswers(published.config, loaded.run.answers),
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
    if (!run || run.report) return false;
    const config = run.slug === NDIS_EXAMPLE_SLUG
      ? ndisStudioConfig()
      : (() => {
        const agent = db.agents.find((item) => item.slug === run.slug && item.ownerId === run.sellerId && item.status === "published");
        const pack = agent ? packageForAgent(agent) : null;
        return pack ? configFromPackage(pack) : null;
      })();
    if (!config) return false;
    run.answers = clipAnswers(config, { ...run.answers, ...answers });
    return true;
  });
  return result ? { ok: true } : { ok: false, error: "missing" };
}

export async function leadsFor(ownerId: string, slug: string): Promise<{ createdAt: string }[]> {
  const db = await readDb();
  return (db.studioRuns ?? [])
    .filter((run) => run.sellerId === ownerId && run.slug === slug && run.brokerRequested)
    .map((run) => ({ createdAt: run.createdAt }));
}

/**
 * The example listing used to await a live proof on the request. Dev injects a
 * model key, the JSON file is empty after a restart, and that proof exceeded
 * the 30s page timeout. The seeded proof is a fixture and is not upgraded to
 * a live model call from the page.
 */
export async function ensureExampleProof(): Promise<void> {
  await seedExamples();
}

export function queueStudioProof(slug: string): void {
  scheduleProof(slug);
}

export { proposalsFromTurns };
