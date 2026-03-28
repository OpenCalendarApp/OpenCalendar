---
name: Route Validation Hook
description: "Automatically validates new route handlers for SQL injection, error format, and Zod validation"
---

# Route Handler Validation Hook

## Overview

This hook automatically validates Express route handlers after you create or edit them. It checks for three critical issues:

1. **SQL Injection Prevention** — Ensures parameterized queries (no string interpolation)
2. **Error Response Format** — Validates `{ error, details }` structure
3. **Input Validation** — Checks for Zod schema validation on POST/PUT handlers

## When It Runs

The hook runs automatically after you save/create a route file in `packages/server/src/routes/`:
- When you create a new route file
- When you edit an existing route file
- When the agent creates/edits routes during development

## What It Validates

### 1. SQL Injection Prevention ❌→✅

**Red Flags** (these will trigger an error):
```typescript
// ❌ DANGEROUS: Template literal interpolation
pool.query(`SELECT * FROM projects WHERE id = ${id}`);

// ❌ DANGEROUS: String concatenation
pool.query('SELECT * FROM projects WHERE id = ' + id);

// ❌ DANGEROUS: Variable in query without parameterization
const query = `SELECT * FROM projects WHERE id = ${projectId}`;
pool.query(query);
```

**Correct Patterns** ✅:
```typescript
// ✅ GOOD: Parameterized query with placeholders
pool.query(
  'SELECT * FROM projects WHERE id = $1',
  [id]
);

// ✅ GOOD: Multiple parameters
pool.query(
  'SELECT * FROM projects WHERE created_by = $1 AND is_active = $2',
  [userId, true]
);
```

### 2. Error Response Format ⚠️→✅

**Red Flags** (warnings):
```typescript
// ⚠️ Missing details field
res.status(400).json({ error: 'Invalid input' });

// ⚠️ Inconsistent format
res.status(409).json({ message: 'Conflict' });

// ⚠️ Incomplete error response
throw new Error('Something went wrong');
```

**Correct Pattern** ✅:
```typescript
// ✅ GOOD: Consistent error format
res.status(400).json({ 
  error: 'Validation failed',
  details: 'Missing required field: email'
});

// ✅ GOOD: Error with minimal context
res.status(404).json({
  error: 'Project not found',
  details: `Project ID ${id} does not exist`
});
```

### 3. Input Validation (Zod) ⚠️→✅

**Red Flags** (warnings):
```typescript
// ⚠️ POST handler without validation
router.post('/', authMiddleware, async (req, res) => {
  const { name } = req.body;  // No validation!
  await pool.query('INSERT INTO projects (name) VALUES ($1)', [name]);
});

// ⚠️ Manual validation without Zod
router.post('/', authMiddleware, async (req, res) => {
  if (!req.body.name) {
    return res.status(400).json({ error: 'Missing name' });
  }
  // ... rest of logic
});
```

**Correct Pattern** ✅:
```typescript
// ✅ GOOD: Zod validation before DB operation
import { z } from 'zod';
import { createProjectSchema } from '@session-scheduler/shared';

router.post('/', authMiddleware, async (req, res) => {
  try {
    const data = createProjectSchema.parse(req.body);  // Validates!
    const result = await pool.query(
      'INSERT INTO projects (name, created_by) VALUES ($1, $2) RETURNING *',
      [data.name, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: error.message 
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

## How to Fix Issues

### SQL Injection Issues

**Step 1:** Find the dangerous pattern in your code
```typescript
// ❌ Before
pool.query(`SELECT * FROM projects WHERE name = '${name}'`)
```

**Step 2:** Use parameterized queries
```typescript
// ✅ After
pool.query(
  'SELECT * FROM projects WHERE name = $1',
  [name]
)
```

**Reference:** [.github/instructions/backend.instructions.md § Database Queries](../instructions/backend.instructions.md#database-queries)

### Error Response Format Issues

**Step 1:** Find inconsistent error responses
```typescript
// ⚠️ Before
res.status(400).json({ error: 'Bad request' });
```

**Step 2:** Add details field
```typescript
// ✅ After
res.status(400).json({ 
  error: 'Bad request',
  details: 'Missing required fields: email, password'
});
```

**Reference:** [.github/instructions/backend.instructions.md § Error Responses](../instructions/backend.instructions.md#error-responses)

### Zod Validation Issues

**Step 1:** Check if POST/PUT handler validates input
```typescript
// ⚠️ Before - no validation
router.post('/', authMiddleware, async (req, res) => {
  const { name } = req.body;
  // ...
});
```

**Step 2:** Add Zod validation
```typescript
// ✅ After - with Zod validation
import { createProjectSchema } from '@session-scheduler/shared';

router.post('/', authMiddleware, async (req, res) => {
  try {
    const data = createProjectSchema.parse(req.body);
    // Now 'data' is validated and type-safe
    // ...
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: error.message 
      });
    }
    throw error;
  }
});
```

**Reference:** [.github/instructions/backend.instructions.md § Route Handlers](../instructions/backend.instructions.md#route-handlers)

## Running the Validator Manually

If you want to validate a file without saving it, you can run the script directly:

```bash
# Validate a single route file
node .github/scripts/validate-route.js packages/server/src/routes/projects.ts

# Or pipe code to stdin
cat packages/server/src/routes/auth.ts | node .github/scripts/validate-route.js
```

## Ignoring the Hook (Not Recommended!)

If you need to bypass the hook temporarily:

```bash
# For a specific session, disable hooks
# (Note: This is not recommended, as hooks enforce important security practices)
```

Hooks are enforced to protect the codebase from SQL injection and inconsistent error handling. If you believe a validation is incorrect, please fix the code rather than disabling the hook.

## Common Questions

**Q: Why does the hook warn about validation on this GET endpoint?**
A: GET endpoints don't typically have request bodies, but if your route uses `req.body` or accepts POST-like parameters, you should validate them.

**Q: Can I use TypeGuards instead of Zod?**
A: Zod is the standard for this project. It provides runtime validation + TypeScript type inference. Custom TypeGuards are allowed if they're as robust.

**Q: What if my SQL query is dynamically constructed?**
A: Never construct SQL dynamically from user input. Always use parameterized queries. If you need dynamic WHERE clauses, build the query carefully with validation, then use parameterized values.

## Implementation Details

**Hook Type:** `PostToolUse` — runs after file creation/edit  
**Script:** `.github/scripts/validate-route.js` (Node.js)  
**Validation Rules:** See [.github/instructions/backend.instructions.md](../instructions/backend.instructions.md)  
**Configuration:** `.github/hooks/validate-routes.json`  

## See Also

- [Backend Development Guide](../instructions/backend.instructions.md)
- [Database Layer Patterns](../instructions/database.instructions.md#common-query-patterns)
- [ARCHITECTURE.md § API Contract](../../docs/ARCHITECTURE.md#-api-contract)
