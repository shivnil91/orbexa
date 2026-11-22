-- Agents, immutable version snapshots, listings, and eval records.
-- Publishing rules are triggers in 0008_enforcement.sql so they can see evals.

CREATE TABLE memory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_org_id uuid NOT NULL REFERENCES orgs (id),
  slug text NOT NULL,
  name text NOT NULL,
  vertical text NOT NULL REFERENCES verticals (code),
  source_locale text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creator_org_id, slug),
  CHECK (source_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);

CREATE TRIGGER agents_touch
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE memory_snapshots
  ADD CONSTRAINT memory_snapshots_agent_fk
  FOREIGN KEY (agent_id) REFERENCES agents (id);

CREATE TABLE agent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents (id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN (
    'draft', 'evaluating', 'published', 'superseded', 'rolled_back'
  )),
  promotion_basis text NOT NULL CHECK (promotion_basis IN ('initial_human', 'eval_improved')),
  previous_version_id uuid,
  pipeline_hash text NOT NULL,
  prompt_bundle_hash text NOT NULL,
  tool_catalog_hash text NOT NULL,
  model_route_id uuid NOT NULL REFERENCES model_routes (id),
  embedding_model_id uuid NOT NULL REFERENCES embedding_models (id),
  memory_snapshot_id uuid REFERENCES memory_snapshots (id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version),
  UNIQUE (id, agent_id)
);

ALTER TABLE agent_versions
  ADD CONSTRAINT agent_versions_previous_fk
  FOREIGN KEY (previous_version_id) REFERENCES agent_versions (id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE agent_version_tools (
  agent_version_id uuid NOT NULL REFERENCES agent_versions (id),
  tool_code text NOT NULL REFERENCES tool_catalog (code),
  PRIMARY KEY (agent_version_id, tool_code)
);

CREATE OR REPLACE FUNCTION app.reject_side_effect_tools()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tool_catalog
    WHERE code = NEW.tool_code AND side_effect
  ) THEN
    RAISE EXCEPTION 'side-effect tools cannot be attached';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_version_tools_side_effect
  BEFORE INSERT OR UPDATE ON agent_version_tools
  FOR EACH ROW EXECUTE FUNCTION app.reject_side_effect_tools();

CREATE TABLE listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_org_id uuid NOT NULL REFERENCES orgs (id),
  agent_version_id uuid NOT NULL REFERENCES agent_versions (id),
  vertical text NOT NULL REFERENCES verticals (code),
  source_locale text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);

CREATE TRIGGER listings_touch
  BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE listing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings (id),
  service_level text NOT NULL CHECK (service_level IN ('autonomous', 'expert_verified', 'expert_led')),
  currency char(3) NOT NULL REFERENCES currencies (code),
  price_minor bigint NOT NULL CHECK (price_minor > 0),
  platform_fee_bps integer NOT NULL CHECK (platform_fee_bps BETWEEN 0 AND 10000),
  creator_royalty_bps integer NOT NULL CHECK (creator_royalty_bps BETWEEN 0 AND 10000),
  review_fee_minor bigint NOT NULL CHECK (review_fee_minor >= 0),
  delivery_days integer NOT NULL CHECK (delivery_days > 0),
  included_revisions integer NOT NULL CHECK (included_revisions >= 0),
  cancellation_code text NOT NULL,
  payout_release text NOT NULL CHECK (payout_release IN ('on_acceptance', 'after_dispute_window')),
  CHECK (platform_fee_bps + creator_royalty_bps = 10000),
  CHECK (
    (service_level = 'autonomous' AND review_fee_minor = 0)
    OR (service_level <> 'autonomous' AND review_fee_minor > 0)
  ),
  UNIQUE (listing_id, service_level)
);

COMMENT ON TABLE listing_tiers IS
  'Basis points split the amount left after the review fee. The order snapshot is the money that was actually agreed. Remainder handling lives in the money helper.';

CREATE TABLE eval_suites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, name)
);

CREATE TABLE eval_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id uuid NOT NULL REFERENCES eval_suites (id),
  code text NOT NULL,
  fixture_storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (suite_id, code)
);

COMMENT ON TABLE eval_cases IS
  'Golden tasks. Fixtures are synthetic or licensed. They are not customer tenders and do not live in a buyer tenant.';

CREATE TABLE eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_version_id uuid NOT NULL REFERENCES agent_versions (id),
  suite_id uuid NOT NULL REFERENCES eval_suites (id),
  passed boolean NOT NULL,
  score numeric(6, 4) NOT NULL CHECK (score >= 0 AND score <= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX eval_runs_version_idx ON eval_runs (agent_version_id, created_at DESC);
