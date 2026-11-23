import type { FactBag } from "./studio-calc.ts";
import type { FactKey, IntakeQuestion, ScopeRule } from "./studio-types.ts";

export function isVisible(question: IntakeQuestion, questions: IntakeQuestion[], answers: Record<string, string>, seen = new Set<string>()): boolean {
  if (!question.showWhen) return true;
  if (seen.has(question.id)) return false;
  seen.add(question.id);
  const parent = questions.find((item) => item.id === question.showWhen?.questionId);
  if (!parent || !isVisible(parent, questions, answers, seen)) return false;
  return (answers[parent.id] ?? "").trim() === question.showWhen.equals;
}

export function visibleQuestions(questions: IntakeQuestion[], answers: Record<string, string>): IntakeQuestion[] {
  return questions.filter((question) => isVisible(question, questions, answers));
}

export function missingRequired(questions: IntakeQuestion[], answers: Record<string, string>): IntakeQuestion[] {
  return visibleQuestions(questions, answers).filter((question) => question.required && (answers[question.id] ?? "").trim().length === 0);
}

function asNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function factsFrom(questions: IntakeQuestion[], answers: Record<string, string>): FactBag {
  const facts: FactBag = {
    tradingMonths: null,
    annualRevenue: null,
    creditClear: null,
    atoDebt: null,
    dealSize: null,
    tradeDebtors: null,
    creditSales: null,
    ebitda: null,
    debtService: null,
    freeCashMonthly: null,
    requestedFacility: null,
    purpose: "",
  };
  for (const question of visibleQuestions(questions, answers)) {
    if (!question.fact) continue;
    const raw = (answers[question.id] ?? "").trim();
    if (!raw) continue;
    if (question.fact === "purpose") {
      facts.purpose = raw;
      continue;
    }
    if (question.fact === "creditClear") {
      facts.creditClear = /^(clear|yes|clean)$/i.test(raw);
      continue;
    }
    const key = question.fact;
    facts[key] = asNumber(raw);
  }
  return facts;
}

export function joinedAnswers(questions: IntakeQuestion[], answers: Record<string, string>): string {
  return visibleQuestions(questions, answers)
    .map((question) => `${question.prompt} ${(answers[question.id] ?? "").trim()}`)
    .join("\n");
}

export function scopeMatch(rule: ScopeRule, facts: FactBag, text: string): boolean {
  const needle = rule.match.trim().toLowerCase();
  if (!needle) return false;
  if (rule.field === "any") return text.toLowerCase().includes(needle);
  if (rule.field === "purpose") return facts.purpose.toLowerCase().includes(needle) || text.toLowerCase().includes(needle);
  const value = facts[rule.field as FactKey];
  return String(value ?? "").toLowerCase().includes(needle) || text.toLowerCase().includes(needle);
}
