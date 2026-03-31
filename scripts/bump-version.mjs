#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUMP_TYPES = new Set(["patch", "minor", "major"]);
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const HASH_STATE_VERSION = 1;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const PACKAGES_DIR = path.join(ROOT_DIR, "packages");
const HASH_STATE_PATH = path.join(ROOT_DIR, ".bump-hashes.json");

const IGNORED_PATHS = [/\.tsbuildinfo$/, /^packages\/[^/]+\/dist\//, /^packages\/[^/]+\/node_modules\//];
const IGNORED_DIRECTORY_NAMES = new Set(["dist", "node_modules", ".git"]);

function printUsage() {
  console.log(
    `
Usage:
  npm run bump
  npm run bump -- --force <patch|minor|major>
  npm run bump -- <patch|minor|major>
  npm run bump -- --since <git-ref>
  npm run bump -- --dry-run

Behavior:
  - Hashes files under packages/* to detect workspace changes
  - Bumps changed workspaces using semantic versioning
  - Bumps dependent workspaces (connection map) with patch versions
  - Root package.json uses date versions: yyyy.mm.dd, then yyyy-mm-dd-<build#>
  - Server changes only => minor; client changes only => patch; client+server => major

Examples:
  npm run bump
  npm run bump -- --force minor
  npm run bump -- major --dry-run
  npm run bump -- --since origin/main
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

function isIgnoredPath(filePath) {
  return IGNORED_PATHS.some((pattern) => pattern.test(filePath));
}

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

function collectChangedFilesSinceGitRef(sinceRef, trackedPaths) {
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

    addFiles(gitLines(["diff", "--name-only", `${sinceRef}...HEAD`, "--", ...trackedPaths], { allowFailure: true }));
    addFiles(gitLines(["diff", "--name-only", "HEAD", "--", ...trackedPaths], { allowFailure: true }));
    addFiles(gitLines(["ls-files", "--others", "--exclude-standard", "--", ...trackedPaths], { allowFailure: true }));
    return [...changedFiles].filter((file) => !isIgnoredPath(file));
  }

  if (hasHeadCommit()) {
    const latestTag = runGit(["describe", "--tags", "--abbrev=0"], { allowFailure: true });

    if (latestTag) {
      addFiles(gitLines(["diff", "--name-only", `${latestTag}..HEAD`, "--", ...trackedPaths], { allowFailure: true }));
    } else {
      addFiles(gitLines(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD", "--", ...trackedPaths], { allowFailure: true }));
    }

    addFiles(gitLines(["diff", "--name-only", "HEAD", "--", ...trackedPaths], { allowFailure: true }));
    addFiles(gitLines(["ls-files", "--others", "--exclude-standard", "--", ...trackedPaths], { allowFailure: true }));
    return [...changedFiles].filter((file) => !isIgnoredPath(file));
  }

  addFiles(gitLines(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...trackedPaths], { allowFailure: true }));
  return [...changedFiles].filter((file) => !isIgnoredPath(file));
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
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }

        stack.push(absPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (isIgnoredPath(relPath)) {
        continue;
      }

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

    packages[workspace.key] = {
      name: workspace.manifest.name,
      hash: hashFileMap(fileHashes),
      files: fileHashes,
    };
  }

  return { packages };
}

function loadHashState() {
  if (!existsSync(HASH_STATE_PATH)) {
    return null;
  }

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
  const changedFiles = new Set();
  const changedPackageKeys = new Set();

  for (const [packageKey, currentPackage] of Object.entries(currentSnapshot.packages)) {
    const previousPackage = previousState?.packages?.[packageKey];
    const previousFiles = previousPackage?.files ?? {};
    const currentFiles = currentPackage.files;

    const allFiles = new Set([...Object.keys(currentFiles), ...Object.keys(previousFiles)]);

    for (const filePath of allFiles) {
      if (currentFiles[filePath] !== previousFiles[filePath]) {
        changedFiles.add(filePath);
      }
    }

    if (!previousPackage || previousPackage.hash !== currentPackage.hash) {
      changedPackageKeys.add(packageKey);
    }
  }

  return {
    changedFiles: [...changedFiles].sort((a, b) => a.localeCompare(b)),
    changedPackageKeys,
  };
}

function mapFilesToWorkspaceKeys(files, workspaceKeys) {
  const changed = new Set();

  for (const filePath of files) {
    for (const workspaceKey of workspaceKeys) {
      if (filePath === workspaceKey || filePath.startsWith(`${workspaceKey}/`)) {
        changed.add(workspaceKey);
        break;
      }
    }
  }

  return changed;
}

function buildDependencyGraph(workspaces, byName) {
  const dependenciesByKey = new Map();
  const dependentsByKey = new Map();

  for (const workspace of workspaces) {
    const deps = new Set();

    for (const field of DEPENDENCY_FIELDS) {
      const entries = workspace.manifest[field];
      if (!entries || typeof entries !== "object") {
        continue;
      }

      for (const dependencyName of Object.keys(entries)) {
        const dependencyKey = byName.get(dependencyName);
        if (!dependencyKey) {
          continue;
        }

        deps.add(dependencyKey);
      }
    }

    dependenciesByKey.set(workspace.key, deps);

    for (const depKey of deps) {
      if (!dependentsByKey.has(depKey)) {
        dependentsByKey.set(depKey, new Set());
      }

      dependentsByKey.get(depKey).add(workspace.key);
    }
  }

  for (const workspace of workspaces) {
    if (!dependentsByKey.has(workspace.key)) {
      dependentsByKey.set(workspace.key, new Set());
    }
  }

  return { dependenciesByKey, dependentsByKey };
}

function expandWithDependents(initialKeys, dependentsByKey) {
  const expanded = new Set(initialKeys);
  const queue = [...initialKeys];

  while (queue.length > 0) {
    const current = queue.shift();
    const dependents = dependentsByKey.get(current);

    if (!dependents) {
      continue;
    }

    for (const dependent of dependents) {
      if (expanded.has(dependent)) {
        continue;
      }

      expanded.add(dependent);
      queue.push(dependent);
    }
  }

  return expanded;
}

function detectBumpType(changedPackageKeys) {
  const keys = [...changedPackageKeys];
  const hasClientChange = keys.some((key) => key === "packages/client");
  const hasServerChange = keys.some((key) => key === "packages/server");
  const hasSharedChange = keys.some((key) => key === "packages/shared");

  if (hasClientChange && hasServerChange) {
    return { type: "major", reason: "changes detected in both client and server" };
  }

  if (hasServerChange) {
    return { type: "minor", reason: "changes detected in server" };
  }

  if (hasClientChange || hasSharedChange || keys.length > 0) {
    return { type: "patch", reason: "changes detected in client/shared workspaces" };
  }

  return { type: null, reason: "no workspace changes detected" };
}

function bumpSemver(version, type) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].+)?$/);
  if (!match) {
    fail(`Cannot ${type} bump non-semver workspace version "${version}".`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (type === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }

  if (type === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  if (type === "major") {
    return `${major + 1}.0.0`;
  }

  fail(`Unsupported bump type "${type}".`);
}

function updateDependencySpecifier(currentSpecifier, newVersion) {
  if (typeof currentSpecifier !== "string") {
    return currentSpecifier;
  }

  if (currentSpecifier.startsWith("workspace:")) {
    const tail = currentSpecifier.slice("workspace:".length);

    if (tail === "*" || tail === "^" || tail === "~") {
      return currentSpecifier;
    }

    if (tail.startsWith("^")) {
      return `workspace:^${newVersion}`;
    }

    if (tail.startsWith("~")) {
      return `workspace:~${newVersion}`;
    }

    return `workspace:${newVersion}`;
  }

  if (currentSpecifier.startsWith("^")) {
    return `^${newVersion}`;
  }

  if (currentSpecifier.startsWith("~")) {
    return `~${newVersion}`;
  }

  if (/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(currentSpecifier)) {
    return newVersion;
  }

  return currentSpecifier;
}

function updateLocalWorkspaceDependencies(workspace, bumpedVersionsByName) {
  let changed = false;

  for (const field of DEPENDENCY_FIELDS) {
    const dependencyBlock = workspace.manifest[field];
    if (!dependencyBlock || typeof dependencyBlock !== "object") {
      continue;
    }

    for (const [dependencyName, currentSpecifier] of Object.entries(dependencyBlock)) {
      const nextVersion = bumpedVersionsByName.get(dependencyName);
      if (!nextVersion) {
        continue;
      }

      const nextSpecifier = updateDependencySpecifier(currentSpecifier, nextVersion);
      if (nextSpecifier === currentSpecifier) {
        continue;
      }

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

  if (dashedBuildMatch) {
    return `${dashedDate}-${Number(dashedBuildMatch[1]) + 1}`;
  }

  if (currentVersion === dotVersion) {
    return `${dashedDate}-1`;
  }

  return dotVersion;
}

function runNpmPackageLockRefresh() {
  try {
    execFileSync("npm", ["install", "--package-lock-only"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const details = error.stderr?.toString().trim();
    fail(`npm install --package-lock-only failed${details ? `: ${details}` : "."}`);
  }
}

function buildHashState(snapshot, dependencyGraph, workspaces) {
  const state = {
    schemaVersion: HASH_STATE_VERSION,
    packages: {},
    connections: {},
  };

  const sortedWorkspaces = [...workspaces].sort((a, b) => a.key.localeCompare(b.key));

  for (const workspace of sortedWorkspaces) {
    const packageSnapshot = snapshot.packages[workspace.key];
    const dependencies = [...(dependencyGraph.dependenciesByKey.get(workspace.key) ?? new Set())].sort((a, b) =>
      a.localeCompare(b)
    );

    state.packages[workspace.key] = {
      name: packageSnapshot.name,
      hash: packageSnapshot.hash,
      files: packageSnapshot.files,
    };

    state.connections[workspace.key] = dependencies;
  }

  return state;
}

function writeHashStateIfChanged(state) {
  const nextContent = `${JSON.stringify(state, null, 2)}\n`;
  const currentContent = existsSync(HASH_STATE_PATH) ? readFileSync(HASH_STATE_PATH, "utf8") : null;

  if (currentContent === nextContent) {
    return false;
  }

  writeFileSync(HASH_STATE_PATH, nextContent, "utf8");
  return true;
}

function formatWorkspaceList(keys, byKey) {
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key} (${byKey.get(key)?.manifest.name ?? "unknown"})`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const initialWorkspaces = loadWorkspacePackages();
  const { byKey: initialByKey, byName: initialByName } = buildWorkspaceMaps(initialWorkspaces);
  const trackedPaths = initialWorkspaces.map((workspace) => workspace.key);

  const currentSnapshot = computeWorkspaceSnapshot(initialWorkspaces);
  const previousState = loadHashState();

  let changedFiles = [];
  let changedPackageKeys = new Set();
  let detectionSource = "hashes";

  if (options.since) {
    changedFiles = collectChangedFilesSinceGitRef(options.since, trackedPaths);
    changedPackageKeys = mapFilesToWorkspaceKeys(changedFiles, trackedPaths);
    detectionSource = `git diff (--since ${options.since})`;
  } else if (previousState) {
    const detected = detectHashChanges(currentSnapshot, previousState);
    changedFiles = detected.changedFiles;
    changedPackageKeys = detected.changedPackageKeys;
    detectionSource = "stored workspace hashes";
  } else {
    changedFiles = collectChangedFilesSinceGitRef(null, trackedPaths);
    changedPackageKeys = mapFilesToWorkspaceKeys(changedFiles, trackedPaths);
    detectionSource = "git diff (no hash baseline yet)";
  }

  const dependencyGraph = buildDependencyGraph(initialWorkspaces, initialByName);
  const changedWorkspaceList = formatWorkspaceList(changedPackageKeys, initialByKey);

  console.log(`Change detection source: ${detectionSource}`);

  if (changedFiles.length > 0) {
    console.log("Changed files considered:");
    for (const filePath of changedFiles) {
      console.log(`- ${filePath}`);
    }
  } else {
    console.log("No workspace file changes detected.");
  }

  if (changedWorkspaceList.length > 0) {
    console.log("Changed workspaces:");
    for (const workspace of changedWorkspaceList) {
      console.log(`- ${workspace}`);
    }
  }

  const detectedBump = detectBumpType(changedPackageKeys);
  const bumpType = options.force ?? detectedBump.type;

  if (!bumpType) {
    console.log("No version bump applied.");

    if (!options.dryRun) {
      const hashState = buildHashState(currentSnapshot, dependencyGraph, initialWorkspaces);
      const didWrite = writeHashStateIfChanged(hashState);
      if (didWrite) {
        console.log(`Updated hash state: ${relFromRoot(HASH_STATE_PATH)}`);
      }
    }

    return;
  }

  const directlyChangedKeys =
    options.force && changedPackageKeys.size === 0 ? new Set(trackedPaths) : new Set(changedPackageKeys);

  const workspaceKeysToBump =
    directlyChangedKeys.size > 0
      ? expandWithDependents(directlyChangedKeys, dependencyGraph.dependentsByKey)
      : new Set(trackedPaths);

  if (workspaceKeysToBump.size === 0) {
    console.log("No workspace versions changed.");

    if (!options.dryRun) {
      const hashState = buildHashState(currentSnapshot, dependencyGraph, initialWorkspaces);
      writeHashStateIfChanged(hashState);
    }

    return;
  }

  const plannedBumps = new Map();
  for (const workspaceKey of workspaceKeysToBump) {
    const level = directlyChangedKeys.has(workspaceKey) ? bumpType : "patch";
    plannedBumps.set(workspaceKey, level);
  }

  const reason = options.force ? `forced to ${options.force}` : detectedBump.reason;
  const rootManifestPath = path.join(ROOT_DIR, "package.json");
  const rootManifest = readJson(rootManifestPath);
  const nextRootVersion = determineNextRootVersion(rootManifest.version ?? "", new Date());

  const bumpLines = [...plannedBumps.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([workspaceKey, level]) => {
      const workspace = initialByKey.get(workspaceKey);
      const nextWorkspaceVersion = bumpSemver(workspace.manifest.version, level);
      return `${workspaceKey}: ${workspace.manifest.version} -> ${nextWorkspaceVersion} (${level})`;
    });

  if (options.dryRun) {
    console.log(`Dry run: would apply ${bumpType} bump (${reason}).`);
    console.log("Planned workspace bumps:");
    for (const line of bumpLines) {
      console.log(`- ${line}`);
    }
    console.log(`Root package version would become: ${nextRootVersion}`);
    return;
  }

  const bumpedVersionsByName = new Map();
  const changedManifestPaths = new Set();

  for (const [workspaceKey, level] of plannedBumps.entries()) {
    const workspace = initialByKey.get(workspaceKey);
    const nextVersion = bumpSemver(workspace.manifest.version, level);

    workspace.manifest.version = nextVersion;
    bumpedVersionsByName.set(workspace.manifest.name, nextVersion);
    changedManifestPaths.add(workspace.manifestPathAbs);
  }

  for (const workspace of initialWorkspaces) {
    if (updateLocalWorkspaceDependencies(workspace, bumpedVersionsByName)) {
      changedManifestPaths.add(workspace.manifestPathAbs);
    }
  }

  for (const workspace of initialWorkspaces) {
    if (changedManifestPaths.has(workspace.manifestPathAbs)) {
      writeJson(workspace.manifestPathAbs, workspace.manifest);
    }
  }

  rootManifest.version = nextRootVersion;
  writeJson(rootManifestPath, rootManifest);

  runNpmPackageLockRefresh();

  const finalWorkspaces = loadWorkspacePackages();
  const { byName: finalByName } = buildWorkspaceMaps(finalWorkspaces);
  const finalDependencyGraph = buildDependencyGraph(finalWorkspaces, finalByName);
  const finalSnapshot = computeWorkspaceSnapshot(finalWorkspaces);
  const hashState = buildHashState(finalSnapshot, finalDependencyGraph, finalWorkspaces);
  writeHashStateIfChanged(hashState);

  console.log(`Applied ${bumpType} bump (${reason}).`);
  console.log("Workspace version updates:");
  for (const line of bumpLines) {
    console.log(`- ${line}`);
  }
  console.log(`New root package version: ${nextRootVersion}`);
  console.log(`Updated hash state: ${relFromRoot(HASH_STATE_PATH)}`);
}

main();
