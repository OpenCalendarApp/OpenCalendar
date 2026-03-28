---
description: "Add a new API endpoint with route handler, validation schema, and client wrapper"
argument-hint: "Describe the endpoint: verb (GET/POST/PUT/DELETE), path (/api/feature/...), and purpose"
agent: "agent"
---

# Add API Endpoint

I'll help you add a new API endpoint to the Session Scheduler following the monorepo conventions.

**Please provide:**
1. **HTTP method** (GET, POST, PUT, DELETE)
2. **Endpoint path** (e.g., `/api/projects/bulk-delete`, `/api/time-blocks/:id/engineers`)
3. **Purpose** (what does this endpoint do?)
4. **Auth required?** (JWT protected or public?)
5. **Relevant table(s)** (e.g., `projects`, `time_blocks`, `bookings`)

---

## Implementation Checklist

Once you provide those details, I'll help you:

### 1. **Define Zod Schema** (shared types)
   - Create validation schema in `packages/shared/src/types.ts`
   - Define request body shape and validation rules
   - Export TypeScript interface

### 2. **Create Route Handler** (backend)
   - Add handler to appropriate `packages/server/src/routes/*.ts` file
   - Validate input with Zod before DB operations
   - Query database with parameterized statements
   - Return normalized JSON response with proper HTTP status code
   - Handle errors with `{ error, details }` format

### 3. **Register Route** (server setup)
   - Import route in `packages/server/src/index.ts`
   - Add `app.use('/api/...',  routeRouter)` middleware

### 4. **Create API Client Wrapper** (frontend)
   - Add typed method to `packages/client/src/api/client.ts`
   - Auto-inject JWT from localStorage
   - Handle response parsing and error extraction

### 5. **Use in Frontend** (components/pages)
   - Import from `ApiClient`
   - Call in useEffect or event handler
   - Update loading/error state

### 6. **Test Locally**
   - Verify with `curl` or Postman
   - Check database state with `npm run db:seed`
   - Test JWT auth with Authorization header

---

## Reference

See [.github/instructions/backend.instructions.md](../instructions/backend.instructions.md) for:
- Route handler patterns
- Database query safety (parameterized + race conditions)
- Error response format
- Authentication middleware usage

See [docs/ARCHITECTURE.md § 6. API Contract](../../docs/ARCHITECTURE.md#-api-contract) for:
- Full endpoint specifications
- Request/response shapes
- Status codes and error handling

---

**Ready? Provide the endpoint details above and I'll generate the implementation!**
