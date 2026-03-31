# Session Scheduler (CalendarGenie)

Phase 1 platform foundation for a Session Scheduler monorepo.

## Stack

- Frontend: React 18 + Vite + TypeScript
- Backend: Express + TypeScript
- Database: PostgreSQL 16
- Shared contracts: `@session-scheduler/shared`
- Infra: Docker Compose (postgres + optional full stack)

## Workspace Layout

- `packages/shared` shared types and validation schemas
- `packages/server` API server, DB migration/seed scripts
- `packages/client` React SPA
- `docker/init.sql` database schema and indexes

## Prerequisites

- Node.js 20+
- npm 10+
- Docker Desktop (or compatible Docker Engine)

## Environment

Create `.env` from the template:

```bash
cp .env.example .env
```

Important defaults:

- `DATABASE_URL` is for local Node scripts (`localhost`)
- `DOCKER_DATABASE_URL` is for the server container (`postgres` service hostname)

Full variable reference (defaults, required/conditional usage, behavior notes):
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)

## Local Development

```bash
npm install
npm run dev:setup
npm run dev
```

What this does:

- `dev:setup` starts Postgres in Docker and runs migration + seed
- `dev` starts shared watcher, API server, and Vite client

Default local URLs:

- Client: `http://localhost:5173`
- API: `http://localhost:4000`
- API health: `http://localhost:4000/api/health`

## Initial App Setup

- Open `http://localhost:5173/setup` on a fresh database to create the first tenant admin account.
- The setup flow calls:
  - `GET /api/setup/status`
  - `POST /api/setup/initialize`
- After setup completes, normal login/SSO uses `http://localhost:5173/login`.

## Docker Compose (full stack)

```bash
docker compose up --build -d
```

Default URLs:

- App (nginx + client): `http://localhost:3000`
- API (direct): `http://localhost:4000`

Stop services:

```bash
npm run docker:down
```

## Useful Scripts

- `npm run lint` lint all workspaces
- `npm run build` build all workspaces
- `npm run bump` auto bump root version from Client/Server changes
- `npm run bump -- --force patch|minor|major` force a version bump level
- `npm run db:migrate` apply database schema
- `npm run db:seed` insert demo seed records
- `npm run db:backup` create a compressed PostgreSQL backup from Docker Compose
- `npm run db:restore -- <file.sql.gz>` restore a PostgreSQL backup into Docker Compose

Auto bump rules:
- `patch`: Client-only changes (`packages/client/**`)
- `minor`: Server-only changes (`packages/server/**`)
- `major`: Both Client and Server changed

## Background Queue + Backup Automation (Epic 11)

- The server now runs an in-memory background job queue for retryable tasks.
- Booking lifecycle events enqueue `booking-email` jobs (booked, rescheduled, cancelled).
- Email delivery supports:
  - `EMAIL_PROVIDER=console` (default, logs structured payloads)
  - `EMAIL_PROVIDER=resend` (sends emails through Resend API)
- Retry behavior is configurable with:
  - `JOB_QUEUE_POLL_INTERVAL_MS`
  - `JOB_QUEUE_MAX_ATTEMPTS`
  - `JOB_QUEUE_BACKOFF_BASE_MS`
- Resend configuration:
  - `RESEND_API_KEY`
  - `EMAIL_FROM`
  - `BOOKING_PORTAL_BASE_URL` (used for absolute reschedule links)
- Backups can be created and restored with:
  - `npm run db:backup`
  - `npm run db:restore -- backups/<file>.sql.gz`

## Booking Idempotency (Epic 11)

- `POST /api/schedule/book/:shareToken` accepts an optional `Idempotency-Key` request header.
- Repeating the same request with the same key returns the original `201` booking payload instead of creating duplicates.
- Reusing a key with a different payload returns `409`.

## Booking Email Domain Allowlist (Epic 11)

- Projects can now define an optional `booking_email_domain_allowlist` (for example `client.com`).
- Public booking rejects emails outside that domain (subdomains are allowed).

## Microsoft Calendar Integration (Epic 11)

- Calendar sync is available for authenticated `engineer` users only.
- Engineers can connect/disconnect Microsoft Calendar from the dashboard.
- Booking lifecycle events now enqueue background sync jobs:
  - `booked` creates/updates engineer calendar events
  - `cancelled` removes engineer calendar events
  - `rescheduled` is handled as cancel old booking + create new booking events
- Required configuration:
  - `MICROSOFT_CLIENT_ID`
  - `MICROSOFT_CLIENT_SECRET`
  - `MICROSOFT_REDIRECT_URI`
- Optional configuration:
  - `MICROSOFT_TENANT_ID` (default `common`)
  - `MICROSOFT_OAUTH_SCOPES`
  - `MICROSOFT_OAUTH_STATE_TTL_SECONDS`
  - `MICROSOFT_OAUTH_STATE_SECRET` (falls back to `JWT_SECRET`)
  - `MICROSOFT_OAUTH_SUCCESS_REDIRECT_URL`
  - `MICROSOFT_OAUTH_ERROR_REDIRECT_URL`

## Recurring Time Blocks (Epic 11)

- PMs can now create recurring weekly schedules from the "Add Time Blocks" modal.
- New API endpoint: `POST /api/time-blocks/recurring` (also available under `/api/v1`).
- Recurring payload supports:
  - `slots_per_occurrence` for consecutive slots in each recurrence
  - `recurrence.interval_weeks`
  - `recurrence.occurrences`

## API Versioning (Epic 11)

- API routes are now exposed under both:
  - legacy: `/api/*`
  - versioned: `/api/v1/*`
- New clients should target `/api/v1`.

## Data Retention + Deletion Policies (Epic 11)

- The server now runs a periodic retention sweep that:
  - deletes expired booking idempotency records
  - redacts booking PII after a configurable retention window
  - hard-deletes cancelled bookings after a longer retention window
- New environment variables:
  - `DATA_RETENTION_ENABLED`
  - `DATA_RETENTION_SWEEP_INTERVAL_MS`
  - `DATA_RETENTION_PII_DAYS`
  - `DATA_RETENTION_CANCELLED_BOOKING_DELETE_DAYS`
  - `DATA_RETENTION_IDEMPOTENCY_KEY_DELETE_DAYS`
- Redacted booking fields are replaced with `[deleted]` markers and a synthetic email (`deleted+<id>@redacted.local`).

## Load Testing + Capacity Planning (Epic 11)

- A built-in load test runner is available at `scripts/load-test.mjs`.
- Supported scenarios:
  - `read-project` (public availability read path)
  - `book-contention` (booking transaction contention path)
- Run:
  - `LOADTEST_SHARE_TOKEN=<share-token> npm run loadtest:read`
  - `LOADTEST_SHARE_TOKEN=<share-token> LOADTEST_PASSWORD=<project-password> npm run loadtest:book`
- Full guide and planning targets: [`docs/LOAD_TESTING.md`](docs/LOAD_TESTING.md)

## Seed Credentials

- PM: `pm@example.com` / `password123`
- Engineer: `engineer@example.com` / `password123`

## Phase 1 Scope

Phase 1 includes:

- Monorepo + npm workspaces
- TypeScript project configs
- ESLint + Prettier setup
- Docker Compose orchestration
- Dev/database scripts for local setup
