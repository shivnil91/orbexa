-- A vertical is a category of specialist work. Tender writing is the first
-- seeded pack, not a column on the ledger. Intake, deliverable types, the
-- rubric, and the workflow are revisioned JSON so another specialist can be
-- inserted without a migration.

ALTER TABLE verticals
  ADD COLUMN display_name text,
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired'));

UPDATE verticals
SET display_name = 'Tender writing'
WHERE code = 'tender_writing';

ALTER TABLE verticals
  ALTER COLUMN display_name SET NOT NULL;

COMMENT ON TABLE verticals IS
  'Specialist category. Code is the stable id. The job shape lives on vertical_revisions, not in application branches.';

CREATE TABLE vertical_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_code text NOT NULL REFERENCES verticals (code),
  revision integer NOT NULL CHECK (revision > 0),
  intake_schema jsonb NOT NULL,
  deliverable_types jsonb NOT NULL,
  rubric jsonb NOT NULL,
  workflow jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical_code, revision),
  CHECK (jsonb_typeof(intake_schema) = 'object'),
  CHECK (intake_schema->>'type' = 'object'),
  CHECK (jsonb_typeof(deliverable_types) = 'array'),
  CHECK (jsonb_typeof(rubric) = 'array'),
  CHECK (jsonb_typeof(workflow) = 'array'),
  CHECK (jsonb_array_length(workflow) > 0)
);

COMMENT ON TABLE vertical_revisions IS
  'Configurable job schema for one vertical. intake_schema is a JSON Schema object subset. deliverable_types, rubric, and workflow are arrays. A new specialist is a new row.';

INSERT INTO vertical_revisions (
  vertical_code, revision, intake_schema, deliverable_types, rubric, workflow
) VALUES (
  'tender_writing',
  1,
  '{"type":"object","additionalProperties":false,"required":["opportunity_name"],"properties":{"opportunity_name":{"type":"string","minLength":1}}}'::jsonb,
  '[{"code":"tender_source","role":"intake"},{"code":"supplier_info","role":"intake"},{"code":"bid_docx","role":"deliverable"},{"code":"bid_xlsx","role":"deliverable"}]'::jsonb,
  '[{"code":"grounded_claim","required":true},{"code":"missing_evidence","required":true}]'::jsonb,
  '["extract","matrix","draft","ground"]'::jsonb
);

CREATE OR REPLACE FUNCTION app.assert_expert_verticals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  unknown text;
BEGIN
  SELECT entered.code INTO unknown
  FROM unnest(NEW.verticals) AS entered(code)
  WHERE NOT EXISTS (
    SELECT 1 FROM verticals AS known
    WHERE known.code = entered.code AND known.status = 'active'
  )
  LIMIT 1;
  IF unknown IS NOT NULL THEN
    RAISE EXCEPTION 'unknown vertical %', unknown;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expert_profiles_verticals
  BEFORE INSERT OR UPDATE OF verticals ON expert_profiles
  FOR EACH ROW EXECUTE FUNCTION app.assert_expert_verticals();

CREATE OR REPLACE FUNCTION app.assert_listing_vertical()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  agent_vertical text;
BEGIN
  SELECT agents.vertical INTO agent_vertical
  FROM agent_versions
  JOIN agents ON agents.id = agent_versions.agent_id
  WHERE agent_versions.id = NEW.agent_version_id;
  IF agent_vertical IS DISTINCT FROM NEW.vertical THEN
    RAISE EXCEPTION 'listing vertical must match the agent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER listings_vertical
  BEFORE INSERT OR UPDATE OF vertical, agent_version_id ON listings
  FOR EACH ROW EXECUTE FUNCTION app.assert_listing_vertical();

ALTER TABLE orders
  ADD COLUMN vertical_code text REFERENCES verticals (code);

CREATE OR REPLACE FUNCTION app.assign_order_vertical()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  SELECT listings.vertical INTO NEW.vertical_code
  FROM listing_tiers
  JOIN listings ON listings.id = listing_tiers.listing_id
  WHERE listing_tiers.id = NEW.listing_tier_id;
  IF NEW.vertical_code IS NULL THEN
    RAISE EXCEPTION 'order listing has no vertical';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_vertical
  BEFORE INSERT OR UPDATE OF listing_tier_id ON orders
  FOR EACH ROW EXECUTE FUNCTION app.assign_order_vertical();

ALTER TABLE orders
  ALTER COLUMN vertical_code SET NOT NULL;

COMMENT ON COLUMN orders.vertical_code IS
  'Copied from the listing. Pricing, tax, and the ledger do not branch on it.';

ALTER TABLE payout_obligations
  ADD COLUMN vertical_code text REFERENCES verticals (code);

COMMENT ON COLUMN payout_obligations.vertical_code IS
  'Optional classification. Payout checks use screening and currency, not a vertical-specific rule.';

