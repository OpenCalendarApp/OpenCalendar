import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRefreshTokenExpiresAt,
  generateRefreshToken,
  hashRefreshToken,
  resolveRefreshTokenTtlDays
} from '../utils/refreshTokens.js';

void test('refresh token ttl parser applies defaults and bounds', () => {
  assert.equal(resolveRefreshTokenTtlDays(undefined), 30);
  assert.equal(resolveRefreshTokenTtlDays('abc'), 30);
  assert.equal(resolveRefreshTokenTtlDays('0'), 1);
  assert.equal(resolveRefreshTokenTtlDays('2.9'), 2);
  assert.equal(resolveRefreshTokenTtlDays('400'), 365);
});

void test('refresh token generation and hashing are stable per token value', () => {
  const token = generateRefreshToken();
  assert.ok(token.length >= 64);

  const hashA = hashRefreshToken(token);
  const hashB = hashRefreshToken(token);
  assert.equal(hashA, hashB);

  const differentHash = hashRefreshToken(`${token}x`);
  assert.notEqual(hashA, differentHash);
});

void test('refresh token expiry builder adds ttl window in days', () => {
  const expiry = buildRefreshTokenExpiresAt(7, 1_700_000_000_000);
  assert.equal(expiry.toISOString(), '2023-11-21T22:13:20.000Z');
});
