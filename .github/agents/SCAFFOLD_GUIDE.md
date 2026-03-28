---
name: Feature Scaffolder Agent Guide
description: "How to use the batch scaffolding agent to build complete features (backend + frontend + database)"
---

# Feature Scaffolder Agent — User Guide

## Overview

The **Feature Scaffolder** is a specialized agent that builds complete features end-to-end by simultaneously generating:

1. **Database migration** — New tables or column additions
2. **Backend route + Zod schema** — Type-safe Express handler with validation
3. **Frontend page/form** — React component with API integration
4. **Integration glue** — Updates to routing, navigation, imports

**Perfect for:** Building new features quickly while maintaining consistency across backend, frontend, and database.

---

## When to Use This Agent

✅ **Use Feature Scaffolder when:**
- Adding a brand new feature (endpoint + page + data model)
- You want a complete, working stub in one go
- You want to ensure consistency across all layers
- You want to learn the patterns by example

❌ **Don't use Feature Scaffolder when:**
- Editing an existing feature (use targeted edits instead)
- Only adding a database column (use `/add-database-table` prompt)
- Only adding an API endpoint (use `/add-api-endpoint` prompt)
- Only adding a page (use `/add-frontend-page` prompt)

---

## How to Invoke

### Option 1: Agent Picker (Easiest)
```
In VS Code chat:
Type: /
Select: "Feature Scaffolder" from the agent list
Provide the feature description in the input area
```

### Option 2: Direct Invocation
```
/Feature Scaffolder

Project archive feature:
- POST /api/projects/:id/archive
- Add archived_at timestamp to projects table
- PM-only endpoint
- Settings page at /projects/:id/settings
```

---

## What to Provide

Before the agent starts scaffolding, have these details ready:

| Item | Example | Details |
|------|---------|---------|
| **Feature Name** | "project archive" | What is the feature called? |
| **Endpoint Path** | `POST /api/projects/:id/archive` | HTTP method + path |
| **Frontend Route** | `/projects/:id/settings` | Where does the UI go? |
| **Database Change** | "add archived_at TIMESTAMPTZ to projects table" | What data do you need? |
| **Required Roles** | "PM only" | Who can use this feature? |

**Example:**
```
Project archive feature:
- Endpoint: POST /api/projects/:id/archive
- Frontend: New modal on /projects/:id page
- Database: Add archived_at TIMESTAMPTZ column to projects table
- Access: PM only
```

---

## Agent Workflow

### Step 1: Clarification (Agent asks if needed)
The agent will verify it has all 5 pieces of information. If something is missing, it will ask:

```
❓ A few clarifications needed:

1. Which endpoint method? (GET, POST, PUT, DELETE?)
2. Does this need a separate page, or a modal on an existing page?
3. Should other roles be able to view archived projects?

Please provide these details so I can generate the best scaffold.
```

### Step 2: Pattern Discovery (Agent reads existing code)
The agent explores the codebase to learn conventions:
- Reads similar routes in `packages/server/src/routes/`
- Reads similar pages in `packages/client/src/pages/`
- Checks the database schema
- Reviews Zod schema patterns

**You see:**
```
🔍 Learning patterns from codebase...
  ✓ Found similar route: projects.ts (POST handler pattern)
  ✓ Found similar page: ProjectDetailPage.tsx (useEffect pattern)
  ✓ Found database schema with timestamps
  ✓ Found Zod patterns in types.ts
```

### Step 3: Database Migration (Agent generates SQL)
The agent creates the necessary database changes:

```sql
-- Migration: Add archived_at column to projects table
ALTER TABLE projects
ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX idx_projects_archived ON projects(archived_at);
```

**Review & approve:**
```
The agent says:
"This SQL will be applied to docker/init.sql.
Approve? (Yes / Make changes / Cancel)"
```

### Step 4: Backend Route + Schema (Agent generates code)
The agent scaffolds the Express handler and Zod schema:

**Zod Schema** (`packages/shared/src/types.ts`):
```typescript
export const archiveProjectSchema = z.object({
  // Request body shape
});

export type ArchiveProjectRequest = z.infer<typeof archiveProjectSchema>;
```

