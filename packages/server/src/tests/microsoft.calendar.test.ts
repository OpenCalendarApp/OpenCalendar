import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMicrosoftAuthorizeUrl,
  buildMicrosoftCalendarEventPayload,
  createMicrosoftOAuthState,
  getMicrosoftOAuthConfig,
  verifyMicrosoftOAuthState
} from '../utils/microsoftCalendar.js';

void test('microsoft oauth config parser applies defaults', () => {
  const config = getMicrosoftOAuthConfig({
    JWT_SECRET: 'jwt-secret',
    MICROSOFT_CLIENT_ID: 'client-id',
    MICROSOFT_CLIENT_SECRET: 'client-secret',
    MICROSOFT_REDIRECT_URI: 'http://localhost:4000/api/auth/microsoft/callback'
  });

  assert.equal(config.tenantId, 'common');
  assert.equal(config.stateTtlSeconds, 600);
  assert.deepEqual(config.scopes, ['offline_access', 'User.Read', 'Calendars.ReadWrite']);
  assert.equal(config.stateSecret, 'jwt-secret');
});

void test('microsoft oauth state signs and verifies user identity', () => {
  const config = getMicrosoftOAuthConfig({
    MICROSOFT_CLIENT_ID: 'client-id',
    MICROSOFT_CLIENT_SECRET: 'client-secret',
    MICROSOFT_REDIRECT_URI: 'http://localhost:4000/api/auth/microsoft/callback',
    MICROSOFT_OAUTH_STATE_SECRET: 'state-secret'
  });

  const state = createMicrosoftOAuthState({
    userId: 42,
    config,
    nowMs: 1_000
  });

  const verified = verifyMicrosoftOAuthState({
    state,
    config,
    nowMs: 2_000
  });
  assert.deepEqual(verified, { ok: true, userId: 42 });

  const tampered = verifyMicrosoftOAuthState({
    state: `${state.slice(0, -1)}x`,
    config,
    nowMs: 2_000
  });
  assert.equal(tampered.ok, false);
});

void test('microsoft authorize url includes expected query params', () => {
  const config = getMicrosoftOAuthConfig({
    MICROSOFT_CLIENT_ID: 'client-id',
    MICROSOFT_CLIENT_SECRET: 'client-secret',
    MICROSOFT_REDIRECT_URI: 'http://localhost:4000/api/auth/microsoft/callback',
    MICROSOFT_OAUTH_STATE_SECRET: 'state-secret',
    MICROSOFT_OAUTH_SCOPES: 'offline_access User.Read Calendars.ReadWrite'
  });

  const url = new URL(buildMicrosoftAuthorizeUrl({ userId: 3, config, nowMs: 10_000 }));
  assert.equal(url.hostname, 'login.microsoftonline.com');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:4000/api/auth/microsoft/callback');
  assert.equal(url.searchParams.get('scope'), 'offline_access User.Read Calendars.ReadWrite');
  assert.ok((url.searchParams.get('state') ?? '').length > 10);
});

void test('microsoft event payload includes client and session details', () => {
  const eventPayload = buildMicrosoftCalendarEventPayload({
    projectName: 'Client Kickoff',
    projectDescription: 'Discuss requirements',
    clientFirstName: 'Ada',
    clientLastName: 'Lovelace',
    clientEmail: 'ada@example.com',
    clientPhone: '555-111-2222',
    sessionStartIso: '2026-04-01T18:00:00.000Z',
    sessionEndIso: '2026-04-01T19:00:00.000Z'
  });

  assert.equal(eventPayload.subject, 'Client Kickoff Session');
  assert.ok(eventPayload.body.content.includes('Discuss requirements'));
  assert.ok(eventPayload.body.content.includes('Ada Lovelace'));
  assert.equal(eventPayload.start.timeZone, 'UTC');
  assert.equal(eventPayload.end.timeZone, 'UTC');
  assert.equal(eventPayload.attendees[0]?.emailAddress.address, 'ada@example.com');
});
