# ADR 0007: Service levels

- Status: Proposed
- Date: 2026-11-22

## Context

Every listing is sold as Autonomous, Expert Verified, or Expert Led. Each level has its own price, currency, delivery time, included revisions, cancellation rule, and payout release. The numbers are commercial and are not invented here.

## Decision

`listing_tiers` stores one row per level:

- `service_level` is `autonomous`, `expert_verified`, or `expert_led`.
- `price_minor` and `currency` are required. Nothing defaults to AUD or USD.
- `platform_fee_bps + creator_royalty_bps = 10000`. Those basis points apply to the amount left after `review_fee_minor`.
- Autonomous requires `review_fee_minor = 0`. The other two levels require a positive review fee.
- `delivery_days`, `included_revisions`, `cancellation_code`, and `payout_release` (`on_acceptance` or `after_dispute_window`) are required columns so Milestone 2 does not add them later.

The order copies the computed minor amounts. Later edits to the listing do not rewrite a placed order.

Expert Verified and Expert Led create an `approvals` row of kind `expert_review` before the buyer can accept. Autonomous does not.

## Alternatives

A single price with an optional add-on review was considered. It hides the timeline and cancellation differences the founder asked to sell as three offers.

Hard-coding a platform percentage in the application was rejected. The snapshot on the order is the figure that gets ledgered.

## Consequences

Moishin can publish one, two, or three levels. Rahul buys one row. The fee math is `splitServiceAmount` in `packages/db`, covered by a unit test.
