import { Router } from 'express';

import {
  bookingTokenParamsSchema,
  bookSlotSchema,
  joinWaitlistSchema,
  rescheduleBookingSchema,
  shareTokenParamsSchema,
  type Booking,
  type BookingLookupResponse,
  type BookingResponse,
  type CancelBookingResponse,
  type CurrentBookingSlotInfo,
  type EngineerSummary,
  type PublicProjectInfo,
  type PublicProjectResponse,
  type PublicSlotInfo,
  type PublicWaitlistSlotInfo,
  type WaitlistEntry,
  type WaitlistJoinResponse,
  type RescheduleResponse
} from '@opencalendar/shared';
import type { PoolClient } from 'pg';

import { pool } from '../db/pool.js';
import { enqueueBookingEmailJob } from '../jobs/emailNotifications.js';
import { cancelBookingReminders, scheduleBookingReminders } from '../jobs/bookingReminders.js';
import { enqueueMicrosoftCalendarSyncJob } from '../jobs/microsoftCalendar.js';
import {
  buildBookingPasswordAbuseKey,
  checkBookingPasswordLockout,
  clearBookingPasswordAbuseState,
  registerFailedBookingPasswordAttempt
} from '../middleware/abuseProtection.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  buildBookingIdempotencyFingerprint,
  parseIdempotencyKey
} from '../middleware/idempotency.js';
import { publicReadRateLimiter, publicWriteRateLimiter } from '../middleware/rateLimit.js';
import { recordAbuseEventMetric } from '../observability/metrics.js';
import { verifyPassword } from '../utils/auth.js';
import { isEmailAllowedForProjectDomain } from '../utils/emailDomain.js';
import { createCalendarEvent } from '../utils/ics.js';

const router = Router();

type ProjectAuthRow = PublicProjectInfo & {
  tenant_id: number;
  signup_password_hash: string;
};

type PublicProjectTenantRow = PublicProjectInfo & {
  tenant_id: number;
};

type AvailableSlotRow = {
  time_block_id: number;
  start_time: string;
  end_time: string;
  remaining_slots: number;
};

type FullSlotRow = {
  time_block_id: number;
  start_time: string;
  end_time: string;
  remaining_slots: number;
  waitlist_count: number;
};

type SlotEngineerRow = {
  time_block_id: number;
  first_name: string;
  last_name: string;
};

type LockedTimeBlockRow = {
  id: number;
  start_time: string;
  end_time: string;
  max_signups: number;
};

type ActiveBookingCountRow = {
  active_booking_count: number;
};

type BookingIdempotencyRow = {
  request_fingerprint: string;
  status: 'processing' | 'completed';
  response_status_code: number | null;
  response_json: BookingResponse | null;
};

type BookingInsertRow = Booking;

type BookingLookupRow = Booking & {
  tenant_id: number;
  tenant_uid: string;
  project_id: number;
  project_name: string;
  project_description: string;
  booking_email_domain_allowlist: string | null;
  session_length_minutes: number;
  is_group_signup: boolean;
  share_token: string;
  current_start_time: string;
  current_end_time: string;
};

type LockedBookingRow = Booking & {
  tenant_id: number;
  project_id: number;
  project_name: string;
  project_description: string;
  share_token: string;
  current_start_time: string;
  current_end_time: string;
};

type LockedCancelBookingRow = Booking & {
  tenant_id: number;
  project_name: string;
  project_description: string;
  start_time: string;
  end_time: string;
};

type CalendarBookingRow = Booking & {
  tenant_id: number;
  project_name: string;
  project_description: string;
  share_token: string;
  start_time: string;
  end_time: string;
};

type WaitlistEntryRow = WaitlistEntry & {
  tenant_id: number;
};

type WaitlistNotifyCandidateRow = {
  id: number;
  tenant_id: number;
  project_name: string;
  share_token: string;
  client_first_name: string;
  client_email: string;
  start_time: string;
  end_time: string;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const bookingIdempotencyTtlHours = parsePositiveInt(process.env.BOOKING_IDEMPOTENCY_TTL_HOURS, 24);
const bookingPortalBaseUrl = (process.env.BOOKING_PORTAL_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

function buildBookingManageUrl(shareToken: string, bookingToken: string): string {
  return `${bookingPortalBaseUrl}/schedule/${shareToken}/reschedule/${bookingToken}`;
}

function buildProjectBookingUrl(shareToken: string): string {
  return `${bookingPortalBaseUrl}/schedule/${shareToken}`;
}

function enqueueBookingEmailSafely(args: Parameters<typeof enqueueBookingEmailJob>[0]): void {
  try {
    enqueueBookingEmailJob(args);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'booking_email_job_enqueue_failed',
      error: error instanceof Error ? error.message : 'Unknown queue enqueue error',
      booking_event: args.event,
      booking_token: args.bookingToken
    }));
  }
}

async function markWaitlistEntryAsBooked(args: {
  client: PoolClient;
  tenantId: number;
  timeBlockId: number;
  clientEmail: string;
}): Promise<void> {
  await args.client.query(
    `
    UPDATE waitlist_entries
    SET status = 'booked',
        updated_at = NOW()
    WHERE tenant_id = $1
      AND time_block_id = $2
      AND lower(client_email) = lower($3)
      AND status IN ('active', 'notified')
    `,
    [args.tenantId, args.timeBlockId, args.clientEmail]
  );
}

async function markWaitlistEntryAsRemoved(args: {
  client: PoolClient;
  tenantId: number;
  timeBlockId: number;
  clientEmail: string;
}): Promise<void> {
  await args.client.query(
    `
    UPDATE waitlist_entries
    SET status = 'removed',
        updated_at = NOW()
    WHERE tenant_id = $1
      AND time_block_id = $2
      AND lower(client_email) = lower($3)
      AND status IN ('active', 'notified')
    `,
    [args.tenantId, args.timeBlockId, args.clientEmail]
  );
}

