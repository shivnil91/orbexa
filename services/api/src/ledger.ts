import { createHash } from "node:crypto";
import type { WebhookEvent } from "./payments/provider.ts";

export type Sql = {
  exec(sql: string): Promise<unknown>;
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

export type WebhookPost = {
  event: WebhookEvent;
  buyerOrgId: string;
  homeRegion: string;
  orderId: string;
};

export type WebhookPostResult = {
  created: boolean;
  transactionId: string;
};

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

export async function persistWebhook(db: Sql, post: WebhookPost): Promise<WebhookPostResult> {
  const lines = linesForEvent(post.event);
  const hash = requestHash(post.event);
  const kind = post.event.type === "payment.captured" ? "charge_captured" : "refund";
  try {
    await db.exec("BEGIN");
    await db.query(
      "INSERT INTO idempotency_keys (scope, key, request_hash) VALUES ('webhook', $1, $2)",
      [post.event.id, hash],
    );
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO ledger_transactions (
         buyer_org_id, home_region, order_id, kind, currency, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text AS id`,
      [post.buyerOrgId, post.homeRegion, post.orderId, kind, post.event.currency, post.event.id],
    );
    const transactionId = inserted.rows[0]?.id;
    if (!transactionId) {
      throw new Error("ledger insert did not return an id");
    }
    for (const line of lines) {
      await db.query(
        `INSERT INTO ledger_entries (
           transaction_id, buyer_org_id, home_region, account_code, direction, amount_minor, currency
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          transactionId,
          post.buyerOrgId,
          post.homeRegion,
          line.account,
          line.direction,
          line.amountMinor.toString(),
          line.currency,
        ],
      );
    }
    await db.query("UPDATE ledger_transactions SET posted = true, posted_at = now() WHERE id = $1", [
      transactionId,
    ]);
    await db.exec("COMMIT");
    return { created: true, transactionId };
  } catch (error) {
    await db.exec("ROLLBACK");
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const existing = await db.query<{ id: string; request_hash: string }>(
      `SELECT txn.id::text AS id, keys.request_hash
       FROM ledger_transactions AS txn
       JOIN idempotency_keys AS keys
         ON keys.scope = 'webhook' AND keys.key = txn.idempotency_key
       WHERE txn.idempotency_key = $1`,
      [post.event.id],
    );
    const row = existing.rows[0];
    if (!row || row.request_hash !== hash) {
      throw new Error("webhook idempotency key was reused with a different payload");
    }
    return { created: false, transactionId: row.id };
  }
}

function requestHash(event: WebhookEvent): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        type: event.type,
        amountMinor: event.amountMinor.toString(),
        currency: event.currency,
        platformFeeMinor: event.platformFeeMinor.toString(),
        creatorRoyaltyMinor: event.creatorRoyaltyMinor.toString(),
        reviewFeeMinor: event.reviewFeeMinor.toString(),
        taxMinor: event.taxMinor.toString(),
      }),
    )
    .digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    return true;
  }
  return error instanceof Error && /duplicate key|unique constraint/i.test(error.message);
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
