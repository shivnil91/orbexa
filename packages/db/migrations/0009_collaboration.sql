-- Buyer/expert messages and a single rating per accepted job.
-- Both are buyer-tenant records. They are not memory and are not retrievable
-- as evidence.

CREATE TABLE job_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id)
);

CREATE TRIGGER job_messages_region
  BEFORE INSERT OR UPDATE OF home_region ON job_messages
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE TRIGGER job_messages_append_only
  BEFORE UPDATE OR DELETE ON job_messages
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TABLE job_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  home_region text NOT NULL REFERENCES processing_regions (id),
  job_id uuid NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id),
  FOREIGN KEY (job_id, tenant_id) REFERENCES jobs (id, tenant_id)
);

CREATE TRIGGER job_ratings_region
  BEFORE INSERT OR UPDATE OF home_region ON job_ratings
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

ALTER TABLE job_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY job_messages_isolation ON job_messages
  USING (app.can_read_job(job_id, tenant_id))
  WITH CHECK (app.can_read_job(job_id, tenant_id));

ALTER TABLE job_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_ratings FORCE ROW LEVEL SECURITY;
CREATE POLICY job_ratings_isolation ON job_ratings
  USING (tenant_id = app.current_tenant() AND app.access_mode() = 'org')
  WITH CHECK (tenant_id = app.current_tenant() AND app.access_mode() = 'org');

GRANT SELECT, INSERT ON job_messages, job_ratings TO orbexa_app;
GRANT SELECT, INSERT ON job_messages TO orbexa_worker;
