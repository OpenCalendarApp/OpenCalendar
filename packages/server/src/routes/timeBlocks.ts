import { Router } from 'express';
import type { PoolClient } from 'pg';

import {
  createRecurringTimeBlocksSchema,
  createTimeBlockSchema,
  createTimeBlocksBatchSchema,
  numericIdParamsSchema,
  updateTimeBlockSchema,
  type Project,
  type TimeBlock,
  type TimeBlocksResponse
} from '@session-scheduler/shared';

import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { recordAuditEventSafe } from '../utils/audit.js';
import { buildWeeklyRecurringWindows } from '../utils/recurrence.js';

const router = Router();

type ProjectCapacityRow = Pick<Project, 'id' | 'is_group_signup' | 'max_group_size'>;
type TimeBlockDeleteRow = {
  id: number;
  created_by: number;
  is_personal: boolean;
  active_booking_count: number;
};

type TimeBlockUpdateLookupRow = {
  id: number;
  project_id: number;
  created_by: number;
  is_personal: boolean;
  active_booking_count: number;
};

function validateMaxSignups(project: ProjectCapacityRow, maxSignups: number): string | null {
  if (!project.is_group_signup && maxSignups !== 1) {
    return 'max_signups must be 1 for non-group projects';
  }

  if (project.is_group_signup && maxSignups > project.max_group_size) {
    return `max_signups cannot exceed project max_group_size (${project.max_group_size})`;
  }

  return null;
}

async function fetchProjectCapacity(
  projectId: number,
  tenantId: number,
  client?: PoolClient
): Promise<ProjectCapacityRow | null> {
  const db = client ?? pool;

  const result = await db.query<ProjectCapacityRow>(
    `
    SELECT id, is_group_signup, max_group_size
    FROM projects
    WHERE id = $1
      AND tenant_id = $2
    `,
    [projectId, tenantId]
  );

  return result.rows[0] ?? null;
}

async function validateEngineerIds(
  engineerIds: number[],
  tenantId: number,
  client?: PoolClient
): Promise<number[]> {
  if (engineerIds.length === 0) {
    return [];
  }

  const db = client ?? pool;

  const result = await db.query<{ id: number }>(
    `
    SELECT id
    FROM users
    WHERE role = 'engineer'
      AND id = ANY($1::int[])
      AND tenant_id = $2
    `,
    [engineerIds, tenantId]
  );

  const foundIds = new Set(result.rows.map((row) => row.id));
  return engineerIds.filter((engineerId) => !foundIds.has(engineerId));
}

async function createTimeBlockRow(
  client: PoolClient,
  args: {
    project_id: number;
    start_time: string;
    end_time: string;
    max_signups: number;
    is_personal: boolean;
    created_by: number;
    tenant_id: number;
  }
): Promise<TimeBlock> {
  const result = await client.query<TimeBlock>(
    `
    INSERT INTO time_blocks (
      project_id,
      start_time,
      end_time,
      max_signups,
      is_personal,
      created_by,
      tenant_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, project_id, start_time, end_time, max_signups, is_personal, created_by, created_at
    `,
    [
      args.project_id,
      args.start_time,
      args.end_time,
      args.max_signups,
      args.is_personal,
      args.created_by,
      args.tenant_id
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to create time block');
  }

  return row;
}

async function assignEngineersToBlock(
  client: PoolClient,
  timeBlockId: number,
  engineerIds: number[]
): Promise<void> {
  for (const engineerId of engineerIds) {
    await client.query(
      `
      INSERT INTO time_block_engineers (time_block_id, engineer_id)
      VALUES ($1, $2)
      ON CONFLICT (time_block_id, engineer_id) DO NOTHING
      `,
      [timeBlockId, engineerId]
    );
  }
}

router.post('/', authMiddleware, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const parse = createTimeBlockSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const data = parse.data;

  const project = await fetchProjectCapacity(data.project_id, req.user.tenantId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const maxSignupsValidation = validateMaxSignups(project, data.max_signups);
  if (maxSignupsValidation) {
    res.status(400).json({ error: 'Validation failed', details: maxSignupsValidation });
    return;
  }

  const isEngineer = req.user.role === 'engineer';
  const isPersonal = isEngineer;
  const engineerIds = isEngineer ? [req.user.userId] : data.engineer_ids;

  const missingEngineerIds = await validateEngineerIds(engineerIds, req.user.tenantId);
  if (missingEngineerIds.length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      details: `Unknown engineer ids: ${missingEngineerIds.join(', ')}`
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const timeBlock = await createTimeBlockRow(client, {
      project_id: data.project_id,
      start_time: data.start_time,
      end_time: data.end_time,
      max_signups: data.max_signups,
      is_personal: isPersonal,
      created_by: req.user.userId,
      tenant_id: req.user.tenantId
    });

    await assignEngineersToBlock(client, timeBlock.id, engineerIds);
    await recordAuditEventSafe({
      tenantId: req.user.tenantId,
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      action: isPersonal ? 'time_block.personal_created' : 'time_block.created',
      entityType: 'time_block',
      entityId: timeBlock.id,
      metadata: {
        project_id: data.project_id,
        max_signups: data.max_signups,
        engineer_ids: engineerIds
      },
      db: client
    });

    await client.query('COMMIT');

    const response: TimeBlocksResponse = { time_blocks: [timeBlock] };
    res.status(201).json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to create time block' });
  } finally {
    client.release();
  }
}));

