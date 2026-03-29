import { Router } from 'express';
import type { PoolClient } from 'pg';

import {
  createTimeBlockSchema,
  createTimeBlocksBatchSchema,
  numericIdParamsSchema,
  type Project,
  type TimeBlock,
  type TimeBlocksResponse
} from '@session-scheduler/shared';

import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

type ProjectCapacityRow = Pick<Project, 'id' | 'is_group_signup' | 'max_group_size'>;
type TimeBlockDeleteRow = {
  id: number;
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

async function fetchProjectCapacity(projectId: number, client?: PoolClient): Promise<ProjectCapacityRow | null> {
  const db = client ?? pool;

  const result = await db.query<ProjectCapacityRow>(
    `
    SELECT id, is_group_signup, max_group_size
    FROM projects
    WHERE id = $1
    `,
    [projectId]
  );

  return result.rows[0] ?? null;
}

async function validateEngineerIds(engineerIds: number[], client?: PoolClient): Promise<number[]> {
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
    `,
    [engineerIds]
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
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, project_id, start_time, end_time, max_signups, is_personal, created_by, created_at
    `,
    [
      args.project_id,
      args.start_time,
      args.end_time,
      args.max_signups,
      args.is_personal,
      args.created_by
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

  const project = await fetchProjectCapacity(data.project_id);
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

  const missingEngineerIds = await validateEngineerIds(engineerIds);
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
      created_by: req.user.userId
    });

    await assignEngineersToBlock(client, timeBlock.id, engineerIds);

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

router.post('/batch', authMiddleware, requireRole(['pm']), asyncHandler(async (req, res) => {
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

  const project = await fetchProjectCapacity(data.project_id);
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
  const missingEngineerIds = await validateEngineerIds(uniqueEngineerIds);
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
        created_by: req.user.userId
      });

      await assignEngineersToBlock(client, createdBlock.id, block.engineer_ids);
      createdBlocks.push(createdBlock);
    }

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
    GROUP BY tb.id
    `,
    [timeBlockId]
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
    `,
    [timeBlockId]
  );

  res.status(204).send();
}));

export default router;
