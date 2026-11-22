-- People, organisations, membership, expert verification, and screening.
-- Orgs are the directory: they are allowed to name a home region that is not
-- this cell, so a tenant can wait for their cell instead of being stored in
-- the wrong region. Private tables cannot.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  time_zone text NOT NULL DEFAULT 'UTC',
  locale_confirmed boolean NOT NULL DEFAULT false,
  zone_confirmed boolean NOT NULL DEFAULT false,
  country_of_residence char(2),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email)),
  CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CHECK (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  CHECK (country_of_residence IS NULL OR country_of_residence ~ '^[A-Z]{2}$')
);

CREATE OR REPLACE FUNCTION app.assert_user_time_zone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  PERFORM now() AT TIME ZONE NEW.time_zone;
  RETURN NEW;
EXCEPTION
  WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'invalid time zone: %', NEW.time_zone USING ERRCODE = '22023';
END;
$$;

CREATE TRIGGER users_time_zone
  BEFORE INSERT OR UPDATE OF time_zone ON users
  FOR EACH ROW EXECUTE FUNCTION app.assert_user_time_zone();

CREATE TRIGGER users_touch
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('platform', 'creator', 'buyer')),
  legal_name text NOT NULL,
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  region_code text,
  home_region text NOT NULL REFERENCES processing_regions (id),
  default_locale text NOT NULL,
  default_time_zone text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (default_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  CHECK (region_code IS NULL OR region_code ~ '^[A-Z0-9-]{1,16}$')
);

CREATE OR REPLACE FUNCTION app.assert_org_time_zone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  PERFORM now() AT TIME ZONE NEW.default_time_zone;
  RETURN NEW;
EXCEPTION
  WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'invalid time zone: %', NEW.default_time_zone USING ERRCODE = '22023';
END;
$$;

CREATE TRIGGER orgs_time_zone
  BEFORE INSERT OR UPDATE OF default_time_zone ON orgs
  FOR EACH ROW EXECUTE FUNCTION app.assert_org_time_zone();

CREATE TRIGGER orgs_touch
  BEFORE UPDATE ON orgs
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE org_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN (
    'platform_admin', 'platform_support', 'platform_finance', 'platform_reviewer',
    'org_owner', 'org_admin', 'expert', 'buyer_admin', 'buyer_member', 'finance', 'auditor'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, role)
);

CREATE OR REPLACE FUNCTION app.assert_membership_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  org_kind text;
BEGIN
  SELECT kind INTO org_kind FROM orgs WHERE id = NEW.org_id;
  IF left(NEW.role, 9) = 'platform_' AND org_kind <> 'platform' THEN
    RAISE EXCEPTION 'platform roles belong to the platform org';
  END IF;
  IF NEW.role = 'expert' AND org_kind <> 'creator' THEN
    RAISE EXCEPTION 'expert role belongs to a creator org';
  END IF;
  IF NEW.role IN ('buyer_admin', 'buyer_member') AND org_kind <> 'buyer' THEN
    RAISE EXCEPTION 'buyer roles belong to a buyer org';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_memberships_role
  BEFORE INSERT OR UPDATE ON org_memberships
  FOR EACH ROW EXECUTE FUNCTION app.assert_membership_role();

CREATE TABLE policy_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  org_id uuid REFERENCES orgs (id),
  policy_code text NOT NULL,
  policy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id, policy_code, policy_version)
);

CREATE TABLE expert_profiles (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  org_id uuid NOT NULL REFERENCES orgs (id),
  verticals text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER expert_profiles_touch
  BEFORE UPDATE ON expert_profiles
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE expert_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_user_id uuid NOT NULL REFERENCES expert_profiles (user_id),
  method text NOT NULL CHECK (method IN ('manual_review')),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_user_id uuid REFERENCES users (id),
  notes text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compliance_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'org')),
  subject_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('expert_verification', 'payout', 'buyer_onboarding')),
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'clear', 'review', 'blocked', 'error')),
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  home_region text NOT NULL REFERENCES processing_regions (id),
  provider_ref text,
  screened_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > screened_at)
);

CREATE INDEX compliance_screenings_subject_idx
  ON compliance_screenings (subject_type, subject_id, purpose, screened_at DESC);

CREATE TRIGGER compliance_screenings_region
  BEFORE INSERT OR UPDATE OF home_region ON compliance_screenings
  FOR EACH ROW EXECUTE FUNCTION app.assert_home_region();

CREATE OR REPLACE FUNCTION app.assert_screening_provider()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  env text;
BEGIN
  SELECT environment INTO env FROM cell_identity;
  IF NEW.provider = 'test' AND env IS DISTINCT FROM 'local' THEN
    RAISE EXCEPTION 'test screening provider is local-only';
  END IF;
  IF NEW.status = 'error' THEN
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER compliance_screenings_provider
  BEFORE INSERT OR UPDATE ON compliance_screenings
  FOR EACH ROW EXECUTE FUNCTION app.assert_screening_provider();

CREATE OR REPLACE FUNCTION app.assert_expert_verified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF NEW.status = 'verified' THEN
    IF NOT EXISTS (
      SELECT 1 FROM compliance_screenings AS screening
      WHERE screening.subject_type = 'user'
        AND screening.subject_id = NEW.user_id
        AND screening.purpose = 'expert_verification'
        AND screening.status = 'clear'
        AND screening.expires_at > now()
    ) THEN
      RAISE EXCEPTION 'verified expert requires a clear unexpired screening';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM expert_verifications AS verification
      WHERE verification.expert_user_id = NEW.user_id
        AND verification.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'verified expert requires an approved verification';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expert_profiles_verified
  BEFORE INSERT OR UPDATE OF status ON expert_profiles
  FOR EACH ROW EXECUTE FUNCTION app.assert_expert_verified();

-- Empty on purpose. The screening vendor is the source of truth. This cache
-- takes effect when compliance inserts rows. The repository does not ship a
-- sanctions country list.
CREATE TABLE jurisdiction_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  kind text NOT NULL CHECK (kind IN ('sanctions', 'payout_refused', 'checkout_refused')),
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, kind)
);

CREATE TRIGGER jurisdiction_restrictions_touch
  BEFORE UPDATE ON jurisdiction_restrictions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
