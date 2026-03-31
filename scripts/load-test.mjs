#!/usr/bin/env node

import process from 'node:process';

const allowedScenarios = new Set(['read-project', 'book-contention']);

function printUsage() {
  console.log(`
Calendar Genie Load Test Runner

Usage:
  node scripts/load-test.mjs <scenario>

Scenarios:
  read-project      Repeatedly calls GET /schedule/project/:shareToken
  book-contention   Repeatedly attempts booking requests against available slots

Environment:
  LOADTEST_BASE_URL            Base URL (default: http://127.0.0.1:4000)
  LOADTEST_API_BASE_PATH       API prefix (default: /api/v1)
  LOADTEST_SHARE_TOKEN         Required for all scenarios
  LOADTEST_PASSWORD            Required for book-contention
  LOADTEST_TIME_BLOCK_ID       Optional fixed slot for book-contention
  LOADTEST_DURATION_SECONDS    Test duration in seconds (default: 30)
  LOADTEST_VUS                 Virtual users / concurrency (default: 10)
  LOADTEST_THINK_TIME_MS       Delay between iterations per VU (default: 20)
  LOADTEST_EMAIL_DOMAIN        Booking email domain (default: example.com)
  LOADTEST_METRICS_TOKEN       Optional x-metrics-token for /metrics snapshot
`);
}

function parsePositiveInt(rawValue, fallback) {
  const parsed = Number(rawValue ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index] ?? 0;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const scenarioArg = process.argv[2];

if (!scenarioArg || scenarioArg === '--help' || scenarioArg === '-h') {
  printUsage();
  process.exit(0);
}

if (!allowedScenarios.has(scenarioArg)) {
  console.error(`Unknown scenario "${scenarioArg}".`);
  printUsage();
  process.exit(1);
}

const scenario = scenarioArg;
const baseUrl = (process.env.LOADTEST_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
const apiBasePathRaw = process.env.LOADTEST_API_BASE_PATH ?? '/api/v1';
const apiBasePath = apiBasePathRaw.startsWith('/') ? apiBasePathRaw : `/${apiBasePathRaw}`;
const shareToken = process.env.LOADTEST_SHARE_TOKEN ?? '';
const password = process.env.LOADTEST_PASSWORD ?? '';
const fixedTimeBlockId = process.env.LOADTEST_TIME_BLOCK_ID ? Number(process.env.LOADTEST_TIME_BLOCK_ID) : null;
const durationSeconds = parsePositiveInt(process.env.LOADTEST_DURATION_SECONDS, 30);
const virtualUsers = parsePositiveInt(process.env.LOADTEST_VUS, 10);
const thinkTimeMs = parsePositiveInt(process.env.LOADTEST_THINK_TIME_MS, 20);
const emailDomain = process.env.LOADTEST_EMAIL_DOMAIN ?? 'example.com';
const metricsToken = process.env.LOADTEST_METRICS_TOKEN ?? '';

if (!shareToken) {
  console.error('Missing LOADTEST_SHARE_TOKEN');
  process.exit(1);
}

if (scenario === 'book-contention' && !password) {
  console.error('Missing LOADTEST_PASSWORD for book-contention scenario');
  process.exit(1);
}

if (fixedTimeBlockId !== null && (!Number.isFinite(fixedTimeBlockId) || fixedTimeBlockId <= 0)) {
  console.error('LOADTEST_TIME_BLOCK_ID must be a positive integer');
  process.exit(1);
}

const projectPath = `${apiBasePath}/schedule/project/${shareToken}`;
const bookPath = `${apiBasePath}/schedule/book/${shareToken}`;
const metricsPath = `${apiBasePath}/metrics`;

const totals = {
  startedAtMs: Date.now(),
  iterations: 0,
  successfulResponses: 0,
  failedResponses: 0,
  networkErrors: 0,
  emptySlotIterations: 0
};

const latenciesMs = [];
const statusCounts = new Map();
const endpointCounts = new Map();
const errorMessages = new Map();

function recordStatus(status) {
  statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
}

function recordEndpoint(path) {
  endpointCounts.set(path, (endpointCounts.get(path) ?? 0) + 1);
}

function recordError(message) {
  errorMessages.set(message, (errorMessages.get(message) ?? 0) + 1);
}

async function timedRequest(path, options = {}) {
  const started = Date.now();
  recordEndpoint(path);

  const response = await fetch(`${baseUrl}${path}`, options);
  const latencyMs = Date.now() - started;
  const json = await readJsonSafe(response);

  latenciesMs.push(latencyMs);
  recordStatus(response.status);

  if (response.ok) {
    totals.successfulResponses += 1;
  } else {
    totals.failedResponses += 1;
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
    latencyMs
  };
}

async function getAvailableTimeBlockId() {
  if (fixedTimeBlockId !== null) {
    return fixedTimeBlockId;
  }

  const result = await timedRequest(projectPath, { method: 'GET' });

  if (!result.ok) {
    return null;
  }

  const responseJson = result.json;
  if (!responseJson || typeof responseJson !== 'object') {
    return null;
  }

  const availableSlots = Array.isArray(responseJson.available_slots) ? responseJson.available_slots : [];
  if (availableSlots.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * availableSlots.length);
  const selectedSlot = availableSlots[randomIndex];
  const selectedId = selectedSlot?.time_block_id;

  if (!Number.isFinite(selectedId) || selectedId <= 0) {
    return null;
  }

  return selectedId;
}

async function runReadProjectIteration() {
  await timedRequest(projectPath, { method: 'GET' });
}

async function runBookContentionIteration(workerId, iteration) {
  const timeBlockId = await getAvailableTimeBlockId();
  if (!timeBlockId) {
    totals.emptySlotIterations += 1;
    return;
  }

  const uniqueSuffix = `${Date.now()}-${workerId}-${iteration}-${Math.floor(Math.random() * 100000)}`;
  const idempotencyKey = `loadtest-${uniqueSuffix}`;

  await timedRequest(bookPath, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey
    },
    body: JSON.stringify({
      password,
      time_block_id: timeBlockId,
      first_name: 'Load',
      last_name: `Tester-${workerId}`,
      email: `loadtest+${uniqueSuffix}@${emailDomain}`,
      phone: '555-0100'
    })
  });
}

