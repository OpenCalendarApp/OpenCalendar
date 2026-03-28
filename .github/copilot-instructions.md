---
applyTo: '**'
---

# CalendarGenie — Session Scheduler Workspace Instructions

> **Project Status:** Pre-development (architecture spec complete, development starting)  
> **Last Updated:** March 2026  
> **Architecture Reference:** [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) (comprehensive detailed specs — this file links, not duplicates)

## Quick Start

**Setup & local development:**
```bash
npm install                           # Install all workspace dependencies
docker compose up postgres -d         # Start database
npm run db:migrate                    # Create schema
npm run db:seed                       # Load sample data
npm run dev                           # Start client (port 5173) + server (port 4000)
```

**Production build:**
```bash
cp .env.example .env                  # Configure secrets
docker compose up --build -d          # Build and deploy all services
# → Access at http://localhost:3000
```

---

## Monorepo Structure

This is an **npm workspaces monorepo** (`packages/shared`, `packages/server`, `packages/client`). Both server and client depend on shared types; changes to shared require rebuilding consumers.

```
CalendarGenie/
├── package.json                      # Root workspaces config
├── docker-compose.yml                # Orchestrates postgres + server + client
├── .env.example                      # Environment template (copy to .env locally)
├── docs/
│   └── ARCHITECTURE.md               # Full specification (consult for detailed decisions)
├── docker/
│   └── init.sql                      # PostgreSQL schema + pgcrypto extension
└── packages/
    ├── shared/                       # @session-scheduler/shared
    │   ├── package.json
    │   └── src/
    │       └── types.ts              # Shared TypeScript interfaces (sync with backend+frontend)
    ├── server/                       # @session-scheduler/server
    │   ├── Dockerfile                # Node 20 Alpine, runs `npm run start`
    │   ├── tsconfig.json
    │   ├── package.json              # Depends on @session-scheduler/shared
    │   └── src/
    │       ├── index.ts              # Express entry point
    │       ├── db/                   # Database pool, migrations, seeds
    │       ├── middleware/           # Auth, CORS, validation
    │       ├── routes/               # API endpoints (auth, projects, time-blocks, schedule)
    │       └── utils/                # Helpers (.ics generator, etc.)
    └── client/                       # @session-scheduler/client
        ├── Dockerfile                # nginx Alpine, serves React SPA + proxies /api
        ├── nginx.conf                # SPA routing + API reverse proxy
        ├── vite.config.ts
        ├── package.json              # Depends on @session-scheduler/shared
        └── src/
            ├── main.tsx              # React entry (mounts to #root)
            ├── App.tsx               # Router + AuthContext wrapper
            ├── api/                  # Fetch wrapper (auto-injects JWT)
            ├── context/              # React Context (AuthContext for user state)
            ├── components/           # Modal, Layout, form components
            ├── pages/                # Route pages (Login, Dashboard, ProjectDetail, PublicBooking, etc.)
            └── styles/               # Global CSS (variables-based design system)
```

---

## Key Technical Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite, TypeScript, React Router v6, CSS variables |
| **Backend** | Node.js 20, Express, TypeScript, Zod validation |
| **Database** | PostgreSQL 16 (5 tables + 1 view), parameterized queries, row-level locks |
| **Auth** | JWT (24h expiry), bcrypt (cost 12 user / cost 10 project passwords) |
| **Infra** | Docker Compose, nginx reverse proxy, two-stage Dockerfiles |
| **Calendar** | Custom .ics RFC 5545 generator in `server/src/utils/ics.ts` |

### Core Conventions

- **TypeScript everywhere** — strict mode, proper typing for all exports
- **Zod validation** — all API request bodies validated server-side before DB operations
- **Functional components + hooks** — no class components, Context for state (no Redux/Zustand)
- **Concurrency safety** — booking uses `SELECT ... FOR UPDATE` transaction pattern
- **Error responses** — standardized JSON: `{ error: "message", details?: "context" }`
- **Responsive design** — mobile-first: desktop (fixed sidebar), tablet (hamburger), mobile (single-column)

---

## API Structure

