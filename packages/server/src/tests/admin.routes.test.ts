import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

void test('admin routes define overview and user-management endpoints with admin role guard', async () => {
  const routePath = new URL('../routes/admin.ts', import.meta.url);
  const source = await fs.readFile(routePath, 'utf8');

  assert.ok(source.includes("router.use(requireRole(['admin']))"), 'Expected admin role guard middleware');
  assert.ok(source.includes("router.get('/overview'"), 'Expected admin overview endpoint');
  assert.ok(source.includes("router.get('/users'"), 'Expected admin users list endpoint');
  assert.ok(source.includes("router.get('/audit'"), 'Expected admin audit log endpoint');
  assert.ok(source.includes("router.get('/sso/oidc'"), 'Expected OIDC SSO config read endpoint');
  assert.ok(source.includes("router.put('/sso/oidc'"), 'Expected OIDC SSO config update endpoint');
  assert.ok(source.includes("router.patch('/users/:id/role'"), 'Expected role update endpoint');
  assert.ok(source.includes("router.patch('/users/:id/status'"), 'Expected status update endpoint');
  assert.ok(source.includes('recordAuditEventSafe'), 'Expected audit-event recording on admin mutations');
});

void test('app mounts admin routes for both legacy and v1 api paths', async () => {
  const appPath = new URL('../app.ts', import.meta.url);
  const source = await fs.readFile(appPath, 'utf8');

  assert.ok(source.includes("import adminRoutes from './routes/admin.js';"), 'Expected admin route import in app');
  assert.ok(source.includes("app.use(`${basePath}/admin`, adminRoutes);"), 'Expected admin route mount');
});
