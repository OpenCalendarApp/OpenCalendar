#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const BUMP_TYPES = new Set(["patch", "minor", "major"]);
const TRACKED_PATHS = ["packages/client", "packages/server"];
const IGNORED_PATHS = [/\.tsbuildinfo$/, /^packages\/(?:client|server)\/dist\//];

function printUsage() {
  console.log(`
Usage:
  npm run bump
  npm run bump -- --force <patch|minor|major>
  npm run bump -- <patch|minor|major>
  npm run bump -- --since <git-ref>
  npm run bump -- --dry-run

Behavior:
  - client changes only => patch
  - server changes only => minor
  - both client + server => major

Examples:
  npm run bump
  npm run bump -- --force minor
  npm run bump -- major --dry-run
  npm run bump -- --since origin/main
`.trim());
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function runGit(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch (error) {
    if (allowFailure) {
      return "";
    }

    const details = error.stderr?.toString().trim();
    fail(`git ${args.join(" ")} failed${details ? `: ${details}` : "."}`);
  }
}

function gitLines(args, options = {}) {
  const output = runGit(args, options);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseArgs(args) {
  const parsed = {
    force: null,
    since: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--force") {
      const forceValue = args[i + 1];
      if (!forceValue) {
        fail("Missing bump type after --force.");
      }

      parsed.force = forceValue;
      i += 1;
      continue;
    }

    if (arg.startsWith("--force=")) {
      parsed.force = arg.split("=")[1];
      continue;
    }

    if (arg === "--since") {
      const sinceValue = args[i + 1];
      if (!sinceValue) {
        fail("Missing git ref after --since.");
      }

      parsed.since = sinceValue;
      i += 1;
      continue;
    }

    if (arg.startsWith("--since=")) {
      parsed.since = arg.split("=")[1];
      continue;
    }

    if (BUMP_TYPES.has(arg)) {
      parsed.force = arg;
      continue;
    }

    fail(`Unknown argument "${arg}". Run with --help for usage.`);
  }

  if (parsed.force && !BUMP_TYPES.has(parsed.force)) {
    fail(`Invalid force bump "${parsed.force}". Expected patch|minor|major.`);
  }

  return parsed;
}

function hasHeadCommit() {
  return Boolean(runGit(["rev-parse", "--verify", "--quiet", "HEAD"], { allowFailure: true }));
}

function collectChangedFiles(sinceRef) {
  const changedFiles = new Set();
  const addFiles = (files) => {
    for (const file of files) {
      changedFiles.add(file);
    }
  };

  if (sinceRef) {
    if (!hasHeadCommit()) {
      fail(`Cannot use --since ${sinceRef} because this repository has no commits yet.`);
    }

    const refExists = Boolean(runGit(["rev-parse", "--verify", "--quiet", sinceRef], { allowFailure: true }));
    if (!refExists) {
      fail(`Git ref "${sinceRef}" does not exist.`);
    }

    addFiles(gitLines(["diff", "--name-only", `${sinceRef}...HEAD`, "--", ...TRACKED_PATHS], { allowFailure: true }));
    addFiles(gitLines(["diff", "--name-only", "HEAD", "--", ...TRACKED_PATHS], { allowFailure: true }));
    addFiles(gitLines(["ls-files", "--others", "--exclude-standard", "--", ...TRACKED_PATHS], { allowFailure: true }));
    return [...changedFiles];
  }

  if (hasHeadCommit()) {
    const latestTag = runGit(["describe", "--tags", "--abbrev=0"], { allowFailure: true });

    if (latestTag) {
      addFiles(gitLines(["diff", "--name-only", `${latestTag}..HEAD`, "--", ...TRACKED_PATHS], { allowFailure: true }));
    } else {
      addFiles(gitLines(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD", "--", ...TRACKED_PATHS], { allowFailure: true }));
    }

    addFiles(gitLines(["diff", "--name-only", "HEAD", "--", ...TRACKED_PATHS], { allowFailure: true }));
    addFiles(gitLines(["ls-files", "--others", "--exclude-standard", "--", ...TRACKED_PATHS], { allowFailure: true }));
    return [...changedFiles];
  }

  addFiles(gitLines(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...TRACKED_PATHS], { allowFailure: true }));
  return [...changedFiles];
}

function isIgnoredPath(filePath) {
  return IGNORED_PATHS.some((pattern) => pattern.test(filePath));
}

function detectBumpType(files) {
  const hasClientChange = files.some((file) => file.startsWith("packages/client/"));
  const hasServerChange = files.some((file) => file.startsWith("packages/server/"));

  if (hasClientChange && hasServerChange) {
    return { type: "major", reason: "changes detected in both client and server" };
  }

  if (hasServerChange) {
    return { type: "minor", reason: "changes detected in server" };
  }

  if (hasClientChange) {
    return { type: "patch", reason: "changes detected in client" };
  }

  return { type: null, reason: "no client/server changes detected" };
}

function bumpVersion(type) {
  const output = execFileSync("npm", ["version", type, "--no-git-tag-version"], {
    encoding: "utf8",
  }).trim();

  return output.startsWith("v") ? output.slice(1) : output;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const changedFiles = collectChangedFiles(options.since).filter((file) => !isIgnoredPath(file));
  const detected = detectBumpType(changedFiles);

  if (changedFiles.length > 0) {
    console.log("Changed files considered:");
    for (const file of changedFiles) {
      console.log(`- ${file}`);
    }
  } else {
    console.log("No client/server file changes detected.");
  }

  const bumpType = options.force ?? detected.type;
  if (!bumpType) {
    console.log("No version bump applied.");
    return;
  }

  const reason = options.force ? `forced to ${options.force}` : detected.reason;

  if (options.dryRun) {
    console.log(`Dry run: would apply ${bumpType} bump (${reason}).`);
    return;
  }

  const nextVersion = bumpVersion(bumpType);
  console.log(`Applied ${bumpType} bump (${reason}).`);
  console.log(`New root package version: ${nextVersion}`);
}

main();
