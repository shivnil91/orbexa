# ADR 0004: Payments, tax, and payouts

- Status: Proposed
- Date: 2026-11-22

## Context

Buyers and experts can be in any country. The only Stripe account connected to this workspace is a live account named ThirdRoc. There is no sandbox. Fiji is not on https://stripe.com/global as fetched on 2026-11-22. Connect cross-border payouts, as documented that day, are self-serve for platforms in the US, UK, EEA, Canada, and Switzerland. Global Payouts is generally available for US and GB senders. Australia is private preview. Fiji was not in the recipient table.

## Decision

- The ledger is the commercial record. Stripe, or a later merchant-of-record, is a provider adapter.
- One ledger transaction is one currency and must balance before it posts. The trigger rejects an unbalanced post. FX is two linked transactions sharing `fx_link`, not mixed legs.
- The order snapshots `platform_fee_minor`, `creator_royalty_minor`, and `review_fee_minor` in the listing currency. `splitServiceAmount` takes the review fee first, truncates the platform basis points, and leaves the remainder with the creator. That rounding rule is proposed, not accepted.
- Tax-exclusive invoices are the path that can be issued. Inclusive tax can be stored on a draft and the check constraint keeps it in draft.
- `tax_quotes.provider = 'test'` is rejected unless `cell_identity.environment` is `local`.
- Payouts move to `processing` only with a clear, unexpired org screening and no active jurisdiction restriction. The restriction table ships empty. This repository does not contain a sanctions country list. The screening vendor is the source of truth.
- Payees use `stripe_connect` where the corridor exists and `wise` as the named long-tail candidate. Coverage, including Pacific countries, is confirmed at contract time. `unsupported_corridor` pays nobody.
- No code in this milestone calls Stripe. ThirdRoc must not be used for development.

Accounts v2 is the Connect API for a new platform. Payees are payout recipients. The platform remains merchant of record on the buyer charge. The exact responsibility fields are immutable after creation and get confirmed against the current Stripe docs when the sandbox exists. Legacy `type=express` is not the integration we will write.

## Alternatives

Stripe Connect alone was the original proposal. It does not pay creators in arbitrary countries from an arbitrary platform entity.

Building a wallet was rejected. Payables are accounting entries until counsel says holding funds is permitted.

A hand-built tax engine was rejected. Stripe Tax or a merchant of record calculates the quote. An unsupported jurisdiction stops checkout.

## Consequences

The first real charge waits on a sandbox and on the entity decision in `docs/first-response.md`. The ledger tests do not need either.
