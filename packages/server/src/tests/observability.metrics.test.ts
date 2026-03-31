import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

import {
  getMetricsSnapshot,
  recordAbuseEventMetric,
  recordHttpRequestMetric,
  recordQueueEventMetric,
  recordRateLimitMetric,
  resetMetricsForTests
} from '../observability/metrics.js';

void test('metrics snapshot aggregates request counters and durations', () => {
  resetMetricsForTests();

  recordHttpRequestMetric({
    method: 'GET',
    path: '/api/health/live',
    statusCode: 200,
    durationMs: 10
  });
  recordHttpRequestMetric({
    method: 'GET',
    path: '/api/health/live',
    statusCode: 200,
    durationMs: 30
  });
  recordRateLimitMetric('public-write');
  recordAbuseEventMetric('project_password_failed_attempt');
  recordQueueEventMetric('enqueued:booking-email');

  const snapshot = getMetricsSnapshot();
  assert.ok(snapshot.uptime_seconds >= 0);
  assert.ok(snapshot.requests.some((entry) => entry.key === 'GET /api/health/live 200' && entry.count === 2));
  assert.ok(
    snapshot.request_durations.some((entry) =>
      entry.key === 'GET /api/health/live' && entry.count === 2 && entry.avg_ms === 20 && entry.max_ms === 30
    )
  );
  assert.ok(snapshot.rate_limits.some((entry) => entry.key === 'public-write' && entry.count === 1));
  assert.ok(
    snapshot.abuse_events.some((entry) => entry.key === 'project_password_failed_attempt' && entry.count === 1)
  );
  assert.ok(
    snapshot.queue_events.some((entry) => entry.key === 'enqueued:booking-email' && entry.count === 1)
  );
});

void test('app defines token-protected metrics endpoints for legacy and v1 routes', async () => {
  const appSourcePath = new URL('../app.ts', import.meta.url);
  const source = await fs.readFile(appSourcePath, 'utf8');

  assert.ok(source.includes('${basePath}/metrics'), 'Expected versioned metrics route builder');
  assert.ok(source.includes("mountApiVersionRoutes(app, '/api');"), 'Expected legacy /api route mount');
  assert.ok(source.includes("mountApiVersionRoutes(app, '/api/v1');"), 'Expected /api/v1 route mount');
  assert.ok(source.includes('x-metrics-token'), 'Expected x-metrics-token header check');
  assert.ok(source.includes('Unauthorized metrics access'), 'Expected unauthorized metrics response');
  assert.ok(source.includes("'x-api-version', 'legacy'"), 'Expected legacy API version header');
  assert.ok(source.includes("'x-api-version', 'v1'"), 'Expected v1 API version header');
});
