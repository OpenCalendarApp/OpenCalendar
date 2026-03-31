import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCalendarEvent } from '../utils/ics.js';

void test('calendar event includes URL field for manage-booking link', () => {
  const content = createCalendarEvent({
    title: 'Session',
    description: 'Manage booking from link',
    startIso: '2026-04-10T15:00:00.000Z',
    endIso: '2026-04-10T16:00:00.000Z',
    url: 'https://calendar.example.com/schedule/share-token/reschedule/booking-token'
  });
  const unfolded = content.replace(/\r\n /g, '');

  assert.ok(
    unfolded.includes('URL:https://calendar.example.com/schedule/share-token/reschedule/booking-token'),
    'Expected ICS URL field with manage-booking link'
  );
});
