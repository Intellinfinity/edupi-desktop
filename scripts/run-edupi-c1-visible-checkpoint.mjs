#!/usr/bin/env node

/** Isolated C1 runner: temporary Core data, detached Desktop, no local store. */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPAT_MANIFEST_PATH = path.join(DESKTOP_ROOT, "contracts", "edupi-core-compat.json");
const TEMP_PARENT_PREFIX = "edupi-c1-visible-";
const DATA_ROOT_NAME = "core-data";
const DESKTOP_WORKTREE_NAME = "desktop-worktree";
const NEXT_RELATIVE_PATH = ["node_modules", "next", "dist", "bin", "next"];
const PRODUCTION_PORT = 30141;
export const DEFAULT_PORT = 30142;
export const EXPECTED_C1_COMMANDS = Object.freeze(["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"]);
export const EXPECTED_C1_REVIEW_COMMANDS = Object.freeze(["review_observation", "review_memory_candidate"]);
export const EXPECTED_C1_ACTIONS = Object.freeze(["accept", "modify", "reject", "hold"]);
export const REVIEW_PATH = "/?edupi=1&module=tasks&view=review&inspector=0";
export const SEED_TIME = "2026-08-27T09:00:00.000Z";

function runGit(args, options) {
  return execFileSync("git", args, options);
}

