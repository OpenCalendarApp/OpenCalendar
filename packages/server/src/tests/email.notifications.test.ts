import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildBookingEmailContent } from '../jobs/emailNotifications.js';

function restoreEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

void test('booking confirmation email includes subject and absolute reschedule URL', () => {
  const previousPortalUrl = process.env.BOOKING_PORTAL_BASE_URL;
  process.env.BOOKING_PORTAL_BASE_URL = 'https://calendar.example.com';

  try {
    const content = buildBookingEmailContent({
      event: 'booked',
      bookingToken: 'abc123',
      projectName: 'Discovery Session',
      clientEmail: 'client@example.com',
      clientFirstName: 'Taylor',
      rescheduleUrl: '/schedule/share-token/reschedule/abc123',
      sessionStartIso: '2026-04-01T15:00:00.000Z',
      sessionEndIso: '2026-04-01T15:30:00.000Z'
    });

    assert.equal(content.subject, 'Booking confirmed: Discovery Session');
    assert.ok(content.text.includes('Taylor'));
    assert.ok(content.text.includes('https://calendar.example.com/schedule/share-token/reschedule/abc123'));
    assert.ok(content.html.includes('Booking token'));
  } finally {
    restoreEnvVar('BOOKING_PORTAL_BASE_URL', previousPortalUrl);
  }
});

void test('reschedule and cancellation emails use expected wording', () => {
  const rescheduled = buildBookingEmailContent({
    event: 'rescheduled',
    bookingToken: 'res-123',
    projectName: 'Kickoff',
    clientEmail: 'client@example.com',
    clientFirstName: 'Alex',
    rescheduleUrl: 'https://calendar.example.com/schedule/share/reschedule/res-123'
  });
  assert.equal(rescheduled.subject, 'Booking updated: Kickoff');
  assert.ok(rescheduled.text.includes('rescheduled'));

  const cancelled = buildBookingEmailContent({
    event: 'cancelled',
    bookingToken: 'can-123',
    projectName: 'Kickoff',
    clientEmail: 'client@example.com',
    clientFirstName: 'Alex'
  });
  assert.equal(cancelled.subject, 'Booking cancelled: Kickoff');
  assert.ok(cancelled.text.includes('cancelled'));
});

void test('waitlist emails include confirmation and booking link copy', () => {
  const previousPortalUrl = process.env.BOOKING_PORTAL_BASE_URL;
  process.env.BOOKING_PORTAL_BASE_URL = 'https://calendar.example.com';

  try {
    const waitlisted = buildBookingEmailContent({
      event: 'waitlisted',
      bookingToken: 'waitlist-1',
      projectName: 'Kickoff',
      clientEmail: 'client@example.com',
      clientFirstName: 'Jordan',
      sessionStartIso: '2026-04-01T15:00:00.000Z',
      sessionEndIso: '2026-04-01T15:30:00.000Z'
    });
    assert.equal(waitlisted.subject, 'Waitlist confirmed: Kickoff');
    assert.ok(waitlisted.text.includes('waitlist'));

    const opened = buildBookingEmailContent({
      event: 'waitlist_opened',
      bookingToken: 'waitlist-2',
      projectName: 'Kickoff',
      clientEmail: 'client@example.com',
      clientFirstName: 'Jordan',
      bookingUrl: '/schedule/share-token',
      sessionStartIso: '2026-04-01T15:00:00.000Z',
      sessionEndIso: '2026-04-01T15:30:00.000Z'
    });
    assert.equal(opened.subject, 'Slot available: Kickoff');
    assert.ok(opened.text.includes('https://calendar.example.com/schedule/share-token'));
  } finally {
    restoreEnvVar('BOOKING_PORTAL_BASE_URL', previousPortalUrl);
  }
});
