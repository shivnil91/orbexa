import { defaultCalculators, type WeekRow } from "./studio-calc.ts";
import { emptyHard, type BenchCase, type HardRule, type IntakeQuestion, type PanelCell, type StudioConfig } from "./studio-types.ts";

export const NDIS_EXAMPLE_SLUG = "example-ndis-broker";

export const NDIS_EXAMPLE_NAME = "NDIS funding desk";

export const NDIS_EXAMPLE_PITCH = "Example funding options for a disability provider. Example data, not a real lender panel.";

const CSV = ["week,inflow,outflow", "1,1000,400", "2,0,900"].join("\n");

function exampleAssumptions(id: string): Record<string, number> {
  if (id === "cashflow_gap") return { startingCash: 20000 };
  if (id === "debtor_days") return { periodDays: 365 };
  return { exampleAnnualRate: 0.09, advanceRate: 0.8, buffer: 0 };
}

function question(partial: IntakeQuestion): IntakeQuestion {
  return partial;
}

function cell(productId: string, lenderId: string, hard: Partial<HardRule>, soft: string, softScore: number): PanelCell {
  return { productId, lenderId, hard: { ...emptyHard(), ...hard }, soft, softScore };
}

const HEALTHY: Record<string, string> = {
  q_provider: "SIL",
  q_registration: "registered",
  q_mix: "plan-managed",
  q_lag: "28",
  q_debtors: "180000",
  q_sales: "900000",
  q_sil: "no",
  q_staff: "40000",
  q_payroll: "fortnightly",
  q_debt_service: "24000",
  q_ato_position: "clear",
  q_ato_debt: "0",
  q_purpose: "wages",
  q_trading: "18",
  q_revenue: "900000",
  q_credit: "clear",
  q_deal: "120000",
  q_ebitda: "150000",
  q_free: "8000",
  q_facility: "120000",
};

function caseOf(partial: Pick<BenchCase, "id" | "title" | "expect" | "hardRule"> & { answers?: Record<string, string>; csv?: string }): BenchCase {
  return {
    id: partial.id,
    title: partial.title,
    answers: { ...HEALTHY, ...partial.answers },
    csv: partial.csv ?? CSV,
    expect: partial.expect,
    hardRule: partial.hardRule,
    confirmedNoPersonal: true,
  };
}

