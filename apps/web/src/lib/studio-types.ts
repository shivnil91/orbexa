/** Expert Agent Studio. The shape is domain-agnostic. The NDIS desk is one filled-in example. */

export const EXAMPLE_PANEL_BADGE = "Example data: replace with your panel";

export const INDICATIVE_LABEL = "indicative, not a credit offer";

export type FactKey =
  | "tradingMonths"
  | "annualRevenue"
  | "creditClear"
  | "atoDebt"
  | "dealSize"
  | "tradeDebtors"
  | "creditSales"
  | "ebitda"
  | "debtService"
  | "freeCashMonthly"
  | "requestedFacility"
  | "purpose";

export type IntakeQuestion = {
  id: string;
  prompt: string;
  why: string;
  required: boolean;
  kind: "text" | "number" | "choice";
  options: string[];
  fact: FactKey | "";
  showWhen: { questionId: string; equals: string } | null;
};

export type ScopeRule = {
  id: string;
  field: FactKey | "any";
  match: string;
  action: "refuse" | "handoff";
  reason: string;
};

export type HardRule = {
  minTradingMonths: number | null;
  minAnnualRevenue: number | null;
  creditClearRequired: boolean;
  maxAtoDebt: number | null;
};

export type Product = { id: string; name: string };
export type Lender = { id: string; name: string };

export type PanelCell = {
  productId: string;
  lenderId: string;
  hard: HardRule;
  soft: string;
  softScore: number;
};

export type CalculatorId = "cashflow_gap" | "debtor_days" | "dscr" | "serviceability" | "facility_size";

export type CalculatorSetting = {
  id: CalculatorId;
  enabled: boolean;
  assumptions: Record<string, number>;
};

export type Playbook = {
  id: string;
  see: string;
  do: string;
  because: string;
  documents: string[];
};

export type TemplateKind = "funding_report" | "lender_pack" | "client_summary";

export type OutputTemplate = {
  id: string;
  kind: TemplateKind;
  title: string;
  preface: string;
};

export type HandoffTrigger = {
  id: string;
  kind: "deal_size" | "equity" | "complexity";
  threshold: number;
  note: string;
};

export type BenchCase = {
  id: string;
  title: string;
  answers: Record<string, string>;
  csv: string;
  expect: string;
  hardRule: boolean;
  confirmedNoPersonal: boolean;
};

export type StudioConfig = {
  specialty: { niche: string; audience: string; scope: ScopeRule[] };
  intake: IntakeQuestion[];
  products: Product[];
  lenders: Lender[];
  cells: PanelCell[];
  calculators: CalculatorSetting[];
  playbooks: Playbook[];
  templates: OutputTemplate[];
  handoff: HandoffTrigger[];
  cases: BenchCase[];
  exampleData: boolean;
};

export type StudioVersion = {
  number: number;
  status: "draft" | "test" | "published";
  note: string;
  savedAt: string;
  config: StudioConfig;
};

export type ProposalStatus = "proposed" | "approved" | "rejected";

export type Proposal =
  | { id: string; status: ProposalStatus; source: "interview" | "correction"; kind: "intake"; question: IntakeQuestion }
  | { id: string; status: ProposalStatus; source: "interview" | "correction"; kind: "rule"; productId: string; lenderId: string; hard: HardRule; note: string }
  | { id: string; status: ProposalStatus; source: "interview" | "correction"; kind: "playbook"; playbook: Playbook }
  | { id: string; status: ProposalStatus; source: "interview" | "correction"; kind: "case"; bench: BenchCase };

export type BenchResult = {
  id: string;
  title: string;
  pass: boolean;
  hardRule: boolean;
  expected: string;
  actual: string;
  missing: string[];
  coverage: number;
};

export type StudioRecord = {
  trainingConsent: boolean;
  publishedVersion: number | null;
  provenAt: string | null;
  versions: StudioVersion[];
  changelog: { at: string; version: number; action: string; note: string }[];
  proposals: Proposal[];
  lastBench: { at: string; coverage: number; results: BenchResult[] } | null;
};

export type ClaimSource =
  | { type: "rule" | "calculator" | "playbook" | "document"; id: string }
  | { type: "model"; id: string };

export type Claim = { id: string; text: string; source: ClaimSource };

export type StudioReport = {
  exampleData: boolean;
  refused: { ruleId: string; reason: string } | null;
  handoff: { triggerId: string; reason: string } | null;
  ranked: { productId: string; lenderId: string; product: string; lender: string; why: string; indicative: string }[];
  knockouts: { productId: string; lenderId: string; product: string; lender: string; ruleId: string; detail: string }[];
  calculations: { id: string; title: string; formula: string; assumptions: string[]; result: string; ok: boolean }[];
  playbooks: { id: string; see: string; do: string; because: string }[];
  checklist: { id: string; text: string }[];
  fundingReport: string[];
  lenderPack: string[];
  clientSummary: string[];
  claims: Claim[];
  coverage: number;
};

export function emptyHard(): HardRule {
  return { minTradingMonths: null, minAnnualRevenue: null, creditClearRequired: false, maxAtoDebt: null };
}

export function coverageOf(claims: Claim[]): number {
  if (claims.length === 0) return 0;
  const cited = claims.filter((claim) => claim.source.type !== "model").length;
  return Math.round((cited / claims.length) * 1000) / 1000;
}
