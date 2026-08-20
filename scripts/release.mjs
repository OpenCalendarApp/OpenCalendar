#!/usr/bin/env node

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Owns the whole release lifecycle: detect what changed, bump workspace +
// root versions, roll the CHANGELOG's [Unreleased] section into a dated
// entry, commit, tag, and push. CI workflows call it twice — once without
// --apply to preview the plan, once with --apply --ci to actually cut the
// release and wire outputs — and release.yml calls it with --from-tag to
// resolve what a tag that's already on origin represents, without re-bumping
// anything.

const BUMP_TYPES = new Set(["patch", "minor", "major"]);
const SCOPES = new Set(["all", "client", "server", "shared"]);
const SCOPE_TO_WORKSPACE_KEY = {
  client: "packages/client",
  server: "packages/server",
  shared: "packages/shared",
};
const DEFAULT_BUMP_BY_SCOPE = { client: "patch", server: "minor", shared: "patch" };
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const HASH_STATE_VERSION = 1;
const ARTIFACT_WORKSPACE_KEYS = { "packages/client": "docker-client", "packages/server": "docker-server" };

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const PACKAGES_DIR = path.join(ROOT_DIR, "packages");
const HASH_STATE_PATH = path.join(ROOT_DIR, ".bump-hashes.json");
const CHANGELOG_PATH = path.join(ROOT_DIR, "CHANGELOG.md");

const IGNORED_PATHS = [/\.tsbuildinfo$/, /^packages\/[^/]+\/dist\//, /^packages\/[^/]+\/node_modules\//];
const IGNORED_DIRECTORY_NAMES = new Set(["dist", "node_modules", ".git"]);

function printUsage() {
  console.log(
    `
Usage:
  node scripts/release.mjs [scope] [options]

Scope (default: all):
  all       Auto-detect changed workspaces from file hashes
  client    Force packages/client (and its dependents) to bump
  server    Force packages/server (and its dependents) to bump
  shared    Force packages/shared (and its dependents) to bump

Options:
  --bump <patch|minor|major>   Override the inferred/default bump level
  --from-tag <tag>              Resolve an already-tagged release (read-only)
  --apply                       Write changes, commit, tag, and push (default: preview only)
  --skip-push                   With --apply: commit + tag locally, skip the push
  --json                        Emit the plan as JSON instead of human-readable text
  --ci                          With --apply: also write $GITHUB_OUTPUT
  --skip-preflight               Skip the clean-working-tree check
  --help

Examples:
  node scripts/release.mjs --json
  node scripts/release.mjs client --apply --ci
  node scripts/release.mjs --bump major --apply
  node scripts/release.mjs --from-tag v2026.08.20 --json
`.trim()
  );
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relFromRoot(absPath) {
  return toPosix(path.relative(ROOT_DIR, absPath));
}

function readJson(absPath) {
  return JSON.parse(readFileSync(absPath, "utf8"));
}

function writeJson(absPath, data) {
  writeFileSync(absPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function runGit(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
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
    scope: "all",
    bump: null,
    fromTag: null,
    apply: false,
    skipPush: false,
    json: false,
    ci: false,
    skipPreflight: false,
  };

  let scopeConsumed = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }

    if (arg === "--skip-push") {
      parsed.skipPush = true;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--ci") {
      parsed.ci = true;
      continue;
    }

    if (arg === "--skip-preflight") {
      parsed.skipPreflight = true;
      continue;
    }

    if (arg === "--bump") {
      const value = args[i + 1];
      if (!value) fail("Missing bump level after --bump.");
      parsed.bump = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--bump=")) {
      parsed.bump = arg.split("=")[1];
      continue;
    }

    if (arg === "--from-tag") {
      const value = args[i + 1];
      if (!value) fail("Missing tag after --from-tag.");
      parsed.fromTag = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--from-tag=")) {
      parsed.fromTag = arg.split("=")[1];
      continue;
    }

    if (!arg.startsWith("--") && !scopeConsumed) {
      parsed.scope = arg;
      scopeConsumed = true;
      continue;
    }

    fail(`Unknown argument "${arg}". Run with --help for usage.`);
  }

  if (!SCOPES.has(parsed.scope)) {
    fail(`Invalid scope "${parsed.scope}". Expected all|client|server|shared.`);
  }

  if (parsed.bump && !BUMP_TYPES.has(parsed.bump)) {
    fail(`Invalid bump level "${parsed.bump}". Expected patch|minor|major.`);
  }

  if (parsed.fromTag && (parsed.apply || parsed.bump || scopeConsumed)) {
    fail("--from-tag is read-only and cannot be combined with scope, --bump, or --apply.");
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Workspace discovery, hashing, dependency graph (shared by both modes)
// ---------------------------------------------------------------------------

function listWorkspacePackageDirs() {
  if (!existsSync(PACKAGES_DIR) || !statSync(PACKAGES_DIR).isDirectory()) {
    fail(`Expected workspace packages directory at ${relFromRoot(PACKAGES_DIR)}.`);
  }

  const packageDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name))
    .filter((absDir) => existsSync(path.join(absDir, "package.json")));

  if (packageDirs.length === 0) {
    fail("No workspace packages found in packages/*.");
  }

  return packageDirs.sort((a, b) => relFromRoot(a).localeCompare(relFromRoot(b)));
}

function loadWorkspacePackages() {
  return listWorkspacePackageDirs().map((absDir) => {
    const manifestPath = path.join(absDir, "package.json");
    const manifest = readJson(manifestPath);

    if (!manifest.name) {
      fail(`Workspace manifest ${relFromRoot(manifestPath)} is missing a name.`);
    }

    if (!manifest.version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(manifest.version)) {
      fail(`Workspace manifest ${relFromRoot(manifestPath)} must use semantic versioning.`);
    }

    return {
      key: relFromRoot(absDir),
      dirAbs: absDir,
      manifestPathAbs: manifestPath,
      manifestPathRel: relFromRoot(manifestPath),
      manifest,
    };
  });
}

function buildWorkspaceMaps(workspaces) {
  const byKey = new Map();
  const byName = new Map();

  for (const workspace of workspaces) {
    byKey.set(workspace.key, workspace);
    byName.set(workspace.manifest.name, workspace.key);
  }

  return { byKey, byName };
}

function isIgnoredPath(filePath) {
  return IGNORED_PATHS.some((pattern) => pattern.test(filePath));
}

function walkPackageFiles(absDir) {
  const files = [];
  const stack = [absDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const relPath = relFromRoot(absPath);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
        stack.push(absPath);
        continue;
      }

      if (!entry.isFile() || isIgnoredPath(relPath)) continue;
      files.push(absPath);
    }
  }

  files.sort((a, b) => relFromRoot(a).localeCompare(relFromRoot(b)));
  return files;
}

