import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

void test('auth routes include refresh token session endpoints', async () => {
  const routePath = new URL('../routes/auth.ts', import.meta.url);
  const source = await fs.readFile(routePath, 'utf8');

  assert.ok(source.includes("router.post('/refresh'"), 'Expected refresh endpoint');
  assert.ok(source.includes("router.post('/logout'"), 'Expected logout endpoint');
  assert.ok(source.includes('auth_refresh_tokens'), 'Expected refresh token revocation/rotation queries');
});

void test('auth routes include engineer-only Microsoft OAuth endpoints', async () => {
  const routePath = new URL('../routes/auth.ts', import.meta.url);
  const source = await fs.readFile(routePath, 'utf8');

  assert.ok(source.includes("router.get('/microsoft/status'"), 'Expected Microsoft status endpoint');
  assert.ok(source.includes("router.get('/microsoft/connect'"), 'Expected Microsoft connect endpoint');
  assert.ok(source.includes("router.get('/microsoft/callback'"), 'Expected Microsoft callback endpoint');
  assert.ok(source.includes("router.delete('/microsoft/connection'"), 'Expected Microsoft disconnect endpoint');
  assert.ok(source.includes("requireRole(['engineer'])"), 'Expected engineer-only role enforcement');
});

void test('auth routes include public OIDC SSO start and callback endpoints', async () => {
  const routePath = new URL('../routes/auth.ts', import.meta.url);
  const source = await fs.readFile(routePath, 'utf8');

  assert.ok(source.includes("router.get('/sso/oidc/start'"), 'Expected OIDC start endpoint');
  assert.ok(source.includes("router.get('/sso/oidc/callback'"), 'Expected OIDC callback endpoint');
  assert.ok(source.includes('buildOidcAuthorizeUrl'), 'Expected OIDC authorize URL builder usage');
  assert.ok(source.includes('verifyOidcSsoState'), 'Expected OIDC state verification');
  assert.ok(source.includes('exchangeOidcAuthorizationCode'), 'Expected OIDC token exchange');
});
