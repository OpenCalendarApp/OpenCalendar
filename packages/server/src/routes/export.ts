import { Router } from 'express';

import {
  exportSessionsQuerySchema,
  numericIdParamsSchema
} from '@opencalendar/shared';

import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const projectExportRouter = Router();
const globalExportRouter = Router();

function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(',');
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 100);
}

interface SessionExportRow {
  project_name: string;
  start_time: string;
  end_time: string;
  client_first_name: string;
  client_last_name: string;
  client_email: string;
  client_phone: string;
  cancelled_at: string | null;
  pii_redacted_at: string | null;
  session_notes: string | null;
  engineers: string | null;
}

function buildCsvContent(
  rows: SessionExportRow[],
  includeProjectColumn: boolean
): string {
  const headers = includeProjectColumn
    ? ['Project Name', 'Session Date', 'Start Time', 'End Time', 'Client First Name', 'Client Last Name', 'Client Email', 'Client Phone', 'Status', 'Engineers', 'Session Notes']
    : ['Session Date', 'Start Time', 'End Time', 'Client First Name', 'Client Last Name', 'Client Email', 'Client Phone', 'Status', 'Engineers', 'Session Notes'];

  const lines: string[] = [formatCsvRow(headers)];

  for (const row of rows) {
    const isRedacted = row.pii_redacted_at !== null;
    const status = row.cancelled_at ? 'Cancelled' : 'Active';
    const startDate = new Date(row.start_time);
    const endDate = new Date(row.end_time);
    const sessionDate = startDate.toISOString().split('T')[0] ?? '';
    const startTime = startDate.toISOString().split('T')[1]?.replace('Z', '') ?? '';
    const endTime = endDate.toISOString().split('T')[1]?.replace('Z', '') ?? '';

    const firstName = isRedacted ? '[redacted]' : row.client_first_name;
    const lastName = isRedacted ? '[redacted]' : row.client_last_name;
    const email = isRedacted ? '[redacted]' : row.client_email;
    const phone = isRedacted ? '[redacted]' : row.client_phone;
    const engineers = row.engineers ?? '';
    const notes = row.session_notes ?? '';

    const fields = includeProjectColumn
      ? [row.project_name, sessionDate, startTime, endTime, firstName, lastName, email, phone, status, engineers, notes]
      : [sessionDate, startTime, endTime, firstName, lastName, email, phone, status, engineers, notes];

    lines.push(formatCsvRow(fields));
  }

  return lines.join('\r\n') + '\r\n';
}

function buildWhereClause(params: {
  from?: string;
  to?: string;
  status: string;
}): { conditions: string[]; values: string[] } {
  const conditions: string[] = [];
  const values: string[] = [];

  if (params.from) {
    values.push(params.from);
    conditions.push(`tb.start_time >= $${values.length + 2}::date`);
  }
  if (params.to) {
    values.push(params.to);
    conditions.push(`tb.end_time <= ($${values.length + 2}::date + INTERVAL '1 day')`);
  }
  if (params.status === 'active') {
    conditions.push('b.cancelled_at IS NULL');
  } else if (params.status === 'cancelled') {
    conditions.push('b.cancelled_at IS NOT NULL');
  }

  return { conditions, values };
}

// GET /api/v1/projects/:id/export — export sessions for one project
projectExportRouter.get('/:id/export', authMiddleware, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const paramsParse = numericIdParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid project id', details: paramsParse.error.flatten() });
    return;
  }

  const queryParse = exportSessionsQuerySchema.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: queryParse.error.flatten() });
    return;
  }

  const projectId = paramsParse.data.id;
  const { from, to, status } = queryParse.data;

  // Check project exists and user has access
  const projectResult = await pool.query<{ name: string }>(
    `SELECT name FROM projects WHERE id = $1 AND tenant_id = $2`,
    [projectId, req.user.tenantId]
  );

  if (!projectResult.rows[0]) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const projectName = projectResult.rows[0].name;
  const { conditions, values: filterValues } = buildWhereClause({ from, to, status });

  const baseParams = [projectId, req.user.tenantId, ...filterValues];
  const whereExtra = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

  const result = await pool.query<SessionExportRow>(
    `
    SELECT
      p.name AS project_name,
      tb.start_time,
      tb.end_time,
      b.client_first_name,
      b.client_last_name,
      b.client_email,
      b.client_phone,
      b.cancelled_at,
      b.pii_redacted_at,
      b.session_notes,
      STRING_AGG(DISTINCT u.first_name || ' ' || u.last_name, '; ' ORDER BY u.first_name || ' ' || u.last_name) AS engineers
    FROM bookings b
    INNER JOIN time_blocks tb ON tb.id = b.time_block_id
    INNER JOIN projects p ON p.id = tb.project_id
    LEFT JOIN time_block_engineers tbe ON tbe.time_block_id = tb.id
    LEFT JOIN users u ON u.id = tbe.engineer_id
    WHERE p.id = $1
      AND p.tenant_id = $2
      ${whereExtra}
    GROUP BY p.name, tb.start_time, tb.end_time, b.id, b.client_first_name, b.client_last_name,
             b.client_email, b.client_phone, b.cancelled_at, b.pii_redacted_at, b.session_notes
    ORDER BY tb.start_time ASC, b.booked_at ASC
    `,
    baseParams
  );

  const csv = buildCsvContent(result.rows, false);
  const today = new Date().toISOString().split('T')[0];
  const filename = `${sanitizeFilename(projectName)}_sessions_${today}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}));

// GET /api/v1/export/sessions — export sessions across all projects (PM only)
globalExportRouter.get('/sessions', authMiddleware, requireRole(['pm', 'admin']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const queryParse = exportSessionsQuerySchema.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: queryParse.error.flatten() });
    return;
  }

  const { from, to, status } = queryParse.data;
  const { conditions, values: filterValues } = buildWhereClause({ from, to, status });

  const baseParams = [req.user.tenantId, ...filterValues];
  const whereExtra = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

  const result = await pool.query<SessionExportRow>(
    `
    SELECT
      p.name AS project_name,
      tb.start_time,
      tb.end_time,
      b.client_first_name,
      b.client_last_name,
      b.client_email,
      b.client_phone,
      b.cancelled_at,
      b.pii_redacted_at,
      b.session_notes,
      STRING_AGG(DISTINCT u.first_name || ' ' || u.last_name, '; ' ORDER BY u.first_name || ' ' || u.last_name) AS engineers
    FROM bookings b
    INNER JOIN time_blocks tb ON tb.id = b.time_block_id
    INNER JOIN projects p ON p.id = tb.project_id
    LEFT JOIN time_block_engineers tbe ON tbe.time_block_id = tb.id
    LEFT JOIN users u ON u.id = tbe.engineer_id
    WHERE p.tenant_id = $1
      ${whereExtra}
    GROUP BY p.name, tb.start_time, tb.end_time, b.id, b.client_first_name, b.client_last_name,
             b.client_email, b.client_phone, b.cancelled_at, b.pii_redacted_at, b.session_notes
    ORDER BY p.name ASC, tb.start_time ASC, b.booked_at ASC
    `,
    baseParams
  );

  const csv = buildCsvContent(result.rows, true);
  const today = new Date().toISOString().split('T')[0];
  const filename = `all_sessions_${today}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}));

export { projectExportRouter, globalExportRouter };
