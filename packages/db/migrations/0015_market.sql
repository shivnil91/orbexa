-- Marketplace store. Replaces the JSON file for users, sessions, sellers,
-- listings, studios, drafts, sealed packages, client workspaces, runs,
-- reports, jobs, orders, proofs, credentials, the audit log, and uploads.
--
-- orbexa_app is not the table owner and is not BYPASSRLS. The runtime
-- SET ROLE orbexa_app and sets app.access, app.seller_id, and app.client_id.
-- A session with access "none" sees nothing. The hash of a sealed package
-- is checked again in the application; this trigger only rejects updates
-- and deletes of sealed rows.

CREATE SCHEMA IF NOT EXISTS market;

REVOKE ALL ON SCHEMA market FROM PUBLIC;
GRANT USAGE ON SCHEMA market TO orbexa_app, orbexa_worker;

ALTER ROLE orbexa_app NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT orbexa_app TO CURRENT_USER;

CREATE OR REPLACE FUNCTION market.current_seller()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, market
AS $$
  SELECT NULLIF(current_setting('app.seller_id', true), '')
$$;

CREATE OR REPLACE FUNCTION market.current_client()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, market
AS $$
  SELECT NULLIF(current_setting('app.client_id', true), '')
$$;

CREATE OR REPLACE FUNCTION market.access_mode()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, market
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.access', true), ''), 'none')
$$;

-- Seller scope sees that seller's rows. Client scope sees one seller's
-- client, so a shared client id cannot cross specialists. Catalog sees
-- only rows marked public. Operator is the trusted API process.
CREATE OR REPLACE FUNCTION market.visible(p_seller text, p_client text, p_public boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, market
AS $$
  SELECT
    market.access_mode() = 'operator'
    OR (p_public AND market.access_mode() = 'catalog')
    OR (
      p_seller <> ''
      AND p_seller IS NOT DISTINCT FROM market.current_seller()
      AND (
        market.access_mode() = 'seller'
        OR (
          market.access_mode() = 'client'
          AND p_client <> ''
          AND p_client IS NOT DISTINCT FROM market.current_client()
        )
      )
    )
$$;

CREATE OR REPLACE FUNCTION market.reject_sealed_package()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, market
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.sealed THEN
    RAISE EXCEPTION 'sealed package is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.sealed THEN
    RAISE EXCEPTION 'sealed package is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION market.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, market
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TABLE market.users (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  email text NOT NULL UNIQUE,
  body jsonb NOT NULL,
  CHECK (seller_id = id),
  CHECK (email = lower(email)),
  CHECK (octet_length(body::text) < 200000)
);

CREATE TABLE market.sessions (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  user_id text NOT NULL REFERENCES market.users (id),
  body jsonb NOT NULL
);

CREATE TABLE market.credentials (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  user_id text NOT NULL REFERENCES market.users (id),
  body jsonb NOT NULL
);

CREATE TABLE market.listings (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  slug text NOT NULL UNIQUE,
  published boolean NOT NULL,
  example boolean NOT NULL DEFAULT false,
  body jsonb NOT NULL
);

CREATE TABLE market.studios (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  listing_id text NOT NULL REFERENCES market.listings (id),
  body jsonb NOT NULL
);

CREATE TABLE market.drafts (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  listing_id text NOT NULL REFERENCES market.listings (id),
  body jsonb NOT NULL
);

CREATE TABLE market.packages (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  slug text NOT NULL,
  sealed boolean NOT NULL,
  content_hash text NOT NULL,
  body jsonb NOT NULL,
  CHECK (seller_id <> ''),
  CHECK (content_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE market.client_workspaces (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL,
  body jsonb NOT NULL,
  UNIQUE (seller_id, client_id)
);

CREATE TABLE market.runs (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL,
  body jsonb NOT NULL
);

CREATE TABLE market.reports (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL,
  run_id text NOT NULL UNIQUE REFERENCES market.runs (id),
  body jsonb NOT NULL
);

CREATE TABLE market.jobs (
  id text PRIMARY KEY,
  seller_id text NOT NULL DEFAULT '',
  client_id text NOT NULL DEFAULT '',
  listing_slug text NOT NULL,
  status text NOT NULL,
  body jsonb NOT NULL
);

CREATE TABLE market.orders (
  id text PRIMARY KEY,
  seller_id text NOT NULL DEFAULT '',
  client_id text NOT NULL DEFAULT '',
  job_id text NOT NULL UNIQUE REFERENCES market.jobs (id),
  currency text NOT NULL,
  price_minor integer NOT NULL,
  status text NOT NULL,
  body jsonb NOT NULL,
  CHECK (price_minor >= 0)
);

CREATE TABLE market.proofs (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  slug text NOT NULL,
  body jsonb NOT NULL,
  UNIQUE (seller_id, slug)
);

CREATE TABLE market.reviews (
  id text PRIMARY KEY,
  seller_id text NOT NULL DEFAULT '',
  client_id text NOT NULL DEFAULT '',
  body jsonb NOT NULL
);

CREATE TABLE market.searches (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  body jsonb NOT NULL
);

CREATE TABLE market.overrides (
  id text PRIMARY KEY,
  seller_id text NOT NULL DEFAULT '',
  client_id text NOT NULL DEFAULT '',
  body jsonb NOT NULL
);

CREATE TABLE market.audit_log (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  body jsonb NOT NULL
);

CREATE TABLE market.uploads (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  body jsonb NOT NULL,
  CHECK (object_key ~ '^sellers/[A-Za-z0-9_-]+/uploads/[A-Za-z0-9_-]+$'),
  CHECK (byte_size >= 0 AND byte_size <= 20000000)
);

CREATE TABLE market.example_proof_runs (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  body jsonb NOT NULL
);

CREATE INDEX listings_seller_idx ON market.listings (seller_id);
CREATE INDEX packages_seller_idx ON market.packages (seller_id);
CREATE INDEX workspaces_seller_idx ON market.client_workspaces (seller_id, client_id);
CREATE INDEX runs_seller_idx ON market.runs (seller_id, client_id);
CREATE INDEX jobs_seller_idx ON market.jobs (seller_id, client_id);
CREATE INDEX uploads_seller_idx ON market.uploads (seller_id);
CREATE INDEX proofs_seller_idx ON market.proofs (seller_id, slug);

CREATE TRIGGER packages_no_update
  BEFORE UPDATE ON market.packages
  FOR EACH ROW EXECUTE FUNCTION market.reject_sealed_package();

CREATE TRIGGER packages_no_delete
  BEFORE DELETE ON market.packages
  FOR EACH ROW EXECUTE FUNCTION market.reject_sealed_package();

CREATE TRIGGER audit_no_update
  BEFORE UPDATE ON market.audit_log
  FOR EACH ROW EXECUTE FUNCTION market.reject_audit_mutation();

CREATE TRIGGER audit_no_delete
  BEFORE DELETE ON market.audit_log
  FOR EACH ROW EXECUTE FUNCTION market.reject_audit_mutation();

DO $$
DECLARE
  rel text;
BEGIN
  FOR rel IN
    SELECT c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'market' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE market.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE market.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON TABLE market.%I FROM PUBLIC', rel);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE market.%I TO orbexa_app', rel);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON market.%I FOR ALL TO orbexa_app USING (market.visible(seller_id, client_id, false)) WITH CHECK (market.visible(seller_id, client_id, false))',
      rel
    );
    IF EXISTS (
      SELECT 1
      FROM pg_class AS owned
      JOIN pg_namespace AS ns ON ns.oid = owned.relnamespace
      WHERE ns.nspname = 'market'
        AND owned.relname = rel
        AND owned.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'orbexa_app')
    ) THEN
      RAISE EXCEPTION 'orbexa_app must not own market.%', rel;
    END IF;
  END LOOP;
