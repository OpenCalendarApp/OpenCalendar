import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildOidcAuthorizeUrl,
  createOidcSsoState,
  resolveOidcProfile,
  verifyOidcSsoState,
  type OidcTenantConfig
} from '../utils/oidcSso.js';

const baseConfig: OidcTenantConfig = {
  tenantId: 1,
  tenantUid: '00000000-0000-0000-0000-000000000001',
  enabled: true,
  authorizationEndpoint: 'https://id.example.com/oauth2/authorize',
  tokenEndpoint: 'https://id.example.com/oauth2/token',
  userinfoEndpoint: 'https://id.example.com/oauth2/userinfo',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  scopes: 'openid profile email',
  claimEmail: 'email',
  claimFirstName: 'given_name',
  claimLastName: 'family_name',
  defaultRole: 'pm',
  autoProvision: true,
  successRedirectUrl: null,
  errorRedirectUrl: null
};

void test('oidc sso state signs and verifies tenant identity', () => {
  const state = createOidcSsoState({
    tenantId: 9,
    stateSecret: 'test-secret',
    ttlSeconds: 120,
    nowMs: 1_700_000_000_000
  });

  const verification = verifyOidcSsoState({
    state,
    stateSecret: 'test-secret',
    nowMs: 1_700_000_030_000
  });

  assert.deepEqual(verification, { ok: true, tenantId: 9 });
});

void test('oidc authorize url includes expected oauth params', () => {
  const urlString = buildOidcAuthorizeUrl({
    config: baseConfig,
    redirectUri: 'http://localhost:4000/api/v1/auth/sso/oidc/callback',
    state: 'signed-state'
  });

  const url = new URL(urlString);
  assert.equal(url.origin, 'https://id.example.com');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:4000/api/v1/auth/sso/oidc/callback');
  assert.equal(url.searchParams.get('scope'), 'openid profile email');
  assert.equal(url.searchParams.get('state'), 'signed-state');
});

void test('oidc profile resolver maps configured claims and lowercases email', () => {
  const profile = resolveOidcProfile({
    config: baseConfig,
    userInfo: {
      email: 'User@Example.com',
      given_name: 'Ada',
      family_name: 'Lovelace'
    }
  });

  assert.deepEqual(profile, {
    email: 'user@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace'
  });
});
