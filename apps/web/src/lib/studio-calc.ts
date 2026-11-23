import type { CalculatorId, CalculatorSetting } from "./studio-types.ts";

export type WeekRow = { inflow: number; outflow: number };

export type CalcOutcome = {
  id: CalculatorId;
  title: string;
  formula: string;
  assumptions: string[];
  ok: boolean;
  result: string;
  value: number | null;
};

export const CALCULATOR_SPECS: Record<CalculatorId, { title: string; formula: string; assumptions: string }> = {
  cashflow_gap: {
    title: "13-week cashflow gap",
    formula: "closing = opening + inflow − outflow; gap = max(0, −closing); peak gap = max gap over 13 weeks",
    assumptions: "Starting cash is the figure you set. Weeks after the CSV repeat the average inflow and average outflow of the uploaded rows. This replays the file. It does not predict new sales.",
  },
  debtor_days: {
    title: "Debtor days",
    formula: "debtor days = trade debtors / credit sales × period days",
    assumptions: "Period days default to 365. Credit sales of zero are not treated as a number.",
  },
  dscr: {
    title: "DSCR",
    formula: "DSCR = EBITDA / debt service",
    assumptions: "Debt service is interest plus principal for the year. Zero debt service is not treated as infinite cover.",
  },
  serviceability: {
    title: "Serviceability",
    formula: "monthly repayment = facility × example annual rate / 12; surplus = free cash per month − monthly repayment",
    assumptions: "The rate is an example interest-only assumption you set. It is not a lender rate. Serviceable when surplus is at least the buffer.",
  },
  facility_size: {
    title: "Indicative facility size",
    formula: "indicative facility = minimum of the requested amount, trade debtors × advance rate, and free cash / (rate / 12), using only the inputs that are present",
    assumptions: "The advance rate and the annual rate are example assumptions you set. They are not a credit offer and not a lender price.",
  },
};

const CALCULATOR_IDS: CalculatorId[] = ["cashflow_gap", "debtor_days", "dscr", "serviceability", "facility_size"];

export const CSV_MAX_BYTES = 1_000_000;
export const CSV_MAX_ROWS = 2_000;
export const CSV_MAX_LINE = 10_000;
const CSV_HTML = /<\s*\/?\s*(script|svg|iframe|img|object|embed|link|meta|html|body|style|math)\b/i;

function formulaCell(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[=+@]/.test(trimmed) || trimmed.startsWith("\t") || trimmed.startsWith("\r")) return true;
  if (trimmed.startsWith("-") && !/^-?\d+(\.\d+)?$/.test(trimmed.replace(/[$,\s]/g, ""))) return true;
  return false;
}

/** Prefix spreadsheet formulas so a later export cannot run them. */
export function neutralizeSpreadsheet(text: string): string {
  return text.split(/\r?\n/).map((line) => line.split(",").map((cell) => {
    const trimmed = cell.trim();
    if (!formulaCell(trimmed)) return cell;
    return `'${trimmed.replace(/^'+/, "")}`;
  }).join(",")).join("\n");
}

export function defaultCalculators(): CalculatorSetting[] {
  return [
    { id: "cashflow_gap", enabled: false, assumptions: { startingCash: 0 } },
    { id: "debtor_days", enabled: false, assumptions: { periodDays: 365 } },
    { id: "dscr", enabled: false, assumptions: {} },
    { id: "serviceability", enabled: false, assumptions: { exampleAnnualRate: 0.09, advanceRate: 0.8, buffer: 0 } },
    { id: "facility_size", enabled: false, assumptions: { exampleAnnualRate: 0.09, advanceRate: 0.8, buffer: 0 } },
  ];
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function decodeCsvBytes(name: string, bytes: Uint8Array): { ok: true; text: string } | { ok: false; error: "csv" } {
  if (bytes.byteLength === 0 || bytes.byteLength >= CSV_MAX_BYTES) return { ok: false, error: "csv" };
  if (bytes.byteLength >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return { ok: false, error: "csv" };
  }
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: "csv" };
  }
  return acceptCsv(name, bytes.byteLength, text);
}