### Base URL
All endpoints prefixed with `/api`. Public endpoints (booking, rescheduling, calendar download) do not require JWT.

### Authentication
- **JWT Bearer token:** included in `Authorization: Bearer <token>` header
- **Note:** Stateless — no refresh tokens in v1 (login required after 24h expiry)

### Response Format

**Success (2xx):**
```json
{
  "id": 1,
  "name": "...",
  /* ... entity fields ... */
}
```
or for listings:
```json
[{ /* ...entity... */ }, { /* ...entity... */ }]
```

**Error (4xx/5xx):**
```json
{
  "error": "Human-readable message",
  "details": "Optional diagnostic context"
}
```

### Endpoint Organization

| Route File | Paths | Auth | Purpose |
|-----------|-------|:----:|---------|
| `auth.ts` | `/api/auth/*` | JWT / public | Login, register, user profile, engineer list |
| `projects.ts` | `/api/projects/*` | JWT | CRUD projects (PM only for create/edit/delete) |
| `timeBlocks.ts` | `/api/time-blocks/*` | JWT | Create single block, batch create, delete blocks |
| `booking.ts` | `/api/schedule/*` | Public + password | Book sessions, reschedule, cancel, download .ics |

**See [docs/ARCHITECTURE.md § 6. API Contract](../../docs/ARCHITECTURE.md#-api-contract) for full endpoint signatures.**

---

## Database Layer

**PostgreSQL 16 schema (5 tables + 1 view):**

| Table | Purpose | Key Pattern |
|-------|---------|-----------|
| `users` | PM and Engineer accounts | PK: id, UNIQUE: email, Enum role: pm\|engineer |
| `projects` | Time-block collections for booking | PK: id, UNIQUE: share_token (public URL), Hash: signup_password_hash |
| `time_blocks` | Individual session slots (60 min each by default) | PK: id, FK: project_id, FK: created_by, Unique engineer assignments via join table |
| `time_block_engineers` | N:M assignment of engineers to blocks | PK: id, UNIQUE: (time_block_id, engineer_id) |
| `bookings` | Client session reservations | PK: id, UNIQUE: booking_token (reschedule/cancel URLs), Nullable: cancelled_at (NULL = active) |
| `available_slots` | VIEW | Convenience: lists blocks with remaining capacity |

**Critical patterns:**
- **Race condition safety:** Booking endpoint uses `BEGIN ... SELECT ... FOR UPDATE ... INSERT ... COMMIT` to prevent double-booking
- **Cascading deletes:** Deleting a project cascades to time_blocks and bookings
- **Token generation:** `share_token` and `booking_token` use `gen_random_bytes(32)` (256-bit entropy) via pgcrypto
- **Parameterized queries everywhere** — no string concatenation in SQL

**Schema initialization:** `docker/init.sql` (executed on container startup via Postgres init)

---

## Backend Conventions (`packages/server/src/`)

### Route Handlers

Each route file (`routes/*.ts`) exports an Express router. Follow this pattern:

```typescript
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { projectSchema } from '@session-scheduler/shared';

const router = Router();

// GET /api/projects
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    // 1. Extract + validate from request
    // 2. Query database
    // 3. Return JSON response
    res.json({ /* data */ });
  } catch (error) {
    res.status(500).json({ error: 'message', details: error.message });
  }
});

// POST /api/projects
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  // Validate request body with Zod
  const validated = projectSchema.parse(req.body);
  // ... create in DB ...
  res.status(201).json({ /* created entity */ });
});

export default router;
```

**Key practices:**
- Use `authMiddleware` or custom RBAC middleware to protect routes
- Validate inputs with **Zod** schemas from `@session-scheduler/shared`
- Return proper HTTP status codes (201 for creates, 409 for conflicts, etc.)
- Log errors for debugging; return normalized `{ error, details }` to client

### Middleware

- `middleware/auth.ts` — extracts and verifies JWT, attaches `req.user` with userId/email/role
- Apply with `router.use(authMiddleware)` or per-route: `router.post('/protected', authMiddleware, handleRequest)`

### Database Layer

- `db/pool.ts` — PostgreSQL connection pool (use `pool.query()` for all DB access)
- `db/migrate.ts` — runs `docker/init.sql` on startup
- `db/seed.ts` — optional: loads sample PM, engineers, projects, time blocks for testing

**Example query:**
```typescript
const result = await pool.query(
  'SELECT * FROM projects WHERE id = $1 AND created_by = $2',
  [projectId, userId]
);
```

### Utilities

- `utils/ics.ts` — RFC 5545 .ics calendar generator, exports functions:
  - `generateClientCalendar(booking, project, engineers)` → .ics string (for client download)
  - `generateEngineerCalendar(booking, project, client)` → .ics string (for engineer email)

---

## Frontend Conventions (`packages/client/src/`)

### Pages

Each route gets a dedicated page component in `pages/*.tsx`:

| Page | Route | Auth | Purpose |
|------|-------|:----:|---------|
| `LoginPage.tsx` | `/login` | Guest only | Unified login/register form |
| `DashboardPage.tsx` | `/dashboard`, `/projects` | JWT | Project cards, create project button |
| `ProjectDetailPage.tsx` | `/projects/:id` | JWT | Manage blocks, view bookings, copy share link |
| `PublicBookingPage.tsx` | `/schedule/:shareToken` | Public | Multi-step: password → slots → contact → .ics download |
| `ReschedulePage.tsx` | `/schedule/:shareToken/reschedule/:bookingToken` | Public | View current + rebook or cancel |

**Page structure:**
```typescript
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [project, setProject] = useState(null);

  useEffect(() => {
    ApiClient.get(`/projects/${id}`).then(setProject);
  }, [id]);

  return (
    <div className="project-detail">
      {/* JSX */}
    </div>
  );
}
```

### Components

Modal and reusable UI components in `components/`:

- `Layout.tsx` — app shell (sidebar on desktop, hamburger on mobile, nav links, user badge)
- `CreateProjectModal.tsx` — form to create project (PM only)
- `AddTimeBlockModal.tsx` — batch time-block creation with engineer multi-select
- (Future: date picker, slot grid, contact form components)

**Pattern:**
```typescript
interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="layout">
      <aside className="sidebar">
        {/* Nav */}
      </aside>
      <main>{children}</main>
    </div>
  );
}
```

### Context

- `context/AuthContext.tsx` — provides user state, JWT management, login/logout/register actions
  - Exports: `<AuthProvider>`, `useAuth()` hook
  - Manages: localStorage JWT, user object, role-based route protection

**Usage:**
```typescript
const { user, login, logout, register } = useAuth();
```

### API Client

- `api/client.ts` — thin typed fetch wrapper
  - Auto-injects `Authorization: Bearer <jwt>` from localStorage
  - Parses JSON responses; detects `.ics` (text/calendar) for downloads
  - Exposes methods for each endpoint (type-safe)

**Example:**
```typescript
const project = await ApiClient.get('/projects/1');
const newProject = await ApiClient.post('/projects', { name: '...', ... });
const ics = await ApiClient.get('/schedule/calendar/abc123'); // Returns .ics string
```

### Styling

- **CSS variables** for theming (no framework dependency)
- Global styles in `styles/global.css`
- **Responsive breakpoints:**
  - Desktop: 260px sidebar + fluid content (max-width 1200px)
  - Tablet ≤768px: collapsible sidebar, hamburger toggle
  - Mobile ≤480px: full-width single column

---

## Environment Configuration

### Local Development

Create `.env` from `.env.example` and set:
```bash
POSTGRES_DB=session_scheduler
POSTGRES_USER=ss_admin
POSTGRES_PASSWORD=dev_password     # For local testing only!
JWT_SECRET=$(openssl rand -base64 32)  # Generate random secret
CORS_ORIGIN=http://localhost:5173
VITE_API_URL=/api
```

### Production

**MUST change before deploying:**
- `POSTGRES_PASSWORD` — use a strong, generated secret
- `JWT_SECRET` — use a strong, generated secret (min 32 chars)
- `CORS_ORIGIN` — point to actual domain
- Optional: Remove sample seed data, set `NODE_ENV=production`

---

## Common Development Tasks

### Adding a New API Endpoint

1. **Define types** in `packages/shared/src/types.ts` (Zod schema + TypeScript interface)
2. **Create route handler** in `packages/server/src/routes/*.ts`:
   - Add router.get/post/put/delete with path
   - Validate request body with Zod
   - Query database (parameterized)
   - Return normalized response or error
3. **Import route** in `packages/server/src/index.ts`: `app.use('/api/foo', fooRouter)`
4. **Create client wrapper** in `packages/client/src/api/client.ts`: `static async get/post/put/delete(...)`
5. **Use in components** via `ApiClient.methodName(...)`

### Adding a New Page

1. **Create route** in `packages/client/src/pages/NewPage.tsx`
2. **Add Router entry** in `packages/client/src/App.tsx`:
   ```typescript
   <Route path="/new-route" element={<NewPage />} />
   ```
3. **Link from navigation** in `components/Layout.tsx` or other components

### Adding a Database Table / Column

1. **Edit schema** in `docker/init.sql` (add CREATE TABLE or ALTER TABLE)
2. **Update types** in `packages/shared/src/types.ts`
3. **Update queries** in `packages/server/src/` (routes + migrations)
4. **Re-run migration**: `npm run db:migrate` (only works for additive changes)

### Generating Calendar Files

Use `server/src/utils/ics.ts`:
```typescript
import { generateClientCalendar, generateEngineerCalendar } from '..../utils/ics';

const clientIcs = generateClientCalendar(booking, project, engineers);
const engineerIcs = generateEngineerCalendar(booking, project, client);

res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
res.send(clientIcs);
```

---

## Key Rules & Constraints

### Permissions

| Action | PM | Engineer | Client |
|--------|:--:|:--------:|:------:|
| Create project | ✅ | ❌ | ❌ |
| Create/assign time blocks | ✅ | Personal only | ❌ |
| Book session | ❌ | ❌ | ✅ (password) |
| Reschedule/cancel | ❌ | ❌ | ✅ (token) |

**Enforce in middleware/routes — client never controls permissions.**

### Database Constraints

- **Time block:** `end_time > start_time` (CHECK constraint)
- **Block deletion:** Fails if any active (non-cancelled) bookings exist
- **Booking concurrency:** Row-level `FOR UPDATE` lock prevents overselling
- **Cascading:** Deleting a project cascades to blocks and bookings
- **Unique tokens:** `share_token` (project) and `booking_token` (booking) use 256-bit entropy

### Development Guidelines

- ✅ Use parameterized queries (no string concatenation)
- ✅ Validate inputs with Zod before DB operations
- ✅ Hash passwords with bcrypt (cost 12 user / 10 project)
- ✅ Return proper HTTP status codes and error structures
- ✅ Test public endpoints don't leak sensitive data
- ❌ Don't hardcode secrets in code (use .env)
- ❌ Don't create sequential tokens (use crypto.random)
- ❌ Don't trust client-side permission checks

---

## Testing Strategy (Future)

See [docs/ARCHITECTURE.md § 10. Future Considerations](../../docs/ARCHITECTURE.md#10-future-considerations) — v1 does not include unit/integration tests, but:
- **Backend:** Add Jest + supertest for route/middleware testing
- **Frontend:** Add Vitest + React Testing Library for component tests
- **Database:** Add dedicated test database + fixture management
- **E2E:** Add Playwright for multi-step booking flow validation

---

## Security Checklist

Before production deployment:
- [ ] Set strong `JWT_SECRET` and `POSTGRES_PASSWORD` in `.env`
- [ ] Enable HTTPS (terminate at reverse proxy / load balancer)
- [ ] Set `CORS_ORIGIN` to actual domain
- [ ] Verify parameterized queries everywhere (no SQL injection)
- [ ] Test public endpoints don't expose PM data
- [ ] Verify JWT tokens expire (24h)
- [ ] Verify project passwords hash with bcrypt
- [ ] Remove sample seed data if not needed
- [ ] Review rate limiting on public endpoints (see Future section)
- [ ] Set up PostgreSQL backups

---

## AI Development Tools (Prompts & Agents)

CalendarGenie includes specialized prompts and agents to accelerate development:

### Prompts (Single-Task Workflows)

Type `/` in chat to access these prompts:

| Prompt | Use When | Time |
|--------|----------|------|
| `/add-api-endpoint` | Adding a new REST endpoint (route + schema) | 10-15 min |
| `/add-frontend-page` | Creating a new React page with routing | 10-15 min |

**Example:**
```
/add-api-endpoint
POST /api/projects/:id/publish - PM-only endpoint
```

### Agents (Orchestrated Workflows)

Type `/Feature Scaffolder`, `/Task Orchestrator`, or use agent picker for:

| Agent | Use When | Time |
|-------|----------|------|
| `Feature Scaffolder` | Building a complete feature (backend + frontend + database) simultaneously | 15-20 min |
| `Task Orchestrator` | Managing 2+ features systematically from a task list (markdown, YAML, or inline) | 60-90 min for 3-5 features |

**Example — Feature Scaffolder:**
```
/Feature Scaffolder

Project publish feature:
- POST /api/projects/:id/publish
- Add published_at TIMESTAMPTZ to projects table
- Modal on /projects/:id page
- PM only
```

**Example — Task Orchestrator:**
```
/Task Orchestrator

docs/SPRINT.md
```

### Documentation

- **Feature Scaffolder Guide:** [.github/agents/SCAFFOLD_GUIDE.md](.github/agents/SCAFFOLD_GUIDE.md)
- **Task Orchestrator Guide:** [.github/agents/TASK_ORCHESTRATOR_GUIDE.md](.github/agents/TASK_ORCHESTRATOR_GUIDE.md)
- **All Available Agents:** [.github/agents/README.md](.github/agents/README.md)
- **Prompt Documentation:** [.github/prompts/](./prompts/)

### Validation Hooks

Automatic validation on route creation:
- **SQL Injection Prevention** — Enforces parameterized queries
- **Error Format** — Validates `{ error, details }` structure
- **Input Validation** — Checks for Zod schema validation

**Reference:** [.github/hooks/VALIDATE_ROUTES.md](.github/hooks/VALIDATE_ROUTES.md)

---

## References & Links

**Architecture & Specifications:**
- **Full Architecture Spec:** [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- **Database Schema:** See § 5 in ARCHITECTURE.md
- **API Contract:** See § 6 in ARCHITECTURE.md
- **Frontend Architecture:** See § 7 in ARCHITECTURE.md
- **Infrastructure:** See § 8 in ARCHITECTURE.md
- **Security Details:** See § 9 in ARCHITECTURE.md

**Development Instructions:**
- **Backend Guide:** [.github/instructions/backend.instructions.md](.github/instructions/backend.instructions.md)
- **Frontend Guide:** [.github/instructions/frontend.instructions.md](.github/instructions/frontend.instructions.md)
- **Database Guide:** [.github/instructions/database.instructions.md](.github/instructions/database.instructions.md)

**AI Development Tools:**
- **Available Prompts:** [.github/prompts/](./prompts/) — `/add-api-endpoint`, `/add-frontend-page`
- **Available Agents:** [.github/agents/README.md](.github/agents/README.md) — Feature Scaffolder, Task Orchestrator
- **Feature Scaffolder Guide:** [.github/agents/SCAFFOLD_GUIDE.md](.github/agents/SCAFFOLD_GUIDE.md)
- **Task Orchestrator Guide:** [.github/agents/TASK_ORCHESTRATOR_GUIDE.md](.github/agents/TASK_ORCHESTRATOR_GUIDE.md)

**Quality & Validation:**
- **Route Validation Hook:** [.github/hooks/VALIDATE_ROUTES.md](.github/hooks/VALIDATE_ROUTES.md)
- **All Hooks & Validation:** [.github/hooks/README.md](.github/hooks/README.md)

---

## Getting Help

When stuck:
1. Check [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for detailed specifications
2. Review existing route/component patterns in `packages/server/src/` or `packages/client/src/`
3. Verify environment variables are set (copy `.env.example` to `.env`)
4. Check Docker logs: `docker compose logs -f <service>`
5. For data issues: `npm run db:seed` resets sample data
