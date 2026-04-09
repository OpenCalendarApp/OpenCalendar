---
name: OpenCalendar AI Customizations — Complete Setup Summary
---

# 🎯 OpenCalendar AI Customizations — Complete Setup

This document summarizes all the AI development tools, agents, prompts, hooks, and instructions that have been configured for the OpenCalendar monorepo.

---

## 📁 File Structure

```
.github/
├── copilot-instructions.md           # ✅ Main workspace instructions
├── instructions/
│   ├── backend.instructions.md       # ✅ Backend route patterns
│   ├── frontend.instructions.md      # ✅ Frontend page patterns
│   └── database.instructions.md      # ✅ Database migration patterns
├── prompts/
│   ├── add-api-endpoint.prompt.md    # ✅ Single-task: add REST endpoint
│   └── add-frontend-page.prompt.md   # ✅ Single-task: add React page
├── agents/
│   ├── scaffold-feature.agent.md     # ✅ Orchestrated: full-stack feature scaffolding
│   ├── task-orchestrator.agent.md    # ✅ Orchestrated: batch task execution (meta-agent)
│   ├── SCAFFOLD_GUIDE.md             # ✅ User guide for Feature Scaffolder
│   ├── TASK_ORCHESTRATOR_GUIDE.md    # ✅ User guide for Task Orchestrator
│   └── README.md                     # ✅ Overview of all agents
├── hooks/
│   ├── validate-routes.json          # ✅ Auto-validation configuration
│   ├── VALIDATE_ROUTES.md            # ✅ Route validation guide
│   └── README.md                     # ✅ All hooks documentation
└── scripts/
    └── validate-route.js             # ✅ Route validator (checks SQL injection, errors, Zod)
```

---

## 🛠️ What Was Created

### 1. Workspace Instructions (`copilot-instructions.md`)
**Status:** ✅ Complete  
**Scope:** Applies to entire workspace (`applyTo: "**"`)  
**Content:**
- Monorepo structure overview
- Tech stack reference
- Quick start commands
- API structure overview
- Common development tasks
- Security checklist
- References to specialized instructions

**Reference:** [.github/copilot-instructions.md](.github/copilot-instructions.md)

---

### 2. Specialized Instructions

#### Backend Instructions
**File:** `.github/instructions/backend.instructions.md`  
**Scope:** `packages/server/**`  
**Content:**
- Route handler patterns
- Database query safety (parameterized queries, race conditions)
- Error response format
- Authentication middleware
- Common backend tasks
- Performance considerations
- Security reminders

#### Frontend Instructions
**File:** `.github/instructions/frontend.instructions.md`  
**Scope:** `packages/client/**`  
**Content:**
- Page component patterns
- API client usage
- React hooks + Context patterns
- Multi-step flow examples
- Styling with CSS variables
- Responsive design breakpoints
- Performance tips
- Security reminders

#### Database Instructions
**File:** `.github/instructions/database.instructions.md`  
**Scope:** `docker/init.sql`, `packages/server/src/db/**`  
**Content:**
- Database schema design (5 tables + 1 view)
- Common query patterns
- Transaction + race condition safety
- Database layer patterns
- Migration strategy
- Debugging techniques
- Performance best practices

---

### 3. Interactive Prompts

#### `/add-api-endpoint`
**File:** `.github/prompts/add-api-endpoint.prompt.md`  
**Use when:** Adding a new REST endpoint  
**Time:** 10-15 minutes

**Guides you through:**
1. Creating Zod schema (shared types)
2. Route handler implementation
3. Route registration in Express
4. API client wrapper
5. Frontend integration
6. Local testing

**Example:**
```
/add-api-endpoint
POST /api/projects/bulk-delete - PM-only endpoint
```

#### `/add-frontend-page`
**File:** `.github/prompts/add-frontend-page.prompt.md`  
**Use when:** Creating a new React page  
**Time:** 10-15 minutes

**Guides you through:**
1. Page component creation
2. React Router setup
3. Sub-components extraction
4. Navigation updates
5. Responsive styling
6. API integration
7. Local testing

**Example:**
```
/add-frontend-page
Settings page at /projects/:id/settings
```

---

### 4. Custom Agents

#### `Feature Scaffolder`
**File:** `.github/agents/scaffold-feature.agent.md`  
**Invoke:** `/Feature Scaffolder` or from agent picker  
**Use when:** Building a complete feature end-to-end  
**Time:** 15-20 minutes

**What it does:**
- Analyzes existing code patterns
- Generates database migration
- Creates Express route + Zod schema
- Scaffolds React page/form
- Updates routing and imports
- All simultaneously and consistently

