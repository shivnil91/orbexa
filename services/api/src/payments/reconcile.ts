export type CurrencySum = {
  currency: string;
  capturedMinor: bigint;
  refundedMinor: bigint;
};

export type ReconciliationMismatch = {
  currency: string;
  field: "capturedMinor" | "refundedMinor";
  ledgerMinor: bigint;
  providerMinor: bigint;
};

export type Reconciliation = {
  day: string;
  matched: boolean;
  mismatches: ReconciliationMismatch[];
  pageHuman: boolean;
};

export type HumanPage = {
  severity: "page";
  reason: "ledger_provider_mismatch";
  day: string;
  mismatches: ReconciliationMismatch[];
};

function byCurrency(rows: CurrencySum[], currency: string): CurrencySum {
  return rows.find((row) => row.currency === currency) ?? {
    currency,
    capturedMinor: 0n,
    refundedMinor: 0n,
  };
}

export function reconcileSandboxDay(
  day: string,
  ledger: CurrencySum[],
  provider: CurrencySum[],
): Reconciliation {
  const currencies = [...new Set([...ledger, ...provider].map((row) => row.currency))].sort();
  const mismatches: ReconciliationMismatch[] = [];
  for (const currency of currencies) {
    const left = byCurrency(ledger, currency);
    const right = byCurrency(provider, currency);
    if (left.capturedMinor !== right.capturedMinor) {
      mismatches.push({
        currency,
        field: "capturedMinor",
        ledgerMinor: left.capturedMinor,
        providerMinor: right.capturedMinor,
      });
    }
    if (left.refundedMinor !== right.refundedMinor) {
      mismatches.push({
        currency,
        field: "refundedMinor",
        ledgerMinor: left.refundedMinor,
        providerMinor: right.refundedMinor,
      });
    }
  }
  return {
    day,
    matched: mismatches.length === 0,
    mismatches,
    pageHuman: mismatches.length > 0,
  };
}

export function pageForMismatch(result: Reconciliation): HumanPage | null {
  if (!result.pageHuman) {
    return null;
  }
  return {
    severity: "page",
    reason: "ledger_provider_mismatch",
    day: result.day,
    mismatches: result.mismatches,
  };
}

export function sumsFromBalanceTransactions(body: string): CurrencySum[] {
  const parsed = JSON.parse(body) as {
    data?: Array<{ type?: string; amount?: number; currency?: string }>;
  };
  const totals = new Map<string, CurrencySum>();
  for (const row of parsed.data ?? []) {
    if (typeof row.amount !== "number" || typeof row.currency !== "string") {
      continue;
    }
    const currency = row.currency.toUpperCase();
    const current = totals.get(currency) ?? { currency, capturedMinor: 0n, refundedMinor: 0n };
    if (row.type === "charge" || row.type === "payment") {
      current.capturedMinor += BigInt(row.amount);
    } else if (row.type === "refund" || row.type === "payment_refund") {
      current.refundedMinor += BigInt(Math.abs(row.amount));
    }
    totals.set(currency, current);
  }
  return [...totals.values()];
}
