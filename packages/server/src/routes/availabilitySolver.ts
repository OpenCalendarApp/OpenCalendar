import { Router } from 'express';

import {
  availabilitySolverQuerySchema,
  numericIdParamsSchema,
  type AvailabilitySolverResponse,
  type AvailabilitySuggestion
} from '@opencalendar/shared';

import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  fetchCalendarBusyIntervals,
  getMicrosoftOAuthConfig,
  isMicrosoftOAuthConfigured,
  refreshMicrosoftAccessToken,
  type BusyInterval
} from '../utils/microsoftCalendar.js';

const router = Router();

interface ProjectRow {
  id: number;
  session_length_minutes: number;
}

interface EngineerRow {
  id: number;
  email: string;
}

interface MicrosoftConnectionRow {
  user_id: number;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  app_tenant_id: number;
}

interface ExistingBlockRow {
  start_time: string;
  end_time: string;
}

const STEP_MINUTES = 15;
const SOLVER_CACHE = new Map<string, { intervals: BusyInterval[]; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedBusyIntervals(cacheKey: string): BusyInterval[] | null {
  const entry = SOLVER_CACHE.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    SOLVER_CACHE.delete(cacheKey);
    return null;
  }
  return entry.intervals;
}

function setCachedBusyIntervals(cacheKey: string, intervals: BusyInterval[]): void {
  SOLVER_CACHE.set(cacheKey, { intervals, fetchedAt: Date.now() });
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

function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// GET /api/v1/projects/:id/availability-solver
router.get('/:id/availability-solver', authMiddleware, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const paramsParse = numericIdParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid project id', details: paramsParse.error.flatten() });
    return;
  }

  const queryParse = availabilitySolverQuerySchema.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: queryParse.error.flatten() });
    return;
  }

  const projectId = paramsParse.data.id;
  const now = new Date();
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const fromDate = queryParse.data.from ? new Date(queryParse.data.from) : now;
  const toDate = queryParse.data.to ? new Date(queryParse.data.to) : twoWeeksFromNow;
  const limit = queryParse.data.limit;

  if (toDate <= fromDate) {
    res.status(400).json({ error: '"to" must be after "from"' });
    return;
  }

  // 1. Get project
  const projectResult = await pool.query<ProjectRow>(
    `SELECT id, session_length_minutes FROM projects WHERE id = $1 AND tenant_id = $2`,
    [projectId, req.user.tenantId]
  );

  const project = projectResult.rows[0];
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // 2. Get unique engineers assigned to this project's time blocks
  const engineersResult = await pool.query<EngineerRow>(
    `
    SELECT DISTINCT u.id, u.email
    FROM time_block_engineers tbe
    INNER JOIN time_blocks tb ON tb.id = tbe.time_block_id
    INNER JOIN users u ON u.id = tbe.engineer_id
    WHERE tb.project_id = $1
      AND u.tenant_id = $2
    ORDER BY u.email ASC
    `,
    [projectId, req.user.tenantId]
  );

  const engineers = engineersResult.rows;
  if (engineers.length === 0) {
    const emptyResponse: AvailabilitySolverResponse = {
      suggestions: [],
      engineers_without_calendar: []
    };
    res.json(emptyResponse);
    return;
  }

  // 3. Get Microsoft Calendar connections for these engineers
  const engineerIds = engineers.map((e) => e.id);
  const connectionsResult = await pool.query<MicrosoftConnectionRow>(
    `
    SELECT user_id, access_token, refresh_token, access_token_expires_at, app_tenant_id
    FROM microsoft_calendar_connections
    WHERE user_id = ANY($1::int[])
      AND app_tenant_id = $2
    `,
    [engineerIds, req.user.tenantId]
  );

  const connectionsByEngineerId = new Map<number, MicrosoftConnectionRow>();
  for (const conn of connectionsResult.rows) {
    connectionsByEngineerId.set(conn.user_id, conn);
  }

  const engineersWithCalendar: EngineerRow[] = [];
  const engineersWithoutCalendar: string[] = [];

  const oauthConfig = getMicrosoftOAuthConfig();
  const oauthConfigured = isMicrosoftOAuthConfigured(oauthConfig);

  for (const eng of engineers) {
    if (oauthConfigured && connectionsByEngineerId.has(eng.id)) {
      engineersWithCalendar.push(eng);
    } else {
      engineersWithoutCalendar.push(eng.email);
    }
  }

  // 4. Fetch busy intervals for each engineer with calendar
  const busyByEngineerId = new Map<number, BusyInterval[]>();
  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();

  for (const eng of engineersWithCalendar) {
    const cacheKey = `${eng.id}:${fromIso}:${toIso}`;
    const cached = getCachedBusyIntervals(cacheKey);
    if (cached) {
      busyByEngineerId.set(eng.id, cached);
      continue;
    }

    const connection = connectionsByEngineerId.get(eng.id);
    if (!connection) continue;

    try {
      const accessToken = await ensureActiveAccessToken(connection);
      const intervals = await fetchCalendarBusyIntervals({
        accessToken,
        startDateTime: fromIso,
        endDateTime: toIso
      });
      busyByEngineerId.set(eng.id, intervals);
      setCachedBusyIntervals(cacheKey, intervals);
    } catch {
      // If calendar fetch fails, treat as engineer without calendar
      engineersWithoutCalendar.push(eng.email);
      const idx = engineersWithCalendar.indexOf(eng);
      if (idx >= 0) engineersWithCalendar.splice(idx, 1);
    }
  }

  // 5. Get existing time blocks for this project in the date range (to avoid double-scheduling)
  const existingBlocksResult = await pool.query<ExistingBlockRow>(
    `
    SELECT start_time, end_time
    FROM time_blocks
    WHERE project_id = $1
      AND start_time < $3
      AND end_time > $2
    ORDER BY start_time ASC
    `,
    [projectId, fromIso, toIso]
  );

  const existingBlocks = existingBlocksResult.rows.map((b) => ({
    start: new Date(b.start_time).getTime(),
    end: new Date(b.end_time).getTime()
  }));

  // 6. Find free windows
  const sessionLengthMs = project.session_length_minutes * 60 * 1000;
  const stepMs = STEP_MINUTES * 60 * 1000;
  const suggestions: AvailabilitySuggestion[] = [];

  const searchStartMs = Math.max(fromDate.getTime(), now.getTime());
  // Round up to next STEP_MINUTES boundary
  const alignedStartMs = Math.ceil(searchStartMs / stepMs) * stepMs;
  const searchEndMs = toDate.getTime();

  for (let slotStart = alignedStartMs; slotStart + sessionLengthMs <= searchEndMs; slotStart += stepMs) {
    if (suggestions.length >= limit) break;

    const slotEnd = slotStart + sessionLengthMs;

    // Skip if overlaps existing time block for this project
    const overlapsExisting = existingBlocks.some((block) =>
      intervalsOverlap(slotStart, slotEnd, block.start, block.end)
    );
    if (overlapsExisting) continue;

    // Check each engineer's availability
    const available: string[] = [];
    const unavailable: string[] = [];

    for (const eng of engineers) {
      const busyIntervals = busyByEngineerId.get(eng.id);
      if (!busyIntervals) {
        // No calendar data — treat as available (they're in engineers_without_calendar already)
        available.push(eng.email);
        continue;
      }

      const isBusy = busyIntervals.some((interval) =>
        intervalsOverlap(
          slotStart,
          slotEnd,
          new Date(interval.start).getTime(),
          new Date(interval.end).getTime()
        )
      );

      if (isBusy) {
        unavailable.push(eng.email);
      } else {
        available.push(eng.email);
      }
    }

    // Only suggest windows where ALL engineers with calendars are free
    if (unavailable.length === 0) {
      suggestions.push({
        start_time: new Date(slotStart).toISOString(),
        end_time: new Date(slotEnd).toISOString(),
        available_engineers: available,
        unavailable_engineers: unavailable
      });
    }
  }

  const response: AvailabilitySolverResponse = {
    suggestions,
    engineers_without_calendar: [...new Set(engineersWithoutCalendar)]
  };

  res.json(response);
}));

export default router;