**Workflow:**
```
You provide details (endpoint, database change, frontend route, roles)
     ↓
Agent reads existing patterns (learns conventions)
     ↓
Agent generates database migration + asks for approval
     ↓
Agent generates backend route + schema + asks for approval
     ↓
Agent generates frontend page + updates + asks for approval
     ↓
Complete feature scaffold delivered
```

**Example:**
```
/Feature Scaffolder

Project archive feature:
- POST /api/projects/:id/archive
- Add archived_at TIMESTAMPTZ to projects table
- Modal on /projects/:id page
- PM only
```

**Guide:** [.github/agents/SCAFFOLD_GUIDE.md](.github/agents/SCAFFOLD_GUIDE.md)

#### `Task Orchestrator`
**File:** `.github/agents/task-orchestrator.agent.md`  
**Invoke:** `/Task Orchestrator` or from agent picker  
**Use when:** Running 2+ features (e.g., sprint features, backlog items)  
**Time:** 60-90 minutes for 3-5 features

**What it does:**
- Reads a task list (markdown, YAML, or inline)
- Validates each task is well-documented
- Plans which sub-agent handles each task
- Executes tasks sequentially with progress tracking
- Routes features to Feature Scaffolder
- Routes research to Explore agent
- Provides final summary with completion status

**Workflow:**
```
You provide task list (docs/SPRINT.md or inline)
     ↓
Agent parses and validates tasks
     ↓
Agent asks: "Ready to execute 3 features + 2 research?" 
     ↓
You approve (or adjust)
     ↓
For each task:
  - Agent marks in-progress
  - Agent invokes Feature Scaffolder (for features)
  - Agent waits for result
  - Agent marks complete
     ↓
Final summary: "3 features delivered, 2 research items complete"
```

**Example:**
```
/Task Orchestrator

docs/SPRINT.md
```

Or inline:
```
/Task Orchestrator

Feature 1: Archive projects (POST /api/projects/:id/archive)
Feature 2: Publish projects (POST /api/projects/:id/publish)
Feature 3: Bulk export (GET /api/bookings/export)
```

**Guide:** [.github/agents/TASK_ORCHESTRATOR_GUIDE.md](.github/agents/TASK_ORCHESTRATOR_GUIDE.md)

---

### 5. Validation Hooks

#### Route Handler Validation Hook
**File:** `.github/hooks/validate-routes.json`  
**Validator:** `.github/scripts/validate-route.js`  
**Trigger:** `PostToolUse` (runs after file creation/edit)  
**Coverage:** Express routes in `packages/server/src/routes/`

**What it validates:**
1. **SQL Injection Prevention** — Detects string interpolation, enforces parameterized queries
2. **Error Response Format** — Validates `{ error, details }` structure
3. **Input Validation** — Checks for Zod schema validation on POST/PUT

**Example output:**
```
🔍 Route validation found 2 error(s) and 1 warning(s):

❌ Line 42: SQL Injection vulnerability: query uses string interpolation
   → Use parameterized query: pool.query('SELECT ... WHERE id = $1', [id])

⚠️ Line 28: POST handler may lack request validation
   → Add Zod validation: const data = createProjectSchema.parse(req.body);
```

**Guide:** [.github/hooks/VALIDATE_ROUTES.md](.github/hooks/VALIDATE_ROUTES.md)

---

## 🎯 How to Use These Tools

### For Adding an API Endpoint
```
1. Type `/add-api-endpoint` in chat
2. Describe: HTTP method, path, purpose
3. Follow the interactive guide
4. Generate all pieces: schema + route + client wrapper
```

### For Adding a Frontend Page
```
1. Type `/add-frontend-page` in chat
2. Describe: route path, purpose, data sources
3. Follow the interactive guide
4. Generate page + components + routing
```

### For Building a Complete Feature
```
1. Type `/Feature Scaffolder` in chat
2. Provide: endpoint path, database change, frontend route, roles
3. Agent scaffolds all simultaneously
4. Review and approve each part
5. Complete feature is ready to test
```

### For Running a Sprint (Multiple Features)
```
1. Create docs/SPRINT.md with task list
2. Type `/Task Orchestrator` in chat
3. Provide: docs/SPRINT.md or paste inline tasks
4. Agent validates and plans execution
5. Approve the plan
6. Watch agent execute each task
7. Get final summary with all features built
```

---

## ✨ Key Benefits

| Benefit | How |
|---------|-----|
| **Consistency** | All code follows the same patterns (instructions guide you) |
| **Speed** | Build features faster with agents + prompts |
| **Quality** | Validation hooks catch SQL injection + format issues early |
| **Learning** | Written patterns in instructions teach best practices |
| **Flexibility** | Choose the tool that matches your task (prompt vs agent) |

---

## 📊 Tool Selection Guide