export const SYNTHETIC_TARGETS = Object.freeze([
  { label: "observation/accept", kind: "observation", decision: "accept", slug: "observation-accept" },
  { label: "observation/modify", kind: "observation", decision: "modify", slug: "observation-modify" },
  { label: "observation/reject", kind: "observation", decision: "reject", slug: "observation-reject" },
  { label: "observation/hold", kind: "observation", decision: "hold", slug: "observation-hold" },
  { label: "memory-candidate/accept", kind: "memory_candidate", decision: "accept", slug: "memory-candidate-accept" },
  { label: "memory-candidate/modify", kind: "memory_candidate", decision: "modify", slug: "memory-candidate-modify" },
  { label: "memory-candidate/reject", kind: "memory_candidate", decision: "reject", slug: "memory-candidate-reject" },
  { label: "memory-candidate/hold", kind: "memory_candidate", decision: "hold", slug: "memory-candidate-hold" },
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function exactList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export function isDescendantPath(root, candidate) {
  if (typeof root !== "string" || typeof candidate !== "string" || !path.isAbsolute(root) || !path.isAbsolute(candidate)) return false;
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function requireAbsolute(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

function readCompatManifest() {
  const manifest = JSON.parse(fs.readFileSync(COMPAT_MANIFEST_PATH, "utf8"));
  const runtime = record(manifest?.core_runtime);
  if (!runtime
    || typeof runtime.core_commit !== "string"
    || runtime.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json"
    || typeof runtime.component_manifest_hash !== "string") {
    throw new Error("Desktop compatibility manifest has no valid pinned Core identity");
  }
  if (!exactList(manifest.supported_commands, EXPECTED_C1_COMMANDS)) {
    throw new Error("Desktop compatibility manifest does not expose the exact cumulative C1 command list");
  }
  return {
    coreCommit: runtime.core_commit,
    componentManifestPath: runtime.component_manifest_path,
    componentManifestHash: runtime.component_manifest_hash,
  };
}

function safeRegularFile(root, candidate, label) {
  if (!isDescendantPath(root, candidate)) throw new Error(`${label} is outside the Core root`);
  const resolved = fs.realpathSync(candidate);
  if (!isDescendantPath(root, resolved)) throw new Error(`${label} is outside the Core root`);
  if (!fs.statSync(resolved).isFile()) throw new Error(`${label} must be a regular file`);
  return resolved;
}

function verifyManifestEntry(root, entry) {
  if (!record(entry) || typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.split(/[\\/]+/).includes("..")) {
    throw new Error("Core component manifest contains an invalid path");
  }
  const file = safeRegularFile(root, path.join(root, entry.path), `Core component ${entry.path}`);
  const bytes = fs.readFileSync(file);
  if (entry.size !== bytes.byteLength) throw new Error(`Core component size mismatch: ${entry.path}`);
  if (entry.sha256 !== sha256(bytes)) throw new Error(`Core component hash mismatch: ${entry.path}`);
}

/** Validate the caller-supplied Core checkout against the Desktop-owned pin. */
export function validateCoreRoot({
  coreRoot = process.env.EDUPI_CORE_ROOT,
  allowedRoot,
  gitExec = runGit,
} = {}) {
  const configuredRoot = requireAbsolute(coreRoot, "EDUPI_CORE_ROOT");
  const root = fs.realpathSync(configuredRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error("EDUPI_CORE_ROOT must be a directory");
  const allowed = fs.realpathSync(requireAbsolute(allowedRoot || path.dirname(root), "EDUPI_CORE_ALLOWED_ROOT"));
  if (!isDescendantPath(allowed, root)) throw new Error("Core root is outside EDUPI_CORE_ALLOWED_ROOT");

  const pinned = readCompatManifest();
  let insideWorkTree;
  try {
    insideWorkTree = String(gitExec(["-C", root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" })).trim();
  } catch {
    throw new Error("EDUPI_CORE_ROOT must be a Git checkout");
  }
  if (insideWorkTree !== "true") throw new Error("EDUPI_CORE_ROOT must be a Git checkout");

  let coreCommit;
  try {
    coreCommit = String(gitExec(["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })).trim();
  } catch {
    throw new Error("EDUPI_CORE_ROOT Git HEAD is unavailable");
  }
  if (coreCommit !== pinned.coreCommit) throw new Error(`Core commit mismatch: expected ${pinned.coreCommit}`);

  const componentManifestPath = safeRegularFile(root, path.join(root, pinned.componentManifestPath), "Core component manifest");
  const manifest = JSON.parse(fs.readFileSync(componentManifestPath, "utf8"));
  const { component_manifest_hash: recordedHash, ...manifestPayload } = manifest;
  const calculatedHash = sha256(Buffer.from(JSON.stringify(canonicalize(manifestPayload)), "utf8"));
  if (recordedHash !== pinned.componentManifestHash || recordedHash !== calculatedHash) {
    throw new Error("Component manifest hash mismatch");
  }
  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const entries = [...modules, ...assets];
  const entryPaths = entries.map((entry) => entry?.path);
  if (entryPaths.some((entry) => typeof entry !== "string") || new Set(entryPaths).size !== entryPaths.length) {
    throw new Error("Core component manifest contains duplicate or invalid entries");
  }
  for (const entry of entries) verifyManifestEntry(root, entry);
  if (!modules.some((entry) => entry.path === "scripts/desktop_bridge_port.mjs")) {
    throw new Error("Core component manifest omits the fixed bridge entrypoint");
  }
  const entrypoint = safeRegularFile(root, path.join(root, "scripts/desktop_bridge_port.mjs"), "Core fixed bridge entrypoint");
  return {
    root,
    allowedRoot: allowed,
    coreCommit,
    componentManifestPath,
    componentManifestHash: recordedHash,
    entrypoint,
  };
}

export function validatePort(value = DEFAULT_PORT) {
  const normalized = typeof value === "string" && /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : value;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65_535 || normalized === PRODUCTION_PORT) {
    throw new Error(`port must be an integer between 1 and 65535 and cannot be ${PRODUCTION_PORT}`);
  }
  return normalized;
}

function createDataRoot(parentRoot) {
  const dataRoot = path.join(parentRoot, DATA_ROOT_NAME);
  if (!isDescendantPath(parentRoot, dataRoot)) throw new Error("temporary data root escaped its parent");
  for (const relative of [".edupi/memory", ".edupi/output", ".edupi/locks"]) {
    fs.mkdirSync(path.join(dataRoot, relative), { recursive: true });
  }
  return {
    root: dataRoot,
    allowedRoot: parentRoot,
    memoryDir: path.join(dataRoot, ".edupi", "memory"),
    outputDir: path.join(dataRoot, ".edupi", "output"),
    lockDir: path.join(dataRoot, ".edupi", "locks"),
  };
}

function assertTempParent(parentRoot, tempRoot) {
  const parent = fs.realpathSync(parentRoot);
  const temp = fs.realpathSync(tempRoot);
  if (!isDescendantPath(temp, parent) || path.dirname(parent) !== temp || !path.basename(parent).startsWith(TEMP_PARENT_PREFIX)) {
    throw new Error("temporary cleanup target is not an owned mkdtemp parent");
  }
}

/** Create the temporary parent/worktree and link existing dependencies. */
export function createVisibleCheckpointWorkspace({
  desktopRoot = DESKTOP_ROOT,
  gitExec = runGit,
  mkdtemp = fs.mkdtempSync,
  symlink = fs.symlinkSync,
  tempRoot = os.tmpdir(),
} = {}) {
  const resolvedDesktopRoot = fs.realpathSync(requireAbsolute(desktopRoot, "Desktop root"));
  const resolvedTempRoot = fs.realpathSync(requireAbsolute(tempRoot, "temporary root"));
  const nodeModulesSource = path.join(resolvedDesktopRoot, "node_modules");
  if (!fs.statSync(nodeModulesSource).isDirectory()) throw new Error("current checkout node_modules is required; dependencies are never installed");

  const parentRoot = fs.realpathSync(mkdtemp(path.join(resolvedTempRoot, TEMP_PARENT_PREFIX)));
  assertTempParent(parentRoot, resolvedTempRoot);
  let worktreeRegistered = false;
  const data = createDataRoot(parentRoot);
  const desktopWorktree = path.join(parentRoot, DESKTOP_WORKTREE_NAME);
  const nodeModulesLink = path.join(desktopWorktree, "node_modules");
  try {
    const head = String(gitExec(["rev-parse", "HEAD"], { cwd: resolvedDesktopRoot, encoding: "utf8" })).trim();
    if (!head) throw new Error("current Desktop committed HEAD is unavailable");
    gitExec(["worktree", "add", "--detach", desktopWorktree, head], { cwd: resolvedDesktopRoot, encoding: "utf8" });
    worktreeRegistered = true;
    symlink(nodeModulesSource, nodeModulesLink, "dir");
  } catch (error) {
    if (!worktreeRegistered) {
      fs.rmSync(parentRoot, { recursive: true, force: true });
      throw error;
    }
    try {
      gitExec(["worktree", "remove", "--force", desktopWorktree], { cwd: resolvedDesktopRoot, encoding: "utf8" });
    } catch (cleanupError) {
      const combined = new Error(
        `C1 setup failed: ${error instanceof Error ? error.message : String(error)}; cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}; recovery path: ${parentRoot}`,
        { cause: error },
      );
      combined.cleanupPath = parentRoot;
      combined.setupError = error;
      combined.cleanupError = cleanupError;
      throw combined;
    }
    fs.rmSync(parentRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    parentRoot,
    dataRoot: data.root,
    dataAllowedRoot: data.allowedRoot,
    memoryDir: data.memoryDir,
    outputDir: data.outputDir,
    lockDir: data.lockDir,
    desktopRoot: resolvedDesktopRoot,
    desktopWorktree,
    nodeModulesSource,
    nodeModulesLink,
    worktreeRegistered,
    child: null,
    childExit: null,
    cleanupPromise: null,
    cleaned: false,
  };
}

function applyEnvironment(values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function ensureDataRootDirectories(workspace) {
  for (const directory of [workspace.dataRoot, workspace.memoryDir, workspace.outputDir, workspace.lockDir]) {
    if (!path.isAbsolute(directory) || !isDescendantPath(workspace.parentRoot, directory)) throw new Error("temporary data root escaped its parent");
  }
  for (const directory of [workspace.memoryDir, workspace.outputDir, workspace.lockDir]) fs.mkdirSync(directory, { recursive: true });
}

/** Seed eight source-bound records through Core's adapter after env setup. */
export async function seedVisibleTargets({
  coreRoot,
  dataRoot,
  dataAllowedRoot = path.dirname(dataRoot),
  memoryDir = path.join(dataRoot, ".edupi", "memory"),
  outputDir = path.join(dataRoot, ".edupi", "output"),
  lockDir = path.join(dataRoot, ".edupi", "locks"),
  jitiFactory,
  prepareWriterRoot,
  acquireWriterAdmission,
} = {}) {
  const resolvedCoreRoot = requireAbsolute(coreRoot, "Core root");
  const workspace = {
    parentRoot: path.dirname(resolvedCoreRoot),
    dataRoot: requireAbsolute(dataRoot, "EDUPI_DATA_ROOT"),
    dataAllowedRoot: requireAbsolute(dataAllowedRoot, "EDUPI_DATA_ALLOWED_ROOT"),
    memoryDir: requireAbsolute(memoryDir, "EDUPI_MEMORY_DIR"),
    outputDir: requireAbsolute(outputDir, "EDUPI_OUTPUT_DIR"),
    lockDir: requireAbsolute(lockDir, "EDUPI_LOCK_DIR"),
  };
  for (const directory of [workspace.memoryDir, workspace.outputDir, workspace.lockDir]) fs.mkdirSync(directory, { recursive: true });
  const adapterPath = path.join(resolvedCoreRoot, "extensions", "teacher_observation.ts");
  if (!isDescendantPath(resolvedCoreRoot, adapterPath)) throw new Error("Core observation adapter escaped the Core root");

  const restoreEnvironment = applyEnvironment({
    EDUPI_PROJECT_ROOT: workspace.dataRoot,
    EDUPI_DATA_ROOT: workspace.dataRoot,
    EDUPI_DATA_ALLOWED_ROOT: workspace.dataAllowedRoot,
    EDUPI_MEMORY_DIR: workspace.memoryDir,
    EDUPI_OUTPUT_DIR: workspace.outputDir,
    EDUPI_LOCK_DIR: workspace.lockDir,
    EDUPI_HOME: path.join(workspace.dataRoot, ".edupi"),
  });
  let writerAdmission = null;
  try {
    const prepare = prepareWriterRoot || (await import(path.join(resolvedCoreRoot, "scripts", "core_runtime_root.mjs"))).prepareCoreRuntimeRoot;
    const acquire = acquireWriterAdmission || (await import(path.join(resolvedCoreRoot, "scripts", "core_runtime_writer_admission.mjs"))).acquireCoreRuntimeWriterAdmission;
    const preparedRoot = prepare(workspace.dataRoot);
    if (!preparedRoot?.ok) throw new Error("Core Runtime writer root could not be prepared.");
    writerAdmission = await acquire({ root: preparedRoot, kind: "legacy_desktop_c1_visible", busyTimeoutMs: 250 });
    const factory = jitiFactory || (await import("jiti")).createJiti;
    const jiti = factory(import.meta.url, { tsconfigPaths: true, moduleCache: false });
    const adapter = await jiti.import(adapterPath);
    if (typeof adapter?.captureTeacherObservation !== "function") throw new Error("Core teacher observation adapter is unavailable");

    const captures = [];
    for (const target of SYNTHETIC_TARGETS) {
      const sourceMessageId = `edupi-c1-visible-${target.slug}`;
      const text = `C1 synthetic QA ${target.label}`;
      const captured = await adapter.captureTeacherObservation({
        source_message_id: sourceMessageId,
        text,
        observed_at: SEED_TIME,
        subject: "synthetic-qa",
        class_id: "synthetic-c1",
        category: "teaching",
        matched_rules: [`edupi-c1-visible-${target.slug}`],
        tags: ["synthetic-qa", target.slug],
      });
      if (!record(captured) || captured.created !== true || typeof captured.observation_id !== "string" || typeof captured.candidate_id !== "string") {
        throw new Error(`Core adapter did not create the synthetic ${target.label} target`);
      }
      captures.push({ target, result: captured });
    }
    const observations = captures.map(({ result }, index) => ({ label: `synthetic-observation/${index + 1}`, targetKind: "observation", targetId: result.observation_id, observationId: result.observation_id, candidateId: result.candidate_id }));
    const memoryCandidates = captures.map(({ result }, index) => ({ label: `synthetic-memory-candidate/${index + 1}`, targetKind: "memory_candidate", targetId: result.candidate_id, observationId: result.observation_id, candidateId: result.candidate_id }));
    const reviewTargets = captures.map(({ target, result }, index) => ({
      label: target.label,
      targetKind: index < 4 ? "observation" : "memory_candidate",
      targetId: index < 4 ? result.observation_id : result.candidate_id,
      observationId: result.observation_id,
      candidateId: result.candidate_id,
    }));
    const allObservationIds = captures.map(({ result }) => result.observation_id);
    const allCandidateIds = captures.map(({ result }) => result.candidate_id);
    if (new Set(allObservationIds).size !== 8 || new Set(allCandidateIds).size !== 8) throw new Error("Core adapter returned non-independent synthetic target IDs");
    const finalState = captures.at(-1)?.result?.state;
    if (record(finalState)) {
      if (Array.isArray(finalState.observations) && finalState.observations.length !== 8) throw new Error("Core adapter observation projection is not 8");
      if (Array.isArray(finalState.memory_candidates) && finalState.memory_candidates.length !== 8) throw new Error("Core adapter candidate projection is not 8");
      if (Array.isArray(finalState.memories) && finalState.memories.length !== 0) throw new Error("Core adapter seeded an unexpected memory");
    }
    return {
      captures,
      observations,
      memoryCandidates,
      reviewTargets,
      counts: { observations: 8, memoryCandidates: 8, memories: 0 },
    };
  } finally {
    try {
      await writerAdmission?.release();
    } finally {
      restoreEnvironment();
    }
  }
}

export function buildLaunchEnvironment({ core, workspace, environment = process.env } = {}) {
  if (!core?.root || !workspace?.dataRoot) throw new Error("Core and temporary workspace are required");
  return {
    ...environment,
    EDUPI_CORE_ROOT: core.root,
    EDUPI_CORE_ALLOWED_ROOT: core.allowedRoot,
    EDUPI_PROJECT_ROOT: workspace.dataRoot,
    EDUPI_DATA_ROOT: workspace.dataRoot,
    EDUPI_DATA_ALLOWED_ROOT: workspace.dataAllowedRoot,
    EDUPI_MEMORY_DIR: workspace.memoryDir,
    EDUPI_OUTPUT_DIR: workspace.outputDir,
    EDUPI_LOCK_DIR: workspace.lockDir,
    EDUPI_HOME: path.join(workspace.dataRoot, ".edupi"),
  };
}

export function buildNextLaunchSpec(worktree, port, environment = process.env) {
  const validatedPort = validatePort(port);
  const resolvedWorktree = requireAbsolute(worktree, "Desktop worktree");
  const nextBin = path.join(resolvedWorktree, ...NEXT_RELATIVE_PATH);
  if (!fs.statSync(nextBin).isFile()) throw new Error("temporary Desktop Next binary is unavailable; dependencies were not installed");
  const argv = [nextBin, "dev", "--webpack", "-H", "127.0.0.1", "-p", String(validatedPort)];
  return {
    argv,
    options: {
      cwd: resolvedWorktree,
      shell: false,
      stdio: "inherit",
      env: environment,
    },
  };
}

export function spawnDesktopDev({ core, workspace, port, spawnImpl = spawn, environment = process.env } = {}) {
  const launch = buildNextLaunchSpec(workspace.desktopWorktree, port, buildLaunchEnvironment({ core, workspace, environment }));
  const child = spawnImpl(process.execPath, launch.argv, launch.options);
  workspace.child = child;
  return { child, launch };
}

export function isReadyForVisibleCheckpoint({ status, education } = {}) {
  const statusCore = record(status?.core);
  const statusProjection = record(status?.projection);
  const educationCapabilities = record(education?.capabilities);
  const c1Review = record(educationCapabilities?.c1Review);
  return statusCore?.status === "ready"
    && exactList(statusCore.supportedCommands, EXPECTED_C1_COMMANDS)
    && statusProjection?.status === "ready"
    && statusProjection?.projection === "education_workspace"
    && education?.externalSend === false
    && c1Review?.enabled === true
    && exactList(c1Review.commands, EXPECTED_C1_REVIEW_COMMANDS)
    && exactList(c1Review.actions, EXPECTED_C1_ACTIONS)
    && Array.isArray(education?.observations)
    && education.observations.length === 8
    && Array.isArray(education?.memoryCandidates)
    && education.memoryCandidates.length === 8;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForReadiness({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
  intervalMs = 250,
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable for Desktop readiness");
  if (typeof baseUrl !== "string" || !baseUrl) throw new Error("Desktop base URL is required");
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "Core/education projection is not ready";
  while (Date.now() <= deadline) {
    if (signal?.aborted) throw new Error("readiness wait aborted");
    try {
      const [statusResponse, educationResponse] = await Promise.all([
        fetchImpl(`${baseUrl}/api/edupi/status`, { signal }),
        fetchImpl(`${baseUrl}/api/edupi/education`, { signal }),
      ]);
      if (!statusResponse || typeof statusResponse.json !== "function" || !educationResponse || typeof educationResponse.json !== "function") throw new Error("Desktop readiness response is invalid");
      const [status, education] = await Promise.all([statusResponse.json(), educationResponse.json()]);
      if (isReadyForVisibleCheckpoint({ status, education })) return { status, education };
      lastFailure = "Core/education readiness predicates are not satisfied";
    } catch (error) {
      if (signal?.aborted) throw new Error("readiness wait aborted");
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await wait(Math.min(intervalMs, remaining));
  }
  throw new Error(`Desktop readiness timeout: ${lastFailure}`);
}

function childHasExited(child) {
  return child && (child.exitCode !== null && child.exitCode !== undefined || child.signalCode);
}

function childExitPromise(child) {
  if (!child) return Promise.resolve({ code: 0, signal: null });
  if (childHasExited(child)) return Promise.resolve({ code: child.exitCode ?? null, signal: child.signalCode ?? null });
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    child.once("error", onError);
    child.once("exit", (code, signal) => {
      child.removeListener?.("error", onError);
      resolve({ code, signal });
    });
  });
}

async function waitForChildExitWithTimeout(child, timeoutMs) {
  if (!child || childHasExited(child)) return { code: child?.exitCode ?? 0, signal: child?.signalCode ?? null };
  let timeout;
  try {
    return await Promise.race([
      childExitPromise(child),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("child exit timeout")), timeoutMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function stopChildAndWait(child, { timeoutMs = 5_000 } = {}) {
  if (!child || childHasExited(child)) return { code: child?.exitCode ?? 0, signal: child?.signalCode ?? null };
  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"]) {
    try { child.kill?.(signal); } catch { /* try the next signal */ }
    try {
      return await waitForChildExitWithTimeout(child, timeoutMs);
    } catch {
      // Escalate only when the child did not exit before the deadline.
    }
  }
  throw new Error("Next child exit could not be confirmed after SIGINT, SIGTERM, and SIGKILL");
}

/** Stop child, unregister the exact worktree, then remove its mkdtemp parent. */
export async function cleanupVisibleCheckpoint(workspace, {
  gitExec = runGit,
  stopChild = stopChildAndWait,
} = {}) {
  if (!workspace || workspace.cleaned) return;
  if (workspace.cleanupPromise) return workspace.cleanupPromise;
  const cleanup = async () => {
    try {
      assertTempParent(workspace.parentRoot, path.dirname(workspace.parentRoot));
      if (workspace.child) {
        try {
          await stopChild(workspace.child);
        } catch (error) {
          throw new Error(`C1 cleanup is waiting for confirmed Next child exit: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
      }
      if (workspace.worktreeRegistered) {
        gitExec(["worktree", "remove", "--force", workspace.desktopWorktree], { cwd: workspace.desktopRoot, encoding: "utf8" });
        workspace.worktreeRegistered = false;
      }
      fs.rmSync(workspace.parentRoot, { recursive: true, force: true });
      workspace.cleaned = true;
    } catch (error) {
      workspace.cleanupPromise = null;
      if (error && typeof error === "object") error.cleanupPath = workspace.parentRoot;
      throw error;
    }
  };
  const promise = Promise.resolve().then(cleanup);
  workspace.cleanupPromise = promise;
  void promise.catch(() => {
    if (workspace.cleanupPromise === promise) workspace.cleanupPromise = null;
  });
  return promise;
}

function invokeCoreBridge(runtime, workspace, operation, requestId) {
  const request = {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation,
    request_id: requestId,
  };
  const result = spawnSync(process.execPath, [runtime.entrypoint], {
    cwd: runtime.root,
    shell: false,
    input: JSON.stringify(request),
    encoding: "utf8",
    timeout: 10_000,
    env: {
      PATH: process.env.PATH,
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
      TZ: process.env.TZ || "Asia/Shanghai",
      NODE_ENV: process.env.NODE_ENV || "production",
      EDUPI_PROJECT_ROOT: workspace.dataRoot,
      EDUPI_MEMORY_DIR: workspace.memoryDir,
      EDUPI_OUTPUT_DIR: workspace.outputDir,
      EDUPI_LOCK_DIR: workspace.lockDir,
      EDUPI_CORE_COMMIT: runtime.coreCommit,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Core bridge ${operation} failed`);
  const frames = String(result.stdout || "").trim().split("\n").filter(Boolean);
  if (frames.length !== 1) throw new Error(`Core bridge ${operation} returned an invalid frame`);
  return JSON.parse(frames[0]);
}

export function assertPreparedProjection({ runtime, workspace, bridgeRequest = invokeCoreBridge } = {}) {
  const health = bridgeRequest(runtime, workspace, "health", "c1-visible-prepare-health");
  if (health?.ok !== true || health.status !== "ready" || !exactList(health.supported_commands, EXPECTED_C1_COMMANDS)) {
    throw new Error("Core prepare-only health is not C1-ready");
  }
  const snapshotResponse = bridgeRequest(runtime, workspace, "snapshot", "c1-visible-prepare-snapshot");
  const payload = snapshotResponse?.envelope?.payload;
  const counts = {
    observations: Array.isArray(payload?.observations) ? payload.observations.length : 0,
    memoryCandidates: Array.isArray(payload?.memory_candidates) ? payload.memory_candidates.length : 0,
    memories: Array.isArray(payload?.memories) ? payload.memories.length : 0,
  };
  if (snapshotResponse?.ok !== true || counts.observations !== 8 || counts.memoryCandidates !== 8 || counts.memories !== 0) {
    throw new Error("Core prepare-only projection is not 8 observations, 8 candidates, 0 memories");
  }
  if (!exactList(payload?.capabilities?.supported_commands, EXPECTED_C1_COMMANDS)) throw new Error("Core prepare-only cumulative capability list is not exact");
  return { health, snapshot: snapshotResponse, counts, snapshotId: payload.snapshot_id };
}

function printTargetChecklist(seed, writeLine) {
  writeLine("合成 QA 目标（仅临时数据）:");
  for (const target of seed.reviewTargets || [...seed.observations.slice(0, 4), ...seed.memoryCandidates.slice(4)]) writeLine(`- ${target.label}: ${target.targetId}`);
}

function printSummary({ runtime, seed, projection, prepareOnly, writeLine }) {
  writeLine(`C1 ${prepareOnly ? "准备检查" : "可见验收"}：隔离工作区已就绪`);
  writeLine(`Core commit: ${runtime.coreCommit}`);
  writeLine(`component manifest: ${runtime.componentManifestHash}`);
  writeLine(`projection: observations=${projection?.counts?.observations ?? seed.counts.observations}, memory_candidates=${projection?.counts?.memoryCandidates ?? seed.counts.memoryCandidates}, memories=${projection?.counts?.memories ?? seed.counts.memories}`);
  printTargetChecklist(seed, writeLine);
  writeLine(prepareOnly ? "准备检查结束：临时工作区自动清理" : "停止并清理：Ctrl-C（退出时自动清理临时 worktree 与数据根）");
}

function parseCliArgs(argv = process.argv.slice(2)) {
  let port = DEFAULT_PORT;
  let prepareOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--prepare-only") {
      prepareOnly = true;
      continue;
    }
    if (argument === "--port") {
      if (index + 1 >= argv.length) throw new Error("--port requires a value");
      port = validatePort(argv[++index]);
      continue;
    }
    if (argument.startsWith("--port=")) {
      port = validatePort(argument.slice("--port=".length));
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return { port, prepareOnly };
}

export async function runVisibleCheckpoint({
  coreRoot = process.env.EDUPI_CORE_ROOT,
  port = DEFAULT_PORT,
  prepareOnly = false,
  dependencies = {},
  writeLine = (line) => console.log(line),
  fetchImpl = globalThis.fetch,
} = {}) {
  const validatedPort = validatePort(port);
  const runtime = (dependencies.validateCoreRoot || validateCoreRoot)({ coreRoot });
  let workspace = null;
  let stopRequested = null;
  const abortController = new AbortController();
  const onSignal = (signal) => {
    if (stopRequested) return;
    stopRequested = signal;
    abortController.abort();
    if (workspace?.child) void stopChildAndWait(workspace.child).catch(() => {});
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  try {
    workspace = (dependencies.createWorkspace || createVisibleCheckpointWorkspace)();
    ensureDataRootDirectories(workspace);
    const seed = await (dependencies.seedTargets || seedVisibleTargets)({
      coreRoot: runtime.root,
      dataRoot: workspace.dataRoot,
      dataAllowedRoot: workspace.dataAllowedRoot,
      memoryDir: workspace.memoryDir,
      outputDir: workspace.outputDir,
      lockDir: workspace.lockDir,
    });
    if (prepareOnly) {
      const projection = await (dependencies.assertPreparedProjection || assertPreparedProjection)({ runtime, workspace, seed });
      printSummary({ runtime, seed, projection, prepareOnly: true, writeLine });
      return { status: "prepared", runtime, workspace, seed, projection };
    }

    const launched = (dependencies.spawnDesktop || spawnDesktopDev)({ core: runtime, workspace, port: validatedPort, environment: process.env });
    workspace.child = launched.child;
    const childExit = childExitPromise(launched.child);
    const baseUrl = `http://127.0.0.1:${validatedPort}`;
    const readiness = dependencies.waitForReadiness
      ? dependencies.waitForReadiness({ baseUrl, signal: abortController.signal })
      : waitForReadiness({ baseUrl, fetchImpl, signal: abortController.signal });
    let ready;
    try {
      ready = await Promise.race([
        readiness,
        childExit.then((exit) => { throw new Error(`Next child exited before readiness (${exit.code ?? exit.signal ?? "unknown"})`); }),
      ]);
    } catch (error) {
      if (!stopRequested) throw error;
      return { status: "stopped", signal: stopRequested, runtime, workspace, seed };
    }
    if (stopRequested) return { status: "stopped", signal: stopRequested, runtime, workspace, seed };
    printSummary({ runtime, seed, projection: { counts: { observations: 8, memoryCandidates: 8, memories: 0 } }, prepareOnly: false, writeLine });
    writeLine(`审核地址: ${baseUrl}${REVIEW_PATH}`);
    const exit = await childExit;
    if (stopRequested) return { status: "stopped", signal: stopRequested, runtime, workspace, seed, ready, exit };
    if (exit.code !== 0) throw new Error(`Next child exited (${exit.code ?? exit.signal ?? "unknown"})`);
    return { status: "child-exited", runtime, workspace, seed, ready, exit };
  } finally {
    let cleanupError = null;
    if (workspace) {
      try {
        await (dependencies.cleanupWorkspace || cleanupVisibleCheckpoint)(workspace);
      } catch (error) {
        cleanupError = error;
      }
    }
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    if (cleanupError) throw cleanupError;
  }
}

function redactedError(error) {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  const safeRecoveryPath = typeof error?.cleanupPath === "string"
    && path.isAbsolute(error.cleanupPath)
    && path.basename(error.cleanupPath).startsWith(TEMP_PARENT_PREFIX)
    && isDescendantPath(fs.realpathSync(os.tmpdir()), error.cleanupPath)
    ? error.cleanupPath
    : null;
  return `${message}${safeRecoveryPath ? `；清理位置：${safeRecoveryPath}` : ""}`
    .replace(/\/Users\/[^\s)]+/g, "[path]")
    .slice(0, 600);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCliArgs();
    const summary = await runVisibleCheckpoint(options);
    if (summary.status === "stopped") process.exitCode = summary.signal === "SIGTERM" ? 143 : 130;
  } catch (error) {
    console.error(`C1 隔离验收未完成：${redactedError(error)}`);
    process.exitCode = 1;
  }
}
