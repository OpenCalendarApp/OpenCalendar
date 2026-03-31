import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

import { buildWeeklyRecurringWindows } from '../utils/recurrence.js';

void test('buildWeeklyRecurringWindows generates weekly windows with slots per occurrence', () => {
  const windows = buildWeeklyRecurringWindows({
    startTimeIso: '2026-04-06T16:00:00.000Z',
    endTimeIso: '2026-04-06T17:00:00.000Z',
    intervalWeeks: 1,
    occurrences: 3,
    slotsPerOccurrence: 2
  });

  assert.equal(windows.length, 6);
  assert.equal(windows[0]?.start_time, '2026-04-06T16:00:00.000Z');
  assert.equal(windows[1]?.start_time, '2026-04-06T17:00:00.000Z');
  assert.equal(windows[2]?.start_time, '2026-04-13T16:00:00.000Z');
  assert.equal(windows[4]?.start_time, '2026-04-20T16:00:00.000Z');
});

void test('time block routes include recurring endpoint', async () => {
  const routePath = new URL('../routes/timeBlocks.ts', import.meta.url);
  const source = await fs.readFile(routePath, 'utf8');

  assert.ok(source.includes("router.post('/recurring'"), 'Expected recurring route registration');
  assert.ok(source.includes('createRecurringTimeBlocksSchema'), 'Expected recurring schema usage');
  assert.ok(source.includes('buildWeeklyRecurringWindows'), 'Expected recurrence window utility usage');
});
