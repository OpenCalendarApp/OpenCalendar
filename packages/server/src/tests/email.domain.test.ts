import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isEmailAllowedForProjectDomain,
  normalizeProjectEmailDomainAllowlist
} from '../utils/emailDomain.js';

void test('normalizes valid project email domain allowlist values', () => {
  assert.equal(normalizeProjectEmailDomainAllowlist('CLIENT.com'), 'client.com');
  assert.equal(normalizeProjectEmailDomainAllowlist('  sub.client.com  '), 'sub.client.com');
  assert.equal(normalizeProjectEmailDomainAllowlist(''), null);
  assert.equal(normalizeProjectEmailDomainAllowlist(null), null);
});

void test('rejects booking emails outside allowlisted domain', () => {
  assert.equal(isEmailAllowedForProjectDomain('person@client.com', 'client.com'), true);
  assert.equal(isEmailAllowedForProjectDomain('person@team.client.com', 'client.com'), true);
  assert.equal(isEmailAllowedForProjectDomain('person@other.com', 'client.com'), false);
  assert.equal(isEmailAllowedForProjectDomain('person@other.com', null), true);
});

