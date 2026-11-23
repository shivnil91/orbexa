-- Specialist workspace tables. The UI is owned elsewhere. These rows are
-- seller-scoped under the same market.visible policy as the rest of the
-- marketplace. orbexa_app is not the owner. Revision tables are append-only.
-- Chunk text stays on the seller of its document. The package hash check
-- stays in the application.

CREATE OR REPLACE FUNCTION market.reject_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, market
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION market.chunk_matches_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, market
AS $$
DECLARE
  doc_seller text;
BEGIN
  SELECT seller_id INTO doc_seller
  FROM market.knowledge_documents
  WHERE id = NEW.document_id;
  IF doc_seller IS DISTINCT FROM NEW.seller_id THEN
    RAISE EXCEPTION 'chunk seller does not match the document'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE market.knowledge_documents (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  listing_id text,
  title text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  status text NOT NULL CHECK (status IN ('stored', 'chunked', 'failed')),
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (byte_size >= 0 AND byte_size <= 20000000),
  CHECK (position('..' in object_key) = 0),
  CHECK (starts_with(object_key, 'sellers/' || seller_id || '/'))
);

CREATE TABLE market.knowledge_chunks (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES market.knowledge_documents (id),
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  content text NOT NULL CHECK (char_length(content) <= 8000),
  token_count integer,
  embedding vector(1536),
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, ordinal)
);

CREATE TABLE market.rules (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  listing_id text,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('scope', 'hard', 'panel')),
  body jsonb NOT NULL,
  head_revision integer NOT NULL DEFAULT 1 CHECK (head_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market.rule_revisions (
  id text PRIMARY KEY,
  rule_id text NOT NULL REFERENCES market.rules (id),
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  revision integer NOT NULL CHECK (revision >= 1),
  body jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, revision)
);

CREATE TABLE market.calculators (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  listing_id text,
  calculator_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  body jsonb NOT NULL,
  head_revision integer NOT NULL DEFAULT 1 CHECK (head_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market.calculator_revisions (
  id text PRIMARY KEY,
  calculator_row_id text NOT NULL REFERENCES market.calculators (id),
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  revision integer NOT NULL CHECK (revision >= 1),
  body jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calculator_row_id, revision)
);

CREATE TABLE market.bench_cases (
  id text PRIMARY KEY,
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  listing_id text,
  title text NOT NULL,
  body jsonb NOT NULL,
  head_revision integer NOT NULL DEFAULT 1 CHECK (head_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market.bench_case_revisions (
  id text PRIMARY KEY,
  bench_case_id text NOT NULL REFERENCES market.bench_cases (id),
  seller_id text NOT NULL,
  client_id text NOT NULL DEFAULT '',
  revision integer NOT NULL CHECK (revision >= 1),
  body jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bench_case_id, revision)
);

CREATE INDEX knowledge_documents_seller_idx ON market.knowledge_documents (seller_id);
CREATE INDEX knowledge_chunks_seller_idx ON market.knowledge_chunks (seller_id, document_id);
CREATE INDEX rules_seller_idx ON market.rules (seller_id, listing_id);
CREATE INDEX calculators_seller_idx ON market.calculators (seller_id, listing_id);
CREATE INDEX bench_cases_seller_idx ON market.bench_cases (seller_id, listing_id);

CREATE TRIGGER knowledge_chunks_match_document
  BEFORE INSERT OR UPDATE ON market.knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION market.chunk_matches_document();

CREATE TRIGGER rule_revisions_append_only
  BEFORE UPDATE OR DELETE ON market.rule_revisions
  FOR EACH ROW EXECUTE FUNCTION market.reject_history_mutation();

CREATE TRIGGER calculator_revisions_append_only
  BEFORE UPDATE OR DELETE ON market.calculator_revisions
  FOR EACH ROW EXECUTE FUNCTION market.reject_history_mutation();

CREATE TRIGGER bench_case_revisions_append_only
  BEFORE UPDATE OR DELETE ON market.bench_case_revisions
  FOR EACH ROW EXECUTE FUNCTION market.reject_history_mutation();

DO $$
DECLARE
  rel text;
BEGIN
  FOR rel IN
    SELECT c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'market'
      AND c.relkind = 'r'
      AND c.relname IN (
        'knowledge_documents',
        'knowledge_chunks',
        'rules',
        'rule_revisions',
        'calculators',
        'calculator_revisions',
        'bench_cases',
        'bench_case_revisions'
      )
  LOOP
    EXECUTE format('ALTER TABLE market.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE market.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON TABLE market.%I FROM PUBLIC', rel);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE market.%I TO orbexa_app', rel);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON market.%I FOR ALL TO orbexa_app USING (market.visible(seller_id, client_id, false)) WITH CHECK (market.visible(seller_id, client_id, false))',
      rel
    );
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION market.reject_history_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION market.chunk_matches_document() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market.reject_history_mutation() TO orbexa_app;
GRANT EXECUTE ON FUNCTION market.chunk_matches_document() TO orbexa_app;

COMMENT ON TABLE market.knowledge_chunks IS
  'Seller-scoped document chunks for workspace retrieval. embedding is vector(1536), nullable until a model writes it.';
