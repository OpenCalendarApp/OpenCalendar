# Load Testing + Capacity Planning (EPIC 11)

This document defines the baseline process for load validation and capacity planning for Calendar Genie.

## Goals

- Measure read-path and booking-path performance under controlled concurrency.
- Catch regressions before production changes are promoted.
- Keep a repeatable planning model for expected traffic growth.

## Test Scenarios

Use `scripts/load-test.mjs` with one of these scenarios:

- `read-project`
  - Hits `GET /api/v1/schedule/project/:shareToken`
  - Measures public slot lookup throughput and latency.
- `book-contention`
  - Hits `POST /api/v1/schedule/book/:shareToken` with unique contact payloads and idempotency keys.
  - Exercises booking transaction behavior when slots are being competed for.

## Quick Start

1. Start the app and database in a stable environment (local Docker or staging).
2. Pick a project `share_token` with future slots.
3. Run a read-path baseline:

```bash
LOADTEST_SHARE_TOKEN=<share-token> \
npm run loadtest:read
```

4. Run booking contention:

```bash
LOADTEST_SHARE_TOKEN=<share-token> \
LOADTEST_PASSWORD=<project-password> \
npm run loadtest:book
```

## Environment Variables

- `LOADTEST_BASE_URL` default `http://127.0.0.1:4000`
- `LOADTEST_API_BASE_PATH` default `/api/v1`
- `LOADTEST_SHARE_TOKEN` required for both scenarios
- `LOADTEST_PASSWORD` required for `book-contention`
- `LOADTEST_TIME_BLOCK_ID` optional fixed slot for `book-contention`
- `LOADTEST_DURATION_SECONDS` default `30`
- `LOADTEST_VUS` default `10`
- `LOADTEST_THINK_TIME_MS` default `20`
- `LOADTEST_EMAIL_DOMAIN` default `example.com`
- `LOADTEST_METRICS_TOKEN` optional token for `/api/v1/metrics`

## Capacity Planning Targets

Track these targets per environment and release:

- Read-path p95 latency (`read-project`) under `250ms`
- Booking-path p95 latency (`book-contention`) under `750ms`
- Non-rate-limit error rate under `1%` during steady-state test windows
- Stable throughput with no rising network-error trend during 30-minute soak

Recommended cadence:

- Baseline run: every feature release affecting booking/project routes
- Soak run: weekly on staging
- Capacity review: monthly

## Suggested Test Profiles

- Baseline:
  - `LOADTEST_DURATION_SECONDS=120`
  - `LOADTEST_VUS=10`
  - `LOADTEST_THINK_TIME_MS=40`
- Stress:
  - `LOADTEST_DURATION_SECONDS=180`
  - `LOADTEST_VUS=40`
  - `LOADTEST_THINK_TIME_MS=15`
- Soak:
  - `LOADTEST_DURATION_SECONDS=1800`
  - `LOADTEST_VUS=20`
  - `LOADTEST_THINK_TIME_MS=30`

## Interpreting Results

- High `429` counts:
  - expected when rate limits are reached; verify thresholds are intentional.
- High `409` on booking:
  - expected under slot contention; validate success ratio and retry behavior.
- Rising p95/p99 with low CPU:
  - likely DB contention/index issue.
- Rising network errors:
  - likely connection limits, proxy, or upstream instability.

Capture and archive after each run:

- Script summary output
- `/api/v1/metrics` snapshot
- DB activity snapshot (`pg_stat_activity`, slow query sample)
- Infra telemetry (CPU, memory, connection counts)