async function claimWaitlistNotificationCandidate(args: {
  client: PoolClient;
  tenantId: number;
  timeBlockId: number;
}): Promise<WaitlistNotifyCandidateRow | null> {
  const candidateResult = await args.client.query<WaitlistNotifyCandidateRow>(
    `
    SELECT
      wl.id,
      wl.tenant_id,
      wl.client_first_name,
      wl.client_email,
      p.name AS project_name,
      p.share_token,
      tb.start_time,
      tb.end_time
    FROM waitlist_entries wl
    INNER JOIN projects p ON p.id = wl.project_id
    INNER JOIN time_blocks tb ON tb.id = wl.time_block_id
    WHERE wl.tenant_id = $1
      AND wl.time_block_id = $2
      AND wl.status = 'active'
      AND tb.start_time > NOW()
    ORDER BY wl.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
    `,
    [args.tenantId, args.timeBlockId]
  );

  const candidate = candidateResult.rows[0];
  if (!candidate) {
    return null;
  }

  await args.client.query(
    `
    UPDATE waitlist_entries
    SET status = 'notified',
        notified_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
      AND tenant_id = $2
    `,
    [candidate.id, args.tenantId]
  );

  return candidate;
}

function enqueueMicrosoftCalendarSyncSafely(args: Parameters<typeof enqueueMicrosoftCalendarSyncJob>[0]): void {
  try {
    enqueueMicrosoftCalendarSyncJob(args);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'microsoft_calendar_sync_job_enqueue_failed',
      error: error instanceof Error ? error.message : 'Unknown queue enqueue error',
      booking_event: args.event,
      booking_id: args.bookingId,
      booking_token: args.bookingToken
    }));
  }
}

