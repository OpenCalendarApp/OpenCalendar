---
applyTo: 'docker/init.sql,packages/server/src/db/**'
---

# Database Development Guide

This file applies to database-related code: `docker/init.sql` schema and `packages/server/src/db/` layer. Reference the main instructions at [.github/copilot-instructions.md](../copilot-instructions.md) for general conventions.

## Database Overview

- **Engine:** PostgreSQL 16
- **Tables:** 5 core tables + 1 view
- **Extensions:** pgcrypto (for `gen_random_bytes()`)
- **Access:** Node.js connection pool (`db/pool.ts`)

## Schema Design

### `users` Table

Stores both Project Managers and Engineers.

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30),
  role VARCHAR(20) NOT NULL CHECK (role IN ('pm', 'engineer')),
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
```

**Role semantics:**
- `pm` — Project Manager (can create projects, assign engineers, manage blocks)
- `engineer` — Can create personal time blocks, assigned to blocks by PMs

### `projects` Table

Collections of time blocks for a specific engagement.

```sql
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  signup_password_hash VARCHAR(255) NOT NULL,
  is_group_signup BOOLEAN DEFAULT FALSE,
  max_group_size INTEGER DEFAULT 1 CHECK (max_group_size > 0),
  session_length_minutes INTEGER NOT NULL CHECK (session_length_minutes > 0),
  share_token VARCHAR(64) UNIQUE NOT NULL,        -- For /schedule/{share_token}
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_created_by ON projects(created_by);
CREATE INDEX idx_projects_share_token ON projects(share_token);
```

**Key fields:**
- `signup_password_hash` — bcrypt hash of the client password (cost factor 10)
- `share_token` — Generated via `gen_random_bytes(32)` on insert (256-bit entropy)
- `is_group_signup` — If true, multiple clients can book the same slot
- `session_length_minutes` — UI hint for duration; used to display time ranges

### `time_blocks` Table

Individual session slots for booking.

```sql
CREATE TABLE time_blocks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  max_signups INTEGER DEFAULT 1 CHECK (max_signups > 0),
  is_personal BOOLEAN DEFAULT FALSE,              -- True if created by engineer
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE INDEX idx_time_blocks_project ON time_blocks(project_id);
CREATE INDEX idx_time_blocks_start ON time_blocks(start_time);
CREATE INDEX idx_time_blocks_created_by ON time_blocks(created_by);
```

**Constraints:**
- `end_time > start_time` — Enforces non-zero duration
- Cascade delete on project deletion

### `time_block_engineers` Table

N:M mapping of engineers to time blocks (many engineers can be assigned to one block).

```sql
CREATE TABLE time_block_engineers (
  id SERIAL PRIMARY KEY,
  time_block_id INTEGER NOT NULL REFERENCES time_blocks(id) ON DELETE CASCADE,
  engineer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (time_block_id, engineer_id)            -- Prevent duplicate assignment
);

CREATE INDEX idx_time_block_engineers_block ON time_block_engineers(time_block_id);
CREATE INDEX idx_time_block_engineers_engineer ON time_block_engineers(engineer_id);
```

### `bookings` Table

Client reservations for time blocks.

```sql
CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  time_block_id INTEGER NOT NULL REFERENCES time_blocks(id) ON DELETE CASCADE,
  client_first_name VARCHAR(100) NOT NULL,
  client_last_name VARCHAR(100) NOT NULL,
  client_email VARCHAR(255) NOT NULL,
  client_phone VARCHAR(30) NOT NULL,
  booking_token VARCHAR(64) UNIQUE NOT NULL,     -- For reschedule/cancel URLs
  booked_at TIMESTAMPTZ DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ                       -- NULL = active, timestamp = cancelled
);

