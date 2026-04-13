CREATE OR REPLACE FUNCTION app_random_uuid()
RETURNS uuid AS $$
DECLARE
  raw TEXT;
BEGIN
  raw := md5(random()::text || clock_timestamp()::text || txid_current()::text);

  RETURN (
    substr(raw, 1, 8) || '-' ||
    substr(raw, 9, 4) || '-' ||
    '4' || substr(raw, 14, 3) || '-' ||
    substr('89ab', floor(random() * 4)::int + 1, 1) || substr(raw, 18, 3) || '-' ||
    substr(raw, 21, 12)
  )::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION app_random_token_64()
RETURNS varchar(64) AS $$
BEGIN
  RETURN
    md5(random()::text || clock_timestamp()::text || txid_current()::text) ||
    md5(random()::text || clock_timestamp()::text || txid_current()::text);
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  tenant_uid UUID NOT NULL UNIQUE DEFAULT app_random_uuid(),
  name VARCHAR(255) NOT NULL DEFAULT 'Tenant',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tenants (id, tenant_uid, name)
VALUES (1, '00000000-0000-0000-0000-000000000001'::uuid, 'Default Tenant')
ON CONFLICT (id) DO UPDATE
SET
  tenant_uid = EXCLUDED.tenant_uid,
  name = EXCLUDED.name,
  updated_at = NOW();

SELECT setval(
  pg_get_serial_sequence('tenants', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM tenants), 1),
  true
);

ALTER TABLE IF EXISTS tenants
ALTER COLUMN tenant_uid SET DEFAULT app_random_uuid();

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30),
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'pm', 'engineer')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE IF EXISTS users ALTER COLUMN tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS users ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_tenant_id_fkey'
  ) THEN
    ALTER TABLE users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

ALTER TABLE IF EXISTS users
ADD COLUMN IF NOT EXISTS is_active BOOLEAN;
UPDATE users
SET is_active = TRUE
WHERE is_active IS NULL;
ALTER TABLE IF EXISTS users
ALTER COLUMN is_active SET DEFAULT TRUE;
ALTER TABLE IF EXISTS users
ALTER COLUMN is_active SET NOT NULL;

ALTER TABLE IF EXISTS users
DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE IF EXISTS users
ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'pm', 'engineer'));

ALTER TABLE IF EXISTS users
ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  booking_email_domain_allowlist VARCHAR(255),
  created_by INTEGER NOT NULL REFERENCES users(id),
  signup_password_hash VARCHAR(255) NOT NULL,
  is_group_signup BOOLEAN NOT NULL DEFAULT FALSE,
  max_group_size INTEGER NOT NULL DEFAULT 1,
  session_length_minutes INTEGER NOT NULL CHECK (session_length_minutes > 0),
  share_token VARCHAR(64) NOT NULL UNIQUE DEFAULT app_random_token_64(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (max_group_size > 0)
);

ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE projects SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE IF EXISTS projects ALTER COLUMN tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS projects ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_tenant_id_fkey'
  ) THEN
    ALTER TABLE projects
    ADD CONSTRAINT projects_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

ALTER TABLE IF EXISTS projects
ADD COLUMN IF NOT EXISTS booking_email_domain_allowlist VARCHAR(255);
ALTER TABLE IF EXISTS projects
ALTER COLUMN share_token SET DEFAULT app_random_token_64();

CREATE TABLE IF NOT EXISTS time_blocks (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  max_signups INTEGER NOT NULL DEFAULT 1 CHECK (max_signups > 0),
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

ALTER TABLE IF EXISTS time_blocks ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE time_blocks SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE IF EXISTS time_blocks ALTER COLUMN tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS time_blocks ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'time_blocks_tenant_id_fkey'
  ) THEN
    ALTER TABLE time_blocks
    ADD CONSTRAINT time_blocks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS time_block_engineers (
  id SERIAL PRIMARY KEY,
  time_block_id INTEGER NOT NULL REFERENCES time_blocks(id) ON DELETE CASCADE,
  engineer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (time_block_id, engineer_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  time_block_id INTEGER NOT NULL REFERENCES time_blocks(id) ON DELETE CASCADE,
  client_first_name VARCHAR(100) NOT NULL,
  client_last_name VARCHAR(100) NOT NULL,
  client_email VARCHAR(255) NOT NULL,
  client_phone VARCHAR(30) NOT NULL,
  booking_token VARCHAR(64) NOT NULL UNIQUE DEFAULT app_random_token_64(),
  booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  pii_redacted_at TIMESTAMPTZ
);

ALTER TABLE IF EXISTS bookings ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE bookings SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE IF EXISTS bookings ALTER COLUMN tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS bookings ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_tenant_id_fkey'
  ) THEN
    ALTER TABLE bookings
    ADD CONSTRAINT bookings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

