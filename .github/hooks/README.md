---
name: Hooks Setup Guide
description: "Overview of all workspace hooks and how they protect code quality"
---

# Workspace Hooks — Setup Guide

CalendarGenie uses workspace hooks to enforce security and consistency standards automatically. Hooks run deterministically at key lifecycle points and can block or warn about problematic code patterns.

## Active Hooks

### 1. Route Handler Validation Hook ✅

**File:** `.github/hooks/validate-routes.json`  
**Validator:** `.github/scripts/validate-route.js`  
**When:** Runs after file creation/edit (`PostToolUse` event)  
**Coverage:** Express route handlers in `packages/server/src/routes/`

**What it checks:**
- ✅ **SQL Injection Prevention** — Detects string interpolation in SQL queries
- ✅ **Error Response Format** — Validates `{ error, details }` structure
- ✅ **Input Validation** — Checks for Zod schema validation on POST/PUT

**Example validation output:**
```
🔍 Route validation found 2 error(s) and 1 warning(s):

❌ Line 42: SQL Injection vulnerability: query uses string interpolation instead of parameterized query
   → Use parameterized query: pool.query('SELECT ... WHERE id = $1', [id])

❌ Line 67: Error response may not follow standard format
   → Use: res.status(400).json({ error: 'message', details: 'context' })

⚠️ Line 28: POST handler may lack request validation
   → Add Zod validation: const data = createProjectSchema.parse(req.body);
```

**See also:** [.github/hooks/VALIDATE_ROUTES.md](./VALIDATE_ROUTES.md)

---

## How Hooks Work

### Hook Lifecycle

```
Agent session starts → User makes edits → PostToolUse event fires →
Validation script runs → Warnings/errors displayed to user → Session continues
```

### Hook Configuration

Hooks are configured in `.github/hooks/*.json` files:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "type": "command",
        "command": "node .github/scripts/validate-route.js",
        "timeout": 10
      }
    ]
  }
}
```

**Parameters:**
- `type` — Always `"command"`
- `command` — Shell command to execute (receives JSON on stdin)
- `timeout` — Max seconds before aborting (default: 30)
- `cwd` — Working directory (defaults to workspace root)

### Exit Codes

The validation script returns JSON output:
```json
{
  "continue": true,
  "systemMessage": "Warnings/errors found..."
}
```

- Exit code `0` — Success
- Exit code `2` — Blocking error (stops workflow)
- Other codes — Non-blocking warnings

---

## Running Validation Manually

You can run the validators directly without waiting for the hook:

```bash
# Validate a single route file
node .github/scripts/validate-route.js packages/server/src/routes/projects.ts

# Or check all routes
for file in packages/server/src/routes/*.ts; do
  node .github/scripts/validate-route.js "$file"
done
```

---

## Adding New Hooks

To add a new hook:

1. **Create the validation script** in `.github/scripts/my-validator.js`
2. **Create hook config** in `.github/hooks/my-validator.json`:
   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "type": "command",
           "command": "node .github/scripts/my-validator.js",
           "timeout": 15
         }
       ]
     }
   }
   ```
3. **Document it** in `HOOKS_README.md` (this file)

### Example: Component Validation Hook

```bash
# .github/scripts/validate-component.js
const fs = require('fs');

// Check React component for prop validation
const hasPropsInterface = fileContent.includes('interface ') || fileContent.includes('type ');
if (!hasPropsInterface && fileContent.includes('function ')) {
  console.error('React components should define props interfaces');
}
```

---

## Best Practices for Hooks

✅ **DO:**
- Keep validators simple and focused
- Make them run fast (< 5 seconds)
- Provide clear, actionable error messages
- Reference instruction files in error output
- Log to stderr during validation, output JSON to stdout

❌ **DON'T:**
- Use hooks for multi-step workflows (use custom agents instead)
- Block the user without a very good reason
- Query external APIs or databases
- Store state between runs
- Use shell-specific features (stick to POSIX bash or Node.js)

---

## Troubleshooting Hooks

### Hook isn't running

1. **Check the config file:**
   ```bash
   cat .github/hooks/validate-routes.json
   # Should have valid JSON with "hooks" object
   ```

2. **Verify the script exists:**
   ```bash
   ls -la .github/scripts/validate-route.js
   # Should be executable or called via `node` or `bash`
   ```

3. **Test the script manually:**
   ```bash
   echo "router.post('/', (req, res) => {
     res.status(400).json({ error: 'test' });
   });" | node .github/scripts/validate-route.js
   ```

### Hook is too slow

- Reduce the timeout if the script completes quickly
- Optimize the validation script (avoid file system calls, complex regex)
- Consider moving to `PreToolUse` if you want earlier feedback

### Hook produces false positives

- Update the regex patterns in the validator script
- Add exceptions for known patterns
- Reference actual code style in the project and refine patterns

---

## Security Considerations

Hooks are powerful tools that run automatically. Always:
- ✅ Review hook scripts before committing
- ✅ Keep scripts simple and auditable
- ✅ Never hardcode secrets
- ✅ Validate all hook inputs
- ✅ Test hooks locally before team deployment

---

See Also:
- [.github/hooks/VALIDATE_ROUTES.md](./VALIDATE_ROUTES.md) — Route validation guide
- [.github/instructions/backend.instructions.md](../instructions/backend.instructions.md) — Backend patterns
- [.github/instructions/database.instructions.md](../instructions/database.instructions.md) — Database safety