| Task | Best Tool | Time |
|------|-----------|------|
| Add a single API endpoint | `/add-api-endpoint` prompt | 10-15 min |
| Add a single React page | `/add-frontend-page` prompt | 10-15 min |
| Build a complete new feature | `Feature Scaffolder` agent | 15-20 min |
| Run a sprint (2+ features) | `Task Orchestrator` agent | 60-90 min for 3-5 features |
| Understand patterns | Read instructions (`.github/instructions/`) | — |
| Check route quality | Validation hook runs automatically | — |

---

## 🔍 What Each Tool Enforces

### Instructions
Guide best practices (non-deterministic):
- ✓ How to write route handlers
- ✓ SQL query safety patterns
- ✓ React page structure
- ✓ Error response format
- ✓ Security considerations

### Prompts
Interactive guides for single tasks:
- ✓ Collect requirements
- ✓ Explain step-by-step workflow
- ✓ Reference instruction files
- ✓ Generate code snippets

### Agents
Orchestrate complex workflows:
- ✓ Read existing patterns
- ✓ Generate interdependent parts
- ✓ Maintain consistency
- ✓ Approve before writing files

### Hooks
Automatic validation (deterministic):
- ✓ Detect SQL injection risks
- ✓ Validate error format
- ✓ Check Zod validation presence
- ✓ Provide fix suggestions

---

## 🚀 Getting Started

### First Time Setup
```bash
# Everything is already configured!
# Just start using the tools:

1. Type `/` in chat → see available prompts
2. Type `/Feature Scaffolder` → start scaffolding
3. Follow agent/prompt guidance
```

### Example Workflow
```
Task: Add user profile endpoint

1. Decision: This is one endpoint → use `/add-api-endpoint` prompt
2. Chat: /add-api-endpoint
3. Input: GET /api/auth/profile - Returns current user details
4. Follow the interactive steps
5. Result: Zod schema + route handler + client wrapper
6. Validation hook runs automatically to check SQL safety
```

---

## 📚 Documentation Index

**Get Started:**
- [.github/copilot-instructions.md](.github/copilot-instructions.md) — Main instructions

**Learn Patterns:**
- [.github/instructions/backend.instructions.md](.github/instructions/backend.instructions.md)
- [.github/instructions/frontend.instructions.md](.github/instructions/frontend.instructions.md)
- [.github/instructions/database.instructions.md](.github/instructions/database.instructions.md)

**Use Prompts:**
- [.github/prompts/add-api-endpoint.prompt.md](.github/prompts/add-api-endpoint.prompt.md)
- [.github/prompts/add-frontend-page.prompt.md](.github/prompts/add-frontend-page.prompt.md)

**Use Agents:**
- [.github/agents/SCAFFOLD_GUIDE.md](.github/agents/SCAFFOLD_GUIDE.md) — How to use Feature Scaffolder
- [.github/agents/TASK_ORCHESTRATOR_GUIDE.md](.github/agents/TASK_ORCHESTRATOR_GUIDE.md) — How to use Task Orchestrator
- [.github/agents/scaffold-feature.agent.md](.github/agents/scaffold-feature.agent.md) — Feature Scaffolder implementation
- [.github/agents/task-orchestrator.agent.md](.github/agents/task-orchestrator.agent.md) — Task Orchestrator implementation
- [.github/agents/README.md](.github/agents/README.md) — All agents overview

**Use Hooks:**
- [.github/hooks/VALIDATE_ROUTES.md](.github/hooks/VALIDATE_ROUTES.md) — Route validation guide
- [.github/hooks/README.md](.github/hooks/README.md) — All hooks overview

**Reference Architecture:**
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — Complete system specification

---

## ✅ Checklist: You're Ready!

- [x] Main workspace instructions created
- [x] Specialized instructions for backend/frontend/database
- [x] Interactive prompts for single tasks
- [x] Feature Scaffolder agent for full-stack features
- [x] Route validation hook with SQL/error/validation checks
- [x] Comprehensive documentation
- [x] Examples and usage guides

**Next:** Start building! Use `/Feature Scaffolder` to add your first feature, or `/add-api-endpoint` for individual pieces.

---

## 🎓 Advanced Usage

### Creating Additional Tools

Want to add more prompts/agents? See:
- `.github/agents/README.md` — Agent design principles
- `.github/prompts/` — Prompt examples

### Customizing Validation

Want to modify the route validator? See:
- `.github/hooks/validate-route.js` — Validator implementation
- `.github/hooks/validate-routes.json` — Hook configuration

### Adding Project-Specific Instructions

Want project-specific guidelines? See:
- `.github/instructions/` — How to structure instructions

---

## 📞 Support

Stuck? Check these:
1. **Pattern questions:** Read the relevant instruction file
2. **Tool usage:** Check the SCAFFOLD_GUIDE.md or prompt description
3. **Code issues:** Validation hook will catch common problems
4. **Architecture:** Refer to docs/ARCHITECTURE.md

Happy building! 🚀
