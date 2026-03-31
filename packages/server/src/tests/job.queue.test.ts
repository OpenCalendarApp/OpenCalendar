import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryJobQueue } from '../jobs/queue.js';

void test('job queue retries with exponential backoff and eventually succeeds', async () => {
  const queue = new InMemoryJobQueue({
    pollIntervalMs: 1_000,
    maxAttempts: 4,
    backoffBaseMs: 10
  });

  let handlerCalls = 0;
  queue.registerHandler('demo-job', async () => {
    handlerCalls += 1;
    if (handlerCalls < 3) {
      throw new Error('Simulated transient failure');
    }
  });

  queue.enqueue('demo-job', { id: 'abc' }, 0);

  assert.equal(await queue.processNextDueJob(0), true);
  assert.equal(handlerCalls, 1);
  assert.equal(queue.getSnapshot().pending, 1);

  assert.equal(await queue.processNextDueJob(5), false);
  assert.equal(await queue.processNextDueJob(10), true);
  assert.equal(handlerCalls, 2);
  assert.equal(queue.getSnapshot().pending, 1);

  assert.equal(await queue.processNextDueJob(29), false);
  assert.equal(await queue.processNextDueJob(30), true);
  assert.equal(handlerCalls, 3);
  assert.equal(queue.getSnapshot().pending, 0);
  assert.equal(queue.getSnapshot().dead_letter, 0);
});

void test('job queue dead-letters job when handler is missing', async () => {
  const queue = new InMemoryJobQueue({
    pollIntervalMs: 1_000,
    maxAttempts: 2,
    backoffBaseMs: 10
  });

  queue.enqueue('missing-handler-job', { id: 'xyz' }, 0);
  assert.equal(await queue.processNextDueJob(0), true);

  const snapshot = queue.getSnapshot();
  assert.equal(snapshot.pending, 0);
  assert.equal(snapshot.dead_letter, 1);
});