function hashValue(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(absPath) {
  return hashValue(readFileSync(absPath));
}

function hashFileMap(fileMap) {
  const lines = Object.entries(fileMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, digest]) => `${filePath}:${digest}`)
    .join("\n");

  return hashValue(lines);
}

function computeWorkspaceSnapshot(workspaces) {
  const packages = {};

  for (const workspace of workspaces) {
    const files = walkPackageFiles(workspace.dirAbs);
    const fileHashes = {};

    for (const absPath of files) {
      fileHashes[relFromRoot(absPath)] = hashFile(absPath);
    }

    packages[workspace.key] = { name: workspace.manifest.name, hash: hashFileMap(fileHashes), files: fileHashes };
  }

  return { packages };
}

function loadHashState() {
  if (!existsSync(HASH_STATE_PATH)) return null;

  try {
    const parsed = readJson(HASH_STATE_PATH);
    if (typeof parsed !== "object" || parsed === null || typeof parsed.packages !== "object" || parsed.packages === null) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function detectHashChanges(currentSnapshot, previousState) {
  const changedPackageKeys = new Set();

  for (const [packageKey, currentPackage] of Object.entries(currentSnapshot.packages)) {
    const previousPackage = previousState?.packages?.[packageKey];
    if (!previousPackage || previousPackage.hash !== currentPackage.hash) {
      changedPackageKeys.add(packageKey);
    }
  }

  return changedPackageKeys;
}

function buildDependencyGraph(workspaces, byName) {
  const dependenciesByKey = new Map();
  const dependentsByKey = new Map();

  for (const workspace of workspaces) {
    const deps = new Set();

    for (const field of DEPENDENCY_FIELDS) {
      const entries = workspace.manifest[field];
      if (!entries || typeof entries !== "object") continue;

      for (const dependencyName of Object.keys(entries)) {
        const dependencyKey = byName.get(dependencyName);
        if (dependencyKey) deps.add(dependencyKey);
      }
    }

    dependenciesByKey.set(workspace.key, deps);

    for (const depKey of deps) {
      if (!dependentsByKey.has(depKey)) dependentsByKey.set(depKey, new Set());
      dependentsByKey.get(depKey).add(workspace.key);
    }
  }

  for (const workspace of workspaces) {
    if (!dependentsByKey.has(workspace.key)) dependentsByKey.set(workspace.key, new Set());
  }

  return { dependenciesByKey, dependentsByKey };
}

function expandWithDependents(initialKeys, dependentsByKey) {
  const expanded = new Set(initialKeys);
  const queue = [...initialKeys];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependent of dependentsByKey.get(current) ?? []) {
      if (!expanded.has(dependent)) {
        expanded.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return expanded;
}

function detectBumpType(changedPackageKeys) {
  const keys = [...changedPackageKeys];
  const hasClientChange = keys.some((key) => key === "packages/client");
  const hasServerChange = keys.some((key) => key === "packages/server");

  if (hasClientChange && hasServerChange) return { type: "major", reason: "changes detected in both client and server" };
  if (hasServerChange) return { type: "minor", reason: "changes detected in server" };
  if (hasClientChange || keys.length > 0) return { type: "patch", reason: "changes detected in client/shared workspaces" };
  return { type: null, reason: "no workspace changes detected" };
}

function bumpSemver(version, type) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].+)?$/);
  if (!match) fail(`Cannot ${type} bump non-semver workspace version "${version}".`);

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (type === "patch") return `${major}.${minor}.${patch + 1}`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  if (type === "major") return `${major + 1}.0.0`;
  fail(`Unsupported bump type "${type}".`);
}