END
$$;

-- Published listings, public reviews, and example proofs are readable
-- without a tenant. Private tables keep the default policy above.
DROP POLICY tenant_isolation ON market.listings;
CREATE POLICY tenant_isolation ON market.listings
  FOR ALL TO orbexa_app
  USING (market.visible(seller_id, client_id, published OR example))
  WITH CHECK (market.visible(seller_id, client_id, false));

DROP POLICY tenant_isolation ON market.reviews;
CREATE POLICY tenant_isolation ON market.reviews
  FOR ALL TO orbexa_app
  USING (market.visible(seller_id, client_id, true))
  WITH CHECK (market.visible(seller_id, client_id, false));

DROP POLICY tenant_isolation ON market.proofs;
CREATE POLICY tenant_isolation ON market.proofs
  FOR ALL TO orbexa_app
  USING (market.visible(seller_id, client_id, slug LIKE 'example-%'))
  WITH CHECK (market.visible(seller_id, client_id, false));

REVOKE ALL ON FUNCTION market.reject_sealed_package() FROM PUBLIC;
REVOKE ALL ON FUNCTION market.reject_audit_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market.reject_sealed_package() TO orbexa_app;
GRANT EXECUTE ON FUNCTION market.reject_audit_mutation() TO orbexa_app;
GRANT EXECUTE ON FUNCTION market.visible(text, text, boolean) TO orbexa_app;
GRANT EXECUTE ON FUNCTION market.current_seller() TO orbexa_app;
GRANT EXECUTE ON FUNCTION market.current_client() TO orbexa_app;
GRANT EXECUTE ON FUNCTION market.access_mode() TO orbexa_app;