router.post('/batch', authMiddleware, requireRole(['pm', 'admin']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const parse = createTimeBlocksBatchSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const data = parse.data;

  const project = await fetchProjectCapacity(data.project_id, req.user.tenantId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  for (const block of data.blocks) {
    const validationIssue = validateMaxSignups(project, block.max_signups);
    if (validationIssue) {
      res.status(400).json({ error: 'Validation failed', details: validationIssue });
      return;
    }
  }

  const uniqueEngineerIds = Array.from(new Set(data.blocks.flatMap((block) => block.engineer_ids)));
  const missingEngineerIds = await validateEngineerIds(uniqueEngineerIds, req.user.tenantId);
  if (missingEngineerIds.length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      details: `Unknown engineer ids: ${missingEngineerIds.join(', ')}`
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const createdBlocks: TimeBlock[] = [];

    for (const block of data.blocks) {
      const createdBlock = await createTimeBlockRow(client, {
        project_id: data.project_id,
        start_time: block.start_time,
        end_time: block.end_time,
        max_signups: block.max_signups,
        is_personal: false,
        created_by: req.user.userId,
        tenant_id: req.user.tenantId
      });

      await assignEngineersToBlock(client, createdBlock.id, block.engineer_ids);
      createdBlocks.push(createdBlock);
    }

    await recordAuditEventSafe({
      tenantId: req.user.tenantId,
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      action: 'time_block.batch_created',
      entityType: 'project',
      entityId: data.project_id,
      metadata: {
        created_count: createdBlocks.length
      },
      db: client
    });

    await client.query('COMMIT');

    const response: TimeBlocksResponse = { time_blocks: createdBlocks };
    res.status(201).json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to create time blocks' });
  } finally {
    client.release();
  }
}));

router.post('/recurring', authMiddleware, requireRole(['pm', 'admin']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const parse = createRecurringTimeBlocksSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const data = parse.data;

  const project = await fetchProjectCapacity(data.project_id, req.user.tenantId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const maxSignupsValidation = validateMaxSignups(project, data.max_signups);
  if (maxSignupsValidation) {
    res.status(400).json({ error: 'Validation failed', details: maxSignupsValidation });
    return;
  }

  const missingEngineerIds = await validateEngineerIds(data.engineer_ids, req.user.tenantId);
  if (missingEngineerIds.length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      details: `Unknown engineer ids: ${missingEngineerIds.join(', ')}`
    });
    return;
  }

  const windows = buildWeeklyRecurringWindows({
    startTimeIso: data.start_time,
    endTimeIso: data.end_time,
    intervalWeeks: data.recurrence.interval_weeks,
    occurrences: data.recurrence.occurrences,
    slotsPerOccurrence: data.slots_per_occurrence
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const createdBlocks: TimeBlock[] = [];
    for (const window of windows) {
      const createdBlock = await createTimeBlockRow(client, {
        project_id: data.project_id,
        start_time: window.start_time,
        end_time: window.end_time,
        max_signups: data.max_signups,
        is_personal: false,
        created_by: req.user.userId,
        tenant_id: req.user.tenantId
      });

      await assignEngineersToBlock(client, createdBlock.id, data.engineer_ids);
      createdBlocks.push(createdBlock);
    }

    await recordAuditEventSafe({
      tenantId: req.user.tenantId,
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      action: 'time_block.recurring_created',
      entityType: 'project',
      entityId: data.project_id,
      metadata: {
        created_count: createdBlocks.length,
        recurrence: data.recurrence,
        slots_per_occurrence: data.slots_per_occurrence
      },
      db: client
    });

    await client.query('COMMIT');

    const response: TimeBlocksResponse = { time_blocks: createdBlocks };
    res.status(201).json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to create recurring time blocks' });
  } finally {
    client.release();
  }
}));