CREATE INDEX idx_bookings_block ON bookings(time_block_id);
CREATE INDEX idx_bookings_email ON bookings(client_email);
CREATE INDEX idx_bookings_token ON bookings(booking_token);
```

**Semantics:**
- `cancelled_at IS NULL` → Active booking
- `cancelled_at IS NOT NULL` → Cancelled (slot is freed)
- `booking_token` — Generated via `gen_random_bytes(32)` (256-bit entropy)

### `available_slots` View

Convenience view listing only slots with remaining capacity.

```sql
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
```

## Common Query Patterns

### Fetch Available Slots for a Project

```sql
SELECT
  tb.id,
  tb.start_time,
  tb.end_time,
  tb.max_signups,
  COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL) AS booked_count,
  tb.max_signups - COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL) AS remaining_slots
FROM time_blocks tb
LEFT JOIN bookings b ON b.time_block_id = tb.id
WHERE tb.project_id = $1
  AND tb.start_time > NOW()
  AND tb.max_signups > COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL)
GROUP BY tb.id
ORDER BY tb.start_time;
```

### Book a Slot (with Race Condition Safety)

```sql
BEGIN;
  SELECT * FROM time_blocks WHERE id = $1 FOR UPDATE;
  -- Check availability
  -- INSERT INTO bookings
COMMIT;
```

Use Node.js transaction wrapper:
```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  
  const blockResult = await client.query(
    'SELECT * FROM time_blocks WHERE id = $1 FOR UPDATE',
    [blockId]
  );
  
  // Verify capacity
  const bookingCount = await client.query(
    'SELECT COUNT(*) FROM bookings WHERE time_block_id = $1 AND cancelled_at IS NULL',
    [blockId]
  );
  
  if (parseInt(bookingCount.rows[0].count) >= blockResult.rows[0].max_signups) {
    throw new Error('Slot is full');
  }
  
  // Insert booking
  const booking = await client.query(
    'INSERT INTO bookings (time_block_id, client_first_name, ...) VALUES ($1, $2, ...) RETURNING *',
    [blockId, firstName, ...]
  );
  
  await client.query('COMMIT');
  return booking.rows[0];
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### Reschedule a Booking

```sql
BEGIN;
  -- Lock old booking and mark cancelled
  UPDATE bookings 
  SET cancelled_at = NOW() 
  WHERE id = $1 FOR UPDATE
  RETURNING *;
  
  -- Lock new slot and verify availability
  SELECT * FROM time_blocks WHERE id = $2 FOR UPDATE;
  SELECT COUNT(*) FROM bookings WHERE time_block_id = $2 AND cancelled_at IS NULL;
  
  -- Create new booking
  INSERT INTO bookings (...) VALUES (...) RETURNING *;
COMMIT;
```

### Delete a Time Block

```sql
DELETE FROM time_blocks 
WHERE id = $1 
  AND NOT EXISTS (
    SELECT 1 FROM bookings 
    WHERE time_block_id = $1 
      AND cancelled_at IS NULL
  )
RETURNING *;
```

## Database Layer (`packages/server/src/db/`)

### `pool.ts` — Connection Pool

```typescript
import { Pool } from 'pg';

export const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'session_scheduler',
  user: process.env.POSTGRES_USER || 'ss_admin',
  password: process.env.POSTGRES_PASSWORD,
  max: 20,  // Max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on connection', err);
  process.exit(-1);
});

export default pool;
```

### `migrate.ts` — Schema Runner

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pool from './pool';

export async function migrate() {
  const schema = readFileSync(resolve(__dirname, '../../docker/init.sql'), 'utf-8');
  
  try {
    await pool.query(schema);
    console.log('✓ Database schema initialized');
  } catch (error) {
    console.error('Failed to migrate:', error);
    throw error;
  }
}
```

### `seed.ts` — Sample Data

```typescript
import pool from './pool';
import { hashPassword } from '../utils/auth';