router.get('/project/:shareToken', publicReadRateLimiter, asyncHandler(async (req, res) => {
  const paramsParse = shareTokenParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid share token', details: paramsParse.error.flatten() });
    return;
  }

  const { shareToken } = paramsParse.data;

  const projectResult = await pool.query<PublicProjectTenantRow>(
    `
    SELECT p.id, p.tenant_id, t.tenant_uid, p.name, p.description, p.session_length_minutes,
           p.is_group_signup, p.share_token, p.booking_email_domain_allowlist
    FROM projects p
    INNER JOIN tenants t ON t.id = p.tenant_id
    WHERE p.share_token = $1
      AND p.is_active = true
    `,
    [shareToken]
  );

  const project = projectResult.rows[0];
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const slotsResult = await pool.query<AvailableSlotRow>(
    `
    SELECT av.time_block_id, av.start_time, av.end_time, av.remaining_slots
    FROM available_slots av
    WHERE av.project_id = $1
      AND av.tenant_id = $2
      AND av.start_time > NOW()
    ORDER BY av.start_time ASC
    `,
    [project.id, project.tenant_id]
  );

  const fullSlotsResult = await pool.query<FullSlotRow>(
    `
    SELECT
      tb.id AS time_block_id,
      tb.start_time,
      tb.end_time,
      GREATEST(tb.max_signups - COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL), 0)::int AS remaining_slots,
      COUNT(wl.id) FILTER (WHERE wl.status IN ('active', 'notified'))::int AS waitlist_count
    FROM time_blocks tb
    LEFT JOIN bookings b
      ON b.time_block_id = tb.id
      AND b.tenant_id = tb.tenant_id
    LEFT JOIN waitlist_entries wl
      ON wl.time_block_id = tb.id
      AND wl.tenant_id = tb.tenant_id
    WHERE tb.project_id = $1
      AND tb.tenant_id = $2
      AND tb.start_time > NOW()
    GROUP BY tb.id
    HAVING tb.max_signups - COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL) <= 0
    ORDER BY tb.start_time ASC
    `,
    [project.id, project.tenant_id]
  );

  const slotIds = [
    ...slotsResult.rows.map((slot) => slot.time_block_id),
    ...fullSlotsResult.rows.map((slot) => slot.time_block_id)
  ];
  const uniqueSlotIds = Array.from(new Set(slotIds));

  const engineersByBlock = new Map<number, PublicSlotInfo['engineers']>();

  if (uniqueSlotIds.length > 0) {
    const engineersResult = await pool.query<SlotEngineerRow>(
      `
      SELECT tbe.time_block_id, u.first_name, u.last_name
      FROM time_block_engineers tbe
      INNER JOIN users u ON u.id = tbe.engineer_id
      WHERE tbe.time_block_id = ANY($1::int[])
        AND u.tenant_id = $2
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [uniqueSlotIds, project.tenant_id]
    );

    for (const row of engineersResult.rows) {
      const existing = engineersByBlock.get(row.time_block_id) ?? [];
      existing.push({
        first_name: row.first_name,
        last_name: row.last_name
      });
      engineersByBlock.set(row.time_block_id, existing);
    }
  }

  const availableSlots: PublicSlotInfo[] = slotsResult.rows.map((slot) => ({
    time_block_id: slot.time_block_id,
    start_time: slot.start_time,
    end_time: slot.end_time,
    remaining_slots: slot.remaining_slots,
    engineers: engineersByBlock.get(slot.time_block_id) ?? []
  }));

  const fullSlots: PublicWaitlistSlotInfo[] = fullSlotsResult.rows.map((slot) => ({
    time_block_id: slot.time_block_id,
    start_time: slot.start_time,
    end_time: slot.end_time,
    remaining_slots: slot.remaining_slots,
    waitlist_count: slot.waitlist_count,
    engineers: engineersByBlock.get(slot.time_block_id) ?? []
  }));

  const response: PublicProjectResponse = {
    project,
    available_slots: availableSlots,
    full_slots: fullSlots
  };

  res.json(response);
}));

router.post('/book/:shareToken', publicWriteRateLimiter, asyncHandler(async (req, res) => {
  const paramsParse = shareTokenParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid share token', details: paramsParse.error.flatten() });
    return;
  }

  const bodyParse = bookSlotSchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Validation failed', details: bodyParse.error.flatten() });
    return;
  }

  const { shareToken } = paramsParse.data;
  const data = bodyParse.data;
  const parsedIdempotencyKey = parseIdempotencyKey(req.header('idempotency-key'));
  if (!parsedIdempotencyKey.ok) {
    res.status(400).json({
      error: 'Invalid Idempotency-Key header',
      details: parsedIdempotencyKey.error
    });
    return;
  }

  const idempotencyKey = parsedIdempotencyKey.key;
  const idempotencyFingerprint = idempotencyKey
    ? buildBookingIdempotencyFingerprint({
      shareToken,
      password: data.password,
      timeBlockId: data.time_block_id,
      firstName: data.first_name,
      lastName: data.last_name,
      email: data.email,
      phone: data.phone
    })
    : null;
  const abuseKey = buildBookingPasswordAbuseKey(shareToken, req.ip);

  const currentLockout = checkBookingPasswordLockout(abuseKey);
  if (currentLockout.locked) {
    recordAbuseEventMetric('project_password_lockout_blocked');
    res.setHeader('Retry-After', String(currentLockout.retryAfterSeconds));
    res.status(429).json({
      error: 'Too many failed password attempts',
      details: `Please wait ${currentLockout.retryAfterSeconds} second(s) and try again.`,
      captcha_required: currentLockout.captchaRequired
    });
    return;
  }

  const projectResult = await pool.query<ProjectAuthRow>(
    `
    SELECT
      p.id,
      p.tenant_id,
      t.tenant_uid,
      p.name,
      p.description,
      p.booking_email_domain_allowlist,
      p.session_length_minutes,
      p.is_group_signup,
      p.share_token,
      p.signup_password_hash
    FROM projects p
    INNER JOIN tenants t ON t.id = p.tenant_id
    WHERE p.share_token = $1
      AND p.is_active = true
    `,
    [shareToken]
  );

  const project = projectResult.rows[0];
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const passwordMatches = await verifyPassword(data.password, project.signup_password_hash);
  if (!passwordMatches) {
    recordAbuseEventMetric('project_password_failed_attempt');
    const updatedLockout = registerFailedBookingPasswordAttempt(abuseKey);

    if (updatedLockout.locked) {
      recordAbuseEventMetric('project_password_lockout_applied');
      res.setHeader('Retry-After', String(updatedLockout.retryAfterSeconds));
      res.status(429).json({
        error: 'Too many failed password attempts',
        details: `Please wait ${updatedLockout.retryAfterSeconds} second(s) and try again.`,
        captcha_required: updatedLockout.captchaRequired
      });
      return;
    }

    res.status(401).json({ error: 'Incorrect project password' });
    return;
  }

  if (!isEmailAllowedForProjectDomain(data.email, project.booking_email_domain_allowlist)) {
    res.status(400).json({
      error: 'Email domain is not allowed for this project',
      details: {
        booking_email_domain_allowlist: project.booking_email_domain_allowlist
      }
    });
    return;
  }

  clearBookingPasswordAbuseState(abuseKey);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (idempotencyKey && idempotencyFingerprint) {
      await client.query(
        `
        INSERT INTO booking_idempotency_keys (
          tenant_id,
          share_token,
          idempotency_key,
          request_fingerprint,
          status,
          expires_at
        )
        VALUES ($1, $2, $3, $4, 'processing', NOW() + ($5::int * INTERVAL '1 hour'))
        ON CONFLICT (tenant_id, share_token, idempotency_key) DO UPDATE
        SET
          request_fingerprint = EXCLUDED.request_fingerprint,
          status = 'processing',
          response_status_code = NULL,
          response_json = NULL,
          booking_id = NULL,
          updated_at = NOW(),
          expires_at = EXCLUDED.expires_at
        WHERE booking_idempotency_keys.expires_at <= NOW()
        `,
        [project.tenant_id, shareToken, idempotencyKey, idempotencyFingerprint, bookingIdempotencyTtlHours]
      );

      const idempotencyResult = await client.query<BookingIdempotencyRow>(
        `
        SELECT request_fingerprint, status, response_status_code, response_json
        FROM booking_idempotency_keys
        WHERE tenant_id = $1
          AND share_token = $2
          AND idempotency_key = $3
        FOR UPDATE
        `,
        [project.tenant_id, shareToken, idempotencyKey]
      );

      const idempotencyRecord = idempotencyResult.rows[0];
      if (!idempotencyRecord) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Unable to process idempotent booking request' });
        return;
      }

      if (idempotencyRecord.request_fingerprint !== idempotencyFingerprint) {
        await client.query('ROLLBACK');
        res.status(409).json({
          error: 'Idempotency key reuse with different request payload is not allowed'
        });
        return;
      }

      if (idempotencyRecord.status === 'completed' && idempotencyRecord.response_json) {
        await client.query('COMMIT');
        res.setHeader('Idempotency-Replayed', 'true');
        res.status(idempotencyRecord.response_status_code ?? 201).json(idempotencyRecord.response_json);
        return;
      }
    }

    const blockResult = await client.query<LockedTimeBlockRow>(
      `
      SELECT id, start_time, end_time, max_signups
      FROM time_blocks
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
        AND start_time > NOW()
      FOR UPDATE
      `,
      [data.time_block_id, project.id, project.tenant_id]
    );

    const timeBlock = blockResult.rows[0];
    if (!timeBlock) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Time block not found or no longer available' });
      return;
    }

    const bookingCountResult = await client.query<ActiveBookingCountRow>(
      `
      SELECT COUNT(*)::int AS active_booking_count
      FROM bookings
      WHERE time_block_id = $1
        AND tenant_id = $2
        AND cancelled_at IS NULL
      `,
      [timeBlock.id, project.tenant_id]
    );

    const activeBookingCount = bookingCountResult.rows[0]?.active_booking_count ?? 0;
    if (activeBookingCount >= timeBlock.max_signups) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Time block is full' });
      return;
    }

    const bookingInsertResult = await client.query<BookingInsertRow>(
      `
      INSERT INTO bookings (
        tenant_id,
        time_block_id,
        client_first_name,
        client_last_name,
        client_email,
        client_phone
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, time_block_id, client_first_name, client_last_name,
                client_email, client_phone, booking_token, booked_at, cancelled_at, session_notes
      `,
      [
        project.tenant_id,
        timeBlock.id,
        data.first_name,
        data.last_name,
        data.email,
        data.phone
      ]
    );

    const booking = bookingInsertResult.rows[0];
    if (!booking) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Unable to create booking' });
      return;
    }

    await markWaitlistEntryAsBooked({
      client,
      tenantId: project.tenant_id,
      timeBlockId: timeBlock.id,
      clientEmail: booking.client_email
    });

    const engineersResult = await client.query<EngineerSummary>(
      `
      SELECT u.id, u.first_name, u.last_name, u.email
      FROM time_block_engineers tbe
      INNER JOIN users u ON u.id = tbe.engineer_id
      WHERE tbe.time_block_id = $1
        AND u.tenant_id = $2
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [timeBlock.id, project.tenant_id]
    );

    const engineerNames = engineersResult.rows
      .map((engineer) => `${engineer.first_name} ${engineer.last_name}`)
      .join(', ');
    const bookingManageUrl = buildBookingManageUrl(project.share_token, booking.booking_token);

    const clientCalendar = createCalendarEvent({
      title: `${project.name} Session`,
      description: [
        project.description,
        engineerNames ? `Engineers: ${engineerNames}` : '',
        `Manage booking (reschedule/cancel): ${bookingManageUrl}`
      ]
        .filter(Boolean)
        .join('\n\n'),
      startIso: timeBlock.start_time,
      endIso: timeBlock.end_time,
      url: bookingManageUrl
    });

    const engineerCalendars = engineersResult.rows.map((engineer) => ({
      engineer,
      ics: createCalendarEvent({
        title: `${project.name} Session`,
        description: [
          project.description,
          `Client: ${booking.client_first_name} ${booking.client_last_name}`,
          `Email: ${booking.client_email}`,
          `Phone: ${booking.client_phone}`
        ]
          .filter(Boolean)
          .join('\n\n'),
        startIso: timeBlock.start_time,
        endIso: timeBlock.end_time,
        organizer: engineer.email
      })
    }));

    const response: BookingResponse = {
      booking,
      client_calendar: clientCalendar,
      engineer_calendars: engineerCalendars,
      reschedule_url: `/schedule/${project.share_token}/reschedule/${booking.booking_token}`
    };

    if (idempotencyKey) {
      await client.query(
        `
        UPDATE booking_idempotency_keys
        SET
          status = 'completed',
          response_status_code = $3,
          response_json = $4::jsonb,
          booking_id = $5,
          updated_at = NOW()
        WHERE share_token = $1
          AND idempotency_key = $2
          AND tenant_id = $6
        `,
        [shareToken, idempotencyKey, 201, JSON.stringify(response), booking.id, project.tenant_id]
      );
    }

    await scheduleBookingReminders({
      client,
      tenantId: project.tenant_id,
      bookingId: booking.id,
      sessionStartIso: timeBlock.start_time
    });

    await client.query('COMMIT');

    enqueueBookingEmailSafely({
      event: 'booked',
      bookingToken: booking.booking_token,
      projectName: project.name,
      clientEmail: booking.client_email,
      clientFirstName: booking.client_first_name,
      rescheduleUrl: response.reschedule_url,
      sessionStartIso: timeBlock.start_time,
      sessionEndIso: timeBlock.end_time
    });
    enqueueMicrosoftCalendarSyncSafely({
      tenantId: project.tenant_id,
      event: 'booked',
      bookingId: booking.id,
      bookingToken: booking.booking_token,
      projectName: project.name,
      projectDescription: project.description,
      clientFirstName: booking.client_first_name,
      clientLastName: booking.client_last_name,
      clientEmail: booking.client_email,
      clientPhone: booking.client_phone,
      sessionStartIso: timeBlock.start_time,
      sessionEndIso: timeBlock.end_time,
      engineerIds: engineersResult.rows.map((engineer) => engineer.id)
    });

    res.status(201).json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to complete booking' });
  } finally {
    client.release();
  }
}));