function updateDependencySpecifier(currentSpecifier, newVersion) {
  if (typeof currentSpecifier !== "string") return currentSpecifier;

  if (currentSpecifier.startsWith("workspace:")) {
    const tail = currentSpecifier.slice("workspace:".length);
    if (tail === "*" || tail === "^" || tail === "~") return currentSpecifier;
    if (tail.startsWith("^")) return `workspace:^${newVersion}`;
    if (tail.startsWith("~")) return `workspace:~${newVersion}`;
    return `workspace:${newVersion}`;
  }

  if (currentSpecifier.startsWith("^")) return `^${newVersion}`;
  if (currentSpecifier.startsWith("~")) return `~${newVersion}`;
  if (/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(currentSpecifier)) return newVersion;
  return currentSpecifier;
}

function updateLocalWorkspaceDependencies(workspace, bumpedVersionsByName) {
  let changed = false;

  for (const field of DEPENDENCY_FIELDS) {
    const dependencyBlock = workspace.manifest[field];
    if (!dependencyBlock || typeof dependencyBlock !== "object") continue;

    for (const [dependencyName, currentSpecifier] of Object.entries(dependencyBlock)) {
      const nextVersion = bumpedVersionsByName.get(dependencyName);
      if (!nextVersion) continue;

      const nextSpecifier = updateDependencySpecifier(currentSpecifier, nextVersion);
      if (nextSpecifier === currentSpecifier) continue;

      dependencyBlock[dependencyName] = nextSpecifier;
      changed = true;
    }
  }

  return changed;
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function determineNextRootVersion(currentVersion, now) {
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  const dotVersion = `${yyyy}.${mm}.${dd}`;
  const dashedDate = `${yyyy}-${mm}-${dd}`;
  const dashedBuildMatch = currentVersion.match(new RegExp(`^${escapeForRegex(dashedDate)}-(\\d+)$`));

  if (dashedBuildMatch) return `${dashedDate}-${Number(dashedBuildMatch[1]) + 1}`;
  if (currentVersion === dotVersion) return `${dashedDate}-1`;
  return dotVersion;
}

function runNpmPackageLockRefresh() {
  try {
    // On Windows, npm is a .cmd shim — execFileSync can't spawn it without a shell.
    execFileSync("npm", ["install", "--package-lock-only"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: "pipe",
      shell: process.platform === "win32",
    });
  } catch (error) {
    const details = error.stderr?.toString().trim();
    fail(`npm install --package-lock-only failed${details ? `: ${details}` : "."}`);
  }
}

function buildHashState(snapshot, dependencyGraph, workspaces) {
  const state = { schemaVersion: HASH_STATE_VERSION, packages: {}, connections: {} };
  const sortedWorkspaces = [...workspaces].sort((a, b) => a.key.localeCompare(b.key));

  for (const workspace of sortedWorkspaces) {
    const packageSnapshot = snapshot.packages[workspace.key];
    const dependencies = [...(dependencyGraph.dependenciesByKey.get(workspace.key) ?? new Set())].sort((a, b) => a.localeCompare(b));

    state.packages[workspace.key] = { name: packageSnapshot.name, hash: packageSnapshot.hash, files: packageSnapshot.files };
    state.connections[workspace.key] = dependencies;
  }

  return state;
}

function writeHashStateIfChanged(state) {
  const nextContent = `${JSON.stringify(state, null, 2)}\n`;
  const currentContent = existsSync(HASH_STATE_PATH) ? readFileSync(HASH_STATE_PATH, "utf8") : null;
  if (currentContent === nextContent) return false;
  writeFileSync(HASH_STATE_PATH, nextContent, "utf8");
  return true;
}

function artifactsForWorkspaceKeys(workspaceKeys) {
  const artifacts = [];
  for (const [workspaceKey, artifactName] of Object.entries(ARTIFACT_WORKSPACE_KEYS)) {
    if (workspaceKeys.has(workspaceKey)) artifacts.push(artifactName);
  }
  return artifacts;
}

// ---------------------------------------------------------------------------
// CHANGELOG.md — roll [Unreleased] into a dated version section
// ---------------------------------------------------------------------------

function readChangelogLines() {
  if (!existsSync(CHANGELOG_PATH)) fail(`Expected a changelog at ${relFromRoot(CHANGELOG_PATH)}.`);
  return readFileSync(CHANGELOG_PATH, "utf8").split(/\r?\n/);
}

function findUnreleasedSection(lines) {
  const startIndex = lines.findIndex((line) => line.trim() === "## [Unreleased]");
  if (startIndex === -1) fail('CHANGELOG.md is missing a "## [Unreleased]" section.');

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## [")) {
      endIndex = i;
      break;
    }
  }

  return { startIndex, endIndex };
}