export async function seed() {
  const pmPassHash = await hashPassword('password', 12);
  const engPassHash = await hashPassword('password', 12);
  const projectPassHash = await hashPassword('password', 10);
  
  const pmResult = await pool.query(
    'INSERT INTO users (email, first_name, last_name, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    ['pm@example.com', 'Sarah', 'Mitchell', pmPassHash, 'pm']
  );
  
  const engResult = await pool.query(
    'INSERT INTO users (email, first_name, last_name, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    ['engineer@example.com', 'Alex', 'Rivera', engPassHash, 'engineer']
  );
  
  const projectResult = await pool.query(
    'INSERT INTO projects (name, created_by, signup_password_hash, session_length_minutes, share_token) VALUES ($1, $2, $3, $4, encode(gen_random_bytes(32), \'hex\')) RETURNING *',
    ['Q2 Planning', pmResult.rows[0].id, projectPassHash, 60]
  );
  
  console.log('✓ Sample data loaded');
}
```

## Migration Strategy

**V1 does not support destructive migrations.** When modifying the schema:

✅ **Safe operations:**
- ADD COLUMN (with default or nullable)
- ADD INDEX
- ADD TABLE
- ALTER COLUMN to remove NOT NULL
- ALTER CONSTRAINT (add CHECK)

❌ **Unsafe operations (not supported in v1):**
- DROP COLUMN
- DROP TABLE
- RENAME COLUMN
- Change data type
- Add NOT NULL to existing column without default

**Workaround for breaking changes:**
1. Create new table with desired schema
2. Write migration script to copy + transform data
3. Rename old table, new table to original name
4. Run one-time migration, then delete old table

## Performance Best Practices

### Indexing

- **Always index foreign keys** — needed for JOINs
- **Index high-cardinality columns** used in WHERE clauses
- **Avoid indexing low-cardinality enums** — seq scan is often faster
- **Use composite indexes** for multi-column WHERE + ORDER BY

```sql
-- Good
CREATE INDEX idx_bookings_block_status 
ON bookings(time_block_id, cancelled_at);

-- Less useful
CREATE INDEX idx_users_role ON users(role);  -- Only 2 values
```

### Query Optimization

- **COUNT aggregates** — use efficient FILTER syntax: `COUNT(*) FILTER (WHERE condition)`
- **LEFT JOIN only when needed** — for optional relationships, not when you need INNER JOIN semantics
- **Use LIMIT** when testing, remove for production queries
- **EXPLAIN ANALYZE** before committing complex queries

```sql
-- Good — efficient counting
SELECT COUNT(*) FILTER (WHERE cancelled_at IS NULL)
FROM bookings WHERE time_block_id = $1;

-- Avoid if possible
SELECT COUNT(*) FROM bookings WHERE time_block_id = $1 AND cancelled_at IS NULL;
```

## Debugging

### Check Table Structure
```sql
\d users          -- Describe table schema
\di               -- List indexes
\dv               -- List views
```

### Check Active Locks
```sql
SELECT * FROM pg_locks WHERE NOT granted;
```

### Check Slow Queries
Enable logging in .env:
```bash
POSTGRES_ENV_POSTGRES_INITDB_ARGS="-c log_min_duration_statement=1000"
```

## Data Retention & Cleanup

**In v1, manually manage old data:**
- Keep cancelled bookings for audit history
- Delete inactive projects only if no legacy bookings exist
- Soft-delete projects by setting `is_active = FALSE` instead of removing

```sql
-- Archive old bookings (14+ days)
INSERT INTO bookings_archive SELECT * FROM bookings WHERE booked_at < NOW() - INTERVAL '14 days';
DELETE FROM bookings WHERE id IN (SELECT id FROM bookings_archive);
```

## Security Reminders

- ✅ Use parameterized queries **always** (`$1`, `$2`, etc.)
- ✅ Hash passwords with bcrypt before storing
- ✅ Use `gen_random_bytes()` for tokens (cryptographically secure)
- ✅ Keep sensitive data (passwords, tokens) in logs only with `[REDACTED]`
- ❌ Never log raw SQL with user input
- ❌ Never concatenate user input into SQL strings
- ❌ Never store plaintext passwords
