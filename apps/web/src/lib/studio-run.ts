import { parseCashflowCsv, runCalculators, type FactBag } from "./studio-calc.ts";
import { factsFrom, joinedAnswers, missingRequired, scopeMatch } from "./studio-intake.ts";
import { applyPanel } from "./studio-rules.ts";
import { coverageOf, EXAMPLE_PANEL_BADGE, INDICATIVE_LABEL, type Claim, type Playbook, type StudioConfig, type StudioReport } from "./studio-types.ts";

function claim(text: string, source: Claim["source"], claims: Claim[]): void {
  claims.push({ id: `c${claims.length + 1}`, text, source });
}

function playbooksFor(playbooks: Playbook[], text: string): Playbook[] {
  const hay = text.toLowerCase();
  return playbooks.filter((playbook) => {
    const tokens = playbook.see.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 4);
    return tokens.some((token) => hay.includes(token));
  });
}

export function reportText(report: StudioReport): string {
  return [
    ...report.fundingReport,
    ...report.lenderPack,
    ...report.clientSummary,
    ...report.knockouts.map((row) => `${row.ruleId} ${row.detail}`),
    ...report.ranked.map((row) => `${row.product} with ${row.lender}`),
  ].join("\n");
}

export function runStudio(config: StudioConfig, answers: Record<string, string>, csv = ""): { ok: true; report: StudioReport } | { ok: false; error: "intake"; missing: string[] } {
  const missing = missingRequired(config.intake, answers);
  if (missing.length > 0) return { ok: false, error: "intake", missing: missing.map((question) => question.prompt) };
  const facts = factsFrom(config.intake, answers);
  const text = joinedAnswers(config.intake, answers);
  const claims: Claim[] = [];
  const scope = config.specialty.scope.find((rule) => scopeMatch(rule, facts, text));
  const refused = scope?.action === "refuse" ? { ruleId: `scope:${scope.id}`, reason: scope.reason } : null;
  if (refused && scope) {
    claim(refused.reason, { type: "rule", id: refused.ruleId }, claims);
  }
  const rows = csv.trim() ? parseCashflowCsv(csv) : [];
  const calculations = runCalculators(config.calculators, facts, rows);
  for (const calc of calculations) {
    claim(`${calc.title}: ${calc.result}`, { type: "calculator", id: `calc:${calc.id}` }, claims);
  }
  const panel = refused ? { knockouts: [], eligible: [] } : applyPanel(config.products, config.lenders, config.cells, facts);
  const knockouts = panel.knockouts.flatMap((row) => row.fires.map((fire) => ({
    productId: fire.productId,
    lenderId: fire.lenderId,
    product: fire.product,
    lender: fire.lender,
    ruleId: fire.ruleId,
    detail: fire.detail,
  })));
  for (const row of knockouts) {
    claim(`${row.product} / ${row.lender} knocked out. ${row.detail}`, { type: "rule", id: row.ruleId }, claims);
  }
  const facility = calculations.find((calc) => calc.id === "facility_size" && calc.ok);
  const indicative = facility ? `${facility.result} ${INDICATIVE_LABEL}.` : `No indicative size was calculated. ${INDICATIVE_LABEL}.`;
  const ranked = panel.eligible.map((row) => ({
    productId: row.productId,
    lenderId: row.lenderId,
    product: row.product,
    lender: row.lender,
    why: row.soft || "Hard rules passed. No soft preference was written for this cell.",
    indicative,
  }));
  for (const row of ranked) {
    claim(`${row.product} with ${row.lender} passed the hard rules. ${row.why}`, { type: "rule", id: `pass:${row.productId}:${row.lenderId}` }, claims);
  }
  const matched = playbooksFor(config.playbooks, text);
  for (const playbook of matched) {
    claim(`If you see ${playbook.see}, do ${playbook.do} because ${playbook.because}`, { type: "playbook", id: `playbook:${playbook.id}` }, claims);
  }
  const checklist: { id: string; text: string }[] = [];
  for (const playbook of matched) {
    playbook.documents.forEach((document, index) => {
      const id = `doc:${playbook.id}:${index + 1}`;
      checklist.push({ id, text: document });
      claim(`Document to collect: ${document}`, { type: "document", id }, claims);
    });
  }
  for (const question of config.intake) {
    if (!question.required) continue;
    if ((answers[question.id] ?? "").trim()) continue;
    const id = `doc:missing:${question.id}`;
    const line = `Missing answer: ${question.prompt}`;
    checklist.push({ id, text: line });
    claim(line, { type: "document", id }, claims);
  }
  const equity = /\bequity\b/i.test(facts.purpose);
  const deal = facts.dealSize ?? 0;
  let handoff: StudioReport["handoff"] = scope?.action === "handoff" ? { triggerId: `scope:${scope.id}`, reason: scope.reason } : null;
  if (!refused && !handoff) {
    for (const trigger of config.handoff) {
      const hit = trigger.kind === "deal_size"
        ? deal >= trigger.threshold
        : trigger.kind === "equity"
          ? equity
          : knockouts.length >= trigger.threshold;
      if (hit) {
        handoff = { triggerId: `handoff:${trigger.id}`, reason: trigger.note };
        break;
      }
    }
  }
  if (handoff) claim(handoff.reason, { type: "rule", id: handoff.triggerId }, claims);
  const template = (kind: StudioConfig["templates"][number]["kind"]) => config.templates.find((item) => item.kind === kind);
  const fundingPreface = template("funding_report")?.preface.trim();
  const packPreface = template("lender_pack")?.preface.trim();
  const summaryPreface = template("client_summary")?.preface.trim();
  const fundingReport = [
    config.exampleData ? EXAMPLE_PANEL_BADGE : "",
    fundingPreface ?? "",
    refused ? `The agent refused this request. ${refused.reason}` : "",
    refused ? "" : "Ranked structure",
    ...ranked.map((row, index) => `${index + 1}. ${row.product} with ${row.lender}. Why: ${row.why} Cost: ${row.indicative}`),
    ranked.length === 0 && !refused ? "No cell passed the hard rules." : "",
    "Knock-outs, from the rule engine",
    ...knockouts.map((row) => `${row.ruleId}: ${row.product} / ${row.lender}. ${row.detail}`),
    handoff ? `The agent stopped. ${handoff.reason}` : "",
    INDICATIVE_LABEL,
  ].filter((line) => line.length > 0);
  const lenderPack = [
    packPreface ?? "",
    `Niche: ${config.specialty.niche}`,
    ...calculations.map((calc) => `${calc.title}: ${calc.result} Formula: ${calc.formula}`),
    ...ranked.map((row) => `Eligible: ${row.product} with ${row.lender}.`),
    ...knockouts.map((row) => `Ineligible: ${row.ruleId}.`),
    "Missing-documents checklist",
    ...checklist.map((item) => item.text),
  ].filter((line) => line.length > 0);
  const top = ranked[0];
  const clientSummary = [
    summaryPreface ?? "",
    config.specialty.audience ? `For: ${config.specialty.audience}` : "",
    refused ? `Nothing was prepared. ${refused.reason}` : top ? `The first structure to discuss is ${top.product} with ${top.lender}. ${top.indicative}` : "No structure passed the hard rules.",
    checklist.length > 0 ? `Still to collect: ${checklist.map((item) => item.text).join("; ")}.` : "No extra document was listed.",
    handoff ? "The broker should take this from here." : "The broker has not been asked to take this yet.",
    INDICATIVE_LABEL,
  ].filter((line) => line.length > 0);
  const report: StudioReport = {
    exampleData: config.exampleData,
    refused,
    handoff,
    ranked,
    knockouts,
    calculations: calculations.map((calc) => ({ id: calc.id, title: calc.title, formula: calc.formula, assumptions: calc.assumptions, result: calc.result, ok: calc.ok })),
    playbooks: matched.map((playbook) => ({ id: playbook.id, see: playbook.see, do: playbook.do, because: playbook.because })),
    checklist,
    fundingReport,
    lenderPack,
    clientSummary,
    claims,
    coverage: coverageOf(claims),
  };
  return { ok: true, report };
}

