---
name: Task Orchestrator Agent Guide
description: "How to use the batch task orchestrator to build multiple features systematically"
---

# Task Orchestrator Agent — User Guide

## Overview

The **Task Orchestrator** is a specialized agent that manages a structured task list and systematically delegates work to specialized sub-agents. It's perfect for:

- **Running sprints** — Build multiple features in sequence
- **Managing backlogs** — Track progress through prioritized work items
- **Coordinating teams** — Delegate pieces to appropriate sub-agents
- **Systematic development** — Build features with consistent patterns

Instead of manually invoking Feature Scaffolder 5 times, you provide a task list once, and the orchestrator runs through it automatically.

---

## When to Use This Agent

✅ **Use when you have:**
- A list of 2+ well-documented development tasks
- Clear task descriptions (endpoints, database changes, pages, etc.)
- Tasks that can be done in sequence
- A desire to automate systematic development

❌ **Don't use when:**
- You have only 1 task (use Feature Scaffolder directly)
- Tasks are vague or poorly documented
- Tasks are highly interdependent
- You need deep research/discovery per task

---

## How to Invoke

### Option 1: Agent Picker
```
Type: /Task Orchestrator
Provide: Path to task file (docs/BACKLOG.md)
```

### Option 2: Direct with File Path
```
/Task Orchestrator

docs/SPRINT.md
```

### Option 3: Inline Task List
```
/Task Orchestrator

Feature 1: Project archive
- Endpoint: POST /api/projects/:id/archive
- Database: Add archived_at column
- Frontend: Modal on /projects/:id
- Access: PM only

Feature 2: Project publish
- Endpoint: POST /api/projects/:id/publish
- Database: Add published_at column
- Frontend: Button on /projects/:id
- Access: PM only
```

---

## Task List Formats

### Format 1: Markdown Checklist (Recommended)
```markdown
# Development Backlog

## Ready to Build
- [ ] Add project archive feature
  - **Endpoint:** POST /api/projects/:id/archive
  - **Database:** Add archived_at TIMESTAMPTZ to projects table
  - **Frontend:** Modal on /projects/:id page
  - **Access:** PM only
  - **Type:** Feature (Feature Scaffolder Agent)

- [ ] Add project publish feature
  - **Endpoint:** POST /api/projects/:id/publish
  - **Database:** Add published_at TIMESTAMPTZ to projects table
  - **Frontend:** Button on /projects/:id page
  - **Access:** PM only
  - **Type:** Feature (Feature Scaffolder Agent)

- [ ] Bulk export bookings
  - **Endpoint:** GET /api/bookings/export?format=csv|json
  - **Database:** No schema changes needed
  - **Frontend:** Export button on dashboard
  - **Type:** Feature (Feature Scaffolder Agent)

## Blocked / Investigating
- [ ] Database optimization
  - Need to analyze query patterns first
  - **Type:** Research (Explore Agent)
```

### Format 2: Markdown with Collapsible Sections
```markdown
# Q2 Sprint Tasks

<details>
<summary>Features (3)</summary>

### Archive Projects
- POST /api/projects/:id/archive
- Add archived_at to projects
- Modal on project page
- Type: Feature

### Publish Projects  
- POST /api/projects/:id/publish
- Add published_at to projects
- Button on project card
- Type: Feature

### Bulk Booking Export
- GET /api/bookings/export
- No DB changes
- Export button + options
- Type: Feature

</details>

<details>
<summary>Research (2)</summary>

### Query Performance Analysis
- Analyze time_blocks + bookings joins
- Type: Research (Explore)

### Booking Concurrency Review
- Review SELECT...FOR UPDATE patterns
- Type: Research (Explore)

</details>
```

### Format 3: Simple YAML
```yaml
sprint: "Q2 Sprint"
tasks:
  - id: "F1"
    name: "Archive Projects"
    type: "feature"
    description: |
      Endpoint: POST /api/projects/:id/archive
      Database: archived_at TIMESTAMPTZ
      Frontend: Modal on /projects/:id
      Access: PM only
    agent: "Feature Scaffolder"
    status: "not-started"
    
  - id: "F2"
    name: "Publish Projects"
    type: "feature"
    description: |
      Endpoint: POST /api/projects/:id/publish
      Database: published_at TIMESTAMPTZ
      Frontend: Button on project card
      Access: PM only
    agent: "Feature Scaffolder"
    status: "not-started"
```

---

## Agent Workflow

### Step 1: Provide Task List
You give the orchestrator a task file or inline list.

```
/Task Orchestrator

docs/SPRINT.md
```

### Step 2: Agent Parses Tasks
The agent reads your task list and validates:
```
✅ Found 5 tasks in SPRINT.md

📋 Task Summary:
1. ✅ Archive Projects (documented, ready)
2. ✅ Publish Projects (documented, ready)
3. ✅ Bulk Export (documented, ready)
4. ❓ Query Analysis (needs clarification)
5. ❓ Concurrency Review (needs clarification)

Please clarify tasks 4 & 5, or proceed with 1-3?
```