ALTER TABLE IF EXISTS bookings
ADD COLUMN IF NOT EXISTS pii_redacted_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS bookings
ALTER COLUMN booking_token SET DEFAULT app_random_token_64();

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  time_block_id INTEGER NOT NULL REFERENCES time_blocks(id) ON DELETE CASCADE,
  client_first_name VARCHAR(100) NOT NULL,
  client_last_name VARCHAR(100) NOT NULL,
  client_email VARCHAR(255) NOT NULL,
  client_phone VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'notified', 'booked', 'removed')),
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE waitlist_entries SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE IF EXISTS waitlist_entries ALTER COLUMN tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS waitlist_entries ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'waitlist_entries_tenant_id_fkey'
  ) THEN
    ALTER TABLE waitlist_entries
    ADD CONSTRAINT waitlist_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS project_id INTEGER;
ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS time_block_id INTEGER;
ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS client_first_name VARCHAR(100);
ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS client_last_name VARCHAR(100);
ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS client_email VARCHAR(255);
ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS client_phone VARCHAR(30);
ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS status VARCHAR(20);
UPDATE waitlist_entries SET status = 'active' WHERE status IS NULL;
ALTER TABLE IF EXISTS waitlist_entries ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS waitlist_entries ALTER COLUMN created_at SET DEFAULT NOW();
UPDATE waitlist_entries SET created_at = NOW() WHERE created_at IS NULL;
ALTER TABLE IF EXISTS waitlist_entries ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE IF EXISTS waitlist_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS waitlist_entries ALTER COLUMN updated_at SET DEFAULT NOW();
UPDATE waitlist_entries SET updated_at = NOW() WHERE updated_at IS NULL;
ALTER TABLE IF EXISTS waitlist_entries ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE IF EXISTS waitlist_entries
DROP CONSTRAINT IF EXISTS waitlist_entries_status_check;
ALTER TABLE IF EXISTS waitlist_entries
ADD CONSTRAINT waitlist_entries_status_check CHECK (status IN ('active', 'notified', 'booked', 'removed'));
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'waitlist_entries_project_id_fkey'
  ) THEN
    ALTER TABLE waitlist_entries
    ADD CONSTRAINT waitlist_entries_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'waitlist_entries_time_block_id_fkey'
  ) THEN
    ALTER TABLE waitlist_entries
    ADD CONSTRAINT waitlist_entries_time_block_id_fkey FOREIGN KEY (time_block_id) REFERENCES time_blocks(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_idempotency_keys (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  share_token VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_fingerprint VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('processing', 'completed')),
  response_status_code INTEGER,
  response_json JSONB,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  UNIQUE (tenant_id, share_token, idempotency_key)
);

ALTER TABLE IF EXISTS booking_idempotency_keys ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE booking_idempotency_keys SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE IF EXISTS booking_idempotency_keys ALTER COLUMN tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS booking_idempotency_keys ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_idempotency_keys_tenant_id_fkey'
  ) THEN
    ALTER TABLE booking_idempotency_keys
    ADD CONSTRAINT booking_idempotency_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'booking_idempotency_keys'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'booking_idempotency_keys_share_token_idempotency_key_key'
  ) THEN
    ALTER TABLE booking_idempotency_keys
    DROP CONSTRAINT booking_idempotency_keys_share_token_idempotency_key_key;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  replaced_by_token_hash CHAR(64),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS auth_refresh_tokens ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE auth_refresh_tokens SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE IF EXISTS auth_refresh_tokens ALTER COLUMN tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS auth_refresh_tokens ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_refresh_tokens_tenant_id_fkey'
  ) THEN
    ALTER TABLE auth_refresh_tokens
    ADD CONSTRAINT auth_refresh_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

