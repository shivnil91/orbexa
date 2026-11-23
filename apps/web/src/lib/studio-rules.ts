import type { FactBag } from "./studio-calc.ts";
import type { HardRule, PanelCell, Product, Lender } from "./studio-types.ts";

export type RuleFire = {
  ruleId: string;
  productId: string;
  lenderId: string;
  product: string;
  lender: string;
  code: "min_trading_months" | "min_annual_revenue" | "credit" | "ato_debt";
  detail: string;
};

export type EligibleCell = {
  productId: string;
  lenderId: string;
  product: string;
  lender: string;
  soft: string;
  softScore: number;
};

export type PanelResult = {
  knockouts: { cell: EligibleCell; fires: RuleFire[] }[];
  eligible: EligibleCell[];
};

function ruleId(productId: string, lenderId: string, code: RuleFire["code"]): string {
  return `rule:${productId}:${lenderId}:${code}`;
}

/** Hard rules run here, in code. A sentence in a playbook or a model reply cannot add a fire. */
export function applyHardRules(cell: PanelCell, hard: HardRule, facts: FactBag, names: { product: string; lender: string }): RuleFire[] {
  const fires: RuleFire[] = [];
  const base = { productId: cell.productId, lenderId: cell.lenderId, product: names.product, lender: names.lender };
  if (hard.minTradingMonths != null) {
    if (facts.tradingMonths == null || facts.tradingMonths < hard.minTradingMonths) {
      fires.push({
        ...base,
        code: "min_trading_months",
        ruleId: ruleId(cell.productId, cell.lenderId, "min_trading_months"),
        detail: facts.tradingMonths == null
          ? `Minimum trading months is ${hard.minTradingMonths}. Trading months were not provided.`
          : `Minimum trading months is ${hard.minTradingMonths}. The file has ${facts.tradingMonths}.`,
      });
    }
  }
  if (hard.minAnnualRevenue != null) {
    if (facts.annualRevenue == null || facts.annualRevenue < hard.minAnnualRevenue) {
      fires.push({
        ...base,
        code: "min_annual_revenue",
        ruleId: ruleId(cell.productId, cell.lenderId, "min_annual_revenue"),
        detail: facts.annualRevenue == null
          ? `Minimum annual revenue is ${hard.minAnnualRevenue}. Annual revenue was not provided.`
          : `Minimum annual revenue is ${hard.minAnnualRevenue}. The file has ${facts.annualRevenue}.`,
      });
    }
  }
  if (hard.creditClearRequired) {
    if (facts.creditClear !== true) {
      fires.push({
        ...base,
        code: "credit",
        ruleId: ruleId(cell.productId, cell.lenderId, "credit"),
        detail: facts.creditClear == null
          ? "A clear credit position is required. Credit was not provided."
          : "A clear credit position is required. The file is not clear.",
      });
    }
  }
  if (hard.maxAtoDebt != null) {
    if (facts.atoDebt == null || facts.atoDebt > hard.maxAtoDebt) {
      fires.push({
        ...base,
        code: "ato_debt",
        ruleId: ruleId(cell.productId, cell.lenderId, "ato_debt"),
        detail: facts.atoDebt == null
          ? `ATO debt must be at most ${hard.maxAtoDebt}. ATO debt was not provided.`
          : `ATO debt must be at most ${hard.maxAtoDebt}. The file has ${facts.atoDebt}.`,
      });
    }
  }
  return fires;
}

export function applyPanel(products: Product[], lenders: Lender[], cells: PanelCell[], facts: FactBag): PanelResult {
  const productName = new Map(products.map((item) => [item.id, item.name]));
  const lenderName = new Map(lenders.map((item) => [item.id, item.name]));
  const knockouts: PanelResult["knockouts"] = [];
  const eligible: EligibleCell[] = [];
  const ordered = [...cells].sort((left, right) => left.productId.localeCompare(right.productId) || left.lenderId.localeCompare(right.lenderId));
  for (const cell of ordered) {
    const names = {
      product: productName.get(cell.productId) ?? cell.productId,
      lender: lenderName.get(cell.lenderId) ?? cell.lenderId,
    };
    const view: EligibleCell = {
      productId: cell.productId,
      lenderId: cell.lenderId,
      product: names.product,
      lender: names.lender,
      soft: cell.soft,
      softScore: cell.softScore,
    };
    const fires = applyHardRules(cell, cell.hard, facts, names);
    if (fires.length > 0) knockouts.push({ cell: view, fires });
    else eligible.push(view);
  }
  eligible.sort((left, right) => right.softScore - left.softScore || left.lender.localeCompare(right.lender) || left.product.localeCompare(right.product));
  return { knockouts, eligible };
}