async function runWorker(workerId, deadlineMs) {
  let iteration = 0;

  while (Date.now() < deadlineMs) {
    iteration += 1;
    totals.iterations += 1;

    try {
      if (scenario === 'read-project') {
        await runReadProjectIteration();
      } else {
        await runBookContentionIteration(workerId, iteration);
      }
    } catch (error) {
      totals.networkErrors += 1;
      totals.failedResponses += 1;
      recordError(error instanceof Error ? error.message : 'Unknown network error');
    }

    if (thinkTimeMs > 0) {
      await sleep(thinkTimeMs);
    }
  }
}

async function fetchMetricsSnapshot() {
  try {
    const response = await fetch(`${baseUrl}${metricsPath}`, {
      method: 'GET',
      headers: metricsToken ? { 'x-metrics-token': metricsToken } : {}
    });

    if (!response.ok) {
      console.log(`Metrics snapshot skipped (${response.status})`);
      return;
    }

    const payload = await readJsonSafe(response);
    if (!payload || typeof payload !== 'object' || !payload.metrics) {
      console.log('Metrics snapshot available but no metrics payload found.');
      return;
    }

    const bookingMetrics = payload.metrics.booking ?? {};
    console.log('\nMetrics Snapshot');
    console.log(`  booking_attempts: ${bookingMetrics.attempts ?? 0}`);
    console.log(`  booking_success:  ${bookingMetrics.success ?? 0}`);
    console.log(`  booking_failure:  ${bookingMetrics.failure ?? 0}`);
  } catch {
    console.log('Metrics snapshot skipped (request failed).');
  }
}

function printSummary() {
  const endedAtMs = Date.now();
  const elapsedMs = Math.max(1, endedAtMs - totals.startedAtMs);
  const elapsedSeconds = elapsedMs / 1000;
  const throughput = totals.iterations / elapsedSeconds;
  const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
  const latencyAverage =
    latenciesMs.length === 0 ? 0 : latenciesMs.reduce((sum, current) => sum + current, 0) / latenciesMs.length;

  console.log('\nLoad Test Summary');
  console.log(`  Scenario:           ${scenario}`);
  console.log(`  Base URL:           ${baseUrl}${apiBasePath}`);
  console.log(`  Duration (seconds): ${elapsedSeconds.toFixed(2)}`);
  console.log(`  Virtual users:      ${virtualUsers}`);
  console.log(`  Iterations:         ${totals.iterations}`);
  console.log(`  Throughput:         ${throughput.toFixed(2)} it/s`);
  console.log(`  Responses OK:       ${totals.successfulResponses}`);
  console.log(`  Responses failed:   ${totals.failedResponses}`);
  console.log(`  Network errors:     ${totals.networkErrors}`);
  if (scenario === 'book-contention') {
    console.log(`  Empty slot loops:   ${totals.emptySlotIterations}`);
  }
  console.log(`  Latency avg (ms):   ${latencyAverage.toFixed(2)}`);
  console.log(`  Latency p50 (ms):   ${percentile(sortedLatencies, 50).toFixed(2)}`);
  console.log(`  Latency p95 (ms):   ${percentile(sortedLatencies, 95).toFixed(2)}`);
  console.log(`  Latency p99 (ms):   ${percentile(sortedLatencies, 99).toFixed(2)}`);

  if (statusCounts.size > 0) {
    console.log('\nStatus Counts');
    for (const [status, count] of [...statusCounts.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
      console.log(`  ${status}: ${count}`);
    }
  }

  if (endpointCounts.size > 0) {
    console.log('\nEndpoint Counts');
    for (const [path, count] of endpointCounts.entries()) {
      console.log(`  ${path}: ${count}`);
    }
  }

  if (errorMessages.size > 0) {
    console.log('\nNetwork Error Samples');
    for (const [message, count] of errorMessages.entries()) {
      console.log(`  ${count}x ${message}`);
    }
  }
}

async function main() {
  console.log(`Starting load test (${scenario}) with ${virtualUsers} virtual users for ${durationSeconds} seconds...`);
  const deadlineMs = Date.now() + durationSeconds * 1000;

  const workers = [];
  for (let workerId = 1; workerId <= virtualUsers; workerId += 1) {
    workers.push(runWorker(workerId, deadlineMs));
  }

  await Promise.all(workers);
  printSummary();
  await fetchMetricsSnapshot();
}

await main();
