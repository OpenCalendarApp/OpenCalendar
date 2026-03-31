import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getDataRetentionConfig,
  runDataRetentionSweep,
  type DataRetentionConfig
} from '../jobs/dataRetention.js';

interface QueryCall {
  text: string;
  values?: unknown[];
}

interface MockDbConfig {
  deletedIdempotencyKeys: number;
  redactedBookings: number;
  deletedCancelledBookings: number;
}

function createMockDb(config: MockDbConfig): {
  calls: QueryCall[];
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ id: number }> }>;
} {
  const calls: QueryCall[] = [];

  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });

      if (text.includes('DELETE FROM booking_idempotency_keys')) {
        return { rows: Array.from({ length: config.deletedIdempotencyKeys }, (_, index) => ({ id: index + 1 })) };
      }

      if (text.includes('UPDATE bookings AS b')) {
        return { rows: Array.from({ length: config.redactedBookings }, (_, index) => ({ id: index + 1 })) };
      }

      if (text.includes('DELETE FROM bookings')) {
        return { rows: Array.from({ length: config.deletedCancelledBookings }, (_, index) => ({ id: index + 1 })) };
      }

      return { rows: [] };
    }
  };
}

void test('data retention config parser applies defaults and bounds', () => {
  const defaults = getDataRetentionConfig({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.sweepIntervalMs, 3_600_000);
  assert.equal(defaults.piiRetentionDays, 365);
  assert.equal(defaults.cancelledBookingDeleteDays, 730);
  assert.equal(defaults.idempotencyDeleteGraceDays, 2);

  const parsed = getDataRetentionConfig({
    DATA_RETENTION_ENABLED: 'false',
    DATA_RETENTION_SWEEP_INTERVAL_MS: '120000',
    DATA_RETENTION_PII_DAYS: '90',
    DATA_RETENTION_CANCELLED_BOOKING_DELETE_DAYS: '30',
    DATA_RETENTION_IDEMPOTENCY_KEY_DELETE_DAYS: '0'
  });

  assert.equal(parsed.enabled, false);
  assert.equal(parsed.sweepIntervalMs, 120_000);
  assert.equal(parsed.piiRetentionDays, 90);
  assert.equal(parsed.cancelledBookingDeleteDays, 90);
  assert.equal(parsed.idempotencyDeleteGraceDays, 0);
});

void test('data retention sweep runs cleanup queries with configured windows', async () => {
  const mockDb = createMockDb({
    deletedIdempotencyKeys: 3,
    redactedBookings: 2,
    deletedCancelledBookings: 1
  });

  const config: DataRetentionConfig = {
    enabled: true,
    sweepIntervalMs: 60_000,
    piiRetentionDays: 180,
    cancelledBookingDeleteDays: 365,
    idempotencyDeleteGraceDays: 4
  };

  const result = await runDataRetentionSweep(mockDb, config);
  assert.deepEqual(result, {
    redactedBookings: 2,
    deletedCancelledBookings: 1,
    deletedIdempotencyKeys: 3
  });

  assert.equal(mockDb.calls.length, 3);
  assert.ok(mockDb.calls[0]?.text.includes('DELETE FROM booking_idempotency_keys'));
  assert.ok(mockDb.calls[1]?.text.includes('UPDATE bookings AS b'));
  assert.ok(mockDb.calls[2]?.text.includes('DELETE FROM bookings'));
  assert.deepEqual(mockDb.calls[0]?.values, [4]);
  assert.deepEqual(mockDb.calls[1]?.values, [180]);
  assert.deepEqual(mockDb.calls[2]?.values, [365]);
});
