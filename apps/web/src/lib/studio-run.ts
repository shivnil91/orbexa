import { createHash } from "node:crypto";
import { parseCashflowCsv, runCalculators, type FactBag } from "./studio-calc.ts";
import { factsFrom, joinedAnswers, missingRequired, scopeMatch } from "./studio-intake.ts";
import { applyPanel } from "./studio-rules.ts";
import { coverageOf, EXAMPLE_PANEL_BADGE, INDICATIVE_LABEL, type Claim, type Playbook, type StudioConfig, type StudioReport } from "./studio-types.ts";

/** Drop markup before a playbook, template, or answer is stored on a report. */
export function plainStudioText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/[<>]/g, "").replace(/javascript:/gi, "");
}

export function studioConfigHash(config: StudioConfig): string {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const entries = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`);
      return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return createHash("sha256").update(stable(config)).digest("hex");
}

/** A hard-rule case counts only when it names a real knock-out or a real eligible pair. */
export function hardCaseSatisfied(expect: string, report: StudioReport): boolean {
  const lines = expect.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return false;
  return lines.every((line) => {
    if (/^rule:[a-z0-9_:-]+$/i.test(line)) return report.knockouts.some((row) => row.ruleId === line);
    return report.ranked.some((row) => {
      const pair = `${row.product} with ${row.lender}`;
      return line === pair || line.startsWith(`${pair}`);
    });
  });
}

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
  const refused = scope?.action === "refuse" ? { ruleId: `scope:${scope.id}`, reason: plainStudioText(scope.reason) } : null;
  if (refused && scope) {
    claim(plainStudioText(refused.reason), { type: "rule", id: refused.ruleId }, claims);
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
    why: plainStudioText(row.soft) || "Hard rules passed. No soft preference was written for this cell.",
    indicative,
  }));
  for (const row of ranked) {
    claim(`${row.product} with ${row.lender} passed the hard rules. ${row.why}`, { type: "rule", id: `pass:${row.productId}:${row.lenderId}` }, claims);
  }
  const matched = playbooksFor(config.playbooks, text);
  for (const playbook of matched) {
    claim(plainStudioText(`If you see ${playbook.see}, do ${playbook.do} because ${playbook.because}`), { type: "playbook", id: `playbook:${playbook.id}` }, claims);
  }
  const checklist: { id: string; text: string }[] = [];
  for (const playbook of matched) {
    playbook.documents.forEach((document, index) => {
      const id = `doc:${playbook.id}:${index + 1}`;
      const label = plainStudioText(document);
      checklist.push({ id, text: label });
      claim(`Document to collect: ${label}`, { type: "document", id }, claims);
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
  let handoff: StudioReport["handoff"] = scope?.action === "handoff" ? { triggerId: `scope:${scope.id}`, reason: plainStudioText(scope.reason) } : null;
  if (!refused && !handoff) {
    for (const trigger of config.handoff) {
      const hit = trigger.kind === "deal_size"
        ? deal >= trigger.threshold
        : trigger.kind === "equity"
          ? equity
          : knockouts.length >= trigger.threshold;
      if (hit) {
        handoff = { triggerId: `handoff:${trigger.id}`, reason: plainStudioText(trigger.note) };
        break;
      }
    }
  }
  if (handoff) claim(handoff.reason, { type: "rule", id: handoff.triggerId }, claims);
  const template = (kind: StudioConfig["templates"][number]["kind"]) => config.templates.find((item) => item.kind === kind);
  const fundingPreface = plainStudioText(template("funding_report")?.preface.trim() ?? "");
  const packPreface = plainStudioText(template("lender_pack")?.preface.trim() ?? "");
  const summaryPreface = plainStudioText(template("client_summary")?.preface.trim() ?? "");
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
    `Niche: ${plainStudioText(config.specialty.niche)}`,
    ...calculations.map((calc) => `${calc.title}: ${calc.result} Formula: ${calc.formula}`),
    ...ranked.map((row) => `Eligible: ${row.product} with ${row.lender}.`),
    ...knockouts.map((row) => `Ineligible: ${row.ruleId}.`),
    "Missing-documents checklist",
    ...checklist.map((item) => item.text),
  ].filter((line) => line.length > 0);
  const top = ranked[0];
  const clientSummary = [
    summaryPreface ?? "",
    config.specialty.audience ? `For: ${plainStudioText(config.specialty.audience)}` : "",
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
    playbooks: matched.map((playbook) => ({
      id: playbook.id,
      see: plainStudioText(playbook.see),
      do: plainStudioText(playbook.do),
      because: plainStudioText(playbook.because),
    })),
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
  const sentences = plainStudioText(text).replace(/\s+/g, " ").split(/(?<=[.?!])\s+/).map((part) => part.trim()).filter((part) => part.length > 20).slice(0, 3);
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
  results: { hardRule: boolean; pass: boolean; expected?: string }[] | null;
  proof: { status?: string; fixture?: boolean; winRate?: number; proven?: boolean; tests?: number; sourceHash?: string } | null;
  coverage: number | null;
  configHash?: string;
  benchHash?: string;
  materialHash?: string;
}): Gate[] {
  const hard = (input.results ?? []).filter((row) => row.hardRule);
  const hardPass = hard.filter((row) => row.pass);
  const bound = Boolean(input.benchHash) && input.benchHash === input.configHash;
  const sawKnockout = hardPass.some((row) => /^rule:/im.test(row.expected ?? ""));
  const sawEligible = hardPass.some((row) => (row.expected ?? "").includes(" with "));
  let bench: Gate;
  if (hard.length === 0) {
    bench = { id: "bench", pass: false, label: "Test bench", detail: "No hard-rule case has been run. This gate has nothing to measure." };
  } else if (!bound) {
    bench = { id: "bench", pass: false, label: "Test bench", detail: "The test bench does not match the current specialist file. Run it again after the last edit." };
  } else if (hardPass.length !== hard.length) {
    bench = { id: "bench", pass: false, label: "Test bench", detail: `${hardPass.length} of ${hard.length} hard-rule cases passed. All of them have to pass.` };
  } else if (!sawKnockout || !sawEligible) {
    bench = { id: "bench", pass: false, label: "Test bench", detail: "Hard-rule cases have to include one real knock-out and one real eligible product-lender pair. A line that appears on every report does not count." };
  } else {
    bench = { id: "bench", pass: true, label: "Test bench", detail: `${hardPass.length} of ${hard.length} hard-rule cases passed on this version of the file.` };
  }
  const proof = input.proof;
  let proofGate: Gate;
  if (!proof || proof.status !== "complete") {
    proofGate = { id: "proof", pass: false, label: "Proof", detail: "Proof has not finished, so there is no win rate yet." };
  } else if (proof.fixture !== false) {
    const rate = Math.round((proof.winRate ?? 0) * 100);
    proofGate = { id: "proof", pass: false, label: "Proof", detail: `The stand-in scorer reported ${rate}% wins. That is not a win rate against the same frontier model without the expert layer.` };
  } else if (proof.proven !== true || (proof.tests ?? 0) < 10 || (proof.winRate ?? 0) < 0.7) {
    proofGate = { id: "proof", pass: false, label: "Proof", detail: `Win rate ${Math.round((proof.winRate ?? 0) * 100)}% is under 70% against the same frontier model without the expert layer.` };
  } else if (!proof.sourceHash || !input.materialHash || proof.sourceHash !== input.materialHash) {
    proofGate = { id: "proof", pass: false, label: "Proof", detail: "The live proof was not run on this version of the specialist material." };
  } else {
    proofGate = { id: "proof", pass: true, label: "Proof", detail: `Win rate ${Math.round((proof.winRate ?? 0) * 100)}% against the same frontier model without the expert layer.` };
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
