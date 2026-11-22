-- Foundations: extensions, roles, regional cells, currencies, and the
-- reference data the rest of the schema points at.
--
-- Roles are NOLOGIN. Passwords are never created here. Production maps
-- each role to a Secrets Manager credential outside this repository.
-- orbexa_app and orbexa_worker must not be superuser and must not bypass RLS.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbexa_app') THEN
    CREATE ROLE orbexa_app NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbexa_worker') THEN
    CREATE ROLE orbexa_worker NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbexa_finance') THEN
    CREATE ROLE orbexa_finance NOLOGIN NOINHERIT;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA app, public TO orbexa_app, orbexa_worker, orbexa_finance;

CREATE OR REPLACE FUNCTION app.current_tenant()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, app
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, app
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_agent()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, app
AS $$
  SELECT NULLIF(current_setting('app.agent_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_job()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, app
AS $$
  SELECT NULLIF(current_setting('app.job_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_run()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, app
AS $$
  SELECT NULLIF(current_setting('app.run_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.access_mode()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, app
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.access', true), ''), 'none')
$$;

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE processing_regions (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]+$'),
  status text NOT NULL CHECK (status IN ('planned', 'active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE processing_regions IS
  'One row per regional cell. Private data can be written only in a cell whose region is active and matches cell_identity.';

-- Candidate cells. None are active: activating a region is an operations
-- change, not a migration. local is inserted by the local seed, never here.
INSERT INTO processing_regions (id, status) VALUES
  ('ap-southeast-2', 'planned'),
  ('eu-central-1', 'planned'),
  ('eu-west-2', 'planned'),
  ('us-east-1', 'planned');

CREATE TABLE cell_identity (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  region text NOT NULL REFERENCES processing_regions (id),
  environment text NOT NULL CHECK (environment IN ('local', 'staging', 'prod'))
);

COMMENT ON TABLE cell_identity IS
  'Exactly one row per database, naming the cell this database is. Empty until seed or deploy configures it. Private inserts fail closed until then.';

CREATE OR REPLACE FUNCTION app.assert_home_region()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  cell text;
  region_status text;
BEGIN
  SELECT region INTO cell FROM cell_identity;
  IF cell IS NULL THEN
    RAISE EXCEPTION 'cell_identity is not configured';
  END IF;
  IF NEW.home_region IS DISTINCT FROM cell THEN
    RAISE EXCEPTION 'home_region % does not match this cell %', NEW.home_region, cell;
  END IF;
  SELECT status INTO region_status FROM processing_regions WHERE id = NEW.home_region;
  IF region_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'region % is not active', NEW.home_region;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE currencies (
  code char(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  minor_unit_exponent smallint NOT NULL CHECK (minor_unit_exponent BETWEEN 0 AND 4),
  checkout_enabled boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN currencies.minor_unit_exponent IS
  'ISO 4217 minor-unit exponent. This is the ledger exponent. Payment adapters convert where a provider disagrees with ISO 4217.';

COMMENT ON COLUMN currencies.checkout_enabled IS
  'False until the founder enables a currency. A row existing here is not a payout corridor and not permission to charge.';

-- A currency in this list is not an agreement to sell or pay out in it.
-- checkout_enabled stays false. FJD is included so a Fijian price can be
-- stored; Fiji is not a Stripe payout country as of the 2026-11-22 review.
INSERT INTO currencies (code, minor_unit_exponent, notes) VALUES
  ('USD', 2, NULL),
  ('EUR', 2, NULL),
  ('GBP', 2, NULL),
  ('AUD', 2, NULL),
  ('CAD', 2, NULL),
  ('NZD', 2, NULL),
  ('CHF', 2, NULL),
  ('SEK', 2, NULL),
  ('NOK', 2, NULL),
  ('DKK', 2, NULL),
  ('PLN', 2, NULL),
  ('CZK', 2, NULL),
  ('HUF', 2, 'Stripe treats HUF payouts as zero-decimal amounts divisible by 100. Confirm the provider exponent before enabling checkout.'),
  ('RON', 2, NULL),
  ('INR', 2, NULL),
  ('BRL', 2, NULL),
  ('MXN', 2, NULL),
  ('ZAR', 2, NULL),
  ('AED', 2, NULL),
  ('SAR', 2, NULL),
  ('THB', 2, NULL),
  ('MYR', 2, NULL),
  ('PHP', 2, NULL),
  ('IDR', 2, 'Confirm the provider exponent before enabling checkout. Provider minor units are not always the ISO exponent.'),
  ('SGD', 2, NULL),
  ('HKD', 2, NULL),
  ('CNY', 2, NULL),
  ('TWD', 2, 'Stripe treats TWD payouts as zero-decimal amounts divisible by 100. Confirm the provider exponent before enabling checkout.'),
  ('FJD', 2, 'Stored so a price can be denominated in Fiji dollars. Not a statement that any payout rail can pay FJD.'),
  ('JPY', 0, NULL),
  ('KRW', 0, NULL),
  ('VND', 0, NULL),
  ('CLP', 0, NULL),
  ('ISK', 0, 'ISO exponent is 0. Stripe still represents ISK as a two-decimal amount ending in 00. The adapter must convert.'),
  ('UGX', 0, 'ISO exponent is 0. Stripe still represents UGX as a two-decimal amount ending in 00. The adapter must convert.'),
  ('BIF', 0, NULL),
  ('DJF', 0, NULL),
  ('GNF', 0, NULL),
  ('KMF', 0, NULL),
  ('PYG', 0, NULL),
  ('RWF', 0, NULL),
  ('VUV', 0, NULL),
  ('XAF', 0, NULL),
  ('XOF', 0, NULL),
  ('XPF', 0, NULL),
  ('BHD', 3, NULL),
  ('IQD', 3, NULL),
  ('JOD', 3, NULL),
  ('KWD', 3, NULL),
  ('LYD', 3, NULL),
  ('OMR', 3, NULL),
  ('TND', 3, NULL);

CREATE TABLE verticals (
  code text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO verticals (code) VALUES ('tender_writing');

CREATE TABLE embedding_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  provider text NOT NULL,
  dims smallint NOT NULL CHECK (dims = 1536),
  status text NOT NULL CHECK (status IN ('shadow', 'active', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE embedding_models IS
  'A published agent version pins one row. Changing model or dimensions is a new agent version, followed by re-embedding, not an in-place rewrite.';

CREATE TABLE model_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  primary_model text NOT NULL,
  fallback_model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE model_routes IS
  'In-process gateway route. primary_model and fallback_model are provider model ids, not a promise that a vendor is contracted.';

CREATE TABLE tool_catalog (
  code text PRIMARY KEY,
  side_effect boolean NOT NULL,
  description text NOT NULL
);

-- The tender vertical's model tools write only this job's rows, through our
-- API. There is no shell, HTTP, or payment tool. Adding a tool is a migration.
INSERT INTO tool_catalog (code, side_effect, description) VALUES
  ('read_chunk', false, 'Read one document chunk already scoped to the current tenant and job'),
  ('write_artifact', false, 'Write a draft, matrix row, or claim inside the current job'),
  ('flag_claim', false, 'Mark a claim supported, unsupported, or missing evidence');

CREATE TABLE retention_policies (
  code text PRIMARY KEY,
  applies_to text NOT NULL,
  retain_days integer NOT NULL CHECK (retain_days >= 0),
  status text NOT NULL CHECK (status IN ('proposed', 'active'))
);

COMMENT ON TABLE retention_policies IS
  'Proposed periods are not applied. Purge reads retain_until on each row. A policy becomes active only when counsel and the founder accept it.';

INSERT INTO retention_policies (code, applies_to, retain_days, status) VALUES
  ('execution_memory', 'memory_items.execution', 7, 'proposed'),
  ('buyer_private', 'memory_items.buyer_private', 90, 'proposed'),
  ('prompt_and_tool_trace', 'prompt_traces', 90, 'proposed'),
  ('financial_record', 'ledger_and_invoices', 2555, 'proposed');
