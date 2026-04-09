---
name: Custom Agents Overview
description: "List of specialized agents for OpenCalendar development"
---

# Custom Agents — OpenCalendar

This directory contains specialized agents for the Session Scheduler monorepo. Each agent has a focused role and restricted toolset to guide development workflows.

## Available Agents

### 🏭 Feature Scaffolder
**File:** `scaffold-feature.agent.md`  
**Invoke:** Type `/Feature Scaffolder` in chat  
**Use when:** Building a new feature end-to-end (backend + frontend + database)

**What it does:**
- Analyzes existing code patterns
- Generates database migration
- Creates Express route + Zod schema
- Scaffolds React page/form
- Updates routing and imports
- All simultaneously and consistently

**Input example:**
```
Project archive feature:
- POST /api/projects/:id/archive
- Frontend: Modal on /projects/:id page
- Database: Add archived_at TIMESTAMPTZ to projects table
- Access: PM only
```

**Output:**
```
✅ Complete scaffold with:
- SQL migration
- Backend route + Zod schema
- Frontend React component
- Updated App.tsx routing
- Updated Layout.tsx navigation
```

**Speed:** ~15-20 minutes for complete feature  
**Guide:** See [SCAFFOLD_GUIDE.md](./SCAFFOLD_GUIDE.md)

---

### 🎯 Task Orchestrator
**File:** `task-orchestrator.agent.md`  
**Invoke:** Type `/Task Orchestrator` in chat  
**Use when:** Have 2+ features to build and want systematic batch execution

**What it does:**
- Reads a task list (markdown, YAML, or inline)
- Validates each task is well-documented
- Plans which sub-agent handles each task
- Executes tasks sequentially with progress tracking
- Routes features to Feature Scaffolder
- Routes research to Explore agent
- Tracks completion and provides summary

**Input example:**
```
docs/SPRINT.md

(File contains task list with feature descriptions)
```

Or inline:
```
Feature 1: Archive projects
- Endpoint: POST /api/projects/:id/archive
- Database: Add archived_at column
- Frontend: Modal on /projects/:id

Feature 2: Publish projects
- Endpoint: POST /api/projects/:id/publish
- Database: Add published_at column
- Frontend: Button on project card
```

**Output:**
```
✅ Sprint Complete! 2/2 features built
- Archive Projects (15 min)
- Publish Projects (14 min)

Generated Files: 6
Next: Test and commit
```

**Speed:** Depends on tasks (typically 60-90 min for 3-5 features)  
**Guide:** See [TASK_ORCHESTRATOR_GUIDE.md](./TASK_ORCHESTRATOR_GUIDE.md)

---

## Why Use Agents Instead of Prompts?

| Aspect | Prompts (`.prompt.md`) | Agents (`.agent.md`) |
|--------|----------------------|-------------------|
| **Scope** | Single focused task | Orchestrated workflow with roles |
| **Tools** | Unrestricted | Minimal, specific toolset |
| **Complexity** | Simple, straightforward | Multi-step with decision points |
| **State** | Stateless | Can build context across steps |
| **Use case** | `/add-api-endpoint` | `/Feature Scaffolder` for full-stack |

**Example:**
- **Prompt:** "Add this one API endpoint" → `/add-api-endpoint`
- **Agent:** "Build a complete feature with endpoint + page + database" → `Feature Scaffolder`
- **Meta-Agent:** "Build 5 features from a sprint list" → `Task Orchestrator`

---

## Agent Invocation Methods

### 1. Agent Picker (Easiest)
```
Press Ctrl+Shift+P (or Cmd+Shift+P on Mac)
Type: "Chat: Invoke Agent"
Select from list: "Feature Scaffolder"
Provide input
```

Or in chat: Type `/` and select from agent list

### 2. Direct Slash Command
```
/Feature Scaffolder

[Describe your feature here]
```

### 3. As Subagent
Another agent can invoke this agent:
```
The main agent detects the task matches and says:
"This looks like a full-stack feature. Let me delegate to Feature Scaffolder..."
```

---

## Agent Configuration

Each agent is defined by:

| File | Purpose |
|------|---------|
| `scaffold-feature.agent.md` | The agent implementation (persona, tools, constraints) |
| `SCAFFOLD_GUIDE.md` | User-facing guide (how to use, examples, tips) |
| `README.md` | This file — overview of all agents |

### Frontmatter Breakdown

```yaml
---
description: "What this agent does and when to invoke it (for discovery)"
name: "Display name in agent picker"
tools: [read, edit, search, agent]  # Minimal tools for this role
user-invocable: true                # Show in the agent picker
argument-hint: "Example input format"
---
```

---

## Design Principles

