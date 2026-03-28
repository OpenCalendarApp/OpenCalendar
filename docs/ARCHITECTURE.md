# Session Scheduler — Architecture Document

> **Version:** 1.0  
> **Last Updated:** March 2026  
> **Status:** Pre-development spec

---

## Table of Contents

1. [Overview](#1-overview)
2. [User Roles & Permissions](#2-user-roles--permissions)
3. [User Flows](#3-user-flows)
4. [System Architecture](#4-system-architecture)
5. [Database Schema](#5-database-schema)
6. [API Contract](#6-api-contract)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Infrastructure & Deployment](#8-infrastructure--deployment)
9. [Security Considerations](#9-security-considerations)
10. [Future Considerations](#10-future-considerations)

---

## 1. Overview

### Purpose

Session Scheduler is an internal scheduling platform that allows Project Managers to create time-blocked sessions for projects, assign engineers to those blocks, and generate password-protected booking links for external clients. Clients visit the link, authenticate with a project-specific password, select an available time slot, and receive a downloadable `.ics` calendar reminder. Clients can also reschedule or cancel, which automatically frees the original slot.

### Core Requirements

- **Mono-repo** — single repository housing client, server, and shared types
- **PostgreSQL backend** — relational schema with race-condition-safe booking
- **Reactive design** — mobile-first, responsive across devices
- **Lightweight** — minimal dependencies, fast load times
- **.ics calendar generation** — universal format (Apple Calendar, Google Calendar, Outlook)
- **Client rescheduling** — frees original slot automatically

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, React Router v6 |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL 16 |
| Auth | JWT (stateless), bcrypt password hashing |
| Validation | Zod (server-side) |
| Calendar | Custom .ics generator (RFC 5545 compliant) |
| Infra | Docker Compose, nginx reverse proxy |
| Monorepo | npm workspaces |

---

## 2. User Roles & Permissions

### Role Definitions

| Role | Description | Authentication |
|------|------------|----------------|
| **Project Manager (PM)** | Creates projects, defines time blocks, assigns engineers, manages all scheduling | JWT — email/password login |
| **Engineer** | Assigned to time blocks by PMs, can create personal time blocks | JWT — email/password login |
| **Client** | External user who books sessions via a shared link | Project-specific password (no account required) |

### Permission Matrix

| Action | PM | Engineer | Client |
|--------|:--:|:--------:|:------:|
| Create project | ✅ | ❌ | ❌ |
| Edit/delete project | ✅ | ❌ | ❌ |
| Create time blocks (batch) | ✅ | ❌ | ❌ |
| Create personal time blocks | ❌ | ✅ | ❌ |
| Assign engineers to blocks | ✅ | ❌ | ❌ |
| Delete time blocks | ✅ | Own only | ❌ |
| View all projects & bookings | ✅ | ✅ | ❌ |
| Book a session | ❌ | ❌ | ✅ |
| Reschedule booking | ❌ | ❌ | ✅ |
| Cancel booking | ❌ | ❌ | ✅ |
| Download .ics calendar | ❌ | ❌ | ✅ |
| View client booking link | ✅ | ✅ | N/A |

### Key Rules

- Engineers cannot create projects or assign other engineers — that's PM-only
- Engineers CAN create personal time blocks scoped to themselves (marked `is_personal = true`)
- Deleting a time block with active (non-cancelled) bookings is prohibited — cancellation must happen first
- Clients never create accounts; they authenticate per-project using a shared password

---

## 3. User Flows

### 3.1 PM: Project Setup Flow

```
PM logs in
  → Dashboard (list of projects)
  → "Create Project"
     → Enter: name, description, session length, signup type (group/individual),
       max group size (if group), client password
     → Project created with unique `share_token`
  → Project Detail
     → "Add Time Blocks"
        → Select: date, start time, # of consecutive slots
        → Assign engineers from registered engineer list
        → Blocks created (batch insert)
     → Copy shareable booking URL
        → URL format: /schedule/{share_token}
     → View bookings table (who booked what, contact info)
```

### 3.2 Engineer: View Assignments

```
Engineer logs in
  → Dashboard (list of projects they're assigned to)
  → Project Detail
     → See their assigned time blocks
     → Optionally create personal time blocks
  → When a client books their slot:
     → Engineer .ics is generated with client contact info and project description
```

### 3.3 Client: Booking Flow

```
Client receives booking URL from PM/team
  → Visit /schedule/{share_token}
  → Step 1: Enter project password
     → Invalid? Error message, retry
     → Valid? Proceed to slot selection
  → Step 2: Browse available time slots (grouped by date)
     → Slots show: time range, remaining spots, assigned engineer names
     → Select a slot
  → Step 3: Enter contact details
     → First name, last name, email, phone (all required)
  → Step 4: Confirmation
     → Booking confirmed
     → Download .ics calendar reminder
     → .ics includes: project name, description, engineer names, session time
     → Reschedule link provided (contains unique booking_token)
```

### 3.4 Client: Reschedule Flow

```
Client clicks reschedule link (or saves it from confirmation)
  → /schedule/{share_token}/reschedule/{booking_token}
  → View current booking details
  → Browse other available slots for the same project
  → Select new slot → Confirm
     → Old booking: cancelled_at timestamp set (slot freed)
     → New booking: created with new booking_token
     → New .ics generated and offered for download
  → OR: Cancel entirely
     → Booking marked cancelled, slot freed
```

### 3.5 Calendar (.ics) Generation

Two variants are generated per booking:

| Recipient | Calendar Contains |
|-----------|------------------|
| **Client** | Project name, project description, session time, assigned engineer names, reschedule reminder |
| **Engineer(s)** | Project name, project description, session time, client name, client email, client phone |

Both are standard `.ics` (RFC 5545) files downloadable on any platform.

---

## 4. System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Docker Compose                                                  │
│                                                                  │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │   nginx       │    │  Express API     │    │ PostgreSQL 16 │  │
│  │   (port 80)   │───▶│  (port 4000)     │───▶│  (port 5432)  │  │
│  │               │    │                  │    │               │  │
│  │  Serves React │    │  JWT Auth        │    │  5 tables     │  │
│  │  SPA + proxy  │    │  REST endpoints  │    │  1 view       │  │
│  │  /api → :4000 │    │  Zod validation  │    │  Indexes      │  │
│  └──────────────┘    │  .ics generation  │    └───────────────┘  │
│                       └──────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘

External:
  ┌──────────┐  HTTPS   ┌──────────┐  Password  ┌──────────┐
  │ PM/Eng   │────────▶│  React   │           │  Client  │
  │ (JWT)    │         │  SPA     │◀──────────│ (no acct)│
  └──────────┘         └──────────┘           └──────────┘
```

### Monorepo Structure

```
session-scheduler/
├── package.json                 # npm workspaces root
├── docker-compose.yml           # Orchestration
├── .env.example                 # Environment template
├── docker/
│   └── init.sql                 # Database schema
├── packages/
│   ├── shared/                  # @session-scheduler/shared
│   │   ├── package.json
│   │   └── src/
│   │       └── types.ts         # Shared TypeScript interfaces
│   ├── server/                  # @session-scheduler/server
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts         # Express entry point
│   │       ├── db/
│   │       │   ├── pool.ts      # PG connection pool
│   │       │   ├── migrate.ts   # Schema runner
│   │       │   └── seed.ts      # Sample data
│   │       ├── middleware/
│   │       │   └── auth.ts      # JWT + RBAC middleware
│   │       ├── routes/
│   │       │   ├── auth.ts      # Login, register, profile
│   │       │   ├── projects.ts  # CRUD projects
│   │       │   ├── timeBlocks.ts# Create, batch, delete blocks
│   │       │   └── booking.ts   # Public booking, reschedule, .ics
│   │       └── utils/
│   │           └── ics.ts       # .ics file generator
│   └── client/                  # @session-scheduler/client
│       ├── package.json
│       ├── Dockerfile
│       ├── nginx.conf           # SPA routing + API proxy
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx          # Router + auth wrapper
│           ├── api/
│           │   └── client.ts    # Typed fetch wrapper
│           ├── context/
│           │   └── AuthContext.tsx
│           ├── components/
│           │   ├── Layout.tsx
│           │   ├── CreateProjectModal.tsx
│           │   └── AddTimeBlockModal.tsx
│           ├── pages/
│           │   ├── LoginPage.tsx
│           │   ├── DashboardPage.tsx
│           │   ├── ProjectDetailPage.tsx
│           │   ├── PublicBookingPage.tsx
│           │   └── ReschedulePage.tsx
│           └── styles/
│               └── global.css
```

### Request Flow

1. **Authenticated requests (PM/Engineer):** Browser → nginx → Express `/api/*` → JWT middleware → route handler → PostgreSQL → JSON response
2. **Public booking requests (Client):** Browser → nginx → Express `/api/schedule/*` → password check in handler → PostgreSQL → JSON + .ics response
3. **Static assets:** Browser → nginx → serves from React build directory (`/usr/share/nginx/html`)
4. **SPA routing:** Any non-`/api` path → nginx `try_files` → `index.html` → React Router handles client-side

---

## 5. Database Schema

### Entity Relationship Diagram

```
┌──────────────────┐       ┌──────────────────────────┐
│     users         │       │        projects           │
├──────────────────┤       ├──────────────────────────┤
│ id (PK)          │──┐    │ id (PK)                  │
│ email (UNIQUE)   │  │    │ name                     │
│ first_name       │  │    │ description              │
│ last_name        │  ├───▶│ created_by (FK → users)  │
│ phone            │  │    │ signup_password_hash      │
│ role (enum)      │  │    │ is_group_signup           │
│ password_hash    │  │    │ max_group_size            │
│ created_at       │  │    │ session_length_minutes    │
│ updated_at       │  │    │ share_token (UNIQUE)      │
└──────────────────┘  │    │ is_active                 │
                      │    │ created_at / updated_at   │
                      │    └──────────┬───────────────┘
                      │               │
                      │               │ 1:N
                      │               ▼
                      │    ┌──────────────────────────┐
                      │    │      time_blocks          │
                      │    ├──────────────────────────┤
                      │    │ id (PK)                  │
                      │    │ project_id (FK)          │
                      │    │ start_time (TIMESTAMPTZ) │
                      │    │ end_time (TIMESTAMPTZ)   │
                      │    │ max_signups              │
                      │    │ is_personal              │
                      │    │ created_by (FK → users)  │
                      │    │ created_at               │
                      │    └─────┬────────────┬───────┘
                      │         │             │
                      │   N:M   │             │ 1:N
                      │         ▼             ▼
                      │  ┌──────────────┐  ┌─────────────────────┐
                      │  │ time_block_  │  │      bookings        │
                      │  │ engineers    │  ├─────────────────────┤
                      │  ├──────────────┤  │ id (PK)             │
                      └─▶│ time_block_id│  │ time_block_id (FK)  │
                         │ engineer_id  │  │ client_first_name   │
                         │ (UNIQUE pair)│  │ client_last_name    │
                         └──────────────┘  │ client_email        │
                                           │ client_phone        │
                                           │ booking_token (UNQ) │
                                           │ booked_at           │
                                           │ cancelled_at        │
                                           └─────────────────────┘
```

### Table Definitions

#### `users`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `SERIAL` | PRIMARY KEY | Auto-increment |
| `email` | `VARCHAR(255)` | UNIQUE, NOT NULL | Login identifier |
| `first_name` | `VARCHAR(100)` | NOT NULL | |
| `last_name` | `VARCHAR(100)` | NOT NULL | |
| `phone` | `VARCHAR(30)` | NULLABLE | |
| `role` | `VARCHAR(20)` | NOT NULL, CHECK IN ('pm', 'engineer') | Determines permission level |
| `password_hash` | `VARCHAR(255)` | NOT NULL | bcrypt hash (cost factor 12) |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT NOW() | Auto-updated via trigger |

#### `projects`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `SERIAL` | PRIMARY KEY | |
| `name` | `VARCHAR(255)` | NOT NULL | Display name |
| `description` | `TEXT` | DEFAULT '' | Appears in booking page and .ics files |
| `created_by` | `INTEGER` | FK → users(id), NOT NULL | Must be a PM |
| `signup_password_hash` | `VARCHAR(255)` | NOT NULL | bcrypt hash — clients authenticate with this |
| `is_group_signup` | `BOOLEAN` | DEFAULT FALSE | If true, multiple clients per slot |
| `max_group_size` | `INTEGER` | DEFAULT 1 | Only relevant when `is_group_signup = true` |
| `session_length_minutes` | `INTEGER` | NOT NULL, CHECK > 0 | Used for UI display and block creation |
| `share_token` | `VARCHAR(64)` | UNIQUE, NOT NULL | Auto-generated via `gen_random_bytes(32)`, used in public URL |
| `is_active` | `BOOLEAN` | DEFAULT TRUE | Inactive projects don't show available slots |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT NOW() | Auto-updated via trigger |

#### `time_blocks`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `SERIAL` | PRIMARY KEY | |
| `project_id` | `INTEGER` | FK → projects(id) ON DELETE CASCADE | |
| `start_time` | `TIMESTAMPTZ` | NOT NULL | Session start |
| `end_time` | `TIMESTAMPTZ` | NOT NULL | Session end |
| `max_signups` | `INTEGER` | DEFAULT 1, CHECK > 0 | For group signup projects |
| `is_personal` | `BOOLEAN` | DEFAULT FALSE | True if created by an engineer |
| `created_by` | `INTEGER` | FK → users(id), NOT NULL | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |

**Constraints:** `CHECK (end_time > start_time)`  
**Indexes:** `idx_time_blocks_project` on `project_id`, `idx_time_blocks_start` on `start_time`

#### `time_block_engineers`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `SERIAL` | PRIMARY KEY | |
| `time_block_id` | `INTEGER` | FK → time_blocks(id) ON DELETE CASCADE | |
| `engineer_id` | `INTEGER` | FK → users(id) ON DELETE CASCADE | |

**Constraints:** UNIQUE on `(time_block_id, engineer_id)` — prevents duplicate assignment

#### `bookings`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `SERIAL` | PRIMARY KEY | |
| `time_block_id` | `INTEGER` | FK → time_blocks(id) ON DELETE CASCADE | |
| `client_first_name` | `VARCHAR(100)` | NOT NULL | |
| `client_last_name` | `VARCHAR(100)` | NOT NULL | |
| `client_email` | `VARCHAR(255)` | NOT NULL | |
| `client_phone` | `VARCHAR(30)` | NOT NULL | |
| `booking_token` | `VARCHAR(64)` | UNIQUE, NOT NULL | Auto-generated, used for reschedule/cancel URLs |
| `booked_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |
| `cancelled_at` | `TIMESTAMPTZ` | NULLABLE | NULL = active; timestamp = cancelled |

**Indexes:** `idx_bookings_block` on `time_block_id`, `idx_bookings_email` on `client_email`, `idx_bookings_token` on `booking_token`

#### `available_slots` (VIEW)

A convenience view that returns only time blocks with remaining capacity:

```sql
CREATE OR REPLACE VIEW available_slots AS
SELECT
  tb.id AS time_block_id,
  tb.project_id,
  tb.start_time,
  tb.end_time,
  tb.max_signups,
  tb.max_signups - COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL) AS remaining_slots
FROM time_blocks tb
LEFT JOIN bookings b ON b.time_block_id = tb.id
GROUP BY tb.id
HAVING tb.max_signups - COUNT(b.id) FILTER (WHERE b.cancelled_at IS NULL) > 0;
```

### Concurrency & Race Conditions

The booking endpoint uses `SELECT ... FOR UPDATE` on the time_blocks row to prevent double-booking. The full transaction flow:

```
BEGIN
  → SELECT time_block ... FOR UPDATE  (row-level lock)
  → Check: current_bookings < max_signups
  → INSERT INTO bookings
COMMIT
```

If two clients attempt to book the last slot simultaneously, the second transaction waits on the row lock, then recounts bookings and sees the slot is full. This guarantees no overbooking without application-level locking.

The same pattern applies to rescheduling — the old booking is cancelled and the new slot is locked + checked within a single transaction.

### Database Extensions

- `pgcrypto` — used for `gen_random_bytes()` to generate `share_token` and `booking_token` values

---

## 6. API Contract

### Base URL

All endpoints are prefixed with `/api`.

### Authentication

- **JWT Bearer Token** — included in `Authorization: Bearer <token>` header
- Token payload: `{ userId, email, role }`, expires in 24 hours
- Passwords hashed with bcrypt (cost factor 12 for user accounts, 10 for project passwords)

### Response Format

Success responses return JSON directly. Error responses follow:

```json
{
  "error": "Human-readable error message",
  "details": "Optional additional context"
}
```

### Endpoints

#### Auth

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| `POST` | `/api/auth/register` | — | Create a new PM or Engineer account |
| `POST` | `/api/auth/login` | — | Authenticate, receive JWT |
| `GET` | `/api/auth/me` | JWT | Get current user profile |
| `GET` | `/api/auth/engineers` | JWT | List all engineers (for assignment UI) |

##### `POST /api/auth/register`

```
Request:
{
  "email": "string (valid email)",
  "password": "string (min 8 chars)",
  "first_name": "string (1-100)",
  "last_name": "string (1-100)",
  "phone": "string (optional)",
  "role": "pm" | "engineer"
}

Response (201):
{
  "token": "jwt-string",
  "user": { "id", "email", "first_name", "last_name", "phone", "role", "created_at" }
}

Errors: 400 (validation), 409 (email exists)
```

##### `POST /api/auth/login`

```
Request:
{
  "email": "string",
  "password": "string"
}

Response (200):
{
  "token": "jwt-string",
  "user": { "id", "email", "first_name", "last_name", "phone", "role", "created_at" }
}

Errors: 401 (invalid credentials)
```

---

#### Projects

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| `GET` | `/api/projects` | JWT | List all projects with stats |
| `GET` | `/api/projects/:id` | JWT | Full project detail with time blocks and bookings |
| `POST` | `/api/projects` | PM | Create a new project |
| `PUT` | `/api/projects/:id` | PM | Update project fields |
| `DELETE` | `/api/projects/:id` | PM | Delete project (cascades to blocks and bookings) |

##### `POST /api/projects`

```
Request:
{
  "name": "string (1-255)",
  "description": "string (optional)",
  "signup_password": "string (min 4)",
  "is_group_signup": boolean,
  "max_group_size": number (optional, default 1),
  "session_length_minutes": number (positive integer)
}

Response (201): Full project object including generated share_token
```

##### `GET /api/projects/:id` — Response Shape

```json
{
  "id": 1,
  "name": "Q2 Infrastructure Review",
  "description": "...",
  "share_token": "abc123...",
  "session_length_minutes": 60,
  "is_group_signup": false,
  "is_active": true,
  "creator_name": "Sarah Mitchell",
  "time_blocks": [
    {
      "id": 10,
      "start_time": "2026-04-15T14:00:00Z",
      "end_time": "2026-04-15T15:00:00Z",
      "max_signups": 1,
      "remaining_slots": 0,
      "engineers": [
        { "id": 2, "first_name": "Alex", "last_name": "Rivera", "email": "alex@..." }
      ],
      "bookings": [
        {
          "id": 5,
          "client_first_name": "Jane",
          "client_last_name": "Doe",
          "client_email": "jane@client.com",
          "client_phone": "555-1234",
          "booked_at": "2026-04-10T09:00:00Z",
          "cancelled_at": null,
          "booking_token": "def456..."
        }
      ]
    }
  ]
}
```

---

#### Time Blocks

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| `POST` | `/api/time-blocks` | JWT | Create a single time block |
| `POST` | `/api/time-blocks/batch` | PM | Batch-create consecutive time blocks |
| `DELETE` | `/api/time-blocks/:id` | JWT | Delete block (fails if active bookings exist) |

##### `POST /api/time-blocks/batch`

This is the primary block creation endpoint. The frontend sends a batch of consecutive slots with engineer assignments.

```
Request:
{
  "project_id": number,
  "blocks": [
    {
      "start_time": "ISO 8601 datetime",
      "end_time": "ISO 8601 datetime",
      "max_signups": number (default 1),
      "engineer_ids": [number, ...]
    }
  ]
}

Response (201): Array of created time_block objects

Transaction: All blocks created atomically — if any fail, none are committed.
```

##### `DELETE /api/time-blocks/:id`

```
Rules:
- PM: can delete any block
- Engineer: can only delete blocks they created (is_personal = true)
- Fails with 409 if the block has any active (non-cancelled) bookings
```

---

#### Public Booking (No JWT Required)

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| `GET` | `/api/schedule/project/:shareToken` | — | Get project info + available slots |
| `POST` | `/api/schedule/book/:shareToken` | Password | Book a slot |
| `GET` | `/api/schedule/booking/:bookingToken` | — | Get booking detail + reschedule options |
| `POST` | `/api/schedule/reschedule/:bookingToken` | — | Cancel old + book new slot |
| `POST` | `/api/schedule/cancel/:bookingToken` | — | Cancel a booking |
| `GET` | `/api/schedule/calendar/:bookingToken` | — | Download .ics file |

##### `GET /api/schedule/project/:shareToken`

Returns only future, available slots (with remaining capacity > 0). Does NOT require the project password — the password is checked on booking.

```json
{
  "project": {
    "id": 1,
    "name": "...",
    "description": "...",
    "session_length_minutes": 60,
    "is_group_signup": false,
    "share_token": "abc123..."
  },
  "available_slots": [
    {
      "time_block_id": 10,
      "start_time": "2026-04-15T14:00:00Z",
      "end_time": "2026-04-15T15:00:00Z",
      "remaining_slots": 1,
      "engineers": [
        { "first_name": "Alex", "last_name": "Rivera" }
      ]
    }
  ]
}
```

##### `POST /api/schedule/book/:shareToken`

```
Request:
{
  "password": "string",
  "time_block_id": number,
  "first_name": "string",
  "last_name": "string",
  "email": "string (valid email)",
  "phone": "string"
}

Response (201):
{
  "booking": { ...booking object with booking_token... },
  "client_calendar": "BEGIN:VCALENDAR...",  // Raw .ics string
  "engineer_calendars": [                    // One per assigned engineer
    {
      "engineer": { "id", "first_name", "last_name", "email" },
      "ics": "BEGIN:VCALENDAR..."
    }
  ],
  "reschedule_url": "/schedule/{shareToken}/reschedule/{bookingToken}"
}

Errors: 401 (wrong password), 404 (slot not found), 409 (slot full)
```

##### `POST /api/schedule/reschedule/:bookingToken`

```
Request:
{
  "new_time_block_id": number
}

Response (200):
{
  "booking": { ...new booking object... },
  "client_calendar": "BEGIN:VCALENDAR...",
  "message": "Successfully rescheduled"
}

Transaction:
  BEGIN
    → Lock old booking (FOR UPDATE)
    → Set cancelled_at = NOW() on old booking
    → Lock new time block (FOR UPDATE)
    → Check availability
    → INSERT new booking
  COMMIT

Errors: 404 (booking not found / already cancelled), 409 (new slot full)
```

##### `GET /api/schedule/calendar/:bookingToken`

Returns raw `.ics` file with proper content headers:

```
Content-Type: text/calendar; charset=utf-8
Content-Disposition: attachment; filename="session-{token_prefix}.ics"
```

---

## 7. Frontend Architecture

### Technology

- **React 18** with functional components and hooks
- **Vite** for dev server and production builds
- **React Router v6** for client-side routing
- **TypeScript** throughout
- **CSS** — custom design system via CSS variables (no framework dependency)
- **No state library** — React Context + local state is sufficient for this scope

### Routing Map

| Path | Component | Auth | Description |
|------|-----------|:----:|-------------|
| `/login` | `LoginPage` | Guest only | Login/register form |
| `/dashboard` | `DashboardPage` | JWT | Project list with stats |
| `/projects` | `DashboardPage` | JWT | Same as dashboard |
| `/projects/:id` | `ProjectDetailPage` | JWT | Project management |
| `/schedule/:shareToken` | `PublicBookingPage` | Public | Client booking flow |
| `/schedule/:shareToken/reschedule/:bookingToken` | `ReschedulePage` | Public | Client reschedule |
| `*` | Redirect → `/dashboard` | — | Catch-all |

### Component Tree

```
<BrowserRouter>
  <AuthProvider>                          ← Context: user, login, logout
    <Routes>
      ├── /login → <LoginPage />          ← GuestRoute wrapper
      ├── /schedule/* → <PublicBookingPage /> or <ReschedulePage />
      └── /* → <ProtectedRoute>
               <Layout>                   ← Sidebar + main area
                 <Outlet>
                   ├── /dashboard → <DashboardPage />
                   └── /projects/:id → <ProjectDetailPage />
                 </Outlet>
               </Layout>
             </ProtectedRoute>
    </Routes>
  </AuthProvider>
</BrowserRouter>
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `AuthContext` | Stores user state, manages JWT in localStorage, provides `login()`, `register()`, `logout()` |
| `Layout` | App shell with collapsible sidebar, nav links, user info badge, mobile hamburger menu |
| `DashboardPage` | Lists all projects as cards, shows block count + booking count + session length, PM gets "Create Project" button |
| `CreateProjectModal` | Form: name, description, session length dropdown, password, group signup toggle |
| `ProjectDetailPage` | Full project view: share link copy, stats grid, time blocks table with booking details, "Add Time Blocks" button |
| `AddTimeBlockModal` | Form: date picker, time picker, consecutive slot count, engineer multi-select toggle buttons |
| `PublicBookingPage` | Multi-step flow: password → slot grid (grouped by date) → contact form → confirmation with .ics download |
| `ReschedulePage` | Shows current booking, available alternative slots, confirm reschedule or cancel entirely |

### API Client (`api/client.ts`)

A thin typed wrapper around `fetch()` that:
- Auto-injects JWT from localStorage into `Authorization` header
- Handles JSON parsing and error extraction
- Detects `text/calendar` responses for .ics downloads
- Exposes typed methods for every API endpoint

### Responsive Design

- Desktop: 260px fixed sidebar + fluid main content (max-width 1200px)
- Tablet (≤768px): sidebar collapses off-screen, toggle via hamburger menu, single-column form rows
- Mobile (≤480px): slot grid collapses to single column, simplified table views

---

## 8. Infrastructure & Deployment

### Docker Compose Services

| Service | Image | Port | Role |
|---------|-------|------|------|
| `postgres` | `postgres:16-alpine` | 5432 | Database with healthcheck |
| `server` | Custom (Node 20 Alpine) | 4000 | Express API, waits for postgres healthy |
| `client` | Custom (nginx Alpine) | 3000 (→ 80) | Serves React SPA, proxies `/api` to server |

### Build Pipeline

#### Server (multi-stage)
1. **Builder stage:** Install deps → copy shared + server source → `tsc` compile
2. **Production stage:** Copy compiled JS + production deps only → `node dist/index.js`

#### Client (multi-stage)
1. **Builder stage:** Install deps → copy shared + client source → `vite build`
2. **Production stage:** Copy `dist/` into nginx → serve with custom config

### nginx Configuration

```
server {
    listen 80;

    # API proxy — all /api/ requests forward to Express
    location /api/ {
        proxy_pass http://server:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SPA fallback — serves index.html for all non-file routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets (1 year, immutable — Vite hashes filenames)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
```

### Environment Variables

| Variable | Default | Required | Description |
|----------|---------|:--------:|-------------|
| `POSTGRES_DB` | `session_scheduler` | ✅ | Database name |
| `POSTGRES_USER` | `ss_admin` | ✅ | DB username |
| `POSTGRES_PASSWORD` | — | ✅ | **Change in production** |
| `POSTGRES_PORT` | `5432` | | Host port mapping |
| `JWT_SECRET` | — | ✅ | **Must be a strong random string** |
| `PORT` | `4000` | | API server port |
| `CORS_ORIGIN` | `http://localhost:5173` | | Allowed CORS origin (dev) |
| `VITE_API_URL` | `/api` | | Client-side API base URL |

### Local Development

```bash
# Start database only
docker compose up postgres -d

# Install all workspace deps
npm install

# Run schema
npm run db:migrate

# Seed sample data
npm run db:seed

# Start API + client with hot reload
npm run dev
# → Client: http://localhost:5173
# → API:    http://localhost:4000
```

### Production Deployment

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env: set strong JWT_SECRET and POSTGRES_PASSWORD

# Build and launch all services
docker compose up --build -d

# → Application: http://localhost:3000
```

### Database Persistence

PostgreSQL data is stored in a Docker named volume (`pg_data`). Data survives `docker compose down` but is destroyed by `docker compose down -v`.

---

## 9. Security Considerations

### Authentication & Authorization

- **JWT tokens** expire after 24 hours; refresh is not implemented (manual re-login required)
- **Role checks** happen in Express middleware — the client never controls permission logic
- **Password hashing** uses bcrypt with cost factor 12 (user accounts) and 10 (project passwords)
- **Project passwords** are separate from user passwords — they're shared among clients for a specific project

### Input Validation

- All API inputs are validated with **Zod** schemas before any database operation
- Email format, string length limits, positive integer checks, and enum validation are enforced server-side
- The client performs basic HTML5 validation but the server is the source of truth

### Database Security

- **Parameterized queries** throughout — no string concatenation in SQL
- **Row-level locking** (`FOR UPDATE`) prevents race conditions on booking
- **ON DELETE CASCADE** ensures no orphaned records when projects or blocks are removed

### Public Endpoint Protection

- The booking endpoints (`/api/schedule/*`) are public (no JWT) but:
  - Booking requires the correct project password
  - Reschedule/cancel require a cryptographically random `booking_token` (256-bit entropy)
  - Tokens are URL-safe hex strings, not sequential IDs
- Rate limiting is recommended but not yet implemented (see Future Considerations)

### Headers & Transport

- **Helmet.js** sets security headers (X-Content-Type-Options, X-Frame-Options, etc.)
- **CORS** is restricted to a configured origin
- **HTTPS** should be terminated at a reverse proxy / load balancer in front of Docker (not included in the Docker setup)

---

## 10. Future Considerations

These are out of scope for v1 but should be considered for subsequent iterations:

| Feature | Priority | Notes |
|---------|----------|-------|
| Rate limiting on public endpoints | High | Prevent brute-force password attempts on `/api/schedule/book`. Use `express-rate-limit` or nginx `limit_req_zone`. |
| Observability + SLOs | High | Define booking success/error SLOs and API latency targets; add structured logs, metrics, traces, and alerts for booking failures. |
| Background job queue | High | Move email delivery and external calendar sync to async workers with retries and dead-letter handling (BullMQ/SQS/RabbitMQ). |
| Backup + disaster recovery | High | Automate PostgreSQL backups, test restore drills regularly, and define target RPO/RTO for production incidents. |
| Abuse protection hardening | High | Add progressive lockouts and optional CAPTCHA/IP reputation checks after repeated failed project-password attempts. |
| Email notifications | High | Send booking confirmations and .ics attachments via email (Resend, SendGrid, or SES). |
| Google Calendar API integration | Medium | Direct calendar event creation in addition to .ics download. Requires OAuth2 consent flow per engineer. |
| Recurring time blocks | Medium | Allow PMs to define "every Tuesday 9am-12pm" repeating patterns instead of creating each week manually. |
| Timezone handling UI | Medium | Currently stores all times as TIMESTAMPTZ (UTC in DB). The frontend should let users set their timezone explicitly rather than relying on browser detection. |
| Idempotency keys on booking | Medium | Support `Idempotency-Key` on `/api/schedule/book` to prevent duplicate bookings when clients retry after timeouts. |
| API versioning strategy | Medium | Introduce versioned API contracts (for example `/api/v1`) and a deprecation policy for safe client upgrades. |
| Data retention + privacy controls | Medium | Define retention windows, archival strategy, and PII deletion/export workflows for compliance requests. |
| Capacity planning + load testing | Medium | Document expected peak booking traffic, validate indexing strategy, and run periodic contention/load tests. |
| Multi-tenant isolation | Medium | If multiple unrelated teams share one instance, enforce tenant scoping on all queries and evaluate PostgreSQL RLS. |
| JWT refresh tokens + revocation | Medium | Add rotating refresh tokens with sliding expiry and server-side revocation/session invalidation support. |
| Audit log | Low | Track who created/deleted blocks, who booked/cancelled, for compliance. |
| Waitlist | Low | When a slot is full, allow clients to join a waitlist and auto-notify if a cancellation opens it. |
| SSO integration | Low | SAML/OIDC for enterprise PM/Engineer authentication. |
