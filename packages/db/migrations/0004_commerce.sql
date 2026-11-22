-- Commercial records. Amounts are integer minor units plus an ISO currency.
-- One ledger transaction is one currency and must balance. FX is a pair of
-- transactions sharing fx_link, never mixed legs inside one transaction.
-- Tax-exclusive is the path the checks fully enforce. Inclusive is stored so
-- a later release does not add columns, and it cannot be charged until the
-- invoice trigger understands it.

CREATE TABLE fx_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_ref text,
  base_currency char(3) NOT NULL REFERENCES currencies (code),
  quote_currency char(3) NOT NULL REFERENCES currencies (code),
  rate numeric(28, 12) NOT NULL CHECK (rate > 0),
  source_amount_minor bigint NOT NULL CHECK (source_amount_minor > 0),
  destination_amount_minor bigint NOT NULL CHECK (destination_amount_minor > 0),
  quoted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (base_currency <> quote_currency),
  CHECK (expires_at > quoted_at)
);

COMMENT ON TABLE fx_quotes IS
  'Provider snapshot. The destination minor amount is authoritative. The rate is explanatory. Orbexa does not warehouse an FX book.';

CREATE TABLE tax_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  provider text NOT NULL CHECK (provider IN ('stripe_tax', 'merchant_of_record', 'test')),
  status text NOT NULL CHECK (status IN ('quoted', 'committed', 'failed', 'unsupported')),
  customer_country char(2) NOT NULL CHECK (customer_country ~ '^[A-Z]{2}$'),
  customer_region text,
  evidence_source text NOT NULL CHECK (evidence_source IN ('billing_address', 'tax_id', 'ip')),
  tax_behavior text NOT NULL CHECK (tax_behavior IN ('exclusive', 'inclusive')),
  currency char(3) NOT NULL REFERENCES currencies (code),
  taxable_amount_minor bigint NOT NULL CHECK (taxable_amount_minor >= 0),
  tax_amount_minor bigint NOT NULL CHECK (tax_amount_minor >= 0),
  provider_ref text,
  calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tax_quotes_region
  BEFORE INSERT OR UPDATE OF home_region ON tax_quotes
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE OR REPLACE FUNCTION app.assert_tax_provider()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  env text;
BEGIN
  SELECT environment INTO env FROM cell_identity;
  IF NEW.provider = 'test' AND env IS DISTINCT FROM 'local' THEN
    RAISE EXCEPTION 'test tax provider is local-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tax_quotes_provider
  BEFORE INSERT OR UPDATE ON tax_quotes
  FOR EACH ROW EXECUTE FUNCTION app.assert_tax_provider();