**Route Handler** (`packages/server/src/routes/projects.ts`):
```typescript
router.post('/:id/archive', authMiddleware, async (req, res) => {
  try {
    // Validate
    // Check auth
    // Query database
    // Return response
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Review & approve:**
```
The agent says:
"This adds the route to projects.ts and schema to types.ts.
Approve? (Yes / Make changes / Cancel)"
```

### Step 5: Frontend Page/Form (Agent generates React)
The agent creates the page component:

**Page Component** (`packages/client/src/pages/ProjectSettingsPage.tsx`):
```typescript
export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(false);
  // ... form logic
  return <Layout>{/* form JSX */}</Layout>;
}
```

**Integration Updates:**
- Add to `App.tsx` routing
- Add to `Layout.tsx` navigation
- Import types from `@session-scheduler/shared`

**Review & approve:**
```
The agent says:
"This creates the settings page and updates routing/navigation.
Files to be created/edited:
- packages/client/src/pages/ProjectSettingsPage.tsx
- packages/client/src/App.tsx (1 line added)
- packages/client/src/components/Layout.tsx (1 link added)

Approve? (Yes / Make changes / Cancel)"
```

### Step 6: Summary & Testing
The agent shows a complete summary and suggests next steps:

```
✅ Feature Scaffold Complete: Project Archive

Generated:
1. Database: ALTER TABLE projects ADD COLUMN archived_at
2. Backend: POST /api/projects/:id/archive (projects.ts, types.ts)
3. Frontend: ProjectSettingsPage.tsx (App.tsx, Layout.tsx updated)

Next steps:
1. Review the code above
2. Run: npm install && npm run dev
3. Test in browser at http://localhost:5173
4. Commit: git add . && git commit -m "feat: add project archive feature"
```

---

## Interacting with the Agent

### During Code Review
The agent shows generated code **before** writing files. You can:

| Action | How |
|--------|-----|
| **Approve** | Say "Yes" or "Approve" or 👍 |
| **Request changes** | Say "Can you change..." or describe modifications |
| **Cancel** | Say "Cancel" or "Skip this part" |
| **Ask questions** | Say "What does this line do?" or "Why did you...?" |

**Example interaction:**
```
Agent: [Shows generated route code]
"Approve these changes?"

You: "Can you add a check to prevent archiving already-archived projects?"

Agent: "Good catch! I'll add:
  if (project.archived_at !== null) {
    return res.status(409).json({ error: 'Project already archived' });
  }
  
Approve now?"

You: "Yes, looks good!"
```

### If You Want to Change Something
```
Agent: [Shows generated frontend code]

You: "Can you use a modal instead of a full page?"

Agent: "Understood! I'll scaffold a modal component instead
and show it from the ProjectDetailPage. Is that right?"

You: "Yes, and make it require a confirmation checkbox."

Agent: [Generates updated code with modal and confirmation]
```

---

## Example: Complete Feature Build

### Input
```
Build an engineer availability feature:
- POST /api/time-blocks/engineer/:engineerId/availability
- Add is_available boolean column to time_blocks table
- Frontend form at /projects/:id/manage-engineers
- Engineers can manage their own availability, PMs can toggle any engineer
```

### Agent's Output

**Database Migration:**
```sql
ALTER TABLE time_blocks
ADD COLUMN is_available BOOLEAN DEFAULT TRUE;
```

**Backend Route:**
```typescript
router.post(
  '/engineer/:engineerId/availability',
  authMiddleware,
  async (req, res) => {
    // Validate
    const data = updateEngineerAvailabilitySchema.parse(req.body);
    
    // Authorize: engineer changing own, or PM changing any
    if (req.user.id !== data.engineerId && req.user.role !== 'pm') {
      return res.status(403).json({ 
        error: 'Not authorized to change other engineers availability' 
      });
    }
    
    // Update
    const result = await pool.query(
      'UPDATE time_blocks SET is_available = $1 WHERE engineer_id = $2 RETURNING *',
      [data.isAvailable, data.engineerId]
    );
    
    res.json(result.rows);
  }
);
```

**Zod Schema:**
```typescript
export const updateEngineerAvailabilitySchema = z.object({
  engineerId: z.number().int().positive(),
  isAvailable: z.boolean(),
});
```

**Frontend:**
```typescript
export default function ManageEngineersPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [engineers, setEngineers] = useState([]);
  
  const handleToggleAvailability = async (engineerId: number, availability: boolean) => {
    const result = await ApiClient.post(`/time-blocks/engineer/${engineerId}/availability`, {
      engineerId,
      isAvailable: availability
    });
    setEngineers(engineers.map(e => 
      e.id === engineerId ? { ...e, is_available: availability } : e
    ));
  };
  
  return (
    <Layout>
      <h1>Manage Engineer Availability</h1>
      {/* Engineer list with toggle buttons */}
    </Layout>
  );
}
```

**Updates:**
- Add route to `App.tsx`
- Add link to `Layout.tsx` navigation
- Update `types.ts` with Zod schema

---

## Tips & Tricks

### 💡 Provide Rich Context
Instead of:
```
Add a search endpoint
```

Try:
```
Add project search:
- GET /api/projects/search?q=term
- Search by name and description
- Return matching projects with stats
- Available to PM and Engineer roles
```

### 💡 Reference Existing Features
```
Similar to the time-block creation flow, add a dialog to bulk-create bookings:
- POST /api/bookings/bulk
- Accept array of time_block_id + client_email
- Include the same validation patterns
```

### 💡 Ask Questions During Generation
```
Agent: [Shows generated code]

