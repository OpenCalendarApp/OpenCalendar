import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildBookingIdempotencyFingerprint, parseIdempotencyKey } from '../middleware/idempotency.js';

void test('idempotency key parser accepts missing and valid keys', () => {
  assert.deepEqual(parseIdempotencyKey(undefined), { ok: true, key: null });
  assert.deepEqual(parseIdempotencyKey(' booking-retry-001 '), { ok: true, key: 'booking-retry-001' });
});

void test('idempotency key parser rejects invalid keys', () => {
  const empty = parseIdempotencyKey('   ');
  assert.equal(empty.ok, false);

  const invalidChars = parseIdempotencyKey('bad key with spaces');
  assert.equal(invalidChars.ok, false);
});

void test('booking idempotency fingerprint is deterministic and sensitive to payload changes', () => {
  const baseArgs = {
    shareToken: 'a'.repeat(64),
    password: 'test-password',
    timeBlockId: 42,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '555-1000'
  };

  const firstFingerprint = buildBookingIdempotencyFingerprint(baseArgs);
  const secondFingerprint = buildBookingIdempotencyFingerprint(baseArgs);
  assert.equal(firstFingerprint, secondFingerprint);

  const changedFingerprint = buildBookingIdempotencyFingerprint({
    ...baseArgs,
    timeBlockId: 43
  });
  assert.notEqual(firstFingerprint, changedFingerprint);
});

