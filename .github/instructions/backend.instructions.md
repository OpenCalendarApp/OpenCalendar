---
applyTo: 'packages/server/**'
---

# Backend (Express Server) Development Guide

This file applies specifically to the `packages/server/` directory. Reference the main instructions at [.github/copilot-instructions.md](../copilot-instructions.md) for general monorepo conventions.

## Server Structure

```
packages/server/src/
├── index.ts           # Express app setup, route registration, error handling
├── db/
│   ├── pool.ts        # PostgreSQL connection pool initialization
│   ├── migrate.ts     # Schema runner (executes docker/init.sql)
│   └── seed.ts        # Sample data loader
├── middleware/
│   └── auth.ts        # JWT extraction + RBAC enforcement
├── routes/
│   ├── auth.ts        # /api/auth/* (register, login, profile, engineers list)
│   ├── projects.ts    # /api/projects/* (CRUD + share token)
│   ├── timeBlocks.ts  # /api/time-blocks/* (create, batch, delete)
│   └── booking.ts     # /api/schedule/* (public: book, reschedule, cancel, .ics)
└── utils/
    └── ics.ts         # RFC 5545 calendar file generator
```

## Key Patterns

### Route Handlers

Every route handler should:
1. **Validate input** with Zod schema from `@session-scheduler/shared`
2. **Check authorization** via `req.user` attached by `authMiddleware`
3. **Query database** with parameterized statements
4. **Return response** with correct HTTP status code

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.post('/', authMiddleware, async (req, res) => {
  try {
    // 1. Validate
    const schema = z.object({ name: z.string().min(1) });
    const data = schema.parse(req.body);

    // 2. Authorize
    if (req.user.role !== 'pm') {
      return res.status(403).json({ error: 'Only PMs can create projects' });
    }

    // 3. Query
    const result = await pool.query(
      'INSERT INTO projects (name, created_by) VALUES ($1, $2) RETURNING *',
      [data.name, req.user.id]
    );

    // 4. Respond
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.message });
    }
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

export default router;
```

### Error Responses

Always follow the standard format:
```json
{
  "error": "Human-readable message",
  "details": "Optional diagnostic context"
}
```

Status codes:
- `200` — Success (GET, PUT without creation)
- `201` — Created (POST)
- `400` — Validation error (bad input)
- `401` — Unauthenticated (missing/invalid JWT)
- `403` — Unauthorized (insufficient role)
- `404` — Not found
- `409` — Conflict (slot full, duplicate email, etc.)
- `500` — Server error

### Database Queries

**Always use parameterized queries** to prevent SQL injection:
```typescript
// ✅ Good
const result = await pool.query(
  'SELECT * FROM users WHERE email = $1',
  [email]
);

// ❌ Bad — SQL injection risk!
const result = await pool.query(
  `SELECT * FROM users WHERE email = '${email}'`
);
```

### Race Condition Safety (Booking)

When handling concurrent booking requests, use transaction with row-level lock:

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Lock the time block
  const blockResult = await client.query(
    'SELECT * FROM time_blocks WHERE id = $1 FOR UPDATE',
    [timeBlockId]
  );

  if (!blockResult.rows.length) {
    throw new Error('Block not found');
  }

  // Check availability
  const bookingCount = await client.query(
    'SELECT COUNT(*) FROM bookings WHERE time_block_id = $1 AND cancelled_at IS NULL',
    [timeBlockId]
  );

  const block = blockResult.rows[0];
  if (parseInt(bookingCount.rows[0].count) >= block.max_signups) {
    throw new Error('Slot is full');
  }

  // Create booking
  const booking = await client.query(
    'INSERT INTO bookings (...) VALUES (...) RETURNING *',
    [/* params */]
  );

  await client.query('COMMIT');
  return booking.rows[0];
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### Authentication Middleware

The `authMiddleware` extracts JWT from `Authorization: Bearer <token>` header and attaches:
```typescript
req.user = {
  id: number,
  email: string,
  role: 'pm' | 'engineer'
}
```

Use for protected routes:
```typescript
router.get('/protected', authMiddleware, handler);
```

Or check role explicitly:
```typescript
if (req.user.role !== 'pm') {
  return res.status(403).json({ error: 'PM access only' });
}
```

## Common Tasks

### Adding a New Endpoint

1. Create handler in appropriate route file (`routes/*.ts`)
2. Add Zod schema to `@session-scheduler/shared/src/types.ts` for validation
3. Import route in `index.ts`: `app.use('/api/feature', featureRouter)`
4. Test with cURL or Postman
5. Update client API wrapper in `packages/client/src/api/client.ts`

### Adding a Database Column

1. Edit `docker/init.sql` to ALTER TABLE (only additive changes supported in v1)
2. Update types in `@session-scheduler/shared/src/types.ts`
3. Update any queries that SELECT * or reference the column
4. Run `npm run db:migrate` to update local database
5. Verify with `npm run db:seed`

### Generating .ics Calendar Files

Use `utils/ics.ts`:
```typescript
import { generateClientCalendar, generateEngineerCalendar } from '../utils/ics';

// Client variant (includes reschedule link)
const clientIcs = generateClientCalendar(booking, project, engineers);

// Engineer variant (includes client contact info)
const engineerIcs = generateEngineerCalendar(booking, project, clientDetails);

res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
res.setHeader('Content-Disposition', `attachment; filename="session-${booking.booking_token.slice(0, 8)}.ics"`);
res.send(clientIcs);
```

## Testing the Server

### Manual Development
```bash
# In one terminal:
npm run dev                          # Starts server with hot reload on port 4000

# In another terminal:
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"pm@example.com","password":"password"}'
```

### Database State
```bash
npm run db:migrate                   # Reset schema
npm run db:seed                      # Load sample data
```

## Key Constraints to Enforce

- **Booking concurrency:** Must use `SELECT ... FOR UPDATE` to prevent overselling
- **Role-based access:** Check `req.user.role` before allowing create/delete/edit
- **Time validation:** Ensure `end_time > start_time` (database CHECK constraint)
- **Token entropy:** Use `gen_random_bytes(32)` for share_token and booking_token (pgcrypto extension)
- **Password hashing:** bcrypt cost 12 for user passwords, cost 10 for project passwords
- **Parameterized queries:** Never interpolate user input into SQL

## Performance Considerations

- Index `time_blocks.project_id` for fast slot lookups
- Index `bookings.time_block_id` for counting active bookings per block
- Index `bookings.booking_token` for fast reschedule/cancel lookups
- Use connection pooling (`db/pool.ts`) — don't create new connections per request
- For bulk inserts, use a single INSERT with multiple VALUES clauses (time block batch creation)

## Security Reminders

- ✅ Validate all inputs with Zod before DB operations
- ✅ Use parameterized queries everywhere
- ✅ Hash passwords with bcrypt (never plaintext)
- ✅ Verify JWT signature before trusting `req.user`
- ✅ Don't leak sensitive data in error messages (e.g., don't return salt or hash)
- ❌ Don't trust client-side authorization checks
- ❌ Don't log passwords or tokens