router.post('/waitlist/:shareToken', publicWriteRateLimiter, asyncHandler(async (req, res) => {
  const paramsParse = shareTokenParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid share token', details: paramsParse.error.flatten() });
    return;
  }

  const bodyParse = joinWaitlistSchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Validation failed', details: bodyParse.error.flatten() });
    return;
  }

  const { shareToken } = paramsParse.data;
  const data = bodyParse.data;
  const abuseKey = buildBookingPasswordAbuseKey(shareToken, req.ip);

  const currentLockout = checkBookingPasswordLockout(abuseKey);
  if (currentLockout.locked) {
    recordAbuseEventMetric('project_password_lockout_blocked');
    res.setHeader('Retry-After', String(currentLockout.retryAfterSeconds));
    res.status(429).json({
      error: 'Too many failed password attempts',
      details: `Please wait ${currentLockout.retryAfterSeconds} second(s) and try again.`,
      captcha_required: currentLockout.captchaRequired
    });
    return;
  }

  const projectResult = await pool.query<ProjectAuthRow>(
    `
    SELECT
      p.id,
      p.tenant_id,
      t.tenant_uid,
      p.name,
      p.description,
      p.booking_email_domain_allowlist,
      p.session_length_minutes,
      p.is_group_signup,
      p.share_token,
      p.signup_password_hash
    FROM projects p
    INNER JOIN tenants t ON t.id = p.tenant_id
    WHERE p.share_token = $1
      AND p.is_active = true
    `,
    [shareToken]
  );

  const project = projectResult.rows[0];
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const passwordMatches = await verifyPassword(data.password, project.signup_password_hash);
  if (!passwordMatches) {
    recordAbuseEventMetric('project_password_failed_attempt');
    const updatedLockout = registerFailedBookingPasswordAttempt(abuseKey);

    if (updatedLockout.locked) {
      recordAbuseEventMetric('project_password_lockout_applied');
      res.setHeader('Retry-After', String(updatedLockout.retryAfterSeconds));
      res.status(429).json({
        error: 'Too many failed password attempts',
        details: `Please wait ${updatedLockout.retryAfterSeconds} second(s) and try again.`,
        captcha_required: updatedLockout.captchaRequired
      });
      return;
    }

    res.status(401).json({ error: 'Incorrect project password' });
    return;
  }

  if (!isEmailAllowedForProjectDomain(data.email, project.booking_email_domain_allowlist)) {
    res.status(400).json({
      error: 'Email domain is not allowed for this project',
      details: {
        booking_email_domain_allowlist: project.booking_email_domain_allowlist
      }
    });
    return;
  }

  clearBookingPasswordAbuseState(abuseKey);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const blockResult = await client.query<LockedTimeBlockRow>(
      `
      SELECT id, start_time, end_time, max_signups
      FROM time_blocks
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
        AND start_time > NOW()
      FOR UPDATE
      `,
      [data.time_block_id, project.id, project.tenant_id]
    );

    const timeBlock = blockResult.rows[0];
    if (!timeBlock) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Time block not found or no longer available' });
      return;
    }

    const bookingCountResult = await client.query<ActiveBookingCountRow>(
      `
      SELECT COUNT(*)::int AS active_booking_count
      FROM bookings
      WHERE time_block_id = $1
        AND tenant_id = $2
        AND cancelled_at IS NULL
      `,
      [timeBlock.id, project.tenant_id]
    );

    const activeBookingCount = bookingCountResult.rows[0]?.active_booking_count ?? 0;
    if (activeBookingCount < timeBlock.max_signups) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Time block has availability. Book directly instead.' });
      return;
    }

    const existingResult = await client.query<WaitlistEntryRow>(
      `
      SELECT
        id,
        tenant_id,
        time_block_id,
        client_first_name,
        client_last_name,
        client_email,
        client_phone,
        status,
        notified_at,
        created_at
      FROM waitlist_entries
      WHERE tenant_id = $1
        AND time_block_id = $2
        AND lower(client_email) = lower($3)
        AND status IN ('active', 'notified')
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE
      `,
      [project.tenant_id, timeBlock.id, data.email]
    );

    const existing = existingResult.rows[0];
    if (existing) {
      await client.query('COMMIT');
      const response: WaitlistJoinResponse = {
        waitlist_entry: existing,
        message: 'You are already on the waitlist for this slot.',
        already_exists: true
      };
      res.json(response);
      return;
    }

    const insertResult = await client.query<WaitlistEntryRow>(
      `
      INSERT INTO waitlist_entries (
        tenant_id,
        project_id,
        time_block_id,
        client_first_name,
        client_last_name,
        client_email,
        client_phone,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
      RETURNING
        id,
        tenant_id,
        time_block_id,
        client_first_name,
        client_last_name,
        client_email,
        client_phone,
        status,
        notified_at,
        created_at
      `,
      [
        project.tenant_id,
        project.id,
        timeBlock.id,
        data.first_name,
        data.last_name,
        data.email,
        data.phone
      ]
    );

    const waitlistEntry = insertResult.rows[0];
    if (!waitlistEntry) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Unable to join waitlist' });
      return;
    }

    await client.query('COMMIT');

    enqueueBookingEmailSafely({
      event: 'waitlisted',
      bookingToken: `waitlist-${waitlistEntry.id}`,
      projectName: project.name,
      clientEmail: waitlistEntry.client_email,
      clientFirstName: waitlistEntry.client_first_name,
      sessionStartIso: timeBlock.start_time,
      sessionEndIso: timeBlock.end_time
    });

    const response: WaitlistJoinResponse = {
      waitlist_entry: waitlistEntry,
      message: 'You have been added to the waitlist.',
      already_exists: false
    };

    res.status(201).json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to join waitlist' });
  } finally {
    client.release();
  }
}));