export function acceptCsv(name: string, bytes: number, text: string): { ok: true; text: string } | { ok: false; error: "csv" } {
  const safeName = name.replace(/[^\w.\- ]+/g, "").trim().toLowerCase();
  if (!safeName.endsWith(".csv")) return { ok: false, error: "csv" };
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes >= CSV_MAX_BYTES) return { ok: false, error: "csv" };
  if (text.length === 0 || text.length >= CSV_MAX_BYTES) return { ok: false, error: "csv" };
  if (text.includes("\u0000") || text.includes("\uFFFD")) return { ok: false, error: "csv" };
  if (CSV_HTML.test(text)) return { ok: false, error: "csv" };
  if (!text.includes(",")) return { ok: false, error: "csv" };
  const stripped = text.replace(/^\uFEFF/, "");
  const lines = stripped.split(/\r?\n/);
  const filled = lines.filter((line) => line.trim().length > 0);
  if (filled.length < 2 || filled.length > CSV_MAX_ROWS) return { ok: false, error: "csv" };
  if (filled.some((line) => line.length > CSV_MAX_LINE || line.split(",").length > 32)) return { ok: false, error: "csv" };
  return { ok: true, text: neutralizeSpreadsheet(stripped) };
}

export function parseCashflowCsv(text: string): WeekRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const index = (names: string[]) => names.map((name) => header.indexOf(name)).find((found) => found >= 0) ?? -1;
  const inflowAt = index(["inflow", "money in", "credit"]);
  const outflowAt = index(["outflow", "money out", "debit"]);
  const amountAt = index(["amount", "value", "net"]);
  const rows: WeekRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (inflowAt >= 0 && outflowAt >= 0) {
      const inflow = numberOrNull(cells[inflowAt]);
      const outflow = numberOrNull(cells[outflowAt]);
      if (inflow == null || outflow == null) continue;
      rows.push({ inflow, outflow });
    } else if (amountAt >= 0) {
      const amount = numberOrNull(cells[amountAt]);
      if (amount == null) continue;
      rows.push(amount >= 0 ? { inflow: amount, outflow: 0 } : { inflow: 0, outflow: Math.abs(amount) });
    }
  }
  return rows.slice(0, 13);
}

function numberOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export type FactBag = {
  tradingMonths: number | null;
  annualRevenue: number | null;
  creditClear: boolean | null;
  atoDebt: number | null;
  dealSize: number | null;
  tradeDebtors: number | null;
  creditSales: number | null;
  ebitda: number | null;
  debtService: number | null;
  freeCashMonthly: number | null;
  requestedFacility: number | null;
  purpose: string;
};

export function cashflowGap(rows: WeekRow[], startingCash: number): CalcOutcome {
  const spec = CALCULATOR_SPECS.cashflow_gap;
  const assumptions = [spec.assumptions, `Starting cash assumption: ${round2(startingCash)}.`];
  if (rows.length === 0) {
    return { id: "cashflow_gap", title: spec.title, formula: spec.formula, assumptions, ok: false, result: "No CSV rows with inflow and outflow, or a signed amount, were read.", value: null };
  }
  const avgIn = rows.reduce((sum, row) => sum + row.inflow, 0) / rows.length;
  const avgOut = rows.reduce((sum, row) => sum + row.outflow, 0) / rows.length;
  let opening = startingCash;
  let peak = 0;
  for (let week = 0; week < 13; week += 1) {
    const source = rows[week];
    const inflow = source ? source.inflow : avgIn;
    const outflow = source ? source.outflow : avgOut;
    const closing = opening + inflow - outflow;
    peak = Math.max(peak, Math.max(0, -closing));
    opening = closing;
  }
  const value = round2(peak);
  return {
    id: "cashflow_gap",
    title: spec.title,
    formula: spec.formula,
    assumptions,
    ok: true,
    result: `Peak gap over 13 weeks is ${value}.`,
    value,
  };
}

export function debtorDays(debtors: number | null, sales: number | null, periodDays: number): CalcOutcome {
  const spec = CALCULATOR_SPECS.debtor_days;
  const assumptions = [spec.assumptions, `Period days assumption: ${periodDays}.`];
  if (debtors == null || sales == null || sales <= 0 || periodDays <= 0) {
    return { id: "debtor_days", title: spec.title, formula: spec.formula, assumptions, ok: false, result: "Trade debtors and credit sales are both required.", value: null };
  }
  const value = round2((debtors / sales) * periodDays);
  return { id: "debtor_days", title: spec.title, formula: spec.formula, assumptions, ok: true, result: `Debtor days are ${value}.`, value };
}

