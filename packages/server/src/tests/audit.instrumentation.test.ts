import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

void test('project routes include audit-log instrumentation for privileged mutations', async () => {
  const routePath = new URL('../routes/projects.ts', import.meta.url);
  const source = await fs.readFile(routePath, 'utf8');

  assert.ok(source.includes('recordAuditEventSafe'), 'Expected audit utility import');
  assert.ok(source.includes("'project.created'"), 'Expected project.created action');
  assert.ok(source.includes("'project.updated'"), 'Expected project.updated action');
  assert.ok(source.includes("'project.deleted'"), 'Expected project.deleted action');
});

void test('time block routes include audit-log instrumentation for create/delete flows', async () => {
  const routePath = new URL('../routes/timeBlocks.ts', import.meta.url);
  const source = await fs.readFile(routePath, 'utf8');

  assert.ok(source.includes('recordAuditEventSafe'), 'Expected audit utility import');
  assert.ok(source.includes("'time_block.created'"), 'Expected time_block.created action');
  assert.ok(source.includes("'time_block.batch_created'"), 'Expected time_block.batch_created action');
  assert.ok(source.includes("'time_block.recurring_created'"), 'Expected time_block.recurring_created action');
  assert.ok(source.includes("'time_block.updated'"), 'Expected time_block.updated action');
  assert.ok(source.includes("'time_block.personal_updated'"), 'Expected time_block.personal_updated action');
  assert.ok(source.includes("'time_block.deleted'"), 'Expected time_block.deleted action');
});
