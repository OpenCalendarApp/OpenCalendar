import { config } from 'dotenv';
import { Pool } from 'pg';

config();

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://ss_admin:change-me@localhost:5432/session_scheduler';

export const pool = new Pool({
  connectionString: databaseUrl
});