/** Model prose is appended as model reasoning. It cannot add or remove a knock-out. */
export function attachModelReasoning(report: StudioReport, text: string): StudioReport {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.?!])\s+/).map((part) => part.trim()).filter((part) => part.length > 20).slice(0, 3);
  if (sentences.length === 0) return report;
  const claims = [...report.claims];
  for (const sentence of sentences) {
    claims.push({ id: `c${claims.length + 1}`, text: sentence, source: { type: "model", id: "model:drafting" } });
  }
  const knockouts = report.knockouts;
  return { ...report, claims, coverage: coverageOf(claims), knockouts, clientSummary: [...report.clientSummary, ...sentences] };
}

export function lineDiff(expected: string, actual: string): string[] {
  const hay = actual.toLowerCase();
  return expected.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !hay.includes(line.toLowerCase()));
}

export type Gate = { id: "bench" | "proof" | "coverage"; pass: boolean; label: string; detail: string };

export function readinessGates(input: {
  results: { hardRule: boolean; pass: boolean }[] | null;
  proof: { status?: string; fixture?: boolean; winRate?: number; proven?: boolean } | null;
  coverage: number | null;
}): Gate[] {
  const hard = (input.results ?? []).filter((row) => row.hardRule);
  const hardPass = hard.filter((row) => row.pass).length;
  const bench: Gate = hard.length === 0
    ? { id: "bench", pass: false, label: "Test bench", detail: "No hard-rule case has been run. This gate has nothing to measure." }
    : hardPass === hard.length
      ? { id: "bench", pass: true, label: "Test bench", detail: `${hardPass} of ${hard.length} hard-rule cases passed.` }
      : { id: "bench", pass: false, label: "Test bench", detail: `${hardPass} of ${hard.length} hard-rule cases passed. All of them have to pass.` };
  const proof = input.proof;
  let proofGate: Gate;
  if (!proof || proof.status !== "complete") {
    proofGate = { id: "proof", pass: false, label: "Proof", detail: "Proof has not finished, so there is no win rate yet." };
  } else if (proof.fixture !== false) {
    const rate = Math.round((proof.winRate ?? 0) * 100);
    proofGate = { id: "proof", pass: false, label: "Proof", detail: `The stand-in scorer reported ${rate}% wins. That is not a win rate against the same frontier model without the expert layer.` };
  } else if ((proof.winRate ?? 0) >= 0.7) {
    proofGate = { id: "proof", pass: true, label: "Proof", detail: `Win rate ${Math.round((proof.winRate ?? 0) * 100)}% against the same frontier model without the expert layer.` };
  } else {
    proofGate = { id: "proof", pass: false, label: "Proof", detail: `Win rate ${Math.round((proof.winRate ?? 0) * 100)}% is under 70% against the same frontier model without the expert layer.` };
  }
  const coverage = input.coverage;
  const coverageGate: Gate = coverage == null
    ? { id: "coverage", pass: false, label: "Citation coverage", detail: "Run the test bench to measure citation coverage." }
    : coverage >= 0.9
      ? { id: "coverage", pass: true, label: "Citation coverage", detail: `${Math.round(coverage * 100)}% of claims cite a rule, calculator, playbook, or document.` }
      : { id: "coverage", pass: false, label: "Citation coverage", detail: `${Math.round(coverage * 100)}% of claims cite a source. The gate is 90%.` };
  return [bench, proofGate, coverageGate];
}

export function gatesPass(gates: Gate[]): boolean {
  return gates.every((gate) => gate.pass);
}

export type { FactBag };
