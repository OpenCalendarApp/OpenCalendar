import { Router } from 'express';

import {
  bookingTokenParamsSchema,
  bookSlotSchema,
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
  type RescheduleResponse
} from '@session-scheduler/shared';

import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { publicReadRateLimiter, publicWriteRateLimiter } from '../middleware/rateLimit.js';
import { verifyPassword } from '../utils/auth.js';
import { createCalendarEvent } from '../utils/ics.js';

const router = Router();

type ProjectAuthRow = PublicProjectInfo & {
  signup_password_hash: string;
};

type AvailableSlotRow = {
  time_block_id: number;
  start_time: string;
  end_time: string;
  remaining_slots: number;
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

type BookingInsertRow = Booking;

type BookingLookupRow = Booking & {
  project_id: number;
  project_name: string;
  project_description: string;
  session_length_minutes: number;
  is_group_signup: boolean;
  share_token: string;
  current_start_time: string;
  current_end_time: string;
};

type LockedBookingRow = Booking & {
  project_id: number;
  project_name: string;
  project_description: string;
  share_token: string;
};

type CalendarBookingRow = Booking & {
  project_name: string;
  project_description: string;
  start_time: string;
  end_time: string;
};

router.get('/project/:shareToken', publicReadRateLimiter, asyncHandler(async (req, res) => {
  const paramsParse = shareTokenParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid share token', details: paramsParse.error.flatten() });
    return;
  }

  const { shareToken } = paramsParse.data;

  const projectResult = await pool.query<PublicProjectInfo>(
    `
    SELECT id, name, description, session_length_minutes, is_group_signup, share_token
    FROM projects
    WHERE share_token = $1
      AND is_active = true
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
      AND av.start_time > NOW()
    ORDER BY av.start_time ASC
    `,
    [project.id]
  );

  const slotIds = slotsResult.rows.map((slot) => slot.time_block_id);

  const engineersByBlock = new Map<number, PublicSlotInfo['engineers']>();

  if (slotIds.length > 0) {
    const engineersResult = await pool.query<SlotEngineerRow>(
      `
      SELECT tbe.time_block_id, u.first_name, u.last_name
      FROM time_block_engineers tbe
      INNER JOIN users u ON u.id = tbe.engineer_id
      WHERE tbe.time_block_id = ANY($1::int[])
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [slotIds]
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

  const response: PublicProjectResponse = {
    project,
    available_slots: availableSlots
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

  const projectResult = await pool.query<ProjectAuthRow>(
    `
    SELECT
      id,
      name,
      description,
      session_length_minutes,
      is_group_signup,
      share_token,
      signup_password_hash
    FROM projects
    WHERE share_token = $1
      AND is_active = true
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
    res.status(401).json({ error: 'Incorrect project password' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const blockResult = await client.query<LockedTimeBlockRow>(
      `
      SELECT id, start_time, end_time, max_signups
      FROM time_blocks
      WHERE id = $1
        AND project_id = $2
        AND start_time > NOW()
      FOR UPDATE
      `,
      [data.time_block_id, project.id]
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
        AND cancelled_at IS NULL
      `,
      [timeBlock.id]
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
        time_block_id,
        client_first_name,
        client_last_name,
        client_email,
        client_phone
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, time_block_id, client_first_name, client_last_name,
                client_email, client_phone, booking_token, booked_at, cancelled_at
      `,
      [
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

    const engineersResult = await client.query<EngineerSummary>(
      `
      SELECT u.id, u.first_name, u.last_name, u.email
      FROM time_block_engineers tbe
      INNER JOIN users u ON u.id = tbe.engineer_id
      WHERE tbe.time_block_id = $1
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [timeBlock.id]
    );

    await client.query('COMMIT');

    const engineerNames = engineersResult.rows
      .map((engineer) => `${engineer.first_name} ${engineer.last_name}`)
      .join(', ');

    const clientCalendar = createCalendarEvent({
      title: `${project.name} Session`,
      description: [
        project.description,
        engineerNames ? `Engineers: ${engineerNames}` : '',
        'Use your reschedule link if you need to make changes.'
      ]
        .filter(Boolean)
        .join('\n\n'),
      startIso: timeBlock.start_time,
      endIso: timeBlock.end_time
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

    res.status(201).json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to complete booking' });
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
      b.time_block_id,
      b.client_first_name,
      b.client_last_name,
      b.client_email,
      b.client_phone,
      b.booking_token,
      b.booked_at,
      b.cancelled_at,
      p.id AS project_id,
      p.name AS project_name,
      p.description AS project_description,
      p.session_length_minutes,
      p.is_group_signup,
      p.share_token,
      tb.start_time AS current_start_time,
      tb.end_time AS current_end_time
    FROM bookings b
    INNER JOIN time_blocks tb ON tb.id = b.time_block_id
    INNER JOIN projects p ON p.id = tb.project_id
    WHERE b.booking_token = $1
      AND b.cancelled_at IS NULL
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
      AND av.start_time > NOW()
      AND av.time_block_id <> $2
    ORDER BY av.start_time ASC
    `,
    [bookingRow.project_id, bookingRow.time_block_id]
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
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [uniqueSlotIds]
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
    session_length_minutes: bookingRow.session_length_minutes,
    is_group_signup: bookingRow.is_group_signup,
    share_token: bookingRow.share_token
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
    cancelled_at: bookingRow.cancelled_at
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

  try {
    await client.query('BEGIN');

    const bookingResult = await client.query<LockedBookingRow>(
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
        tb.project_id,
        p.name AS project_name,
        p.description AS project_description,
        p.share_token
      FROM bookings b
      INNER JOIN time_blocks tb ON tb.id = b.time_block_id
      INNER JOIN projects p ON p.id = tb.project_id
      WHERE b.booking_token = $1
        AND b.cancelled_at IS NULL
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
      `,
      [currentBooking.id]
    );

    const newBlockResult = await client.query<LockedTimeBlockRow>(
      `
      SELECT id, start_time, end_time, max_signups
      FROM time_blocks
      WHERE id = $1
        AND project_id = $2
        AND start_time > NOW()
      FOR UPDATE
      `,
      [data.new_time_block_id, currentBooking.project_id]
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
        AND cancelled_at IS NULL
      `,
      [newTimeBlock.id]
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
        time_block_id,
        client_first_name,
        client_last_name,
        client_email,
        client_phone
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, time_block_id, client_first_name, client_last_name,
                client_email, client_phone, booking_token, booked_at, cancelled_at
      `,
      [
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

    const engineersResult = await client.query<EngineerSummary>(
      `
      SELECT u.id, u.first_name, u.last_name, u.email
      FROM time_block_engineers tbe
      INNER JOIN users u ON u.id = tbe.engineer_id
      WHERE tbe.time_block_id = $1
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [newTimeBlock.id]
    );

    await client.query('COMMIT');

    const engineerNames = engineersResult.rows
      .map((engineer) => `${engineer.first_name} ${engineer.last_name}`)
      .join(', ');

    const clientCalendar = createCalendarEvent({
      title: `${currentBooking.project_name} Session`,
      description: [
        currentBooking.project_description,
        engineerNames ? `Engineers: ${engineerNames}` : '',
        'Your session has been rescheduled.'
      ]
        .filter(Boolean)
        .join('\n\n'),
      startIso: newTimeBlock.start_time,
      endIso: newTimeBlock.end_time
    });

    const response: RescheduleResponse = {
      booking: newBooking,
      client_calendar: clientCalendar,
      reschedule_url: `/schedule/${currentBooking.share_token}/reschedule/${newBooking.booking_token}`,
      message: 'Successfully rescheduled'
    };

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

  try {
    await client.query('BEGIN');

    const bookingResult = await client.query<Booking>(
      `
      SELECT id, time_block_id, client_first_name, client_last_name, client_email,
             client_phone, booking_token, booked_at, cancelled_at
      FROM bookings
      WHERE booking_token = $1
        AND cancelled_at IS NULL
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

    const cancelResult = await client.query<Booking>(
      `
      UPDATE bookings
      SET cancelled_at = NOW()
      WHERE id = $1
      RETURNING id, time_block_id, client_first_name, client_last_name,
                client_email, client_phone, booking_token, booked_at, cancelled_at
      `,
      [booking.id]
    );

    const cancelledBooking = cancelResult.rows[0];
    if (!cancelledBooking) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Unable to cancel booking' });
      return;
    }

    await client.query('COMMIT');

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
      b.time_block_id,
      b.client_first_name,
      b.client_last_name,
      b.client_email,
      b.client_phone,
      b.booking_token,
      b.booked_at,
      b.cancelled_at,
      p.name AS project_name,
      p.description AS project_description,
      tb.start_time,
      tb.end_time
    FROM bookings b
    INNER JOIN time_blocks tb ON tb.id = b.time_block_id
    INNER JOIN projects p ON p.id = tb.project_id
    WHERE b.booking_token = $1
      AND b.cancelled_at IS NULL
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
    ORDER BY u.first_name ASC, u.last_name ASC
    `,
    [booking.time_block_id]
  );

  const engineerNames = engineersResult.rows
    .map((engineer) => `${engineer.first_name} ${engineer.last_name}`)
    .join(', ');

  const calendarContent = createCalendarEvent({
    title: `${booking.project_name} Session`,
    description: [
      booking.project_description,
      engineerNames ? `Engineers: ${engineerNames}` : '',
      `Client: ${booking.client_first_name} ${booking.client_last_name}`
    ]
      .filter(Boolean)
      .join('\n\n'),
    startIso: booking.start_time,
    endIso: booking.end_time
  });

  const tokenPrefix = booking.booking_token.slice(0, 8);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="session-${tokenPrefix}.ics"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(calendarContent);
}));

export default router;
