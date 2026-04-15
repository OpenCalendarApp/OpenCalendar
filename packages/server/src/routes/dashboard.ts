import { Router } from 'express';

import type { DashboardStats, DashboardStatsResponse } from '@opencalendar/shared';

import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/v1/dashboard/stats
 * Returns aggregate dashboard metrics scoped to the authenticated user's tenant and role.
 * PMs/admins see project-owner stats; engineers see assignment-based stats.
 */
router.get('/stats', asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const { tenantId, role, userId } = req.user;

  // Engineers: scope to projects where they have assigned time blocks
  // PMs/admins: scope to all tenant projects
  const projectScopeClause = role === 'engineer'
    ? `AND p.id IN (
        SELECT DISTINCT tb2.project_id
        FROM time_block_engineers tbe2
        INNER JOIN time_blocks tb2 ON tb2.id = tbe2.time_block_id
        WHERE tbe2.engineer_id = $2
          AND tb2.tenant_id = $1
      )`
    : '';

  const params = role === 'engineer' ? [tenantId, userId] : [tenantId];

  const result = await pool.query<DashboardStats>(
    `
    SELECT
      (
        SELECT COUNT(*)::int
        FROM projects p
        WHERE p.tenant_id = $1
          AND p.is_active = true
          ${projectScopeClause}
      ) AS active_projects,

      (
        SELECT COUNT(DISTINCT b.id)::int
        FROM bookings b
        INNER JOIN time_blocks tb ON tb.id = b.time_block_id
        INNER JOIN projects p ON p.id = tb.project_id
        WHERE b.tenant_id = $1
          AND b.cancelled_at IS NULL
          AND tb.start_time >= date_trunc('week', CURRENT_DATE)
          AND tb.start_time < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
          ${projectScopeClause}
      ) AS sessions_this_week,

      (
        SELECT COUNT(DISTINCT b.id)::int
        FROM bookings b
        INNER JOIN time_blocks tb ON tb.id = b.time_block_id
        INNER JOIN projects p ON p.id = tb.project_id
        WHERE b.tenant_id = $1
          AND b.cancelled_at IS NULL
          AND tb.start_time > NOW()
          ${projectScopeClause}
      ) AS pending_bookings,

      (
        SELECT COUNT(DISTINCT b.id)::int
        FROM bookings b
        INNER JOIN time_blocks tb ON tb.id = b.time_block_id
        INNER JOIN projects p ON p.id = tb.project_id
        WHERE b.tenant_id = $1
          AND b.cancelled_at IS NULL
          AND tb.start_time > NOW()
          AND tb.start_time <= NOW() + INTERVAL '24 hours'
          ${projectScopeClause}
      ) AS upcoming_next_24h,

      (
        SELECT COUNT(DISTINCT u.id)::int
        FROM users u
        WHERE u.tenant_id = $1
          AND u.is_active = true
      ) AS team_members,

      (
        SELECT COUNT(DISTINCT b.id)::int
        FROM bookings b
        INNER JOIN time_blocks tb ON tb.id = b.time_block_id
        INNER JOIN projects p ON p.id = tb.project_id
        WHERE b.tenant_id = $1
          AND b.cancelled_at IS NULL
          AND b.booked_at >= date_trunc('month', CURRENT_DATE)
          AND b.booked_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
          ${projectScopeClause}
      ) AS total_bookings_this_month
    `,
    params
  );

  const stats = result.rows[0];
  if (!stats) {
    res.status(500).json({ error: 'Unable to compute dashboard stats' });
    return;
  }

  const response: DashboardStatsResponse = { stats };
  res.json(response);
}));

export default router;