CREATE TABLE tax_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES tax_quotes (id),
  jurisdiction text NOT NULL,
  tax_type text NOT NULL CHECK (tax_type IN ('vat', 'gst', 'sales_tax', 'other')),
  rate_bps integer NOT NULL CHECK (rate_bps >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL REFERENCES currencies (code)
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  listing_tier_id uuid NOT NULL REFERENCES listing_tiers (id),
  listing_currency char(3) NOT NULL REFERENCES currencies (code),
  service_amount_minor bigint NOT NULL CHECK (service_amount_minor > 0),
  platform_fee_minor bigint NOT NULL CHECK (platform_fee_minor >= 0),
  creator_royalty_minor bigint NOT NULL CHECK (creator_royalty_minor >= 0),
  review_fee_minor bigint NOT NULL CHECK (review_fee_minor >= 0),
  tax_behavior text NOT NULL CHECK (tax_behavior IN ('exclusive', 'inclusive')),
  tax_amount_minor bigint NOT NULL DEFAULT 0 CHECK (tax_amount_minor >= 0),
  tax_quote_id uuid REFERENCES tax_quotes (id),
  charge_currency char(3) NOT NULL REFERENCES currencies (code),
  charge_amount_minor bigint NOT NULL CHECK (charge_amount_minor > 0),
  fx_quote_id uuid REFERENCES fx_quotes (id),
  buyer_country_code char(2) NOT NULL CHECK (buyer_country_code ~ '^[A-Z]{2}$'),
  creator_country_code char(2) NOT NULL CHECK (creator_country_code ~ '^[A-Z]{2}$'),
  buyer_locale text NOT NULL,
  buyer_time_zone text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'draft', 'awaiting_payment', 'paid', 'in_delivery', 'accepted',
    'cancelled', 'refunded', 'disputed'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (service_amount_minor = platform_fee_minor + creator_royalty_minor + review_fee_minor),
  CHECK (
    (charge_currency = listing_currency AND fx_quote_id IS NULL)
    OR (charge_currency <> listing_currency AND fx_quote_id IS NOT NULL)
  ),
  CHECK (
    (
      tax_behavior = 'exclusive'
      AND charge_currency = listing_currency
      AND charge_amount_minor = service_amount_minor + tax_amount_minor
    )
    OR (
      tax_behavior = 'inclusive'
      AND charge_currency = listing_currency
      AND charge_amount_minor = service_amount_minor
      AND tax_amount_minor <= platform_fee_minor
    )
    OR charge_currency <> listing_currency
  ),
  CHECK (buyer_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  CHECK (tax_behavior <> 'inclusive' OR status = 'draft')
);

COMMENT ON TABLE orders IS
  'Buyer-cell commercial record. Creator payouts are obligations, not a copy of the buyer file. Inclusive tax can be stored on a draft and cannot leave draft until a later release.';

CREATE TRIGGER orders_region
  BEFORE INSERT OR UPDATE OF home_region ON orders
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER orders_touch
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE OR REPLACE FUNCTION app.assert_order_country()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM jurisdiction_restrictions AS restriction
    WHERE restriction.active
      AND restriction.kind IN ('sanctions', 'checkout_refused')
      AND restriction.country_code = NEW.buyer_country_code
  ) THEN
    RAISE EXCEPTION 'checkout is refused for the buyer country';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_country
  BEFORE INSERT OR UPDATE OF buyer_country_code, status ON orders
  FOR EACH ROW EXECUTE FUNCTION app.assert_order_country();

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders (id),
  buyer_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  invoice_number text NOT NULL,
  locale text NOT NULL,
  currency char(3) NOT NULL REFERENCES currencies (code),
  service_amount_minor bigint NOT NULL CHECK (service_amount_minor >= 0),
  tax_amount_minor bigint NOT NULL CHECK (tax_amount_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  supplier_country char(2) NOT NULL CHECK (supplier_country ~ '^[A-Z]{2}$'),
  customer_country char(2) NOT NULL CHECK (customer_country ~ '^[A-Z]{2}$'),
  status text NOT NULL CHECK (status IN ('draft', 'issued', 'void', 'credited')),
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_minor = service_amount_minor + tax_amount_minor),
  CHECK (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);

CREATE TRIGGER invoices_region
  BEFORE INSERT OR UPDATE OF home_region ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE OR REPLACE FUNCTION app.assert_invoice_matches_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  order_row orders%ROWTYPE;
BEGIN
  SELECT * INTO order_row FROM orders WHERE id = NEW.order_id;
  IF order_row.tax_behavior <> 'exclusive' THEN
    RAISE EXCEPTION 'only tax-exclusive orders can be invoiced in this release';
  END IF;
  IF NEW.currency <> order_row.charge_currency
    OR NEW.total_minor <> order_row.charge_amount_minor
    OR NEW.service_amount_minor <> order_row.service_amount_minor
    OR NEW.tax_amount_minor <> order_row.tax_amount_minor
    OR NEW.buyer_org_id <> order_row.buyer_org_id
  THEN
    RAISE EXCEPTION 'invoice does not match the order snapshot';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_match_order
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.assert_invoice_matches_order();

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders (id),
  buyer_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  provider text NOT NULL CHECK (provider IN ('stripe', 'merchant_of_record')),
  provider_ref text,
  status text NOT NULL CHECK (status IN (
    'requires_payment', 'processing', 'succeeded', 'failed', 'cancelled'
  )),
  currency char(3) NOT NULL REFERENCES currencies (code),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  three_d_secure text CHECK (
    three_d_secure IS NULL OR three_d_secure IN ('required', 'succeeded', 'failed', 'not_supported')
  ),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER payments_region
  BEFORE INSERT OR UPDATE OF home_region ON payments
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER payments_touch
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE OR REPLACE FUNCTION app.assert_payment_matches_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  order_row orders%ROWTYPE;
BEGIN
  SELECT * INTO order_row FROM orders WHERE id = NEW.order_id;
  IF NEW.currency <> order_row.charge_currency
    OR NEW.amount_minor <> order_row.charge_amount_minor
    OR NEW.buyer_org_id <> order_row.buyer_org_id
  THEN
    RAISE EXCEPTION 'payment does not match the order charge';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_match_order
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.assert_payment_matches_order();