export function ndisStudioConfig(): StudioConfig {
  const calculators = defaultCalculators().map((setting) => ({
    ...setting,
    enabled: true,
    assumptions: exampleAssumptions(setting.id),
  }));
  return {
    exampleData: true,
    specialty: {
      niche: "Business loans and equity for disability service providers, including NDIS providers.",
      audience: "An accounting firm whose client is an NDIS provider and needs a funding structure before anyone talks to a broker.",
      scope: [
        {
          id: "scope_personal",
          field: "purpose",
          match: "personal",
          action: "refuse",
          reason: "Personal expenses are outside this practice. The agent refuses them and does not shop a lender.",
        },
        {
          id: "scope_consumer",
          field: "any",
          match: "consumer mortgage",
          action: "handoff",
          reason: "A consumer mortgage is outside this desk. Hand it to the broker rather than guessing a product.",
        },
      ],
    },
    intake: [
      question({ id: "q_provider", prompt: "Provider type", why: "The product set depends on whether the provider is SIL, SDA, or core supports.", required: true, kind: "choice", options: ["core supports", "SIL", "SDA", "plan management", "allied health"], fact: "", showWhen: null }),
      question({ id: "q_registration", prompt: "NDIS registration", why: "An unregistered provider is a different file from a registered one.", required: true, kind: "choice", options: ["registered", "not registered"], fact: "", showWhen: null }),
      question({ id: "q_mix", prompt: "Revenue mix", why: "Plan-managed, agency, and self-managed revenue collect on different clocks.", required: true, kind: "choice", options: ["plan-managed", "agency", "self-managed", "mixed"], fact: "", showWhen: null }),
      question({ id: "q_lag", prompt: "NDIA payment lag in days", why: "The lag is the receivable a wages facility has to bridge.", required: false, kind: "number", options: [], fact: "", showWhen: null }),
      question({ id: "q_debtors", prompt: "Trade debtors", why: "Debtor days and an indicative receivables facility both need this balance.", required: true, kind: "number", options: [], fact: "tradeDebtors", showWhen: null }),
      question({ id: "q_sales", prompt: "Credit sales for the year", why: "Debtor days divide debtors by credit sales.", required: true, kind: "number", options: [], fact: "creditSales", showWhen: null }),
      question({ id: "q_sil", prompt: "SIL or SDA exposure", why: "Property and accommodation exposure changes which product is even discussable.", required: true, kind: "choice", options: ["yes", "no"], fact: "", showWhen: null }),
      question({ id: "q_sda_value", prompt: "SDA property value", why: "An SDA property file needs a value before anyone talks about a property product.", required: true, kind: "number", options: [], fact: "", showWhen: { questionId: "q_sil", equals: "yes" } }),
      question({ id: "q_staff", prompt: "Staff costs per month", why: "Wages are usually why the provider needs the money.", required: false, kind: "number", options: [], fact: "", showWhen: null }),
      question({ id: "q_payroll", prompt: "Payroll cycle", why: "A weekly payroll runs out of cash sooner than a monthly one.", required: false, kind: "choice", options: ["weekly", "fortnightly", "monthly"], fact: "", showWhen: null }),
      question({ id: "q_debt_service", prompt: "Annual debt service", why: "DSCR needs the existing repayments.", required: false, kind: "number", options: [], fact: "debtService", showWhen: null }),
      question({ id: "q_ato_position", prompt: "ATO position", why: "An overdue ATO account is a hard stop on the example panel.", required: true, kind: "choice", options: ["clear", "on a plan", "overdue"], fact: "", showWhen: null }),
      question({ id: "q_ato_debt", prompt: "ATO debt", why: "The hard rule compares this balance with the example maximum.", required: true, kind: "number", options: [], fact: "atoDebt", showWhen: null }),
      question({ id: "q_purpose", prompt: "Purpose of funds", why: "Wages, equipment, property, and equity are different products. Personal spending is out of scope.", required: true, kind: "choice", options: ["wages", "equipment", "property", "equity", "personal expense", "working capital"], fact: "purpose", showWhen: null }),
      question({ id: "q_trading", prompt: "Months trading", why: "Every example lender cell has a minimum trading period.", required: true, kind: "number", options: [], fact: "tradingMonths", showWhen: null }),
      question({ id: "q_revenue", prompt: "Annual revenue", why: "Every example lender cell has a minimum revenue.", required: true, kind: "number", options: [], fact: "annualRevenue", showWhen: null }),
      question({ id: "q_credit", prompt: "Credit position", why: "Several example cells require a clear credit file.", required: true, kind: "choice", options: ["clear", "adverse"], fact: "creditClear", showWhen: null }),
      question({ id: "q_deal", prompt: "Amount sought", why: "A large amount is one of the triggers that stops the agent and books the broker.", required: true, kind: "number", options: [], fact: "dealSize", showWhen: null }),
      question({ id: "q_ebitda", prompt: "EBITDA", why: "DSCR uses EBITDA over debt service.", required: false, kind: "number", options: [], fact: "ebitda", showWhen: null }),
      question({ id: "q_free", prompt: "Free cash per month", why: "The example serviceability sum uses free cash, not a lender calculator.", required: false, kind: "number", options: [], fact: "freeCashMonthly", showWhen: null }),
      question({ id: "q_facility", prompt: "Requested facility", why: "The indicative facility is capped by what was asked for.", required: false, kind: "number", options: [], fact: "requestedFacility", showWhen: null }),
    ],
    products: [
      { id: "prod_invoice", name: "Invoice or receivables finance" },
      { id: "prod_overdraft", name: "Overdraft" },
      { id: "prod_equipment", name: "Equipment" },
      { id: "prod_sda", name: "SDA property" },
      { id: "prod_equity", name: "Equity" },
    ],
    lenders: [
      { id: "len_a", name: "Example Lender A" },
      { id: "len_b", name: "Example Lender B" },
      { id: "len_c", name: "Example Lender C" },
    ],
    cells: [
      cell("prod_invoice", "len_a", { minTradingMonths: 12, minAnnualRevenue: 250000, creditClearRequired: true, maxAtoDebt: 0 }, "Prefers plan-managed receivables on the example panel.", 90),
      cell("prod_invoice", "len_b", { minTradingMonths: 6, minAnnualRevenue: 150000, creditClearRequired: false, maxAtoDebt: 10000 }, "Will look at a small ATO balance on the example panel.", 70),
      cell("prod_invoice", "len_c", { minTradingMonths: 18, minAnnualRevenue: 300000, creditClearRequired: true, maxAtoDebt: 0 }, "Wants a longer file on the example panel.", 40),
      cell("prod_overdraft", "len_a", { minTradingMonths: 24, minAnnualRevenue: 400000, creditClearRequired: true, maxAtoDebt: 0 }, "Only longer files on the example panel.", 50),
      cell("prod_overdraft", "len_b", { minTradingMonths: 12, minAnnualRevenue: 200000, creditClearRequired: true, maxAtoDebt: 0 }, "A shorter overdraft file on the example panel.", 60),
      cell("prod_overdraft", "len_c", { minTradingMonths: 36, minAnnualRevenue: 500000, creditClearRequired: true, maxAtoDebt: 0 }, "A long trading history on the example panel.", 20),
      cell("prod_equipment", "len_a", { minTradingMonths: 12, minAnnualRevenue: 200000, creditClearRequired: true, maxAtoDebt: 5000 }, "Equipment with a small ATO balance on the example panel.", 55),
      cell("prod_equipment", "len_b", { minTradingMonths: 6, minAnnualRevenue: 100000, creditClearRequired: false, maxAtoDebt: 20000 }, "A lighter equipment file on the example panel.", 45),
      cell("prod_equipment", "len_c", { minTradingMonths: 12, minAnnualRevenue: 150000, creditClearRequired: true, maxAtoDebt: 0 }, "Equipment with a clear ATO account on the example panel.", 50),
      cell("prod_sda", "len_a", { minTradingMonths: 24, minAnnualRevenue: 500000, creditClearRequired: true, maxAtoDebt: 0 }, "SDA property prefers a longer file on the example panel.", 80),
      cell("prod_sda", "len_b", { minTradingMonths: 36, minAnnualRevenue: 750000, creditClearRequired: true, maxAtoDebt: 0 }, "SDA property wants a long history on the example panel.", 70),
      cell("prod_sda", "len_c", { minTradingMonths: 24, minAnnualRevenue: 400000, creditClearRequired: true, maxAtoDebt: 0 }, "SDA property with a clear file on the example panel.", 60),
      cell("prod_equity", "len_a", { minTradingMonths: 36, minAnnualRevenue: 1000000, creditClearRequired: true, maxAtoDebt: 0 }, "Equity is a broker conversation on the example panel.", 30),
      cell("prod_equity", "len_b", { minTradingMonths: 24, minAnnualRevenue: 800000, creditClearRequired: true, maxAtoDebt: 0 }, "Equity wants more trading months on the example panel.", 40),
      cell("prod_equity", "len_c", { minTradingMonths: 36, minAnnualRevenue: 1200000, creditClearRequired: true, maxAtoDebt: 0 }, "Equity is the last resort on the example panel.", 20),
    ],
    calculators,
    playbooks: [
      {
        id: "pb_lag",
        see: "plan-managed payment lag",
        do: "Discuss invoice or receivables finance before an overdraft.",
        because: "NDIA lag is a receivable, not a trading loss.",
        documents: ["Aged receivables", "A sample NDIA remittance"],
      },
      {
        id: "pb_ato",
        see: "overdue ATO",
        do: "Stop and do not send a credit application.",
        because: "An overdue ATO position fails the example hard rule.",
        documents: ["ATO position statement"],
      },
      {
        id: "pb_sda",
        see: "SDA property exposure",
        do: "Hand the property file to the broker.",
        because: "SDA property is a specialist credit decision, not a model guess.",
        documents: ["Valuation", "Lease", "NDIS registration"],
      },
    ],
    templates: [
      { id: "tpl_funding", kind: "funding_report", title: "Funding options report", preface: "Example note for the accountant. Rank the structures that passed the hard rules and say why. Do not invent a lender price." },
      { id: "tpl_pack", kind: "lender_pack", title: "Lender-ready pack", preface: "Example pack. List the facts, the calculations, and the documents still missing." },
      { id: "tpl_summary", kind: "client_summary", title: "Note for the accountant", preface: "Example summary in plain words for the accounting firm to send to its client." },
    ],
    handoff: [
      { id: "hand_deal", kind: "deal_size", threshold: 250000, note: "The amount sought is large enough that the broker should own the conversation." },
      { id: "hand_equity", kind: "equity", threshold: 1, note: "Equity is the broker's deal. The agent stops and does not negotiate a share." },
      { id: "hand_complex", kind: "complexity", threshold: 12, note: "Too many hard rules failed. The broker should read the file." },
    ],
    cases: [
      caseOf({ id: "case_wages", title: "Registered SIL provider, wages", expect: "Invoice or receivables finance with Example Lender A", hardRule: true }),
      caseOf({ id: "case_short", title: "Short trading history", expect: "rule:prod_invoice:len_a:min_trading_months", hardRule: true, answers: { q_trading: "3" } }),
      caseOf({ id: "case_equity", title: "Equity raise", expect: "The agent stopped.", hardRule: false, answers: { q_purpose: "equity" } }),
      caseOf({ id: "case_personal", title: "Personal spending", expect: "The agent refused this request.", hardRule: false, answers: { q_purpose: "personal expense" } }),
    ],
  };
}

export function exampleCashflowRows(): WeekRow[] {
  return [{ inflow: 1000, outflow: 400 }, { inflow: 0, outflow: 900 }];
}