export function dscr(ebitda: number | null, debtService: number | null): CalcOutcome {
  const spec = CALCULATOR_SPECS.dscr;
  if (ebitda == null || debtService == null || debtService <= 0) {
    return { id: "dscr", title: spec.title, formula: spec.formula, assumptions: [spec.assumptions], ok: false, result: "EBITDA and debt service are both required.", value: null };
  }
  const value = round2(ebitda / debtService);
  return { id: "dscr", title: spec.title, formula: spec.formula, assumptions: [spec.assumptions], ok: true, result: `DSCR is ${value}.`, value };
}

export function serviceability(facility: number | null, freeCash: number | null, annualRate: number, buffer: number): CalcOutcome {
  const spec = CALCULATOR_SPECS.serviceability;
  const assumptions = [spec.assumptions, `Example annual rate assumption: ${annualRate}. Buffer assumption: ${buffer}.`];
  if (facility == null || freeCash == null || annualRate < 0) {
    return { id: "serviceability", title: spec.title, formula: spec.formula, assumptions, ok: false, result: "A facility amount and free cash per month are both required.", value: null };
  }
  const repayment = round2(facility * annualRate / 12);
  const surplus = round2(freeCash - repayment);
  const ok = surplus >= buffer;
  return {
    id: "serviceability",
    title: spec.title,
    formula: spec.formula,
    assumptions,
    ok: true,
    result: `Example monthly repayment ${repayment}. Surplus ${surplus}. ${ok ? "Serviceable on this example assumption." : "Not serviceable on this example assumption."}`,
    value: surplus,
  };
}

export function facilitySize(input: { requested: number | null; debtors: number | null; freeCash: number | null; annualRate: number; advanceRate: number }): CalcOutcome {
  const spec = CALCULATOR_SPECS.facility_size;
  const assumptions = [spec.assumptions, `Example advance rate: ${input.advanceRate}. Example annual rate: ${input.annualRate}.`];
  const caps: number[] = [];
  if (input.requested != null && input.requested > 0) caps.push(input.requested);
  if (input.debtors != null && input.debtors > 0 && input.advanceRate > 0) caps.push(input.debtors * input.advanceRate);
  if (input.freeCash != null && input.freeCash > 0 && input.annualRate > 0) caps.push(input.freeCash / (input.annualRate / 12));
  if (caps.length === 0) {
    return { id: "facility_size", title: spec.title, formula: spec.formula, assumptions, ok: false, result: "No requested amount, receivables, or free cash was available.", value: null };
  }
  const value = round2(Math.min(...caps));
  return {
    id: "facility_size",
    title: spec.title,
    formula: spec.formula,
    assumptions,
    ok: true,
    result: `Indicative facility size is ${value}. ${assumptions[0]} This is indicative, not a credit offer.`,
    value,
  };
}

export function runCalculators(settings: CalculatorSetting[], facts: FactBag, rows: WeekRow[]): CalcOutcome[] {
  const byId = new Map(settings.map((setting) => [setting.id, setting]));
  const outcomes: CalcOutcome[] = [];
  for (const id of CALCULATOR_IDS) {
    const setting = byId.get(id);
    if (!setting?.enabled) continue;
    const rate = setting.assumptions.exampleAnnualRate ?? 0.09;
    const advance = setting.assumptions.advanceRate ?? 0.8;
    const buffer = setting.assumptions.buffer ?? 0;
    const facility = facts.requestedFacility ?? facts.dealSize;
    if (id === "cashflow_gap") outcomes.push(cashflowGap(rows, setting.assumptions.startingCash ?? 0));
    if (id === "debtor_days") outcomes.push(debtorDays(facts.tradeDebtors, facts.creditSales, setting.assumptions.periodDays ?? 365));
    if (id === "dscr") outcomes.push(dscr(facts.ebitda, facts.debtService));
    if (id === "serviceability") outcomes.push(serviceability(facility, facts.freeCashMonthly, rate, buffer));
    if (id === "facility_size") outcomes.push(facilitySize({ requested: facility, debtors: facts.tradeDebtors, freeCash: facts.freeCashMonthly, annualRate: rate, advanceRate: advance }));
  }
  return outcomes;
}