ALTER TABLE IF EXISTS auth_refresh_tokens ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE IF EXISTS auth_refresh_tokens ADD COLUMN IF NOT EXISTS token_hash CHAR(64);
ALTER TABLE IF EXISTS auth_refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by_token_hash CHAR(64);
ALTER TABLE IF EXISTS auth_refresh_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS auth_refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS auth_refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS auth_refresh_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS auth_refresh_tokens ALTER COLUMN created_at SET DEFAULT NOW();
UPDATE auth_refresh_tokens SET created_at = NOW() WHERE created_at IS NULL;
ALTER TABLE IF EXISTS auth_refresh_tokens ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE IF EXISTS auth_refresh_tokens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS auth_refresh_tokens ALTER COLUMN updated_at SET DEFAULT NOW();
UPDATE auth_refresh_tokens SET updated_at = NOW() WHERE updated_at IS NULL;
ALTER TABLE IF EXISTS auth_refresh_tokens ALTER COLUMN updated_at SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_refresh_tokens_user_id_fkey'
  ) THEN
    ALTER TABLE auth_refresh_tokens
    ADD CONSTRAINT auth_refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_oidc_sso_configs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL UNIQUE DEFAULT 1 REFERENCES tenants(id),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  issuer_url VARCHAR(512),
  authorization_endpoint VARCHAR(512),
  token_endpoint VARCHAR(512),
  userinfo_endpoint VARCHAR(512),
  client_id VARCHAR(255),
  client_secret VARCHAR(2048),
  scopes VARCHAR(512) NOT NULL DEFAULT 'openid profile email',
  default_role VARCHAR(20) NOT NULL DEFAULT 'pm' CHECK (default_role IN ('pm', 'engineer')),
  auto_provision BOOLEAN NOT NULL DEFAULT TRUE,
  claim_email VARCHAR(64) NOT NULL DEFAULT 'email',
  claim_first_name VARCHAR(64) NOT NULL DEFAULT 'given_name',
  claim_last_name VARCHAR(64) NOT NULL DEFAULT 'family_name',
  success_redirect_url VARCHAR(512),
  error_redirect_url VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE tenant_oidc_sso_configs SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_oidc_sso_configs_tenant_id_fkey'
  ) THEN
    ALTER TABLE tenant_oidc_sso_configs
    ADD CONSTRAINT tenant_oidc_sso_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_oidc_sso_configs_tenant_id_key'
  ) THEN
    ALTER TABLE tenant_oidc_sso_configs
    ADD CONSTRAINT tenant_oidc_sso_configs_tenant_id_key UNIQUE (tenant_id);
  END IF;
END $$;

ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS enabled BOOLEAN;
UPDATE tenant_oidc_sso_configs SET enabled = FALSE WHERE enabled IS NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN enabled SET DEFAULT FALSE;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN enabled SET NOT NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS issuer_url VARCHAR(512);
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS authorization_endpoint VARCHAR(512);
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS token_endpoint VARCHAR(512);
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS userinfo_endpoint VARCHAR(512);
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS client_id VARCHAR(255);
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS client_secret VARCHAR(2048);
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS scopes VARCHAR(512);
UPDATE tenant_oidc_sso_configs SET scopes = 'openid profile email' WHERE scopes IS NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN scopes SET DEFAULT 'openid profile email';
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN scopes SET NOT NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS default_role VARCHAR(20);
UPDATE tenant_oidc_sso_configs SET default_role = 'pm' WHERE default_role IS NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN default_role SET DEFAULT 'pm';
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN default_role SET NOT NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs DROP CONSTRAINT IF EXISTS tenant_oidc_sso_configs_default_role_check;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs
ADD CONSTRAINT tenant_oidc_sso_configs_default_role_check CHECK (default_role IN ('pm', 'engineer'));
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS auto_provision BOOLEAN;
UPDATE tenant_oidc_sso_configs SET auto_provision = TRUE WHERE auto_provision IS NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN auto_provision SET DEFAULT TRUE;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN auto_provision SET NOT NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS claim_email VARCHAR(64);
UPDATE tenant_oidc_sso_configs SET claim_email = 'email' WHERE claim_email IS NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN claim_email SET DEFAULT 'email';
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN claim_email SET NOT NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS claim_first_name VARCHAR(64);
UPDATE tenant_oidc_sso_configs SET claim_first_name = 'given_name' WHERE claim_first_name IS NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN claim_first_name SET DEFAULT 'given_name';
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN claim_first_name SET NOT NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS claim_last_name VARCHAR(64);
UPDATE tenant_oidc_sso_configs SET claim_last_name = 'family_name' WHERE claim_last_name IS NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN claim_last_name SET DEFAULT 'family_name';
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN claim_last_name SET NOT NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS success_redirect_url VARCHAR(512);
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS error_redirect_url VARCHAR(512);
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN created_at SET DEFAULT NOW();
UPDATE tenant_oidc_sso_configs SET created_at = NOW() WHERE created_at IS NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN updated_at SET DEFAULT NOW();
UPDATE tenant_oidc_sso_configs SET updated_at = NOW() WHERE updated_at IS NULL;
ALTER TABLE IF EXISTS tenant_oidc_sso_configs ALTER COLUMN updated_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS audit_log_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(20) NOT NULL CHECK (actor_role IN ('admin', 'pm', 'engineer', 'system')),
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS audit_log_events ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE audit_log_events SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE IF EXISTS audit_log_events ALTER COLUMN tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS audit_log_events ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audit_log_events_tenant_id_fkey'
  ) THEN
    ALTER TABLE audit_log_events
    ADD CONSTRAINT audit_log_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

