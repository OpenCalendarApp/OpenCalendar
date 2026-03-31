import { Router } from 'express';

import {
  createProjectSchema,
  numericIdParamsSchema,
  updateProjectSchema,
  type Booking,
  type EngineerSummary,
  type Project,
  type ProjectDetail,
  type ProjectResponse,
  type ProjectSummary,
  type ProjectsResponse,
  type TimeBlockWithRelations
} from '@calendar-genie/shared';

import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { hashProjectPassword } from '../utils/auth.js';
import { recordAuditEventSafe } from '../utils/audit.js';
import { normalizeProjectEmailDomainAllowlist } from '../utils/emailDomain.js';

const router = Router();

type ProjectDetailRow = Omit<ProjectDetail, 'time_blocks'>;
type TimeBlockRow = Omit<TimeBlockWithRelations, 'engineers' | 'bookings'>;
type EngineerAssignmentRow = EngineerSummary & { time_block_id: number };

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const result = await pool.query<ProjectSummary>(
    `
    SELECT
      p.id,
      p.name,
      p.description,
      p.booking_email_domain_allowlist,
      p.created_by,
      p.is_group_signup,
      p.max_group_size,
      p.session_length_minutes,
      p.share_token,
      p.is_active,
      p.created_at,
      p.updated_at,
      COUNT(DISTINCT tb.id)::text AS time_block_count,
      COUNT(DISTINCT b.id) FILTER (WHERE b.cancelled_at IS NULL)::text AS active_booking_count
    FROM projects p
    LEFT JOIN time_blocks tb ON tb.project_id = p.id
    LEFT JOIN bookings b ON b.time_block_id = tb.id
    WHERE p.tenant_id = $1
    GROUP BY p.id
    ORDER BY p.created_at DESC
    `,
    [req.user.tenantId]
  );

  const response: ProjectsResponse = { projects: result.rows };
  res.json(response);
}));

