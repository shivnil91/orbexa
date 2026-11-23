import { randomBytes } from "node:crypto";
import { emptyHard, type BenchCase, type HardRule, type IntakeQuestion, type Playbook, type Proposal, type StudioConfig } from "./studio-types.ts";
import { steersJudge } from "./trust.ts";

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const LONG_DIGITS = /\d{8,}/;

export type InterviewTurn = { notice: string; junior: string; killed: string };

export function containsPersonal(text: string): boolean {
  return EMAIL.test(text) || LONG_DIGITS.test(text);
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(3).toString("hex")}`;
}

function monthsFrom(text: string): number | null {
  const match = text.match(/(\d{1,3})\s*months?/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function hardFrom(text: string, base: HardRule = emptyHard()): HardRule {
  const next = { ...base };
  const months = monthsFrom(text);
  if (months != null) next.minTradingMonths = months;
  const revenue = text.match(/revenue[^0-9]{0,24}(\d{4,7})/i);
  if (revenue) next.minAnnualRevenue = Number(revenue[1]);
  const ato = text.match(/ato[^0-9]{0,24}(\d{1,7})/i);
  if (ato) next.maxAtoDebt = Number(ato[1]);
  if (/credit/i.test(text) && /clear|clean|adverse/i.test(text)) next.creditClearRequired = true;
  return next;
}

function clip(value: string, max: number): string {
  return value.replace(/\u0000/g, "").replace(/[<>]/g, "").replace(/javascript:/gi, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function proposalsFromTurns(turns: InterviewTurn[], config: StudioConfig): { ok: true; proposals: Proposal[] } | { ok: false; error: "personal" | "cases" } {
  if (turns.length < 3) return { ok: false, error: "cases" };
  const body = turns.map((turn) => `${turn.notice}\n${turn.junior}\n${turn.killed}`).join("\n");
  if (containsPersonal(body)) return { ok: false, error: "personal" };
  const product = config.products[0];
  const lender = config.lenders[0];
  const proposals: Proposal[] = [];
  turns.slice(0, 3).forEach((turn, index) => {
    const notice = clip(turn.notice, 400);
    const junior = clip(turn.junior, 400);
    const killed = clip(turn.killed, 400);
    if (notice.length < 8 || junior.length < 8 || killed.length < 8) return;
    if (steersJudge(`${notice} ${junior} ${killed}`)) return;
    const question: IntakeQuestion = {
      id: id("q"),
      prompt: `Confirm: ${notice}`,
      why: "The expert noticed this first on an anonymised past case.",
      required: false,
      kind: "text",
      options: [],
      fact: "",
      showWhen: null,
    };
    proposals.push({ id: id("prop"), status: "proposed", source: "interview", kind: "intake", question });
    const playbook: Playbook = {
      id: id("pb"),
      see: notice,
      do: `Check what a junior would miss: ${junior}`,
      because: killed,
      documents: [],
    };
    proposals.push({ id: id("prop"), status: "proposed", source: "interview", kind: "playbook", playbook });
    const hard = hardFrom(`${notice} ${junior} ${killed}`);
    if (product && lender && (hard.minTradingMonths != null || hard.minAnnualRevenue != null || hard.creditClearRequired || hard.maxAtoDebt != null)) {
      proposals.push({
        id: id("prop"),
        status: "proposed",
        source: "interview",
        kind: "rule",
        productId: product.id,
        lenderId: lender.id,
        hard,
        note: killed,
      });
    }
    const answers = { ...(config.cases[0]?.answers ?? {}) };
    const trading = config.intake.find((question) => question.fact === "tradingMonths");
    if (trading && hard.minTradingMonths != null) answers[trading.id] = String(Math.max(0, hard.minTradingMonths - 1));
    const bench: BenchCase = {
      id: id("case"),
      title: `Anonymised case ${index + 1}`,
      answers,
      csv: config.cases[0]?.csv ?? "",
      expect: hard.minTradingMonths != null ? "min_trading_months" : junior.slice(0, 80),
      hardRule: hard.minTradingMonths != null || hard.minAnnualRevenue != null || hard.creditClearRequired || hard.maxAtoDebt != null,
      confirmedNoPersonal: true,
    };
    proposals.push({ id: id("prop"), status: "proposed", source: "interview", kind: "case", bench });
  });
  return { ok: true, proposals: proposals.slice(0, 12) };
}

export function addedLines(before: string, after: string): string[] {
  const old = new Set(before.split("\n").map((line) => line.trim()).filter(Boolean));
  return after.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !old.has(line));
}

export function proposalsFromCorrection(input: { before: string; after: string; reason: string; config: StudioConfig }): { ok: true; proposals: Proposal[] } | { ok: false; error: "personal" | "empty" } {
  const before = input.before.replace(/\u0000/g, "");
  const after = input.after.replace(/\u0000/g, "");
  const reason = clip(input.reason, 500);
  if (containsPersonal(`${before}\n${after}\n${reason}`)) return { ok: false, error: "personal" };
  if (steersJudge(`${before}\n${after}\n${reason}`)) return { ok: false, error: "empty" };
  const added = addedLines(before, after);
  if (reason.length < 8 || (added.length === 0 && after.trim() === before.trim())) return { ok: false, error: "empty" };
  const product = input.config.products[0];
  const lender = input.config.lenders[0];
  const text = `${reason}\n${added.join("\n")}`;
  const hard = hardFrom(text);
  const proposals: Proposal[] = [];
  if (product && lender && (hard.minTradingMonths != null || hard.minAnnualRevenue != null || hard.creditClearRequired || hard.maxAtoDebt != null)) {
    proposals.push({ id: id("prop"), status: "proposed", source: "correction", kind: "rule", productId: product.id, lenderId: lender.id, hard, note: reason });
  }
  proposals.push({
    id: id("prop"),
    status: "proposed",
    source: "correction",
    kind: "playbook",
    playbook: { id: id("pb"), see: reason, do: added[0] || reason, because: reason, documents: [] },
  });
  const expect = hard.minTradingMonths != null ? "min_trading_months" : (added[0] || reason).slice(0, 120);
  const answers = { ...(input.config.cases[0]?.answers ?? {}) };
  if (hard.minTradingMonths != null) {
    const trading = input.config.intake.find((question) => question.fact === "tradingMonths");
    if (trading) answers[trading.id] = String(Math.max(0, hard.minTradingMonths - 1));
  }
  proposals.push({
    id: id("prop"),
    status: "proposed",
    source: "correction",
    kind: "case",
    bench: {
      id: id("case"),
      title: "Regression from an edited output",
      answers,
      csv: input.config.cases[0]?.csv ?? "",
      expect,
      hardRule: true,
      confirmedNoPersonal: true,
    },
  });
  return { ok: true, proposals };
}

export function applyProposal(config: StudioConfig, proposal: Proposal): StudioConfig {
  const next: StudioConfig = structuredClone(config);
  if (proposal.kind === "intake") {
    next.intake = next.intake.concat(proposal.question);
    return next;
  }
  if (proposal.kind === "playbook") {
    next.playbooks = next.playbooks.concat(proposal.playbook);
    return next;
  }
  if (proposal.kind === "case") {
    next.cases = next.cases.concat(proposal.bench);
    return next;
  }
  const cell = next.cells.find((item) => item.productId === proposal.productId && item.lenderId === proposal.lenderId);
  if (cell) cell.hard = { ...cell.hard, ...proposal.hard };
  return next;
}

/**
 * Proposals come from the specialist's own words. A model is not asked to
 * invent a rule, and these notes are not sent to a provider.
 */
export async function elicitWithModel(turns: InterviewTurn[], config: StudioConfig, env?: Record<string, string | undefined>): Promise<{ ok: true; proposals: Proposal[] } | { ok: false; error: "personal" | "cases" }> {
  void env;
  return proposalsFromTurns(turns, config);
}