### Step 3: You Approve Plan
```
You: "Clarify task 4 - analyze what specifically?"

Agent: "What should we measure?
  - Slow queries (queries taking >100ms)?
  - Missing indexes?
  - N+1 patterns?
  - All of the above?"

You: "All of the above"

Agent: "Got it! Starting Feature Scaffolder for tasks 1-3,
        then Explore Agent for query analysis.
        Ready to start? (Yes/No/Skip task X)"

You: "Yes"
```

### Step 4: Agent Executes Each Task
For each task, the agent:

1. **Marks task in-progress**
2. **Invokes appropriate sub-agent**
3. **Shows progress** as the sub-agent works
4. **Collects results**
5. **Marks task complete**

```
🔄 Task 1/5: Archive Projects
   Invoking: Feature Scaffolder Agent
   
   [Agent determines schema]
   [Agent generates database migration]
   [Agent generates backend route]
   [Agent generates frontend components]
   [Agent updates routing]
   
✅ Task 1 Complete!
   • Route: POST /api/projects/:id/archive
   • Schema: ArchiveProjectRequest
   • Page: Updated /projects/:id
   • Files: 3 created/updated
   
🔄 Task 2/5: Publish Projects
   [executing...]
```

### Step 5: Agent Reports Progress
After each task:
```
Progress: 2/5 tasks complete (40%)

Completed:
1. ✅ Archive Projects (15 min)
2. ✅ Publish Projects (14 min)

In Progress:
3. Bulk Export (5 min elapsed)

Next:
4. Query Analysis (Explore Agent)
5. Concurrency Review (Explore Agent)

Continue? (Yes/Skip/Adjust)
```

### Step 6: Final Summary
When all tasks are done:
```
✅ Sprint Complete!

📊 Summary:
- Tasks: 5/5 complete (100%)
- Time: ~75 minutes
- Features built: 3
- Research completed: 2
- Files generated: 12

📝 Features Delivered:
1. Project Archive (POST /api/projects/:id/archive)
2. Project Publish (POST /api/projects/:id/publish)
3. Bulk Export (GET /api/bookings/export)

🔍 Research Findings:
1. Query Performance: Identified 2 missing indexes
2. Concurrency: Current SELECT...FOR UPDATE pattern is safe

🚀 Next Steps:
1. Run: npm install && npm run dev
2. Test features in browser
3. Apply database indexes
4. Commit: "feat: Q2 sprint features"
5. Deploy to staging
```

---

## Example: Running Your First Sprint

### Create Task File
Create `docs/SPRINT.md`:

```markdown
# Q2 Sprint - Week 1

## Features (Primary Focus)

### 1. Project Archive
- **Endpoint:** POST /api/projects/:id/archive
- **Database:** Add `archived_at TIMESTAMPTZ` to projects table
- **Frontend:** Modal on /projects/:id page with confirmation
- **Access:** PM only
- **Type:** Feature

### 2. Time Block Bulk Operations
- **Endpoint:** DELETE /api/time-blocks/bulk with array of IDs
- **Database:** No schema changes (use cascading deletes)
- **Frontend:** Checkbox multi-select on project detail page
- **Access:** PM only
- **Type:** Feature

### 3. Engineer Availability Toggle
- **Endpoint:** POST /api/engineers/:id/toggle-availability
- **Database:** Add `is_available BOOLEAN` to time_block_engineers
- **Frontend:** Toggle buttons on manage engineers page
- **Access:** Engineer (own only) or PM (any)
- **Type:** Feature

## Research Tasks

### 4. Database Query Performance
- Analyze time_blocks + bookings join patterns
- Identify slow queries and missing indexes
- Type: Research

### 5. Authentication Flow Review
- Review current JWT + password patterns
- Suggest improvements if any
- Type: Research
```

### Invoke Orchestrator
```
/Task Orchestrator

docs/SPRINT.md
```

### Agent's Response
```
📋 Found 5 tasks in docs/SPRINT.md

✅ All tasks are well-documented!

🚀 Execution Plan:
1. ✅ Project Archive (Feature Scaffolder, 15-20 min)
2. ✅ Bulk Operations (Feature Scaffolder, 15-20 min)
3. ✅ Availability Toggle (Feature Scaffolder, 15-20 min)
4. ✅ Query Performance (Explore Agent, 10-15 min)
5. ✅ Auth Review (Explore Agent, 10-15 min)

Total estimated time: 65-90 minutes

Ready to start? (Yes/Skip task X/Adjust)
```

### Approve and Watch
```
You: "Yes, go ahead!"

Agent: "Starting Task 1/5: Project Archive"
[Agent invokes Feature Scaffolder]
[Feature Scaffolder generates code]
Agent: "✅ Task 1 complete! Moving to Task 2..."

[Process repeats for each task]

Agent: "✅ All 5 tasks complete! 
        Summary: 3 features + 2 research items
        Next: Review generated code, run tests, commit"
```