function extractChangelogSection(version) {
  const lines = readChangelogLines();
  const headingIndex = lines.findIndex((line) => line.trim().startsWith(`## [${version}]`));
  if (headingIndex === -1) return null;

  let endIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## [")) {
      endIndex = i;
      break;
    }
  }

  return lines
    .slice(headingIndex + 1, endIndex)
    .join("\n")
    .trim();
}

function rollChangelogUnreleased(version, now) {
  const lines = readChangelogLines();
  const { startIndex, endIndex } = findUnreleasedSection(lines);

  const unreleasedBody = lines
    .slice(startIndex + 1, endIndex)
    .join("\n")
    .trim();

  const dateStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const notes = unreleasedBody.length > 0 ? unreleasedBody : "- No notable changes recorded.";

  const replacement = ["## [Unreleased]", "", `## [${version}] - ${dateStamp}`, "", notes, ""];

  const nextLines = [...lines.slice(0, startIndex), ...replacement, ...lines.slice(endIndex)];

  writeFileSync(CHANGELOG_PATH, `${nextLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`, "utf8");
  return notes;
}

// ---------------------------------------------------------------------------
// git: commit, tag, push
// ---------------------------------------------------------------------------

function assertCleanWorkingTree() {
  const status = gitLines(["status", "--porcelain"]);
  if (status.length > 0) {
    fail("Working tree is not clean. Commit or stash changes before releasing (use --skip-preflight to override).");
  }
}

function commitTagAndPush(paths, tag, message, { skipPush }) {
  runGit(["add", ...paths]);
  runGit(["commit", "-m", message]);
  runGit(["tag", "-a", tag, "-m", message]);

  if (skipPush) return;

  runGit(["push", "origin", "HEAD"]);
  runGit(["push", "origin", tag]);
}

