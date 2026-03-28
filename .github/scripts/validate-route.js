#!/usr/bin/env node

/**
 * Route Handler Validation Script
 * 
 * Validates Express route handlers for security and consistency:
 * 1. Parameterized SQL queries (prevent SQL injection)
 * 2. Proper error response format ({ error, details })
 * 3. Zod validation for POST/PUT request bodies
 * 
 * Usage: node validate-route.js <filepath>
 * Or via hook: reads from stdin (hook JSON)
 */

const fs = require('fs');
const path = require('path');

const issues = [];
let fileContent = '';

// Read input - either pipe or command line argument
if (process.argv[2]) {
  const filePath = process.argv[2];
  if (fs.existsSync(filePath)) {
    fileContent = fs.readFileSync(filePath, 'utf-8');
  }
} else {
  // Read from stdin if no argument
  fileContent = fs.readFileSync(0, 'utf-8');
}

if (!fileContent.trim()) {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

const lines = fileContent.split('\n');

// ============================================================================
// VALIDATION 1: SQL Injection Prevention (Parameterized Queries)
// ============================================================================

// Pattern: Look for pool.query() calls and check if they use parameterized queries
const sqlQueryPattern = /pool\.query\s*\(\s*[`"']([^`"']*)[`"']/g;
let match;
const sqlQueries: Array<{ line: number; query: string }> = [];

lines.forEach((line, idx) => {
  const lineNum = idx + 1;
  if (line.includes('pool.query') || line.includes('.query')) {
    // Extract the SQL string if present
    const match = line.match(/query\s*\(\s*[`"']([^`"']*)[`"']/);
    if (match) {
      sqlQueries.push({ line: lineNum, query: match[1] });
    }
  }
});

// Check for string concatenation in SQL (dangerous patterns)
sqlQueries.forEach(({ line, query }) => {
  // Red flags for SQL injection:
  // 1. Using template literals with variable interpolation: `SELECT ... WHERE id = ${id}`
  // 2. String concatenation: 'SELECT ... WHERE id = ' + id
  // 3. Not using $1, $2 parameters

  const dangerousPatterns = [
    /\$\{.*\}/,  // Template literal interpolation
    /[+\s]params?[+]/,  // String concatenation with params
    /WHERE.*=\s*['"]\s*\+/,  // WHERE clause with concatenation
  ];

  const isDangerous = dangerousPatterns.some(pattern => pattern.test(query));
  
  if (isDangerous) {
    issues.push({
      level: 'error',
      line: line,
      message: `SQL Injection vulnerability: query uses string interpolation instead of parameterized query`,
      suggestion: `Use parameterized query: pool.query('SELECT ... WHERE id = $1', [id])`
    });
  }

  // Check if using parameterized placeholders correctly
  const hasParams = /\$\d+/.test(query);
  if (!hasParams && (query.includes('WHERE') || query.includes('INSERT') || query.includes('UPDATE'))) {
    // If query has WHERE/INSERT/UPDATE but no $1, $2 params, it's probably hardcoded
    const containsVariable = /[a-zA-Z_]\w+\s*[=<>!]|VALUES\s*\(/.test(query);
    if (containsVariable) {
      issues.push({
        level: 'warning',
        line: line,
        message: `Unparameterized SQL query detected (may be hardcoded values)`,
        suggestion: `Use parameterized query: SELECT ... WHERE id = $1, [id]`
      });
    }
  }
});

// ============================================================================
// VALIDATION 2: Error Response Format
// ============================================================================

// Look for error responses and check format
const errorResponseLines: Array<{ line: number; text: string }> = [];
lines.forEach((line, idx) => {
  if (/res\.status\([45]/.test(line) || /res\.status\(4\d{2}\)|res\.status\(5\d{2}\)/.test(line)) {
    errorResponseLines.push({ line: idx + 1, text: line });
  }
});

errorResponseLines.forEach(({ line, text }) => {
  // Check if the response uses { error, details } format
  let nextLines = lines.slice(Math.max(0, line - 2), Math.min(lines.length, line + 3)).join('');
  
  const hasErrorDetails = /error\s*:\s*[`"']|error:\s*\w+\s*,\s*details/.test(nextLines);
  
  if (!hasErrorDetails) {
    issues.push({
      level: 'warning',
      line: line,
      message: `Error response may not follow standard format`,
      suggestion: `Use: res.status(400).json({ error: 'message', details: 'context' })`
    });
  }
});

// ============================================================================
// VALIDATION 3: Zod Validation for POST/PUT Handlers
// ============================================================================

// Check for route handlers that accept body data
const hasPostOrPut = /router\.(post|put)\s*\(/.test(fileContent);

if (hasPostOrPut) {
  // Look for route definitions
  const routePattern = /router\.(post|put)\s*\('([^']+)'\s*,\s*([^,]+)\s*,\s*async/g;
  let routeMatch;
  const routes: Array<{ method: string; path: string; line: number }> = [];

  lines.forEach((line, idx) => {
    if (/router\.(post|put)\s*\(/.test(line)) {
      const match = line.match(/router\.(post|put)/);
      routes.push({ method: match![1], path: '', line: idx + 1 });
    }
  });

  // For each POST/PUT handler, check if Zod validation is present nearby
  routes.forEach(route => {
    const contextLines = lines.slice(
      Math.max(0, route.line - 2),
      Math.min(lines.length, route.line + 20)
    ).join('\n');

    // Check for Zod schema usage
    const hasZodValidation = /z\.\w+|\.parse\(|\.parseAsync\(|\.safeParse\(/.test(contextLines);
    
    if (!hasZodValidation) {
      const hasManualValidation = /req\.body\.\w+|req\.query\.\w+/.test(contextLines) && 
                                  /(if\s*\(!|typeof.*!==|length\s*<)/.test(contextLines);
      
      if (!hasManualValidation) {
        issues.push({
          level: 'warning',
          line: route.line,
          message: `${route.method.toUpperCase()} handler may lack request validation`,
          suggestion: `Add Zod validation: const data = createProjectSchema.parse(req.body);`
        });
      }
    }
  });
}

// ============================================================================
// OUTPUT RESULTS
// ============================================================================

const errorCount = issues.filter(i => i.level === 'error').length;
const warningCount = issues.filter(i => i.level === 'warning').length;

let systemMessage = '';

if (errorCount > 0 || warningCount > 0) {
  systemMessage = `🔍 Route validation found ${errorCount} error(s) and ${warningCount} warning(s):\n\n`;
  
  issues.forEach(issue => {
    const icon = issue.level === 'error' ? '❌' : '⚠️';
    systemMessage += `${icon} Line ${issue.line || '?'}: ${issue.message}\n`;
    systemMessage += `   → ${issue.suggestion}\n\n`;
  });

  systemMessage += `\nSee .github/instructions/backend.instructions.md for route patterns.\n`;
}

const output = {
  continue: true,
  systemMessage: systemMessage || undefined
};

console.log(JSON.stringify(output));
process.exit(0);
