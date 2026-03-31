import { pool } from '../db/pool.js';
import { recordQueueEventMetric } from '../observability/metrics.js';
import {
  buildMicrosoftCalendarEventPayload,
  createMicrosoftCalendarEvent,
  deleteMicrosoftCalendarEvent,
  getMicrosoftOAuthConfig,
  isMicrosoftOAuthConfigured,
  refreshMicrosoftAccessToken,
  updateMicrosoftCalendarEvent
} from '../utils/microsoftCalendar.js';
import { jobQueue, type JobRecord } from './queue.js';

export const MICROSOFT_CALENDAR_SYNC_JOB_TYPE = 'microsoft-calendar-sync';

export type MicrosoftCalendarSyncPayload = {
  tenantId: number;
  event: 'booked' | 'cancelled';
  bookingId: number;
  bookingToken: string;
  projectName: string;
  projectDescription: string;
  clientFirstName: string;
  clientLastName: string;
  clientEmail: string;
  clientPhone: string;
  sessionStartIso: string;
  sessionEndIso: string;
  engineerIds: number[];
};

type MicrosoftConnectionRow = {
  app_tenant_id: number;
  user_id: number;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
};

type MicrosoftEventMapRow = {
  microsoft_event_id: string;
};

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

function resolveMicrosoftCalendarSyncEnabled(): boolean {
  return parseBoolean(process.env.MICROSOFT_CALENDAR_SYNC_ENABLED, true);
}

async function getEngineerConnection(
  engineerId: number,
  tenantId: number
): Promise<MicrosoftConnectionRow | null> {
  const result = await pool.query<MicrosoftConnectionRow>(
    `
    SELECT app_tenant_id, user_id, access_token, refresh_token, access_token_expires_at
    FROM microsoft_calendar_connections
    WHERE user_id = $1
      AND app_tenant_id = $2
    LIMIT 1
    `,
    [engineerId, tenantId]
  );

  return result.rows[0] ?? null;
}

async function ensureActiveAccessToken(connection: MicrosoftConnectionRow): Promise<string> {
  const expiresAtMs = new Date(connection.access_token_expires_at).getTime();
  const refreshThresholdMs = Date.now() + 60_000;

  if (Number.isFinite(expiresAtMs) && expiresAtMs > refreshThresholdMs) {
    return connection.access_token;
  }

  const tokenResult = await refreshMicrosoftAccessToken({
    refreshToken: connection.refresh_token
  });

  await pool.query(
    `
    UPDATE microsoft_calendar_connections
    SET
      access_token = $2,
      refresh_token = $3,
      access_token_expires_at = NOW() + ($4::int * INTERVAL '1 second'),
      scope = CASE WHEN $5 = '' THEN scope ELSE $5 END,
      updated_at = NOW()
    WHERE user_id = $1
      AND app_tenant_id = $6
    `,
    [
      connection.user_id,
      tokenResult.accessToken,
      tokenResult.refreshToken,
      tokenResult.expiresInSeconds,
      tokenResult.scope,
      connection.app_tenant_id
    ]
  );

  return tokenResult.accessToken;
}

async function upsertBookingEventMap(args: {
  tenantId: number;
  bookingId: number;
  engineerId: number;
  microsoftEventId: string;
}): Promise<void> {
  await pool.query(
    `
    INSERT INTO microsoft_calendar_events (
      booking_id,
      engineer_id,
      tenant_id,
      microsoft_event_id
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (booking_id, engineer_id) DO UPDATE
    SET
      microsoft_event_id = EXCLUDED.microsoft_event_id,
      updated_at = NOW()
    `,
    [args.bookingId, args.engineerId, args.tenantId, args.microsoftEventId]
  );
}

async function getBookingEventMap(args: {
  tenantId: number;
  bookingId: number;
  engineerId: number;
}): Promise<MicrosoftEventMapRow | null> {
  const result = await pool.query<MicrosoftEventMapRow>(
    `
    SELECT microsoft_event_id
    FROM microsoft_calendar_events
    WHERE booking_id = $1
      AND engineer_id = $2
      AND tenant_id = $3
    LIMIT 1
    `,
    [args.bookingId, args.engineerId, args.tenantId]
  );

  return result.rows[0] ?? null;
}

async function removeBookingEventMap(args: {
  tenantId: number;
  bookingId: number;
  engineerId: number;
}): Promise<void> {
  await pool.query(
    `
    DELETE FROM microsoft_calendar_events
    WHERE booking_id = $1
      AND engineer_id = $2
      AND tenant_id = $3
    `,
    [args.bookingId, args.engineerId, args.tenantId]
  );
}