router.put('/:id', authMiddleware, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const paramsParse = numericIdParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid time block id', details: paramsParse.error.flatten() });
    return;
  }

  const bodyParse = updateTimeBlockSchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Validation failed', details: bodyParse.error.flatten() });
    return;
  }

  const timeBlockId = paramsParse.data.id;
  const data = bodyParse.data;

  const lookupResult = await pool.query<TimeBlockUpdateLookupRow>(
    `
    SELECT
      tb.id,
      tb.project_id,
      tb.created_by,
      tb.is_personal,
      COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL)::int AS active_booking_count
    FROM time_blocks tb
    LEFT JOIN bookings b ON b.time_block_id = tb.id
    WHERE tb.id = $1
      AND tb.tenant_id = $2
    GROUP BY tb.id
    `,
    [timeBlockId, req.user.tenantId]
  );

  const existingBlock = lookupResult.rows[0];
  if (!existingBlock) {
    res.status(404).json({ error: 'Time block not found' });
    return;
  }

  const isEngineer = req.user.role === 'engineer';
  if (isEngineer && (!existingBlock.is_personal || existingBlock.created_by !== req.user.userId)) {
    res.status(403).json({ error: 'Engineers can only edit their own personal time blocks' });
    return;
  }

  if (existingBlock.active_booking_count > 0) {
    res.status(409).json({
      error: 'Cannot edit time block with active bookings',
      details: 'Cancel active bookings before editing this block'
    });
    return;
  }

  const project = await fetchProjectCapacity(existingBlock.project_id, req.user.tenantId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const maxSignups = isEngineer ? 1 : data.max_signups;
  const maxSignupsValidation = validateMaxSignups(project, maxSignups);
  if (maxSignupsValidation) {
    res.status(400).json({ error: 'Validation failed', details: maxSignupsValidation });
    return;
  }

  const engineerIds = isEngineer ? [req.user.userId] : data.engineer_ids;
  const missingEngineerIds = await validateEngineerIds(engineerIds, req.user.tenantId);
  if (missingEngineerIds.length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      details: `Unknown engineer ids: ${missingEngineerIds.join(', ')}`
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateResult = await client.query<TimeBlock>(
      `
      UPDATE time_blocks
      SET
        start_time = $1,
        end_time = $2,
        max_signups = $3
      WHERE id = $4
        AND tenant_id = $5
      RETURNING id, project_id, start_time, end_time, max_signups, is_personal, created_by, created_at
      `,
      [data.start_time, data.end_time, maxSignups, timeBlockId, req.user.tenantId]
    );

    const updatedBlock = updateResult.rows[0];
    if (!updatedBlock) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Unable to update time block' });
      return;
    }

    await client.query(
      `
      DELETE FROM time_block_engineers
      WHERE time_block_id = $1
      `,
      [timeBlockId]
    );

    await assignEngineersToBlock(client, timeBlockId, engineerIds);

    await recordAuditEventSafe({
      tenantId: req.user.tenantId,
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      action: isEngineer ? 'time_block.personal_updated' : 'time_block.updated',
      entityType: 'time_block',
      entityId: timeBlockId,
      metadata: {
        project_id: existingBlock.project_id,
        max_signups: maxSignups,
        engineer_ids: engineerIds
      },
      db: client
    });

    await client.query('COMMIT');

    const response: TimeBlocksResponse = { time_blocks: [updatedBlock] };
    res.json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to update time block' });
  } finally {
    client.release();
  }
}));

router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const paramsParse = numericIdParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid time block id', details: paramsParse.error.flatten() });
    return;
  }

  const timeBlockId = paramsParse.data.id;

  const blockResult = await pool.query<TimeBlockDeleteRow>(
    `
    SELECT
      tb.id,
      tb.created_by,
      tb.is_personal,
      COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL)::int AS active_booking_count
    FROM time_blocks tb
    LEFT JOIN bookings b ON b.time_block_id = tb.id
    WHERE tb.id = $1
      AND tb.tenant_id = $2
    GROUP BY tb.id
    `,
    [timeBlockId, req.user.tenantId]
  );

  const timeBlock = blockResult.rows[0];
  if (!timeBlock) {
    res.status(404).json({ error: 'Time block not found' });
    return;
  }

  if (timeBlock.active_booking_count > 0) {
    res.status(409).json({
      error: 'Cannot delete time block with active bookings',
      details: 'Cancel active bookings before deleting this block'
    });
    return;
  }

  if (
    req.user.role === 'engineer' &&
    !(timeBlock.is_personal && timeBlock.created_by === req.user.userId)
  ) {
    res.status(403).json({ error: 'Engineers can only delete their own personal time blocks' });
    return;
  }

  await pool.query(
    `
    DELETE FROM time_blocks
    WHERE id = $1
      AND tenant_id = $2
    `,
    [timeBlockId, req.user.tenantId]
  );

  await recordAuditEventSafe({
    tenantId: req.user.tenantId,
    actorUserId: req.user.userId,
    actorRole: req.user.role,
    action: 'time_block.deleted',
    entityType: 'time_block',
    entityId: timeBlockId,
    metadata: {
      is_personal: timeBlock.is_personal
    }
  });

  res.status(204).send();
}));

export default router;