You: "Before you write the files, should this page have
a confirmation dialog for destructive operations?"

Agent: [Updates code, asks for approval]
```

### 💡 Reuse for Multiple Similar Features
```
You: "Great! Now do the exact same thing for engineer
availability, but for projects instead. Same pattern,
different table and endpoint."

Agent: "I'll scaffold project availability with the same
patterns. Approve?"
```

---

## Common Patterns Handled by the Agent

The agent automatically applies these patterns (you don't need to specify them):

| Pattern | What the Agent Does |
|---------|-------------------|
| **SQL Safety** | All queries use parameterized statements ($1, $2, etc.) |
| **Validation** | All POST/PUT bodies validated with Zod before DB queries |
| **Auth Check** | Verifies `req.user.role` against permission requirements |
| **Error Format** | All errors return `{ error, details }` structure |
| **Status Codes** | 201 for creates, 200 for success, 4xx/5xx for errors |
| **React Hooks** | Uses useState, useEffect, useParams correctly |
| **API Client** | Calls ApiClient with JWT auto-injection |
| **Type Safety** | Imports types from `@session-scheduler/shared` |
| **Responsive CSS** | Uses CSS variables and responsive breakpoints |

---

## Troubleshooting

### Agent asks for clarification
**Issue:** Agent says "I need more information"

**Solution:** Provide all 5 details (feature name, endpoint, frontend route, database change, roles)

### Generated code looks different from existing code
**Issue:** Formatting or style doesn't match

**Solution:** Say "Please adjust the formatting to match the style in [existing file]" and show the agent an example

### Agent scaffolded too much or too little
**Issue:** Generated more/fewer files than expected

**Solution:** Clarify scope. Say "Just the backend route, skip the page for now" or "Also add a component for this form"

### Can't find the generated files
**Issue:** Agent said it created files, but you don't see them

**Solution:** The agent previews but doesn't write without your approval. Look for "Approve?" prompt and say "Yes"

---

## Best Practices

✅ **DO:**
- Review generated code before approving
- Ask the agent to adjust if something doesn't look right
- Test locally (`npm run dev`) after scaffolding
- Commit all generated files together
- Reference existing similar features when describing your feature

❌ **DON'T:**
- Skip the approval steps
- Build multiple features at once with one agent invocation
- Ask for features the agent can't scaffold (e.g., "add a PWA")
- Manually edit generated code before testing (test first, then iterate)

---

## See Also

- [.github/agents/scaffold-feature.agent.md](./scaffold-feature.agent.md) — Agent implementation
- [/add-api-endpoint prompt](./../prompts/add-api-endpoint.prompt.md) — When you only need a backend route
- [/add-frontend-page prompt](./../prompts/add-frontend-page.prompt.md) — When you only need a page
- [Backend Instructions](../instructions/backend.instructions.md) — Route patterns
- [Frontend Instructions](../instructions/frontend.instructions.md) — Page patterns
- [Database Instructions](../instructions/database.instructions.md) — Migration patterns