router.get('/booking/:bookingToken', publicReadRateLimiter, asyncHandler(async (req, res) => {
  const paramsParse = bookingTokenParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid booking token', details: paramsParse.error.flatten() });
    return;
  }

  const { bookingToken } = paramsParse.data;

  const bookingResult = await pool.query<BookingLookupRow>(
    `
    SELECT
      b.id,
      b.tenant_id,
      t.tenant_uid,
      b.time_block_id,
      b.client_first_name,
      b.client_last_name,
      b.client_email,
      b.client_phone,
      b.booking_token,
      b.booked_at,
      b.cancelled_at,
      b.session_notes,
      p.id AS project_id,
      p.name AS project_name,
      p.description AS project_description,
      p.booking_email_domain_allowlist,
      p.session_length_minutes,
      p.is_group_signup,
      p.share_token,
      tb.start_time AS current_start_time,
      tb.end_time AS current_end_time
    FROM bookings b
    INNER JOIN time_blocks tb ON tb.id = b.time_block_id
    INNER JOIN projects p ON p.id = tb.project_id
    INNER JOIN tenants t ON t.id = b.tenant_id
    WHERE b.booking_token = $1
      AND b.cancelled_at IS NULL
      AND b.tenant_id = p.tenant_id
    LIMIT 1
    `,
    [bookingToken]
  );

  const bookingRow = bookingResult.rows[0];
  if (!bookingRow) {
    res.status(404).json({ error: 'Booking not found or already cancelled' });
    return;
  }

  const slotsResult = await pool.query<AvailableSlotRow>(
    `
    SELECT av.time_block_id, av.start_time, av.end_time, av.remaining_slots
    FROM available_slots av
    WHERE av.project_id = $1
      AND av.tenant_id = $2
      AND av.start_time > NOW()
      AND av.time_block_id <> $3
    ORDER BY av.start_time ASC
    `,
    [bookingRow.project_id, bookingRow.tenant_id, bookingRow.time_block_id]
  );

  const slotIds = [
    bookingRow.time_block_id,
    ...slotsResult.rows.map((slot) => slot.time_block_id)
  ];

  const uniqueSlotIds = Array.from(new Set(slotIds));
  const engineersByBlock = new Map<number, PublicSlotInfo['engineers']>();

  if (uniqueSlotIds.length > 0) {
    const engineersResult = await pool.query<SlotEngineerRow>(
      `
      SELECT tbe.time_block_id, u.first_name, u.last_name
      FROM time_block_engineers tbe
      INNER JOIN users u ON u.id = tbe.engineer_id
      WHERE tbe.time_block_id = ANY($1::int[])
        AND u.tenant_id = $2
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [uniqueSlotIds, bookingRow.tenant_id]
    );

    for (const row of engineersResult.rows) {
      const existing = engineersByBlock.get(row.time_block_id) ?? [];
      existing.push({
        first_name: row.first_name,
        last_name: row.last_name
      });
      engineersByBlock.set(row.time_block_id, existing);
    }
  }

  const project: PublicProjectInfo = {
    id: bookingRow.project_id,
    name: bookingRow.project_name,
    description: bookingRow.project_description,
    booking_email_domain_allowlist: bookingRow.booking_email_domain_allowlist,
    session_length_minutes: bookingRow.session_length_minutes,
    is_group_signup: bookingRow.is_group_signup,
    share_token: bookingRow.share_token,
    tenant_uid: bookingRow.tenant_uid
  };

  const booking: Booking = {
    id: bookingRow.id,
    time_block_id: bookingRow.time_block_id,
    client_first_name: bookingRow.client_first_name,
    client_last_name: bookingRow.client_last_name,
    client_email: bookingRow.client_email,
    client_phone: bookingRow.client_phone,
    booking_token: bookingRow.booking_token,
    booked_at: bookingRow.booked_at,
    cancelled_at: bookingRow.cancelled_at,
    session_notes: bookingRow.session_notes ?? null
  };

  const currentSlot: CurrentBookingSlotInfo = {
    time_block_id: bookingRow.time_block_id,
    start_time: bookingRow.current_start_time,
    end_time: bookingRow.current_end_time,
    engineers: engineersByBlock.get(bookingRow.time_block_id) ?? []
  };

  const availableSlots: PublicSlotInfo[] = slotsResult.rows.map((slot) => ({
    time_block_id: slot.time_block_id,
    start_time: slot.start_time,
    end_time: slot.end_time,
    remaining_slots: slot.remaining_slots,
    engineers: engineersByBlock.get(slot.time_block_id) ?? []
  }));

  const response: BookingLookupResponse = {
    project,
    booking,
    current_slot: currentSlot,
    available_slots: availableSlots
  };

  res.json(response);
}));

router.post('/reschedule/:bookingToken', publicWriteRateLimiter, asyncHandler(async (req, res) => {
  const paramsParse = bookingTokenParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid booking token', details: paramsParse.error.flatten() });
    return;
  }

  const bodyParse = rescheduleBookingSchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Validation failed', details: bodyParse.error.flatten() });
    return;
  }

  const { bookingToken } = paramsParse.data;
  const data = bodyParse.data;
  const client = await pool.connect();
  let waitlistCandidate: WaitlistNotifyCandidateRow | null = null;

  try {
    await client.query('BEGIN');

    const bookingResult = await client.query<LockedBookingRow>(
      `
      SELECT
        b.id,
        b.tenant_id,
        b.time_block_id,
        b.client_first_name,
        b.client_last_name,
        b.client_email,
        b.client_phone,
        b.booking_token,
        b.booked_at,
        b.cancelled_at,
        b.session_notes,
        tb.project_id,
            p.name AS project_name,
            p.description AS project_description,
            p.share_token,
            tb.start_time AS current_start_time,
            tb.end_time AS current_end_time
      FROM bookings b
      INNER JOIN time_blocks tb ON tb.id = b.time_block_id
      INNER JOIN projects p ON p.id = tb.project_id
      WHERE b.booking_token = $1
        AND b.cancelled_at IS NULL
        AND b.tenant_id = p.tenant_id
      FOR UPDATE
      `,
      [bookingToken]
    );

    const currentBooking = bookingResult.rows[0];
    if (!currentBooking) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Booking not found or already cancelled' });
      return;
    }

    const previousEngineersResult = await client.query<EngineerSummary>(
      `
      SELECT u.id, u.first_name, u.last_name, u.email
      FROM time_block_engineers tbe
      INNER JOIN users u ON u.id = tbe.engineer_id
      WHERE tbe.time_block_id = $1
        AND u.tenant_id = $2
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [currentBooking.time_block_id, currentBooking.tenant_id]
    );

    if (currentBooking.time_block_id === data.new_time_block_id) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'New time block must be different from the current booking' });
      return;
    }

    await client.query(
      `
      UPDATE bookings
      SET cancelled_at = NOW()
      WHERE id = $1
        AND tenant_id = $2
      `,
      [currentBooking.id, currentBooking.tenant_id]
    );

    await markWaitlistEntryAsRemoved({
      client,
      tenantId: currentBooking.tenant_id,
      timeBlockId: currentBooking.time_block_id,
      clientEmail: currentBooking.client_email
    });

    const newBlockResult = await client.query<LockedTimeBlockRow>(
      `
      SELECT id, start_time, end_time, max_signups
      FROM time_blocks
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
        AND start_time > NOW()
      FOR UPDATE
      `,
      [data.new_time_block_id, currentBooking.project_id, currentBooking.tenant_id]
    );

    const newTimeBlock = newBlockResult.rows[0];
    if (!newTimeBlock) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'New time block not found or no longer available' });
      return;
    }

    const bookingCountResult = await client.query<ActiveBookingCountRow>(
      `
      SELECT COUNT(*)::int AS active_booking_count
      FROM bookings
      WHERE time_block_id = $1
        AND tenant_id = $2
        AND cancelled_at IS NULL
      `,
      [newTimeBlock.id, currentBooking.tenant_id]
    );

    const activeBookingCount = bookingCountResult.rows[0]?.active_booking_count ?? 0;
    if (activeBookingCount >= newTimeBlock.max_signups) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'New time block is full' });
      return;
    }

    const bookingInsertResult = await client.query<BookingInsertRow>(
      `
      INSERT INTO bookings (
        tenant_id,
        time_block_id,
        client_first_name,
        client_last_name,
        client_email,
        client_phone
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, time_block_id, client_first_name, client_last_name,
                client_email, client_phone, booking_token, booked_at, cancelled_at, session_notes
      `,
      [
        currentBooking.tenant_id,
        newTimeBlock.id,
        currentBooking.client_first_name,
        currentBooking.client_last_name,
        currentBooking.client_email,
        currentBooking.client_phone
      ]
    );

    const newBooking = bookingInsertResult.rows[0];
    if (!newBooking) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Unable to create rescheduled booking' });
      return;
    }

    await markWaitlistEntryAsBooked({
      client,
      tenantId: currentBooking.tenant_id,
      timeBlockId: newTimeBlock.id,
      clientEmail: newBooking.client_email
    });

    const engineersResult = await client.query<EngineerSummary>(
      `
      SELECT u.id, u.first_name, u.last_name, u.email
      FROM time_block_engineers tbe
      INNER JOIN users u ON u.id = tbe.engineer_id
      WHERE tbe.time_block_id = $1
        AND u.tenant_id = $2
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [newTimeBlock.id, currentBooking.tenant_id]
    );

    waitlistCandidate = await claimWaitlistNotificationCandidate({
      client,
      tenantId: currentBooking.tenant_id,
      timeBlockId: currentBooking.time_block_id
    });

    await cancelBookingReminders({ client, bookingId: currentBooking.id });
    await scheduleBookingReminders({
      client,
      tenantId: currentBooking.tenant_id,
      bookingId: newBooking.id,
      sessionStartIso: newTimeBlock.start_time
    });

    await client.query('COMMIT');

    const engineerNames = engineersResult.rows
      .map((engineer) => `${engineer.first_name} ${engineer.last_name}`)
      .join(', ');
    const bookingManageUrl = buildBookingManageUrl(currentBooking.share_token, newBooking.booking_token);

    const clientCalendar = createCalendarEvent({
      title: `${currentBooking.project_name} Session`,
      description: [
        currentBooking.project_description,
        engineerNames ? `Engineers: ${engineerNames}` : '',
        'Your session has been rescheduled.',
        `Manage booking (reschedule/cancel): ${bookingManageUrl}`
      ]
        .filter(Boolean)
        .join('\n\n'),
      startIso: newTimeBlock.start_time,
      endIso: newTimeBlock.end_time,
      url: bookingManageUrl
    });

    const response: RescheduleResponse = {
      booking: newBooking,
      client_calendar: clientCalendar,
      reschedule_url: `/schedule/${currentBooking.share_token}/reschedule/${newBooking.booking_token}`,
      message: 'Successfully rescheduled'
    };

    enqueueBookingEmailSafely({
      event: 'rescheduled',
      bookingToken: newBooking.booking_token,
      projectName: currentBooking.project_name,
      clientEmail: newBooking.client_email,
      clientFirstName: newBooking.client_first_name,
      rescheduleUrl: response.reschedule_url,
      sessionStartIso: newTimeBlock.start_time,
      sessionEndIso: newTimeBlock.end_time
    });
    enqueueMicrosoftCalendarSyncSafely({
      tenantId: currentBooking.tenant_id,
      event: 'cancelled',
      bookingId: currentBooking.id,
      bookingToken: currentBooking.booking_token,
      projectName: currentBooking.project_name,
      projectDescription: currentBooking.project_description,
      clientFirstName: currentBooking.client_first_name,
      clientLastName: currentBooking.client_last_name,
      clientEmail: currentBooking.client_email,
      clientPhone: currentBooking.client_phone,
      sessionStartIso: currentBooking.current_start_time,
      sessionEndIso: currentBooking.current_end_time,
      engineerIds: previousEngineersResult.rows.map((engineer) => engineer.id)
    });
    enqueueMicrosoftCalendarSyncSafely({
      tenantId: currentBooking.tenant_id,
      event: 'booked',
      bookingId: newBooking.id,
      bookingToken: newBooking.booking_token,
      projectName: currentBooking.project_name,
      projectDescription: currentBooking.project_description,
      clientFirstName: newBooking.client_first_name,
      clientLastName: newBooking.client_last_name,
      clientEmail: newBooking.client_email,
      clientPhone: newBooking.client_phone,
      sessionStartIso: newTimeBlock.start_time,
      sessionEndIso: newTimeBlock.end_time,
      engineerIds: engineersResult.rows.map((engineer) => engineer.id)
    });
    if (waitlistCandidate) {
      enqueueBookingEmailSafely({
        event: 'waitlist_opened',
        bookingToken: `waitlist-${waitlistCandidate.id}`,
        projectName: waitlistCandidate.project_name,
        clientEmail: waitlistCandidate.client_email,
        clientFirstName: waitlistCandidate.client_first_name,
        bookingUrl: buildProjectBookingUrl(waitlistCandidate.share_token),
        sessionStartIso: waitlistCandidate.start_time,
        sessionEndIso: waitlistCandidate.end_time
      });
    }

    res.json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to reschedule booking' });
  } finally {
    client.release();
  }
}));

router.post('/cancel/:bookingToken', publicWriteRateLimiter, asyncHandler(async (req, res) => {
  const paramsParse = bookingTokenParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid booking token', details: paramsParse.error.flatten() });
    return;
  }

  const { bookingToken } = paramsParse.data;
  const client = await pool.connect();
  let waitlistCandidate: WaitlistNotifyCandidateRow | null = null;

  try {
    await client.query('BEGIN');

    const bookingResult = await client.query<LockedCancelBookingRow>(
      `
      SELECT
             b.id,
             b.tenant_id,
             b.time_block_id,
             b.client_first_name,
             b.client_last_name,
             b.client_email,
             b.client_phone,
             b.booking_token,
             b.booked_at,
             b.cancelled_at,
             b.session_notes,
             p.name AS project_name,
             p.description AS project_description,
             tb.start_time,
             tb.end_time
      FROM bookings b
      INNER JOIN time_blocks tb ON tb.id = b.time_block_id
      INNER JOIN projects p ON p.id = tb.project_id
      WHERE b.booking_token = $1
        AND b.cancelled_at IS NULL
        AND b.tenant_id = p.tenant_id
      FOR UPDATE
      `,
      [bookingToken]
    );

    const booking = bookingResult.rows[0];
    if (!booking) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Booking not found or already cancelled' });
      return;
    }

    const engineersResult = await client.query<EngineerSummary>(
      `
      SELECT u.id, u.first_name, u.last_name, u.email
      FROM time_block_engineers tbe
      INNER JOIN users u ON u.id = tbe.engineer_id
      WHERE tbe.time_block_id = $1
        AND u.tenant_id = $2
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [booking.time_block_id, booking.tenant_id]
    );

    const cancelResult = await client.query<Booking>(
      `
      UPDATE bookings
      SET cancelled_at = NOW()
      WHERE id = $1
        AND tenant_id = $2
      RETURNING id, time_block_id, client_first_name, client_last_name,
                client_email, client_phone, booking_token, booked_at, cancelled_at, session_notes
      `,
      [booking.id, booking.tenant_id]
    );

    const cancelledBooking = cancelResult.rows[0];
    if (!cancelledBooking) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Unable to cancel booking' });
      return;
    }

    await markWaitlistEntryAsRemoved({
      client,
      tenantId: booking.tenant_id,
      timeBlockId: booking.time_block_id,
      clientEmail: cancelledBooking.client_email
    });

    waitlistCandidate = await claimWaitlistNotificationCandidate({
      client,
      tenantId: booking.tenant_id,
      timeBlockId: booking.time_block_id
    });

    await cancelBookingReminders({ client, bookingId: booking.id });

    await client.query('COMMIT');

    enqueueBookingEmailSafely({
      event: 'cancelled',
      bookingToken: cancelledBooking.booking_token,
      projectName: booking.project_name,
      clientEmail: cancelledBooking.client_email,
      clientFirstName: cancelledBooking.client_first_name
    });
    enqueueMicrosoftCalendarSyncSafely({
      tenantId: booking.tenant_id,
      event: 'cancelled',
      bookingId: cancelledBooking.id,
      bookingToken: cancelledBooking.booking_token,
      projectName: booking.project_name,
      projectDescription: booking.project_description,
      clientFirstName: cancelledBooking.client_first_name,
      clientLastName: cancelledBooking.client_last_name,
      clientEmail: cancelledBooking.client_email,
      clientPhone: cancelledBooking.client_phone,
      sessionStartIso: booking.start_time,
      sessionEndIso: booking.end_time,
      engineerIds: engineersResult.rows.map((engineer) => engineer.id)
    });
    if (waitlistCandidate) {
      enqueueBookingEmailSafely({
        event: 'waitlist_opened',
        bookingToken: `waitlist-${waitlistCandidate.id}`,
        projectName: waitlistCandidate.project_name,
        clientEmail: waitlistCandidate.client_email,
        clientFirstName: waitlistCandidate.client_first_name,
        bookingUrl: buildProjectBookingUrl(waitlistCandidate.share_token),
        sessionStartIso: waitlistCandidate.start_time,
        sessionEndIso: waitlistCandidate.end_time
      });
    }

    const response: CancelBookingResponse = {
      booking: cancelledBooking,
      message: 'Booking cancelled'
    };

    res.json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to cancel booking' });
  } finally {
    client.release();
  }
}));

