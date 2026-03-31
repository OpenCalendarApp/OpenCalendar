import { recordQueueEventMetric } from '../observability/metrics.js';

type EnvLike = Record<string, string | undefined>;

export interface DataRetentionConfig {
  enabled: boolean;
  sweepIntervalMs: number;
  piiRetentionDays: number;
  cancelledBookingDeleteDays: number;
  idempotencyDeleteGraceDays: number;
}

export interface DataRetentionSweepResult {
  redactedBookings: number;
  deletedCancelledBookings: number;
  deletedIdempotencyKeys: number;
}

export interface DataRetentionScheduler {
  start: () => void;
  stop: () => Promise<void>;
}

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function getDataRetentionConfig(env: EnvLike = process.env): DataRetentionConfig {
  const enabled = parseBoolean(env.DATA_RETENTION_ENABLED, true);
  const sweepIntervalMs = parsePositiveInt(env.DATA_RETENTION_SWEEP_INTERVAL_MS, 3_600_000);
  const piiRetentionDays = parsePositiveInt(env.DATA_RETENTION_PII_DAYS, 365);
  const cancelledBookingDeleteDaysRaw = parsePositiveInt(env.DATA_RETENTION_CANCELLED_BOOKING_DELETE_DAYS, 730);
  const idempotencyDeleteGraceDays = parseNonNegativeInt(env.DATA_RETENTION_IDEMPOTENCY_KEY_DELETE_DAYS, 2);

  return {
    enabled,
    sweepIntervalMs,
    piiRetentionDays,
    cancelledBookingDeleteDays: Math.max(cancelledBookingDeleteDaysRaw, piiRetentionDays),
    idempotencyDeleteGraceDays
  };
}

export async function runDataRetentionSweep(
  db: Queryable,
  config: DataRetentionConfig = getDataRetentionConfig()
): Promise<DataRetentionSweepResult> {
  const deleteExpiredIdempotencyResult = await db.query(
    `
    DELETE FROM booking_idempotency_keys
    WHERE expires_at < (NOW() - ($1::int * INTERVAL '1 day'))
    RETURNING id
    `,
    [config.idempotencyDeleteGraceDays]
  );

  const redactBookingsResult = await db.query(
    `
    UPDATE bookings AS b
    SET
      client_first_name = '[deleted]',
      client_last_name = '[deleted]',
      client_email = CONCAT('deleted+', b.id::text, '@redacted.local'),
      client_phone = '[deleted]',
      pii_redacted_at = NOW()
    FROM time_blocks AS tb
    WHERE b.time_block_id = tb.id
      AND b.pii_redacted_at IS NULL
      AND tb.end_time < (NOW() - ($1::int * INTERVAL '1 day'))
    RETURNING b.id
    `,
    [config.piiRetentionDays]
  );

  const deleteCancelledBookingsResult = await db.query(
    `
    DELETE FROM bookings
    WHERE cancelled_at IS NOT NULL
      AND pii_redacted_at IS NOT NULL
      AND cancelled_at < (NOW() - ($1::int * INTERVAL '1 day'))
    RETURNING id
    `,
    [config.cancelledBookingDeleteDays]
  );

  const result: DataRetentionSweepResult = {
    redactedBookings: redactBookingsResult.rows.length,
    deletedCancelledBookings: deleteCancelledBookingsResult.rows.length,
    deletedIdempotencyKeys: deleteExpiredIdempotencyResult.rows.length
  };

  if (result.redactedBookings > 0 || result.deletedCancelledBookings > 0 || result.deletedIdempotencyKeys > 0) {
    console.info(
      '[data-retention] sweep completed',
      JSON.stringify({
        redacted_bookings: result.redactedBookings,
        deleted_cancelled_bookings: result.deletedCancelledBookings,
        deleted_idempotency_keys: result.deletedIdempotencyKeys
      })
    );
  }

  return result;
}

export function createDataRetentionScheduler(args: {
  db: Queryable;
  config?: DataRetentionConfig;
}): DataRetentionScheduler {
  const config = args.config ?? getDataRetentionConfig();
  let timer: NodeJS.Timeout | null = null;
  let inFlightSweep: Promise<void> | null = null;

  const runSweep = async (): Promise<void> => {
    if (inFlightSweep) {
      return;
    }

    inFlightSweep = (async () => {
      try {
        recordQueueEventMetric('retention_sweep_started');
        const result = await runDataRetentionSweep(args.db, config);
        recordQueueEventMetric('retention_sweep_succeeded');
        if (result.redactedBookings > 0) {
          recordQueueEventMetric('retention_redaction_applied');
        }
        if (result.deletedCancelledBookings > 0) {
          recordQueueEventMetric('retention_cancelled_booking_deleted');
        }
        if (result.deletedIdempotencyKeys > 0) {
          recordQueueEventMetric('retention_idempotency_key_deleted');
        }
      } catch (error: unknown) {
        recordQueueEventMetric('retention_sweep_failed');
        console.error('[data-retention] sweep failed', error);
      } finally {
        inFlightSweep = null;
      }
    })();

    await inFlightSweep;
  };

  return {
    start: () => {
      if (!config.enabled || timer) {
        return;
      }

      timer = setInterval(() => {
        void runSweep();
      }, config.sweepIntervalMs);
      timer.unref();
      void runSweep();
    },
    stop: async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      if (inFlightSweep) {
        await inFlightSweep;
      }
    }
  };
}
