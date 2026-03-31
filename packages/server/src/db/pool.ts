import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

config();

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(currentDir, '../../../../.env');

if (!process.env.DATABASE_URL && existsSync(rootEnvPath)) {
  config({ path: rootEnvPath });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function buildDatabaseUrlFromParts(): string {
  const user = process.env.POSTGRES_USER ?? 'ss_admin';
  const password = process.env.POSTGRES_PASSWORD ?? 'change-me';
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const port = parsePositiveInt(process.env.POSTGRES_PORT, 5432);
  const database = process.env.POSTGRES_DB ?? 'calendar_genie';
  const sslMode = process.env.DATABASE_SSLMODE ?? process.env.PGSSLMODE;
  const sslSuffix = sslMode ? `?sslmode=${encodeURIComponent(sslMode)}` : '';

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}${sslSuffix}`;
}

function resolveDatabaseUrl(): string {
  const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (rawDatabaseUrl && !rawDatabaseUrl.includes('${')) {
    return rawDatabaseUrl;
  }

  return buildDatabaseUrlFromParts();
}

const databaseUrl = resolveDatabaseUrl();

export const pool = new Pool({
  connectionString: databaseUrl
});
