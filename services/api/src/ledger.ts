import type { WebhookEvent } from "./payments/provider.ts";

export type LedgerLine = {
  account:
    | "provider_cash"
    | "platform_fee_revenue"
    | "creator_payable"
    | "reviewer_payable"
    | "tax_payable"
    | "refund_expense";
  direction: "debit" | "credit";
  amountMinor: bigint;
  currency: string;
};

export function linesForEvent(event: WebhookEvent): LedgerLine[] {
  const parts = event.platformFeeMinor + event.creatorRoyaltyMinor + event.reviewFeeMinor + event.taxMinor;
  if (parts !== event.amountMinor) {
    throw new Error("fee split does not add up to the charge");
  }
  if (event.type === "payment.captured") {
    const lines: LedgerLine[] = [
      { account: "provider_cash", direction: "debit", amountMinor: event.amountMinor, currency: event.currency },
    ];
    pushCredit(lines, "tax_payable", event.taxMinor, event.currency);
    pushCredit(lines, "platform_fee_revenue", event.platformFeeMinor, event.currency);
    pushCredit(lines, "creator_payable", event.creatorRoyaltyMinor, event.currency);
    pushCredit(lines, "reviewer_payable", event.reviewFeeMinor, event.currency);
    assertBalanced(lines);
    return lines;
  }
  const lines: LedgerLine[] = [
    { account: "provider_cash", direction: "credit", amountMinor: event.amountMinor, currency: event.currency },
  ];
  pushDebit(lines, "tax_payable", event.taxMinor, event.currency);
  pushDebit(lines, "refund_expense", event.platformFeeMinor, event.currency);
  pushDebit(lines, "creator_payable", event.creatorRoyaltyMinor, event.currency);
  pushDebit(lines, "reviewer_payable", event.reviewFeeMinor, event.currency);
  assertBalanced(lines);
  return lines;
}

export function assertBalanced(lines: LedgerLine[]): void {
  const currencies = new Set(lines.map((line) => line.currency));
  if (currencies.size !== 1) {
    throw new Error("a ledger transaction is single-currency");
  }
  const debit = sum(lines, "debit");
  const credit = sum(lines, "credit");
  if (debit !== credit || debit === 0n) {
    throw new Error("ledger transaction is not balanced");
  }
}

export class IdempotentLedger {
  private readonly posted = new Map<string, LedgerLine[]>();

  apply(event: WebhookEvent): LedgerLine[] {
    const existing = this.posted.get(event.id);
    if (existing) {
      return existing;
    }
    const lines = linesForEvent(event);
    this.posted.set(event.id, lines);
    return lines;
  }

  transactionCount(): number {
    return this.posted.size;
  }
}

function pushCredit(lines: LedgerLine[], account: LedgerLine["account"], amount: bigint, currency: string): void {
  if (amount > 0n) {
    lines.push({ account, direction: "credit", amountMinor: amount, currency });
  }
}

function pushDebit(lines: LedgerLine[], account: LedgerLine["account"], amount: bigint, currency: string): void {
  if (amount > 0n) {
    lines.push({ account, direction: "debit", amountMinor: amount, currency });
  }
}

function sum(lines: LedgerLine[], direction: LedgerLine["direction"]): bigint {
  return lines.filter((line) => line.direction === direction).reduce((total, line) => total + line.amountMinor, 0n);
}