router.get('/calendar/:bookingToken', publicReadRateLimiter, asyncHandler(async (req, res) => {
  const paramsParse = bookingTokenParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid booking token', details: paramsParse.error.flatten() });
    return;
  }

  const { bookingToken } = paramsParse.data;

  const bookingResult = await pool.query<CalendarBookingRow>(
    `
    SELECT
      b.id,
      b.tenant_id,
      b.time_block_id,
      b.client_first_name,
      b.client_last_name,
      b.client_email,
      b.client_phone,
      b.booking_token,
      b.booked_at,
      b.cancelled_at,
      b.session_notes,
      p.name AS project_name,
      p.description AS project_description,
      p.share_token,
      tb.start_time,
      tb.end_time
    FROM bookings b
    INNER JOIN time_blocks tb ON tb.id = b.time_block_id
    INNER JOIN projects p ON p.id = tb.project_id
    WHERE b.booking_token = $1
      AND b.cancelled_at IS NULL
      AND b.tenant_id = p.tenant_id
    LIMIT 1
    `,
    [bookingToken]
  );

  const booking = bookingResult.rows[0];
  if (!booking) {
    res.status(404).json({ error: 'Booking not found or already cancelled' });
    return;
  }

  const engineersResult = await pool.query<EngineerSummary>(
    `
    SELECT u.id, u.first_name, u.last_name, u.email
    FROM time_block_engineers tbe
    INNER JOIN users u ON u.id = tbe.engineer_id
    WHERE tbe.time_block_id = $1
      AND u.tenant_id = $2
    ORDER BY u.first_name ASC, u.last_name ASC
    `,
    [booking.time_block_id, booking.tenant_id]
  );

  const engineerNames = engineersResult.rows
    .map((engineer) => `${engineer.first_name} ${engineer.last_name}`)
    .join(', ');
  const bookingManageUrl = buildBookingManageUrl(booking.share_token, booking.booking_token);

  const calendarContent = createCalendarEvent({
    title: `${booking.project_name} Session`,
    description: [
      booking.project_description,
      engineerNames ? `Engineers: ${engineerNames}` : '',
      `Client: ${booking.client_first_name} ${booking.client_last_name}`,
      `Manage booking (reschedule/cancel): ${bookingManageUrl}`
    ]
      .filter(Boolean)
      .join('\n\n'),
    startIso: booking.start_time,
    endIso: booking.end_time,
    url: bookingManageUrl
  });

  const tokenPrefix = booking.booking_token.slice(0, 8);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="session-${tokenPrefix}.ics"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(calendarContent);
}));

export default router;
