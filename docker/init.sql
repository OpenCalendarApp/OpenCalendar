CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30),
  role VARCHAR(20) NOT NULL CHECK (role IN ('pm', 'engineer')),
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  signup_password_hash VARCHAR(255) NOT NULL,
  is_group_signup BOOLEAN NOT NULL DEFAULT FALSE,
  max_group_size INTEGER NOT NULL DEFAULT 1,
  session_length_minutes INTEGER NOT NULL CHECK (session_length_minutes > 0),
  share_token VARCHAR(64) NOT NULL UNIQUE DEFAULT ENCODE(gen_random_bytes(32), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (max_group_size > 0)
);

CREATE TABLE IF NOT EXISTS time_blocks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  max_signups INTEGER NOT NULL DEFAULT 1 CHECK (max_signups > 0),
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS time_block_engineers (
  id SERIAL PRIMARY KEY,
  time_block_id INTEGER NOT NULL REFERENCES time_blocks(id) ON DELETE CASCADE,
  engineer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (time_block_id, engineer_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  time_block_id INTEGER NOT NULL REFERENCES time_blocks(id) ON DELETE CASCADE,
  client_first_name VARCHAR(100) NOT NULL,
  client_last_name VARCHAR(100) NOT NULL,
  client_email VARCHAR(255) NOT NULL,
  client_phone VARCHAR(30) NOT NULL,
  booking_token VARCHAR(64) NOT NULL UNIQUE DEFAULT ENCODE(gen_random_bytes(32), 'hex'),
  booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_time_blocks_project ON time_blocks(project_id);
CREATE INDEX IF NOT EXISTS idx_time_blocks_start ON time_blocks(start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_block ON bookings(time_block_id);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(client_email);
CREATE INDEX IF NOT EXISTS idx_bookings_token ON bookings(booking_token);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

CREATE OR REPLACE VIEW available_slots AS
SELECT
  tb.id AS time_block_id,
  tb.project_id,
  tb.start_time,
  tb.end_time,
  tb.max_signups,
  tb.max_signups - COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL) AS remaining_slots
FROM time_blocks tb
LEFT JOIN bookings b ON b.time_block_id = tb.id
GROUP BY tb.id
HAVING tb.max_signups - COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL) > 0;
