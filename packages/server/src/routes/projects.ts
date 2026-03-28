import bcrypt from 'bcrypt';
import { Router } from 'express';

import { createProjectSchema, type Project } from '@session-scheduler/shared';

import { pool } from '../db/pool.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', authMiddleware, async (_req, res) => {
  const result = await pool.query<
    Project & {
      time_block_count: string;
      active_booking_count: string;
    }
  >(
    `
    SELECT
      p.id,
      p.name,
      p.description,
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
    GROUP BY p.id
    ORDER BY p.created_at DESC
    `
  );

  res.json({ projects: result.rows });
});

router.post('/', authMiddleware, requireRole(['pm']), async (req, res) => {
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
  const hashedPassword = await bcrypt.hash(data.signup_password, 10);

  const result = await pool.query<Project>(
    `
    INSERT INTO projects (
      name,
      description,
      created_by,
      signup_password_hash,
      is_group_signup,
      max_group_size,
      session_length_minutes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, name, description, created_by, is_group_signup, max_group_size,
              session_length_minutes, share_token, is_active, created_at, updated_at
    `,
    [
      data.name,
      data.description,
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

  res.status(201).json({ project });
});

export default router;