// ---------------------------------------------------------------------------
// GitHub Actions output wiring
// ---------------------------------------------------------------------------

function writeGithubOutput(plan) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  appendFileSync(outputPath, `release_tag=${plan.tag}\n`);
  appendFileSync(outputPath, `artifacts=${plan.artifacts.join(",")}\n`);

  for (const pkg of plan.packages) {
    const outKey = `version_${pkg.key.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`;
    appendFileSync(outputPath, `${outKey}=${pkg.nextVersion}\n`);
  }

  const delimiter = "RELEASE_NOTES_EOF";
  appendFileSync(outputPath, `release_notes<<${delimiter}\n${plan.notes}\n${delimiter}\n`);
}

// ---------------------------------------------------------------------------
// Mode: --from-tag (read-only resolution of an already-published tag)
// ---------------------------------------------------------------------------

function runFromTagMode(tag) {
  const tagExists = Boolean(runGit(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], { allowFailure: true }));
  if (!tagExists) fail(`Tag "${tag}" does not exist locally. Make sure the checkout fetched tags.`);

  const version = tag.replace(/^v/, "");
  const workspaces = loadWorkspacePackages();
  const parentRef = runGit(["rev-parse", "--verify", "--quiet", `${tag}^`], { allowFailure: true });

  const changedWorkspaceKeys = new Set();

  for (const workspace of workspaces) {
    if (!Object.hasOwn(ARTIFACT_WORKSPACE_KEYS, workspace.key)) continue;

    if (!parentRef) {
      changedWorkspaceKeys.add(workspace.key);
      continue;
    }

    const parentManifestRaw = runGit(["show", `${parentRef}:${workspace.manifestPathRel}`], { allowFailure: true });
    const parentVersion = parentManifestRaw ? JSON.parse(parentManifestRaw).version : null;

    if (parentVersion !== workspace.manifest.version) {
      changedWorkspaceKeys.add(workspace.key);
    }
  }

  const artifacts = artifactsForWorkspaceKeys(changedWorkspaceKeys);
  const notes = extractChangelogSection(version) ?? "- No notable changes recorded.";

  const plan = {
    mode: "from-tag",
    tag,
    version,
    artifacts,
    notes,
    packages: workspaces
      .filter((workspace) => changedWorkspaceKeys.has(workspace.key))
      .map((workspace) => ({ key: workspace.key, name: workspace.manifest.name, nextVersion: workspace.manifest.version })),
  };

  console.log(JSON.stringify(plan, null, 2));
}

// ---------------------------------------------------------------------------
// Mode: bump (preview by default, --apply to cut the release)
// ---------------------------------------------------------------------------