router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const paramsParse = numericIdParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid project id', details: paramsParse.error.flatten() });
    return;
  }

  const projectId = paramsParse.data.id;

  const projectResult = await pool.query<ProjectDetailRow>(
    `
    SELECT
      p.id,
      p.name,
      p.description,
      p.booking_email_domain_allowlist,
      p.created_by,
      p.is_group_signup,
      p.max_group_size,
      p.session_length_minutes,
      p.share_token,
      p.is_active,
      p.created_at,
      p.updated_at,
      CONCAT(u.first_name, ' ', u.last_name) AS creator_name
    FROM projects p
    INNER JOIN users u ON u.id = p.created_by
    WHERE p.id = $1
      AND p.tenant_id = $2
    `,
    [projectId, req.user.tenantId]
  );

  const projectRow = projectResult.rows[0];
  if (!projectRow) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const timeBlocksResult = await pool.query<TimeBlockRow>(
    `
    SELECT
      tb.id,
      tb.project_id,
      tb.start_time,
      tb.end_time,
      tb.max_signups,
      tb.is_personal,
      tb.created_by,
      tb.created_at,
      (
        tb.max_signups - COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL)
      )::int AS remaining_slots
    FROM time_blocks tb
    LEFT JOIN bookings b ON b.time_block_id = tb.id
    WHERE tb.project_id = $1
      AND tb.tenant_id = $2
    GROUP BY tb.id
    ORDER BY tb.start_time ASC
    `,
    [projectId, req.user.tenantId]
  );

  const blockIds = timeBlocksResult.rows.map((block) => block.id);

  const engineersByBlock = new Map<number, EngineerSummary[]>();
  const bookingsByBlock = new Map<number, Booking[]>();

  if (blockIds.length > 0) {
    const engineersResult = await pool.query<EngineerAssignmentRow>(
      `
      SELECT
        tbe.time_block_id,
        u.id,
        u.first_name,
        u.last_name,
        u.email
      FROM time_block_engineers tbe
      INNER JOIN users u ON u.id = tbe.engineer_id
      WHERE tbe.time_block_id = ANY($1::int[])
        AND u.tenant_id = $2
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [blockIds, req.user.tenantId]
    );

    for (const assignment of engineersResult.rows) {
      const existing = engineersByBlock.get(assignment.time_block_id) ?? [];
      existing.push({
        id: assignment.id,
        first_name: assignment.first_name,
        last_name: assignment.last_name,
        email: assignment.email
      });
      engineersByBlock.set(assignment.time_block_id, existing);
    }

    const bookingsResult = await pool.query<Booking>(
      `
      SELECT
        id,
        time_block_id,
        client_first_name,
        client_last_name,
        client_email,
        client_phone,
        booking_token,
        booked_at,
        cancelled_at
      FROM bookings
      WHERE time_block_id = ANY($1::int[])
        AND tenant_id = $2
      ORDER BY booked_at DESC
      `,
      [blockIds, req.user.tenantId]
    );

    for (const booking of bookingsResult.rows) {
      const existing = bookingsByBlock.get(booking.time_block_id) ?? [];
      existing.push(booking);
      bookingsByBlock.set(booking.time_block_id, existing);
    }
  }

  const timeBlocks: TimeBlockWithRelations[] = timeBlocksResult.rows.map((block) => ({
    ...block,
    engineers: engineersByBlock.get(block.id) ?? [],
    bookings: bookingsByBlock.get(block.id) ?? []
  }));

  const project: ProjectDetail = {
    ...projectRow,
    time_blocks: timeBlocks
  };

  res.json({ project });
}));

router.post('/', authMiddleware, requireRole(['pm', 'admin']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const parse = createProjectSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const data = parse.data;
  const hashedPassword = await hashProjectPassword(data.signup_password);
  const bookingEmailDomainAllowlist = normalizeProjectEmailDomainAllowlist(data.booking_email_domain_allowlist);

  const result = await pool.query<Project>(
    `
    INSERT INTO projects (
      name,
      description,
      booking_email_domain_allowlist,
      tenant_id,
      created_by,
      signup_password_hash,
      is_group_signup,
      max_group_size,
      session_length_minutes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, name, description, booking_email_domain_allowlist, created_by, is_group_signup, max_group_size,
              session_length_minutes, share_token, is_active, created_at, updated_at
    `,
    [
      data.name,
      data.description,
      bookingEmailDomainAllowlist,
      req.user.tenantId,
      req.user.userId,
      hashedPassword,
      data.is_group_signup,
      data.max_group_size,
      data.session_length_minutes
    ]
  );

  const project = result.rows[0];
  if (!project) {
    res.status(500).json({ error: 'Unable to create project' });
    return;
  }

  const response: ProjectResponse = { project };
  await recordAuditEventSafe({
    tenantId: req.user.tenantId,
    actorUserId: req.user.userId,
    actorRole: req.user.role,
    action: 'project.created',
    entityType: 'project',
    entityId: project.id,
    metadata: {
      name: project.name,
      is_group_signup: project.is_group_signup,
      max_group_size: project.max_group_size
    }
  });
  res.status(201).json(response);
}));

router.put('/:id', authMiddleware, requireRole(['pm', 'admin']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const paramsParse = numericIdParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid project id', details: paramsParse.error.flatten() });
    return;
  }

  const bodyParse = updateProjectSchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Validation failed', details: bodyParse.error.flatten() });
    return;
  }

  const projectId = paramsParse.data.id;
  const data = bodyParse.data;

  const existingResult = await pool.query<Pick<Project, 'id' | 'is_group_signup' | 'max_group_size'>>(
    `
    SELECT id, is_group_signup, max_group_size
    FROM projects
    WHERE id = $1
      AND tenant_id = $2
    `,
    [projectId, req.user.tenantId]
  );

  const existingProject = existingResult.rows[0];
  if (!existingProject) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const effectiveIsGroupSignup = data.is_group_signup ?? existingProject.is_group_signup;
  const effectiveMaxGroupSize = data.max_group_size ?? existingProject.max_group_size;

  if (!effectiveIsGroupSignup && effectiveMaxGroupSize !== 1) {
    res.status(400).json({
      error: 'Validation failed',
      details: {
        max_group_size: ['max_group_size must be 1 when is_group_signup is false']
      }
    });
    return;
  }

  const signupPasswordHash = data.signup_password
    ? await hashProjectPassword(data.signup_password)
    : null;
  const hasDomainAllowlistUpdate = Object.prototype.hasOwnProperty.call(data, 'booking_email_domain_allowlist');
  const normalizedDomainAllowlist = hasDomainAllowlistUpdate
    ? normalizeProjectEmailDomainAllowlist(data.booking_email_domain_allowlist ?? null)
    : null;

  const result = await pool.query<Project>(
    `
    UPDATE projects
    SET
      name = COALESCE($1, name),
      description = COALESCE($2, description),
      signup_password_hash = COALESCE($3, signup_password_hash),
      is_group_signup = COALESCE($4, is_group_signup),
      max_group_size = COALESCE($5, max_group_size),
      session_length_minutes = COALESCE($6, session_length_minutes),
      is_active = COALESCE($7, is_active),
      booking_email_domain_allowlist = CASE WHEN $8 THEN $9 ELSE booking_email_domain_allowlist END
    WHERE id = $10
      AND tenant_id = $11
    RETURNING id, name, description, booking_email_domain_allowlist, created_by, is_group_signup, max_group_size,
              session_length_minutes, share_token, is_active, created_at, updated_at
    `,
    [
      data.name ?? null,
      data.description ?? null,
      signupPasswordHash,
      data.is_group_signup ?? null,
      data.max_group_size ?? null,
      data.session_length_minutes ?? null,
      data.is_active ?? null,
      hasDomainAllowlistUpdate,
      normalizedDomainAllowlist,
      projectId,
      req.user.tenantId
    ]
  );

  const project = result.rows[0];
  if (!project) {
    res.status(500).json({ error: 'Unable to update project' });
    return;
  }

  const response: ProjectResponse = { project };
  await recordAuditEventSafe({
    tenantId: req.user.tenantId,
    actorUserId: req.user.userId,
    actorRole: req.user.role,
    action: 'project.updated',
    entityType: 'project',
    entityId: project.id,
    metadata: {
      name: project.name,
      is_active: project.is_active
    }
  });
  res.json(response);
}));

router.delete('/:id', authMiddleware, requireRole(['pm', 'admin']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const paramsParse = numericIdParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid project id', details: paramsParse.error.flatten() });
    return;
  }

  const projectId = paramsParse.data.id;

  const result = await pool.query<{ id: number }>(
    `
    DELETE FROM projects
    WHERE id = $1
      AND tenant_id = $2
    RETURNING id
    `,
    [projectId, req.user.tenantId]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  await recordAuditEventSafe({
    tenantId: req.user.tenantId,
    actorUserId: req.user.userId,
    actorRole: req.user.role,
    action: 'project.deleted',
    entityType: 'project',
    entityId: projectId,
    metadata: null
  });

  res.status(204).send();
}));

export default router;
