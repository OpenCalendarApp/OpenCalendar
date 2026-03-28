import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from './pool.js';

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function runMigrationSqlWithRetry(sql: string): Promise<void> {
  const maxAttempts = 20;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query(sql);
      return;
    } catch (error: unknown) {
      if (attempt === maxAttempts) {
        throw error;
      }

      console.warn(`Migration attempt ${attempt}/${maxAttempts} failed. Retrying...`);
      await sleep(1000);
    }
  }
}

async function runMigration(): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationPath = resolve(currentDir, '../../../../docker/init.sql');
  const sql = await readFile(migrationPath, 'utf8');

  await runMigrationSqlWithRetry(sql);
  await pool.end();

  console.log(`Applied schema from ${migrationPath}`);
}

runMigration().catch(async (error: unknown) => {
  console.error('Migration failed', error);
  await pool.end();
  process.exit(1);
});