-- Platform kinds are shared. Every other kind must be declared by the job's vertical.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'documents'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%tender_source%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.assert_document_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  vertical text;
BEGIN
  IF NEW.kind IN ('evidence', 'expert_credential') THEN
    RETURN NEW;
  END IF;
  IF NEW.job_id IS NULL THEN
    RAISE EXCEPTION 'document kind % is not a platform kind', NEW.kind;
  END IF;
  SELECT agents.vertical INTO vertical
  FROM jobs
  JOIN agent_versions ON agent_versions.id = jobs.agent_version_id
  JOIN agents ON agents.id = agent_versions.agent_id
  WHERE jobs.id = NEW.job_id AND jobs.tenant_id = NEW.tenant_id;
  IF vertical IS NULL THEN
    RAISE EXCEPTION 'document job has no vertical';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM vertical_revisions AS revisions
    JOIN jsonb_array_elements(revisions.deliverable_types) AS item ON true
    WHERE revisions.vertical_code = vertical
      AND revisions.revision = (
        SELECT max(latest.revision)
        FROM vertical_revisions AS latest
        WHERE latest.vertical_code = vertical
      )
      AND item->>'code' = NEW.kind
  ) THEN
    RAISE EXCEPTION 'document kind % is not declared by vertical %', NEW.kind, vertical;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_kind
  BEFORE INSERT OR UPDATE OF kind, job_id ON documents
  FOR EACH ROW EXECUTE FUNCTION app.assert_document_kind();

CREATE OR REPLACE FUNCTION app.assert_intake(p_revision uuid, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  spec jsonb;
  required_key text;
  prop_key text;
  prop jsonb;
  value jsonb;
  extra_key text;
BEGIN
  SELECT intake_schema INTO spec FROM vertical_revisions WHERE id = p_revision;
  IF spec IS NULL THEN
    RAISE EXCEPTION 'unknown vertical revision';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'intake must be an object';
  END IF;
  FOR required_key IN
    SELECT jsonb_array_elements_text(COALESCE(spec->'required', '[]'::jsonb))
  LOOP
    IF NOT (p_payload ? required_key) THEN
      RAISE EXCEPTION 'intake missing %', required_key;
    END IF;
  END LOOP;
  IF COALESCE(spec->>'additionalProperties', 'true') = 'false' THEN
    FOR extra_key IN SELECT jsonb_object_keys(p_payload)
    LOOP
      IF NOT (COALESCE(spec->'properties', '{}'::jsonb) ? extra_key) THEN
        RAISE EXCEPTION 'intake property % is not allowed', extra_key;
      END IF;
    END LOOP;
  END IF;
  FOR prop_key, prop IN
    SELECT props.key, props.value
    FROM jsonb_each(COALESCE(spec->'properties', '{}'::jsonb)) AS props
  LOOP
    IF NOT (p_payload ? prop_key) THEN
      CONTINUE;
    END IF;
    value := p_payload->prop_key;
    IF prop->>'type' = 'string' AND jsonb_typeof(value) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'intake property % must be a string', prop_key;
    END IF;
    IF prop->>'type' = 'boolean' AND jsonb_typeof(value) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'intake property % must be a boolean', prop_key;
    END IF;
    IF prop->>'type' IN ('number', 'integer') AND jsonb_typeof(value) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'intake property % must be a number', prop_key;
    END IF;
    IF prop->>'type' = 'integer' AND value::text !~ '^-?[0-9]+$' THEN
      RAISE EXCEPTION 'intake property % must be an integer', prop_key;
    END IF;
    IF prop ? 'enum' AND NOT (prop->'enum' @> jsonb_build_array(value)) THEN
      RAISE EXCEPTION 'intake property % is not an allowed value', prop_key;
    END IF;
    IF prop ? 'minLength'
       AND jsonb_typeof(value) = 'string'
       AND char_length(value #>> '{}') < (prop->>'minLength')::integer
    THEN
      RAISE EXCEPTION 'intake property % is too short', prop_key;
    END IF;
  END LOOP;
END;
$$;

CREATE TABLE job_intakes (
  job_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  vertical_revision_id uuid NOT NULL REFERENCES vertical_revisions (id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id)
);

CREATE TRIGGER job_intakes_region
  BEFORE INSERT OR UPDATE OF home_region ON job_intakes
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE OR REPLACE FUNCTION app.assert_job_intake()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  vertical text;
  revision_vertical text;
BEGIN
  SELECT agents.vertical INTO vertical
  FROM jobs
  JOIN agent_versions ON agent_versions.id = jobs.agent_version_id
  JOIN agents ON agents.id = agent_versions.agent_id
  WHERE jobs.id = NEW.job_id AND jobs.tenant_id = NEW.tenant_id;
  SELECT vertical_code INTO revision_vertical
  FROM vertical_revisions
  WHERE id = NEW.vertical_revision_id;
  IF vertical IS DISTINCT FROM revision_vertical THEN
    RAISE EXCEPTION 'intake revision is for a different vertical';
  END IF;
  PERFORM app.assert_intake(NEW.vertical_revision_id, NEW.payload);
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_intakes_payload
  BEFORE INSERT OR UPDATE OF payload, vertical_revision_id ON job_intakes
  FOR EACH ROW EXECUTE FUNCTION app.assert_job_intake();

ALTER TABLE job_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_intakes FORCE ROW LEVEL SECURITY;
CREATE POLICY job_intakes_isolation ON job_intakes
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT ON vertical_revisions TO orbexa_app, orbexa_worker, orbexa_finance;
GRANT INSERT, UPDATE ON verticals, vertical_revisions TO orbexa_app;
GRANT SELECT, INSERT ON job_intakes TO orbexa_app;
GRANT EXECUTE ON FUNCTION app.assert_intake(uuid, jsonb) TO orbexa_app, orbexa_worker;