async function processBookedEventForEngineer(args: {
  payload: MicrosoftCalendarSyncPayload;
  engineerId: number;
  accessToken: string;
}): Promise<void> {
  const eventPayload = buildMicrosoftCalendarEventPayload({
    projectName: args.payload.projectName,
    projectDescription: args.payload.projectDescription,
    clientFirstName: args.payload.clientFirstName,
    clientLastName: args.payload.clientLastName,
    clientEmail: args.payload.clientEmail,
    clientPhone: args.payload.clientPhone,
    sessionStartIso: args.payload.sessionStartIso,
    sessionEndIso: args.payload.sessionEndIso
  });

  const existingEventMap = await getBookingEventMap({
    tenantId: args.payload.tenantId,
    bookingId: args.payload.bookingId,
    engineerId: args.engineerId
  });

  if (existingEventMap) {
    await updateMicrosoftCalendarEvent({
      accessToken: args.accessToken,
      eventId: existingEventMap.microsoft_event_id,
      event: eventPayload
    });
    return;
  }

  const createdEvent = await createMicrosoftCalendarEvent({
    accessToken: args.accessToken,
    event: eventPayload,
    transactionId: `${args.payload.bookingToken}:${args.engineerId}`
  });

  await upsertBookingEventMap({
    tenantId: args.payload.tenantId,
    bookingId: args.payload.bookingId,
    engineerId: args.engineerId,
    microsoftEventId: createdEvent.id
  });
}

async function processCancelledEventForEngineer(args: {
  payload: MicrosoftCalendarSyncPayload;
  engineerId: number;
  accessToken: string;
}): Promise<void> {
  const existingEventMap = await getBookingEventMap({
    tenantId: args.payload.tenantId,
    bookingId: args.payload.bookingId,
    engineerId: args.engineerId
  });

  if (!existingEventMap) {
    return;
  }

  await deleteMicrosoftCalendarEvent({
    accessToken: args.accessToken,
    eventId: existingEventMap.microsoft_event_id
  });

  await removeBookingEventMap({
    tenantId: args.payload.tenantId,
    bookingId: args.payload.bookingId,
    engineerId: args.engineerId
  });
}

async function processMicrosoftCalendarSyncJob(
  payload: MicrosoftCalendarSyncPayload,
  job: JobRecord<MicrosoftCalendarSyncPayload>
): Promise<void> {
  const syncEnabled = resolveMicrosoftCalendarSyncEnabled();
  const oauthConfig = getMicrosoftOAuthConfig();
  if (!syncEnabled || !oauthConfig.enabled) {
    return;
  }

  if (!isMicrosoftOAuthConfigured(oauthConfig)) {
    console.warn('[microsoft-calendar] OAuth is not fully configured; skipping sync job');
    return;
  }

  const uniqueEngineerIds = Array.from(new Set(payload.engineerIds.filter((engineerId) => engineerId > 0)));
  for (const engineerId of uniqueEngineerIds) {
    const connection = await getEngineerConnection(engineerId, payload.tenantId);
    if (!connection) {
      continue;
    }

    try {
      const accessToken = await ensureActiveAccessToken(connection);
      if (payload.event === 'booked') {
        await processBookedEventForEngineer({ payload, engineerId, accessToken });
      } else {
        await processCancelledEventForEngineer({ payload, engineerId, accessToken });
      }
    } catch (error) {
      recordQueueEventMetric('microsoft_calendar_sync_engineer_failed');
      console.error(JSON.stringify({
        level: 'error',
        event: 'microsoft_calendar_sync_engineer_failed',
        job_id: job.id,
        job_attempt: job.attempts + 1,
        booking_id: payload.bookingId,
        booking_token: payload.bookingToken,
        engineer_id: engineerId,
        action: payload.event,
        error: error instanceof Error ? error.message : 'Unknown Microsoft calendar sync error'
      }));
      throw error;
    }
  }
}

export function registerMicrosoftCalendarQueueHandlers(): void {
  jobQueue.registerHandler<MicrosoftCalendarSyncPayload>(
    MICROSOFT_CALENDAR_SYNC_JOB_TYPE,
    processMicrosoftCalendarSyncJob
  );
}

export function enqueueMicrosoftCalendarSyncJob(payload: MicrosoftCalendarSyncPayload): string {
  const job = jobQueue.enqueue(MICROSOFT_CALENDAR_SYNC_JOB_TYPE, payload);
  return job.id;
}
