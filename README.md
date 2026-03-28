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

Auto bump rules:
- `patch`: Client-only changes (`packages/client/**`)
- `minor`: Server-only changes (`packages/server/**`)
- `major`: Both Client and Server changed

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
