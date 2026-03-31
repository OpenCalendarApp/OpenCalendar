import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

void test('setup routes expose status and initialize endpoints', async () => {
  const routePath = new URL('../routes/setup.ts', import.meta.url);
  const source = await fs.readFile(routePath, 'utf8');

  assert.ok(source.includes("router.get('/status'"), 'Expected setup status endpoint');
  assert.ok(source.includes("router.post('/initialize'"), 'Expected setup initialize endpoint');
  assert.ok(source.includes('LOCK TABLE users'), 'Expected setup initialize concurrency lock');
});

void test('app mounts setup routes for both legacy and v1 api paths', async () => {
  const appPath = new URL('../app.ts', import.meta.url);
  const source = await fs.readFile(appPath, 'utf8');

  assert.ok(source.includes("import setupRoutes from './routes/setup.js';"), 'Expected setup route import in app');
  assert.ok(source.includes("app.use(`${basePath}/setup`, setupRoutes);"), 'Expected setup route mount');
});