CREATE TABLE payout_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  provider text NOT NULL CHECK (provider IN ('stripe_connect', 'wise')),
  provider_recipient_id text,
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  currency char(3) NOT NULL REFERENCES currencies (code),
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'unsupported', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider, currency)
);

CREATE TRIGGER payout_accounts_region
  BEFORE INSERT OR UPDATE OF home_region ON payout_accounts
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER payout_accounts_touch
  BEFORE UPDATE ON payout_accounts
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- No foreign key to orders. An obligation is the creator-cell projection of a
-- buyer-cell order and must survive the cells living in different databases.
CREATE TABLE payout_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  payee_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  kind text NOT NULL CHECK (kind IN ('creator_royalty', 'review_fee')),
  currency char(3) NOT NULL REFERENCES currencies (code),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, payee_org_id, kind)
);

CREATE TRIGGER payout_obligations_region
  BEFORE INSERT OR UPDATE OF home_region ON payout_obligations
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES payout_obligations (id),
  payee_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  provider text CHECK (provider IN ('stripe_connect', 'wise')),
  provider_ref text,
  source_currency char(3) NOT NULL REFERENCES currencies (code),
  source_amount_minor bigint NOT NULL CHECK (source_amount_minor > 0),
  destination_currency char(3) REFERENCES currencies (code),
  destination_amount_minor bigint,
  fx_quote_id uuid REFERENCES fx_quotes (id),
  status text NOT NULL CHECK (status IN (
    'pending', 'screening_blocked', 'unsupported_corridor', 'held',
    'processing', 'paid', 'failed'
  )),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      destination_currency IS NULL
      AND destination_amount_minor IS NULL
      AND fx_quote_id IS NULL
    )
    OR (
      destination_currency IS NOT NULL
      AND destination_amount_minor IS NOT NULL
      AND destination_amount_minor > 0
    )
  ),
  CHECK (status NOT IN ('processing', 'paid') OR provider IS NOT NULL)
);

CREATE TRIGGER payouts_region
  BEFORE INSERT OR UPDATE OF home_region ON payouts
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER payouts_touch
  BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE OR REPLACE FUNCTION app.assert_payout_allowed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  payee_country char(2);
BEGIN
  IF NEW.status NOT IN ('processing', 'paid') THEN
    RETURN NEW;
  END IF;
  SELECT country_code INTO payee_country FROM orgs WHERE id = NEW.payee_org_id;
  IF EXISTS (
    SELECT 1 FROM jurisdiction_restrictions AS restriction
    WHERE restriction.active
      AND restriction.kind IN ('sanctions', 'payout_refused')
      AND restriction.country_code = payee_country
  ) THEN
    RAISE EXCEPTION 'payout country is restricted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM compliance_screenings AS screening
    WHERE screening.subject_type = 'org'
      AND screening.subject_id = NEW.payee_org_id
      AND screening.purpose = 'payout'
      AND screening.status = 'clear'
      AND screening.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'payout requires a clear unexpired screening';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payouts_allowed
  BEFORE INSERT OR UPDATE OF status ON payouts
  FOR EACH ROW EXECUTE FUNCTION app.assert_payout_allowed();

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments (id),
  order_id uuid NOT NULL REFERENCES orders (id),
  buyer_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  currency char(3) NOT NULL REFERENCES currencies (code),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  tax_amount_minor bigint NOT NULL CHECK (tax_amount_minor >= 0),
  platform_fee_reversal_minor bigint NOT NULL CHECK (platform_fee_reversal_minor >= 0),
  royalty_reversal_minor bigint NOT NULL CHECK (royalty_reversal_minor >= 0),
  review_fee_reversal_minor bigint NOT NULL CHECK (review_fee_reversal_minor >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    amount_minor = tax_amount_minor
      + platform_fee_reversal_minor
      + royalty_reversal_minor
      + review_fee_reversal_minor
  )
);

