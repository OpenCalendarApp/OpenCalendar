#!/bin/bash

# Route Handler Validation Hook
# Validates new/edited route files for common security and format issues
# Checks for:
# 1. Parameterized SQL queries (no string interpolation)
# 2. Proper error response format ({ error, details })
# 3. Zod validation for request bodies

set -e

# Read hook input from stdin (JSON)
INPUT=$(cat)

# Extract file paths from the hook input
# The hook provides info about what file was created/edited
FILES=$(echo "$INPUT" | jq -r '.toolResults[0].content // empty' 2>/dev/null | grep -o "'[^']*'" | tr -d "'" | grep -E '\.ts$' | grep -v node_modules)

# Exit gracefully if no relevant files
if [ -z "$FILES" ]; then
  echo '{"continue": true}'
  exit 0
fi

ISSUES=0
WARNINGS=""

# Check each TypeScript file
while IFS= read -r FILE; do
  # Only validate route files
  if ! [[ "$FILE" =~ packages/server/src/routes/.*.ts$ ]]; then
    continue
  fi

  echo "🔍 Validating route: $FILE" >&2

  # Check 1: Detect unparameterized SQL queries (SQL INJECTION RISK)
  echo "  ✓ Checking for SQL injection vulnerability..." >&2
  
  # Look for SQL strings with concatenation patterns
  CONCAT_SQL=$(grep -n -E "query\(`.*\$|query\(\".*\$|query\('[^']*'\s*\+|query\(\"[^\"]*\"\s*\+" "$FILE" 2>/dev/null | head -5)
  if [ ! -z "$CONCAT_SQL" ]; then
    WARNINGS="${WARNINGS}⚠️  SQL INJECTION RISK in $FILE:\n  Detected possible string concatenation in SQL query.\n  Use parameterized queries: query('SELECT ... WHERE id = \$1', [id])\n  Found at:\n$CONCAT_SQL\n\n"
    ((ISSUES++))
  fi

  # Check 2: Validate error response format ({ error, details })
  echo "  ✓ Checking for proper error response format..." >&2
  
  # Count proper error responses
  PROPER_ERRORS=$(grep -c "error.*details" "$FILE" 2>/dev/null || echo 0)
  
  # Look for res.status(...).json() calls
  JSON_RESPONSES=$(grep -c "\.json({" "$FILE" 2>/dev/null || echo 0)
  
  # If there are error responses, check for inconsistency
  if grep -q "res.status(4\|res.status(5" "$FILE" 2>/dev/null; then
    ERROR_WITHOUT_FORMAT=$(grep -n "res.status(4\|res.status(5" "$FILE" | grep -v "error.*details" | head -3)
    if [ ! -z "$ERROR_WITHOUT_FORMAT" ]; then
      WARNINGS="${WARNINGS}⚠️  ERROR RESPONSE FORMAT in $FILE:\n  Not all error responses follow { error, details } format.\n  Pattern: res.status(4xx).json({ error: 'message', details: 'context' })\n  Found:\n$ERROR_WITHOUT_FORMAT\n\n"
      ((ISSUES++))
    fi
  fi

  # Check 3: Validate Zod validation is present for POST/PUT
  echo "  ✓ Checking for Zod request validation..." >&2
  
  USING_ZEPHYR=$(grep -c "z\." "$FILE" 2>/dev/null || echo 0)
  
  # If there are POST/PUT handlers, check if they validate
  if grep -q "router.post\|router.put" "$FILE" 2>/dev/null; then
    POST_PUT_LINES=$(grep -n "router.post\|router.put" "$FILE")
    
    # Simple heuristic: if there are POST/PUT handlers but no Zod usage, warn
    if [ "$USING_ZEPHYR" -eq 0 ]; then
      HANDLERS_COUNT=$(echo "$POST_PUT_LINES" | wc -l)
      if [ "$HANDLERS_COUNT" -gt 0 ]; then
        WARNINGS="${WARNINGS}⚠️  MISSING ZOD VALIDATION in $FILE:\n  Found $HANDLERS_COUNT POST/PUT handler(s) without apparent Zod validation.\n  Example: const data = schema.parse(req.body);\n  Handlers:\n$POST_PUT_LINES\n\n"
        ((ISSUES++))
      fi
    fi
  fi

  # Check 4: Basic syntax check (optional)
  echo "  ✓ Checking TypeScript syntax..." >&2
  if ! npx --silent tsc --noEmit "$FILE" 2>/dev/null; then
    WARNINGS="${WARNINGS}⚠️  TYPESCRIPT SYNTAX ERROR in $FILE\n  Fix syntax errors before committing.\n\n"
    ((ISSUES++))
  fi

done <<< "$FILES"

# Format output as JSON
OUTPUT='{'
OUTPUT="${OUTPUT}\"continue\": true"

if [ "$ISSUES" -gt 0 ]; then
  OUTPUT="${OUTPUT}, \"systemMessage\": \"Route validation found ${ISSUES} issue(s):\n${WARNINGS}\""
fi

OUTPUT="${OUTPUT}}"

echo "$OUTPUT"
exit 0
