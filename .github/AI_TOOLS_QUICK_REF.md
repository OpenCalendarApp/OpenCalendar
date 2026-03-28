---
name: AI Tools Quick Reference
---

# 🎯 CalendarGenie AI Tools — Quick Reference Card

## One-Line Summaries

| Tool | What It Does | Time | Invocation |
|------|-------------|------|-----------|
| `/add-api-endpoint` | Add a REST endpoint (route + schema) | 10-15 min | Type `/` in chat |
| `/add-frontend-page` | Add a React page (component + routing) | 10-15 min | Type `/` in chat |
| `/Feature Scaffolder` | Build complete feature (backend + frontend + database) | 15-20 min | `/Feature Scaffolder` |
| `/Task Orchestrator` | Execute multiple features from a task list | 60-90 min (3-5 features) | `/Task Orchestrator` |
| **Route Validation Hook** | Auto-check SQL injection + error format + Zod validation | Auto | Runs on file save |

---

## Decision Tree

```
"I need to add something..."

├─ "...just a new API endpoint"
│  └─ Use: /add-api-endpoint prompt
│
├─ "...just a new React page"
│  └─ Use: /add-frontend-page prompt
│
├─ "...a complete new feature (endpoint + page + database)"
│  └─ Use: /Feature Scaffolder agent
│
├─ "...multiple features at once (sprint list)"
│  └─ Use: /Task Orchestrator agent
│
└─ "...just a database column"
   └─ Use: /add-database-table prompt (future)
```

---

## Prompt Usage Examples

### `/add-api-endpoint`
```
/add-api-endpoint
POST /api/projects/:id/publish - PM-only endpoint to publish projects
```

### `/add-frontend-page`
```
/add-frontend-page
Settings page at /projects/:id/settings - show project configuration options
```

---

## Agent Usage Example

### `/Feature Scaffolder`
```
/Feature Scaffolder

Project archive feature:
- Endpoint: POST /api/projects/:id/archive
- Database: Add archived_at TIMESTAMPTZ to projects table
- Frontend: Modal on /projects/:id detail page
- Access: PM only
```

### `/Task Orchestrator`
```
/Task Orchestrator

docs/SPRINT.md
```

(Or inline: Feature 1: ... Feature 2: ... Feature 3: ...)

---

## What the Validation Hook Catches

The hook runs automatically and checks for:

**❌ SQL Injection**
```typescript
// Bad: pool.query(`SELECT * WHERE id = ${id}`)
// Good: pool.query('SELECT * WHERE id = $1', [id])
```

**❌ Error Format**
```typescript
// Bad: res.status(400).json({ error: 'failed' })
// Good: res.status(400).json({ error: 'msg', details: 'context' })
```

**❌ Missing Validation**
```typescript
// Bad: router.post('/', (req) => { const { name } = req.body; })
// Good: const data = schema.parse(req.body);
```

---

## File Locations

| Type | Location | Examples |
|------|----------|----------|
| Instructions | `.github/instructions/` | backend, frontend, database |
| Prompts | `.github/prompts/` | add-api-endpoint, add-frontend-page |
| Agents | `.github/agents/` | scaffold-feature |
| Hooks | `.github/hooks/` | validate-routes |
| Scripts | `.github/scripts/` | validate-route.js |

---

## Common Workflows

### "I want to add a new feature"

**Option A: Quick prompts (task-by-task)**
```
1. /add-api-endpoint → creates endpoint + schema
2. /add-frontend-page → creates page
3. Manually add database changes as needed
```
Time: 30-40 minutes

**Option B: Batch agent (everything together)**
```
1. /Feature Scaffolder → provides endpoint + page + database
2. Review and approve each part
3. Done!
```
Time: 15-20 minutes ← **Recommended**

### "I need to understand the patterns"

1. Read: `.github/copilot-instructions.md` (overview)
2. Read: `.github/instructions/backend.instructions.md` (your area)
3. Read: Examples in the instruction files
4. Use tools to scaffold code and learn

### "I'm building my first feature"

```
1. /Feature Scaffolder
2. Provide all 5 details (name, endpoint, database, frontend, roles)
3. Review each generated part
4. Say "Approve" when ready
5. Run: npm run dev
6. Test in browser
7. Commit!
```

---

## Reference Documents

| Document | Find It | When to Read |
|----------|---------|-------------|
| Main Instructions | `.github/copilot-instructions.md` | Starting development |
| Backend Patterns | `.github/instructions/backend.instructions.md` | Writing routes |
| Frontend Patterns | `.github/instructions/frontend.instructions.md` | Writing pages |
| Database Patterns | `.github/instructions/database.instructions.md` | Schema changes |
| Prompt Guide | `.github/prompts/add-api-endpoint.prompt.md` | Using prompts |
| Feature Scaffolder Guide | `.github/agents/SCAFFOLD_GUIDE.md` | Using Feature Scaffolder |
| Task Orchestrator Guide | `.github/agents/TASK_ORCHESTRATOR_GUIDE.md` | Using Task Orchestrator (sprint) |
| Hook Guide | `.github/hooks/VALIDATE_ROUTES.md` | Understanding validation |
| Architecture | `docs/ARCHITECTURE.md` | Deep technical details |

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Open chat | In VS Code: Cmd+K or Ctrl+K |
| Show all prompts/agents | Type `/` in chat |
| Show agent picker | Cmd+Shift+P → "Chat: Invoke Agent" |
| Format code | Cmd+K Cmd+F (VS Code) |

---

## Troubleshooting

**Agent asks "Need more information?"**
→ Provide all 5 details: feature name, endpoint, database change, frontend route, roles

**Hook shows SQL injection warning**
→ Use parameterized queries: `pool.query('... WHERE id = $1', [id])`

**Generated code looks different**
→ Ask: "Can you match the style in [file name]?"

**Can't find generated files**
→ They're previewed first. Look for "Approve?" and say "Yes"

---

## Pro Tips

💡 **Provide rich context** — Instead of "Add endpoint", say "Add search endpoint that queries by name and description"

💡 **Reference existing code** — "Similar to how projects are created, add engineers bulk assignment"

💡 **Ask before approving** — "What does this error check do?" before saying yes

💡 **Test locally** — Run `npm run dev` and test in browser before committing

---

## Next Steps

1. **Quick start:** Read `.github/copilot-instructions.md` (5 mins)
2. **Add your first feature:** Use `/Feature Scaffolder` (20 mins)
3. **Learn patterns:** Read specialized instructions as needed (varies)
4. **Build more features:** Repeat with additional features (each 15-20 mins)
5. **Build a sprint:** Create a task list and use `/Task Orchestrator` (60-90 mins for 3-5 features)

---

**Version:** March 2026  
**Updated:** After Task Orchestrator agent setup  
**For:** CalendarGenie Session Scheduler Team