CREATE TRIGGER refunds_region
  BEFORE INSERT OR UPDATE OF home_region ON refunds
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments (id),
  buyer_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  currency char(3) NOT NULL REFERENCES currencies (code),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL CHECK (status IN ('opened', 'won', 'lost', 'closed')),
  reason text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  evidence_due_at timestamptz
);

CREATE TRIGGER disputes_region
  BEFORE INSERT OR UPDATE OF home_region ON disputes
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE spend_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  scope text NOT NULL CHECK (scope IN ('per_order', 'per_day', 'per_month')),
  currency char(3) NOT NULL REFERENCES currencies (code),
  limit_minor bigint NOT NULL CHECK (limit_minor > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_org_id, scope, currency)
);

CREATE TRIGGER spend_limits_region
  BEFORE INSERT OR UPDATE OF home_region ON spend_limits
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  order_id uuid,
  kind text NOT NULL CHECK (kind IN (
    'charge_captured', 'tax_liability', 'royalty_accrued', 'review_fee_accrued',
    'payout_settled', 'refund', 'dispute_opened', 'dispute_closed', 'fx_conversion'
  )),
  currency char(3) NOT NULL REFERENCES currencies (code),
  fx_link uuid,
  posted boolean NOT NULL DEFAULT false,
  posted_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (posted = false OR posted_at IS NOT NULL)
);

CREATE TRIGGER ledger_transactions_region
  BEFORE INSERT OR UPDATE OF home_region ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES ledger_transactions (id),
  buyer_org_id uuid NOT NULL REFERENCES orgs (id),
  home_region text NOT NULL REFERENCES processing_regions (id),
  account_code text NOT NULL CHECK (account_code IN (
    'provider_cash', 'tax_payable', 'platform_fee_revenue',
    'creator_payable', 'reviewer_payable', 'refund_expense', 'dispute_hold', 'fx_bridge'
  )),
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL REFERENCES currencies (code),
  counterparty_org_id uuid REFERENCES orgs (id),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id);

CREATE TRIGGER ledger_entries_region
  BEFORE INSERT OR UPDATE OF home_region ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE OR REPLACE FUNCTION app.assert_ledger_posted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  debit_sum bigint;
  credit_sum bigint;
  currencies integer;
  regions integer;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.posted THEN
    RAISE EXCEPTION 'posted ledger transactions are immutable';
  END IF;
  IF NEW.posted IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  SELECT
    COALESCE(sum(amount_minor) FILTER (WHERE direction = 'debit'), 0),
    COALESCE(sum(amount_minor) FILTER (WHERE direction = 'credit'), 0),
    count(DISTINCT currency),
    count(DISTINCT home_region)
  INTO debit_sum, credit_sum, currencies, regions
  FROM ledger_entries
  WHERE transaction_id = NEW.id;

  IF debit_sum <> credit_sum OR debit_sum = 0 OR currencies <> 1 OR regions <> 1 THEN
    RAISE EXCEPTION 'ledger transaction % is not balanced', NEW.id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM ledger_entries
    WHERE transaction_id = NEW.id
      AND (currency <> NEW.currency OR home_region <> NEW.home_region OR buyer_org_id <> NEW.buyer_org_id)
  ) THEN
    RAISE EXCEPTION 'ledger lines must match the transaction currency, region, and buyer';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_transactions_balance
  BEFORE INSERT OR UPDATE OF posted ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION app.assert_ledger_posted();