function runBumpMode(options) {
  const workspaces = loadWorkspacePackages();
  const { byKey, byName } = buildWorkspaceMaps(workspaces);
  const dependencyGraph = buildDependencyGraph(workspaces, byName);

  let directlyChangedKeys;
  let bumpType;
  let reason;

  if (options.scope === "all") {
    const currentSnapshot = computeWorkspaceSnapshot(workspaces);
    const previousState = loadHashState();
    const changedPackageKeys = previousState ? detectHashChanges(currentSnapshot, previousState) : new Set(workspaces.map((w) => w.key));

    const detected = detectBumpType(changedPackageKeys);
    bumpType = options.bump ?? detected.type;
    reason = options.bump ? `forced to ${options.bump}` : detected.reason;
    directlyChangedKeys = options.bump && changedPackageKeys.size === 0 ? new Set(workspaces.map((w) => w.key)) : changedPackageKeys;
  } else {
    const workspaceKey = SCOPE_TO_WORKSPACE_KEY[options.scope];
    if (!byKey.has(workspaceKey)) fail(`Workspace "${workspaceKey}" not found.`);
    directlyChangedKeys = new Set([workspaceKey]);
    bumpType = options.bump ?? DEFAULT_BUMP_BY_SCOPE[options.scope];
    reason = options.bump ? `forced to ${options.bump}` : `scope "${options.scope}" requested`;
  }

  if (!bumpType) {
    if (options.json) {
      console.log(JSON.stringify({ mode: "bump", applied: false, reason }, null, 2));
    } else {
      console.log(`No version bump to apply (${reason}).`);
    }
    return;
  }

  const workspaceKeysToBump = expandWithDependents(directlyChangedKeys, dependencyGraph.dependentsByKey);
  const plannedBumps = new Map();
  for (const workspaceKey of workspaceKeysToBump) {
    plannedBumps.set(workspaceKey, directlyChangedKeys.has(workspaceKey) ? bumpType : "patch");
  }

  const rootManifestPath = path.join(ROOT_DIR, "package.json");
  const rootManifest = readJson(rootManifestPath);
  const nextRootVersion = determineNextRootVersion(rootManifest.version ?? "", new Date());
  const tag = `v${nextRootVersion}`;
  const artifacts = artifactsForWorkspaceKeys(workspaceKeysToBump);

  const packagePreview = [...plannedBumps.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([workspaceKey, level]) => {
      const workspace = byKey.get(workspaceKey);
      const nextVersion = bumpSemver(workspace.manifest.version, level);
      return { key: workspaceKey, name: workspace.manifest.name, currentVersion: workspace.manifest.version, nextVersion, level };
    });

  if (!options.apply) {
    const plan = { mode: "bump", applied: false, reason, tag, rootVersion: nextRootVersion, artifacts, packages: packagePreview };

    if (options.json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(`Would apply ${bumpType} bump (${reason}).`);
      console.log(`Tag: ${tag}`);
      console.log(`Artifacts: ${artifacts.length > 0 ? artifacts.join(", ") : "none"}`);
      console.log("Planned workspace bumps:");
      for (const pkg of packagePreview) {
        console.log(`- ${pkg.key}: ${pkg.currentVersion} -> ${pkg.nextVersion} (${pkg.level})`);
      }
    }
    return;
  }

  if (!options.skipPreflight) assertCleanWorkingTree();

  const bumpedVersionsByName = new Map();
  const changedManifestPaths = new Set();

  for (const pkg of packagePreview) {
    const workspace = byKey.get(pkg.key);
    workspace.manifest.version = pkg.nextVersion;
    bumpedVersionsByName.set(workspace.manifest.name, pkg.nextVersion);
    changedManifestPaths.add(workspace.manifestPathAbs);
  }

  for (const workspace of workspaces) {
    if (updateLocalWorkspaceDependencies(workspace, bumpedVersionsByName)) {
      changedManifestPaths.add(workspace.manifestPathAbs);
    }
  }

  for (const workspace of workspaces) {
    if (changedManifestPaths.has(workspace.manifestPathAbs)) writeJson(workspace.manifestPathAbs, workspace.manifest);
  }

  rootManifest.version = nextRootVersion;
  writeJson(rootManifestPath, rootManifest);

  const notes = rollChangelogUnreleased(nextRootVersion, new Date());

  runNpmPackageLockRefresh();

  const finalWorkspaces = loadWorkspacePackages();
  const { byName: finalByName } = buildWorkspaceMaps(finalWorkspaces);
  const finalDependencyGraph = buildDependencyGraph(finalWorkspaces, finalByName);
  const finalSnapshot = computeWorkspaceSnapshot(finalWorkspaces);
  const hashState = buildHashState(finalSnapshot, finalDependencyGraph, finalWorkspaces);
  writeHashStateIfChanged(hashState);

  const message = `chore(release): ${tag}`;
  commitTagAndPush(["package.json", "package-lock.json", "CHANGELOG.md", ".bump-hashes.json", "packages/*/package.json"], tag, message, {
    skipPush: options.skipPush,
  });

  const plan = { mode: "bump", applied: true, reason, tag, rootVersion: nextRootVersion, artifacts, notes, packages: packagePreview };

  if (options.ci) writeGithubOutput(plan);

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`Applied ${bumpType} bump (${reason}).`);
    console.log(`Tagged and pushed: ${tag}`);
    console.log(`Artifacts: ${artifacts.length > 0 ? artifacts.join(", ") : "none"}`);
    for (const pkg of packagePreview) {
      console.log(`- ${pkg.key}: ${pkg.currentVersion} -> ${pkg.nextVersion} (${pkg.level})`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.fromTag) {
    runFromTagMode(options.fromTag);
    return;
  }

  runBumpMode(options);
}

main();
