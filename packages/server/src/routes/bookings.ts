import { Router } from 'express';

import {
  numericIdParamsSchema,
  updateSessionNotesSchema,
  type Booking
} from '@opencalendar/shared';

import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// PUT /api/v1/bookings/:id/notes
router.put('/:id/notes', authMiddleware, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const params = numericIdParamsSchema.parse(req.params);
  const body = updateSessionNotesSchema.parse(req.body);

  // Fetch the booking and verify it belongs to user's tenant + user has access
  const bookingResult = await pool.query<Booking & { project_id: number; project_created_by: number }>(
    `
    SELECT
      b.id,
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
      p.created_by AS project_created_by
    FROM bookings b
    INNER JOIN time_blocks tb ON tb.id = b.time_block_id
    INNER JOIN projects p ON p.id = tb.project_id
    WHERE b.id = $1
      AND b.tenant_id = $2
    `,
    [params.id, req.user.tenantId]
  );

  if (bookingResult.rows.length === 0) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }

  const booking = bookingResult.rows[0] as NonNullable<typeof bookingResult.rows[0]>;

  if (booking.cancelled_at) {
    res.status(400).json({ error: 'Cannot add notes to a cancelled booking' });
    return;
  }

  // Authorization: PM who owns the project, admin, or engineer assigned to the project
  const userId = req.user.userId;
  const role = req.user.role;
  let hasAccess = false;

  if (role === 'admin') {
    hasAccess = true;
  } else if (role === 'pm' && booking.project_created_by === userId) {
    hasAccess = true;
  } else if (role === 'engineer') {
    const assignmentResult = await pool.query(
      `
      SELECT 1
      FROM time_block_engineers tbe
      INNER JOIN time_blocks tb ON tb.id = tbe.time_block_id
      WHERE tb.project_id = $1
        AND tbe.engineer_id = $2
      LIMIT 1
      `,
      [booking.project_id, userId]
    );
    hasAccess = assignmentResult.rows.length > 0;
  }

  if (!hasAccess) {
    res.status(403).json({ error: 'You do not have permission to edit notes for this booking' });
    return;
  }

  const updateResult = await pool.query<Booking>(
    `
    UPDATE bookings
    SET session_notes = $1
    WHERE id = $2
      AND tenant_id = $3
    RETURNING
      id,
      time_block_id,
      client_first_name,
      client_last_name,
      client_email,
      client_phone,
      booking_token,
      booked_at,
      cancelled_at,
      session_notes
    `,
    [body.session_notes, params.id, req.user.tenantId]
  );

  res.json(updateResult.rows[0]);
}));

export default router;