ALTER TABLE IF EXISTS audit_log_events ADD COLUMN IF NOT EXISTS actor_user_id INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audit_log_events_actor_user_id_fkey'
  ) THEN
    ALTER TABLE audit_log_events
    ADD CONSTRAINT audit_log_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE IF EXISTS audit_log_events ADD COLUMN IF NOT EXISTS actor_role VARCHAR(20);
UPDATE audit_log_events SET actor_role = 'system' WHERE actor_role IS NULL;
ALTER TABLE IF EXISTS audit_log_events ALTER COLUMN actor_role SET NOT NULL;
ALTER TABLE IF EXISTS audit_log_events DROP CONSTRAINT IF EXISTS audit_log_events_actor_role_check;
ALTER TABLE IF EXISTS audit_log_events
ADD CONSTRAINT audit_log_events_actor_role_check CHECK (actor_role IN ('admin', 'pm', 'engineer', 'system'));

ALTER TABLE IF EXISTS audit_log_events ADD COLUMN IF NOT EXISTS action VARCHAR(120);
UPDATE audit_log_events SET action = 'unknown' WHERE action IS NULL;
ALTER TABLE IF EXISTS audit_log_events ALTER COLUMN action SET NOT NULL;

ALTER TABLE IF EXISTS audit_log_events ADD COLUMN IF NOT EXISTS entity_type VARCHAR(60);
UPDATE audit_log_events SET entity_type = 'system' WHERE entity_type IS NULL;
ALTER TABLE IF EXISTS audit_log_events ALTER COLUMN entity_type SET NOT NULL;

ALTER TABLE IF EXISTS audit_log_events ADD COLUMN IF NOT EXISTS entity_id BIGINT;
ALTER TABLE IF EXISTS audit_log_events ADD COLUMN IF NOT EXISTS metadata JSONB;
UPDATE audit_log_events SET metadata = '{}'::jsonb WHERE metadata IS NULL;
ALTER TABLE IF EXISTS audit_log_events ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS audit_log_events ALTER COLUMN metadata SET NOT NULL;

ALTER TABLE IF EXISTS audit_log_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
UPDATE audit_log_events SET created_at = NOW() WHERE created_at IS NULL;
ALTER TABLE IF EXISTS audit_log_events ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE IF EXISTS audit_log_events ALTER COLUMN created_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS microsoft_calendar_connections (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  app_tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  microsoft_user_id VARCHAR(255) NOT NULL,
  microsoft_user_email VARCHAR(255) NOT NULL,
  microsoft_tenant_id VARCHAR(128) NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS microsoft_calendar_connections ADD COLUMN IF NOT EXISTS app_tenant_id INTEGER;
UPDATE microsoft_calendar_connections SET app_tenant_id = 1 WHERE app_tenant_id IS NULL;
ALTER TABLE IF EXISTS microsoft_calendar_connections ALTER COLUMN app_tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS microsoft_calendar_connections ALTER COLUMN app_tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'microsoft_calendar_connections_app_tenant_id_fkey'
  ) THEN
    ALTER TABLE microsoft_calendar_connections
    ADD CONSTRAINT microsoft_calendar_connections_app_tenant_id_fkey FOREIGN KEY (app_tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

ALTER TABLE IF EXISTS microsoft_calendar_connections
ADD COLUMN IF NOT EXISTS microsoft_tenant_id VARCHAR(128);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'microsoft_calendar_connections'
      AND column_name = 'tenant_id'
  ) THEN
    EXECUTE '
      UPDATE microsoft_calendar_connections
      SET microsoft_tenant_id = COALESCE(microsoft_tenant_id, tenant_id::text, ''unknown'')
      WHERE microsoft_tenant_id IS NULL
    ';
  ELSE
    UPDATE microsoft_calendar_connections
    SET microsoft_tenant_id = COALESCE(microsoft_tenant_id, 'unknown')
    WHERE microsoft_tenant_id IS NULL;
  END IF;