### 1. Single Responsibility
Each agent has **one primary job**:
- Feature Scaffolder → Build complete features
- (Future) API Designer → Design REST endpoints
- (Future) Database Optimizer → Analyze and improve schemas

### 2. Minimal Tooling
Agents include **only what they need**:
- Feature Scaffolder: `read, edit, search, agent` (no web, no execute)
- Tools are restricted so the agent stays focused

### 3. Clear Boundaries
Agents know **what NOT to do**:
```
- DO NOT generate code without reading existing patterns
- DO NOT create standalone files without coordinating imports
- DO NOT skip Zod validation
```

### 4. Keyword-Rich Descriptions
Descriptions help both:
- **Users:** Know when to invoke the agent
- **Parent agents:** Decide when to delegate

Good description:
```
"Batch scaffold a complete feature: backend route + frontend form 
+ database migration. Use when building a new feature end-to-end..."
```

Bad description:
```
"A helpful agent"
```

---

## Future Agents (Ideas for v2+)

These agents could be added to support other workflows:

### 🗄️ Database Optimizer
Analyzes table structure and query patterns, suggests:
- Missing indexes
- Query optimization opportunities
- Schema denormalization (if justified)
- Data retention policies

### 🎨 API Designer
Helps design REST endpoints by:
- Asking about business logic
- Studying existing endpoints
- Proposing endpoint structure
- Generating route skeletons

### 🧪 Test Scaffolder
Generates unit + integration tests:
- Backend: Jest + supertest
- Frontend: Vitest + React Testing Library
- Database: Test fixtures and migrations

### 📊 Performance Auditor
Reviews code for performance issues:
- N+1 queries
- Inefficient algorithms
- Bundle size bloat
- Slow database queries

---

## Best Practices for Using Agents

### ✅ DO
- **Understand the output** — Review generated code before approving
- **Iterate with the agent** — Ask for changes on the fly
- **Test locally** — Run `npm run dev` and verify manually
- **Commit together** — Group all generated changes in one commit
- **Reference patterns** — Show the agent examples from your codebase

### ❌ DON'T
- **Skip approvals** — Always review before files are written
- **Combine unrelated features** — One agent invocation = one feature
- **Edit generated code immediately** — Test first, then iterate
- **Forget cleanup** — Remove temporary test code before committing
- **Assume correctness** — Always validate generated SQL with a DBA or senior dev

---

## Troubleshooting

### Agent says "I need more information"
**Issue:** Missing required input details

**Solution:** Provide all requested details. For Feature Scaffolder, that's:
1. Feature name
2. Endpoint path
3. Frontend route
4. Database change
5. Required roles

### Generated code doesn't match existing style
**Issue:** Agent used an inconsistent pattern

**Solution:** Ask the agent to align with existing patterns:
```
"Can you adjust the route handler style to match 
the pattern in packages/server/src/routes/projects.ts?"
```

### Agent won't generate something I want
**Issue:** Agent has constraints by design

**Solution:** Either:
- Use the targeted prompts (`/add-api-endpoint`, `/add-frontend-page`)
- Ask the main agent to do it instead
- Manually implement and ask for code review

### Agent forgot to update imports
**Issue:** Generated files but forgot to update App.tsx or types.ts

**Solution:** Ask the agent:
```
"You created the page but didn't add it to App.tsx routing.
Can you update the import and add the route?"
```

---

## How Agents Compare to Other Customizations

| Type | Files | Scope | Use Case |
|------|-------|-------|----------|
| **Instructions** | `.instructions.md` | Always-on, applies to all files | Guidelines and conventions |
| **Prompts** | `.prompt.md` | Single focused task | `/add-api-endpoint` |
| **Agents** | `.agent.md` | Orchestrated workflow | `/Feature Scaffolder` |
| **Hooks** | `.json` | Automatic validation | Auto-check for SQL injection |

---

## See Also

**Guides & Documentation:**
- [SCAFFOLD_GUIDE.md](./SCAFFOLD_GUIDE.md) — How to use Feature Scaffolder
- [TASK_ORCHESTRATOR_GUIDE.md](./TASK_ORCHESTRATOR_GUIDE.md) — How to run batch feature development

**Agent Implementations:**
- [scaffold-feature.agent.md](./scaffold-feature.agent.md) — Feature Scaffolder agent
- [task-orchestrator.agent.md](./task-orchestrator.agent.md) — Task Orchestrator agent

**Related Customizations:**
- [.github/prompts/](../prompts/) — Single-task prompts (`/add-api-endpoint`)
- [.github/hooks/](../hooks/) — Automatic validation
- [.github/instructions/](../instructions/) — Development guidelines
