import type { PoolClient } from 'pg';

import { pool } from '../db/pool.js';
import { enqueueBookingEmailJob } from './emailNotifications.js';
import { jobQueue, type JobRecord } from './queue.js';

export const BOOKING_REMINDER_JOB_TYPE = 'booking-reminder';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export interface BookingReminderJobPayload {
  reminderId: number;
  bookingId: number;
  tenantId: number;
  type: '24h' | '1h';
}

interface ReminderBookingRow {
  booking_id: number;
  tenant_id: number;
  client_first_name: string;
  client_last_name: string;
  client_email: string;
  booking_token: string;
  cancelled_at: string | null;
  project_name: string;
  share_token: string;
  start_time: string;
  end_time: string;
  sent_at: string | null;
  reminder_cancelled_at: string | null;
}

interface EngineerRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

function resolveBookingPortalBaseUrl(): string {
  return process.env.BOOKING_PORTAL_BASE_URL ?? 'http://localhost:3000';
}

function buildRescheduleUrl(shareToken: string, bookingToken: string): string {
  const base = resolveBookingPortalBaseUrl().replace(/\/+$/, '');
  return `${base}/schedule/${shareToken}/reschedule/${bookingToken}`;
}

async function processBookingReminderJob(
  payload: BookingReminderJobPayload,
  job: JobRecord<BookingReminderJobPayload>
): Promise<void> {
  const result = await pool.query<ReminderBookingRow>(
    `
    SELECT
      b.id AS booking_id,
      b.tenant_id,
      b.client_first_name,
      b.client_last_name,
      b.client_email,
      b.booking_token,
      b.cancelled_at,
      p.name AS project_name,
      p.share_token,
      tb.start_time,
      tb.end_time,
      sr.sent_at,
      sr.cancelled_at AS reminder_cancelled_at
    FROM scheduled_reminders sr
    INNER JOIN bookings b ON b.id = sr.booking_id
    INNER JOIN time_blocks tb ON tb.id = b.time_block_id
    INNER JOIN projects p ON p.id = tb.project_id
    WHERE sr.id = $1
    `,
    [payload.reminderId]
  );

  const row = result.rows[0];
  if (!row) {
    console.log(JSON.stringify({
      level: 'warn',
      event: 'booking_reminder_skipped',
      reason: 'reminder_not_found',
      reminder_id: payload.reminderId,
      job_id: job.id
    }));
    return;
  }

  if (row.reminder_cancelled_at || row.sent_at || row.cancelled_at) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'booking_reminder_skipped',
      reason: row.reminder_cancelled_at ? 'reminder_cancelled' : row.sent_at ? 'already_sent' : 'booking_cancelled',
      reminder_id: payload.reminderId,
      booking_id: payload.bookingId,
      job_id: job.id
    }));
    return;
  }

  const engineersResult = await pool.query<EngineerRow>(
    `
    SELECT u.id, u.first_name, u.last_name, u.email
    FROM time_block_engineers tbe
    INNER JOIN users u ON u.id = tbe.engineer_id
    INNER JOIN time_blocks tb ON tb.id = tbe.time_block_id
    INNER JOIN bookings b ON b.time_block_id = tb.id
    WHERE b.id = $1
    `,
    [payload.bookingId]
  );

  const rescheduleUrl = buildRescheduleUrl(row.share_token, row.booking_token);
  const timingLabel = payload.type === '24h' ? '24 hours' : '1 hour';

  // Send client reminder via the existing email infrastructure
  try {
    enqueueBookingEmailJob({
      event: 'booked',
      bookingToken: row.booking_token,
      projectName: `[Reminder: ${timingLabel}] ${row.project_name}`,
      clientEmail: row.client_email,
      clientFirstName: row.client_first_name,
      rescheduleUrl,
      sessionStartIso: row.start_time,
      sessionEndIso: row.end_time
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'booking_reminder_client_email_failed',
      reminder_id: payload.reminderId,
      booking_id: payload.bookingId,
      error: error instanceof Error ? error.message : 'Unknown error'
    }));
  }

  // Send engineer reminders
  for (const engineer of engineersResult.rows) {
    try {
      enqueueBookingEmailJob({
        event: 'booked',
        bookingToken: row.booking_token,
        projectName: `[Reminder: ${timingLabel}] ${row.project_name}`,
        clientEmail: engineer.email,
        clientFirstName: engineer.first_name,
        rescheduleUrl: '',
        sessionStartIso: row.start_time,
        sessionEndIso: row.end_time
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'booking_reminder_engineer_email_failed',
        reminder_id: payload.reminderId,
        booking_id: payload.bookingId,
        engineer_id: engineer.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  // Mark reminder as sent
  await pool.query(
    'UPDATE scheduled_reminders SET sent_at = NOW() WHERE id = $1',
    [payload.reminderId]
  );

  console.log(JSON.stringify({
    level: 'info',
    event: 'booking_reminder_sent',
    reminder_id: payload.reminderId,
    booking_id: payload.bookingId,
    type: payload.type,
    recipients: 1 + engineersResult.rows.length,
    job_id: job.id
  }));
}

export function registerBookingReminderQueueHandlers(): void {
  jobQueue.registerHandler<BookingReminderJobPayload>(
    BOOKING_REMINDER_JOB_TYPE,
    processBookingReminderJob
  );
}

/**
 * Schedule 24h and 1h reminder jobs for a booking.
 * Persists to the scheduled_reminders table and enqueues in-memory jobs.
 * Handles edge cases: if session is <24h away, skip the 24h reminder;
 * if <1h away, skip both.
 */
export async function scheduleBookingReminders(args: {
  client: PoolClient;
  tenantId: number;
  bookingId: number;
  sessionStartIso: string;
}): Promise<void> {
  const sessionStartMs = new Date(args.sessionStartIso).getTime();
  const nowMs = Date.now();

  const reminders: Array<{ type: '24h' | '1h'; scheduledForMs: number }> = [];

  const reminder24hMs = sessionStartMs - TWENTY_FOUR_HOURS_MS;
  if (reminder24hMs > nowMs) {
    reminders.push({ type: '24h', scheduledForMs: reminder24hMs });
  }

  const reminder1hMs = sessionStartMs - ONE_HOUR_MS;
  if (reminder1hMs > nowMs) {
    reminders.push({ type: '1h', scheduledForMs: reminder1hMs });
  } else if (sessionStartMs > nowMs) {
    // Session is less than 1h away but hasn't started — send immediately
    reminders.push({ type: '1h', scheduledForMs: nowMs });
  }

  for (const reminder of reminders) {
    const insertResult = await args.client.query<{ id: number }>(
      `
      INSERT INTO scheduled_reminders (tenant_id, booking_id, type, scheduled_for)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [args.tenantId, args.bookingId, reminder.type, new Date(reminder.scheduledForMs).toISOString()]
    );

    const reminderId = insertResult.rows[0]?.id;
    if (reminderId) {
      jobQueue.enqueue<BookingReminderJobPayload>(
        BOOKING_REMINDER_JOB_TYPE,
        {
          reminderId,
          bookingId: args.bookingId,
          tenantId: args.tenantId,
          type: reminder.type
        },
        reminder.scheduledForMs
      );
    }
  }
}

/**
 * Cancel all pending reminders for a booking.
 */
export async function cancelBookingReminders(args: {
  client: PoolClient;
  bookingId: number;
}): Promise<void> {
  await args.client.query(
    `
    UPDATE scheduled_reminders
    SET cancelled_at = NOW()
    WHERE booking_id = $1
      AND sent_at IS NULL
      AND cancelled_at IS NULL
    `,
    [args.bookingId]
  );
}

/**
 * Recover pending reminders from the database on server startup.
 * Re-enqueues in-memory jobs for any unsent, uncancelled reminders.
 */
export async function recoverPendingReminders(): Promise<void> {
  const result = await pool.query<{
    id: number;
    booking_id: number;
    tenant_id: number;
    type: '24h' | '1h';
    scheduled_for: string;
  }>(
    `
    SELECT id, booking_id, tenant_id, type, scheduled_for
    FROM scheduled_reminders
    WHERE sent_at IS NULL
      AND cancelled_at IS NULL
      AND scheduled_for > NOW() - INTERVAL '5 minutes'
    ORDER BY scheduled_for ASC
    `
  );

  const nowMs = Date.now();
  let recovered = 0;

  for (const row of result.rows) {
    const scheduledForMs = new Date(row.scheduled_for).getTime();
    const runAtMs = scheduledForMs > nowMs ? scheduledForMs : nowMs;

    jobQueue.enqueue<BookingReminderJobPayload>(
      BOOKING_REMINDER_JOB_TYPE,
      {
        reminderId: row.id,
        bookingId: row.booking_id,
        tenantId: row.tenant_id,
        type: row.type
      },
      runAtMs
    );
    recovered += 1;
  }

  if (recovered > 0) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'booking_reminders_recovered',
      count: recovered
    }));
  }
}