END $$;
ALTER TABLE IF EXISTS microsoft_calendar_connections
ALTER COLUMN microsoft_tenant_id SET NOT NULL;
ALTER TABLE IF EXISTS microsoft_calendar_connections
DROP COLUMN IF EXISTS tenant_id;

CREATE TABLE IF NOT EXISTS microsoft_calendar_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  engineer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  microsoft_event_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, engineer_id)
);

ALTER TABLE IF EXISTS microsoft_calendar_events ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE microsoft_calendar_events SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE IF EXISTS microsoft_calendar_events ALTER COLUMN tenant_id SET DEFAULT 1;
ALTER TABLE IF EXISTS microsoft_calendar_events ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'microsoft_calendar_events_tenant_id_fkey'
  ) THEN
    ALTER TABLE microsoft_calendar_events
    ADD CONSTRAINT microsoft_calendar_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

-- ─── password_reset_tokens ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_tenant ON password_reset_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_active ON users(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_time_blocks_tenant_project ON time_blocks(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_time_blocks_project ON time_blocks(project_id);
CREATE INDEX IF NOT EXISTS idx_time_blocks_start ON time_blocks(start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_block ON bookings(tenant_id, time_block_id);
CREATE INDEX IF NOT EXISTS idx_bookings_block ON bookings(time_block_id);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(client_email);
CREATE INDEX IF NOT EXISTS idx_bookings_token ON bookings(booking_token);
CREATE INDEX IF NOT EXISTS idx_bookings_cancelled_at ON bookings(cancelled_at);
CREATE INDEX IF NOT EXISTS idx_bookings_pii_redacted_at ON bookings(pii_redacted_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_entries_tenant_slot_status_created ON waitlist_entries(tenant_id, time_block_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_entries_tenant_email ON waitlist_entries(tenant_id, client_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_entries_unique_open_email
ON waitlist_entries(tenant_id, time_block_id, lower(client_email))
WHERE status IN ('active', 'notified');
CREATE INDEX IF NOT EXISTS idx_booking_idempotency_tenant_token_key ON booking_idempotency_keys(tenant_id, share_token, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_booking_idempotency_expires ON booking_idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_tenant_user ON auth_refresh_tokens(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_hash ON auth_refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_active_expires ON auth_refresh_tokens(expires_at) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_refresh_tokens_hash_unique ON auth_refresh_tokens(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_oidc_sso_configs_tenant ON tenant_oidc_sso_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_oidc_sso_configs_enabled ON tenant_oidc_sso_configs(enabled);
CREATE INDEX IF NOT EXISTS idx_audit_log_events_tenant_created ON audit_log_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_events_actor ON audit_log_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_connections_user ON microsoft_calendar_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_connections_tenant ON microsoft_calendar_connections(app_tenant_id);
CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_events_engineer ON microsoft_calendar_events(engineer_id);
CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_events_booking ON microsoft_calendar_events(booking_id);
CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_events_tenant ON microsoft_calendar_events(tenant_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_tenants_updated_at ON tenants;
CREATE TRIGGER trigger_tenants_updated_at
BEFORE UPDATE ON tenants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_users_updated_at ON users;
CREATE TRIGGER trigger_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_projects_updated_at ON projects;
CREATE TRIGGER trigger_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_microsoft_calendar_connections_updated_at ON microsoft_calendar_connections;
CREATE TRIGGER trigger_microsoft_calendar_connections_updated_at
BEFORE UPDATE ON microsoft_calendar_connections
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_auth_refresh_tokens_updated_at ON auth_refresh_tokens;
CREATE TRIGGER trigger_auth_refresh_tokens_updated_at
BEFORE UPDATE ON auth_refresh_tokens
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_tenant_oidc_sso_configs_updated_at ON tenant_oidc_sso_configs;
CREATE TRIGGER trigger_tenant_oidc_sso_configs_updated_at
BEFORE UPDATE ON tenant_oidc_sso_configs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_microsoft_calendar_events_updated_at ON microsoft_calendar_events;
CREATE TRIGGER trigger_microsoft_calendar_events_updated_at
BEFORE UPDATE ON microsoft_calendar_events
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_waitlist_entries_updated_at ON waitlist_entries;
CREATE TRIGGER trigger_waitlist_entries_updated_at
BEFORE UPDATE ON waitlist_entries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE VIEW available_slots AS
SELECT
  tb.id AS time_block_id,
  tb.project_id,
  tb.start_time,
  tb.end_time,
  tb.max_signups,
  tb.max_signups - COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL) AS remaining_slots,
  tb.tenant_id
FROM time_blocks tb
LEFT JOIN bookings b ON b.time_block_id = tb.id
GROUP BY tb.id
HAVING tb.max_signups - COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL) > 0;

CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS INTEGER AS $$
DECLARE
  tenant_setting TEXT;
BEGIN
  tenant_setting := current_setting('app.tenant_id', true);

  IF tenant_setting IS NULL OR btrim(tenant_setting) = '' THEN
    RETURN NULL;
  END IF;

  RETURN tenant_setting::integer;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_block_engineers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_oidc_sso_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_scoped_tenants ON tenants;
CREATE POLICY tenant_scoped_tenants
ON tenants
USING (app_current_tenant_id() IS NULL OR id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_users ON users;
CREATE POLICY tenant_scoped_users
ON users
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_projects ON projects;
CREATE POLICY tenant_scoped_projects
ON projects
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_time_blocks ON time_blocks;
CREATE POLICY tenant_scoped_time_blocks
ON time_blocks
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_time_block_engineers ON time_block_engineers;
CREATE POLICY tenant_scoped_time_block_engineers
ON time_block_engineers
USING (
  app_current_tenant_id() IS NULL
  OR EXISTS (
    SELECT 1
    FROM time_blocks tb
    WHERE tb.id = time_block_engineers.time_block_id
      AND tb.tenant_id = app_current_tenant_id()
  )
)
WITH CHECK (
  app_current_tenant_id() IS NULL
  OR EXISTS (
    SELECT 1
    FROM time_blocks tb
    WHERE tb.id = time_block_engineers.time_block_id
      AND tb.tenant_id = app_current_tenant_id()
  )
);

DROP POLICY IF EXISTS tenant_scoped_bookings ON bookings;
CREATE POLICY tenant_scoped_bookings
ON bookings
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_waitlist_entries ON waitlist_entries;
CREATE POLICY tenant_scoped_waitlist_entries
ON waitlist_entries
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_booking_idempotency_keys ON booking_idempotency_keys;
CREATE POLICY tenant_scoped_booking_idempotency_keys
ON booking_idempotency_keys
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_auth_refresh_tokens ON auth_refresh_tokens;
CREATE POLICY tenant_scoped_auth_refresh_tokens
ON auth_refresh_tokens
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_tenant_oidc_sso_configs ON tenant_oidc_sso_configs;
CREATE POLICY tenant_scoped_tenant_oidc_sso_configs
ON tenant_oidc_sso_configs
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_audit_log_events ON audit_log_events;
CREATE POLICY tenant_scoped_audit_log_events
ON audit_log_events
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_microsoft_calendar_connections ON microsoft_calendar_connections;
CREATE POLICY tenant_scoped_microsoft_calendar_connections
ON microsoft_calendar_connections
USING (app_current_tenant_id() IS NULL OR app_tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR app_tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_microsoft_calendar_events ON microsoft_calendar_events;
CREATE POLICY tenant_scoped_microsoft_calendar_events
ON microsoft_calendar_events
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_scoped_password_reset_tokens ON password_reset_tokens;
CREATE POLICY tenant_scoped_password_reset_tokens
ON password_reset_tokens
USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());