---

## Interacting with the Orchestrator

### Continue to Next Task
```
You: "Looks good!"
Agent: [Continues to next task]
```

### Skip a Task
```
You: "Skip the auth review for now"
Agent: "Marking auth review as blocked. Continuing with next task..."
```

### Adjust a Task Mid-Execution
```
You: "Wait, can you add email notification to the publish feature?"
Agent: "Good catch! I'll ask Feature Scaffolder to add:
        - Email sent to PM on publish
        - Database: log_notification flag
        
        Approve this addition?"

You: "Yes"
Agent: [Feature Scaffolder adds notification logic]
```

### Get Current Status
```
You: "How are we doing?"
Agent: "Progress: 2/5 tasks complete (40%)
        Time: 35 minutes elapsed
        Current: Bulk Operations (Feature Scaffolder)
        Estimated finish: 50 more minutes"
```

### Pause and Resume
```
You: "Pause after the next task"
Agent: [Completes current task, stops]
Agent: "Paused. 3/5 tasks complete. Resume when ready?"

[Later...]
You: "Resume"
Agent: "Resuming Task 4..."
```

---

## Task Documentation Best Practices

### ✅ Good Task Documentation
```markdown
## Add Project Archive Feature
- **Endpoint:** POST /api/projects/:id/archive
  - Payload: { reason?: string }
  - Auth: PM only
- **Database:** Add `archived_at TIMESTAMPTZ` to projects table
- **Frontend:** Modal on /projects/:id page
- **Behavior:** 
  - Only allow if no active bookings
  - Log the archive action
  - Send notification
```

### ❌ Bad Task Documentation
```
- Archive projects
```

### ✅ Good Research Task
```markdown
## Database Query Optimization
- **Goal:** Identify slow queries in booking flow
- **Focus Areas:**
  - time_blocks + bookings JOINs
  - Engineer availability filtering
  - Available slots aggregation
- **Type:** Explore (codebase analysis)
```

### ❌ Bad Research Task
```
- Make it faster
```

---

## Common Workflows

### Workflow 1: Sprint Execution
```
1. Create docs/SPRINT.md with all planned features
2. /Task Orchestrator docs/SPRINT.md
3. Approve the plan
4. Watch orchestrator run through each feature
5. Get final summary
6. Test and commit
```

### Workflow 2: Backlog Cleanup
```
1. Create docs/BACKLOG.md with prioritized work
2. /Task Orchestrator docs/BACKLOG.md
3. Have agent focus on "High Priority" section
4. Run through those features
5. Revisit backlog next cycle
```

### Workflow 3: Feature Batch Build
```
1. /Task Orchestrator
2. Provide inline list of 3-5 related features
3. Let orchestrator run them all
4. Get complete feature set delivered
```

### Workflow 4: Research Then Build
```
1. Create task list with research items first
2. /Task Orchestrator
3. Run research tasks (Explore Agent)
4. Use findings to inform feature design
5. Run feature tasks (Feature Scaffolder)
```

---

## Troubleshooting

### Agent says "Task not well-documented"
**Solution:** Add more details:
```
Before:
- Add booking feature

After:
- **Endpoint:** POST /api/bookings
- **Database:** Use existing bookings table
- **Frontend:** Form on /schedule/:token page
- **Type:** Feature
```

### Agent stops and asks questions
**Solution:** This is good! Answer the questions with specifics:
```
Agent: "Should archive also delete related time blocks?"
You: "No, keep them but mark the project as archived"
Agent: "Got it. Proceeding..."
```

### Want to adjust a task mid-execution
**Solution:** Just ask:
```
You: "Before moving to task 3, can we add a feature to task 2?"
Agent: "What should I add?"
You: [Describe addition]
Agent: "Adding now..."
```

### Tasks take longer than expected
**Solution:** Agent shows progress and estimates:
```
Agent: "Task 1 taking longer than estimated (20 min so far)
        Still working on Feature Scaffolder generation
        New estimate: 25 min total for this task
        Continue? (Yes/Skip)"
```

---

## Tips & Best Practices

💡 **Create a task file for reference** — docs/SPRINT.md becomes your execution plan

💡 **Use consistent formatting** — Makes parsing and tracking easier

💡 **Document dependencies** — If Task B needs Task A done first, note it

💡 **Include rationale** — Why are we building this? Helps agents understand context

💡 **Batch related features** — Group similar features together for consistency

💡 **Start small** — Run 2-3 tasks first, see the pattern, then scale up

---

## See Also

- [Feature Scaffolder Agent](.github/agents/scaffold-feature.agent.md) — Individual feature scaffolding
- [Task Orchestrator Agent](.github/agents/task-orchestrator.agent.md) — Agent implementation
- [.github/agents/README.md](.github/agents/README.md) — All agents overview
- [.github/instructions/](.github/instructions/) — Code patterns and conventions
