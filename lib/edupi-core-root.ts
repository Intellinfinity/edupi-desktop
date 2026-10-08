import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export type CoreRuntimeIdentity = {
  core_commit: string;
  component_manifest_path: "contracts/edupi-desktop-component-manifest.json";
  component_manifest_hash: string;
  runtime_component_manifest_hash: string;
};

export type EduPiCoreValidationMode = "external" | "bundled";

export type ResolvedEduPiCore = {
  root: string;
  cwd: string;
  entrypoint: string;
  componentManifestPath: string;
  componentManifestHash: string;
  runtimeComponentManifestPath: string;
  runtimeComponentManifestHash: string;
  coreCommit: string;
  validationMode: EduPiCoreValidationMode;
};

export type ResolvedEduPiDataRoot = {
  root: string;
  allowedRoot: string;
  memoryDir: string;
  outputDir: string;
  lockDir: string;
};

function sha256(bytes: Buffer | string): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

const COMPONENT_MANIFEST_VERSION = "1";
const COMPONENT_MANIFEST_ALGORITHM = "sha256-canonical-component-payload-v1";
const RUNTIME_MANIFEST_PATH = "contracts/edupi-core-runtime-component-manifest.json";
const RUNTIME_ENTRYPOINT = "scripts/core_runtime_daemon.mjs";
const RUNTIME_BOOTSTRAP_FILES = [
  RUNTIME_ENTRYPOINT,
  "scripts/edupi_component_manifest.mjs",
  "scripts/core_runtime_protocol.mjs",
  "scripts/core_runtime_root.mjs",
] as const;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const PACKAGE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function requireAbsolute(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  return value;
}

function resolveDirectory(value: string, label: string): string {
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`${label} must be a directory`);
  return resolved;
}

function containedPath(root: string, relative: string, label: string): string {
  const candidate = path.resolve(root, relative);
  if (!isInside(root, candidate)) throw new Error(`${label} is outside the data root`);

  let current = root;
  for (const component of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error(`${label} contains a symlink component: ${current}`);
    const resolved = fs.realpathSync(current);
    if (!isInside(root, resolved)) throw new Error(`${label} is outside the data root`);
    if (!stats.isDirectory()) throw new Error(`${label} must be a directory: ${current}`);
  }
  return candidate;
}

/**
 * Resolve the user data root independently from the pinned Core code root.
 * The three derived paths are intentionally passed to Core; ambient path
 * overrides and HOME/cwd fallbacks are never consulted here.
 */
export function resolveEduPiDataRoot({
  configuredRoot = process.env.EDUPI_DATA_ROOT,
  allowedRoot = process.env.EDUPI_DATA_ALLOWED_ROOT,
}: {
  configuredRoot?: string;
  allowedRoot?: string;
} = {}): ResolvedEduPiDataRoot {
  const configured = requireAbsolute(configuredRoot, "EDUPI_DATA_ROOT");
  const allowedConfigured = requireAbsolute(allowedRoot || path.dirname(configured), "EDUPI_DATA_ALLOWED_ROOT");
  const root = resolveDirectory(configured, "EDUPI_DATA_ROOT");
  const allowed = resolveDirectory(allowedConfigured, "EDUPI_DATA_ALLOWED_ROOT");
  if (!isInside(allowed, root)) throw new Error("EDUPI_DATA_ROOT is outside EDUPI_DATA_ALLOWED_ROOT");
  return {
    root,
    allowedRoot: allowed,
    memoryDir: containedPath(root, ".edupi/memory", "EDUPI_MEMORY_DIR"),
    outputDir: containedPath(root, ".edupi/output", "EDUPI_OUTPUT_DIR"),
    lockDir: containedPath(root, ".edupi/locks", "EDUPI_LOCK_DIR"),
  };
}

function safeManifestRelativePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !/^[a-zA-Z]:/u.test(value)
    && !value.includes("\\")
    && !value.includes("\0")
    && !value.split("/").some((part) => part === ".." || part === "." || part === "");
}

function assertNoDisallowedSymlink(root: string, candidate: string, allowNodeModulesSymlink: boolean): void {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const [index, component] of relative.split(path.sep).filter(Boolean).entries()) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (!stat.isSymbolicLink()) continue;
    if (allowNodeModulesSymlink && index === 0 && component === "node_modules") continue;
    throw new Error(`Core component contains a symlink: ${current}`);
  }
}

export function validateContainedRegularFile({
  allowedRoot,
  candidate,
  allowNodeModulesSymlink = false,
}: {
  allowedRoot: string;
  candidate: string;
  allowNodeModulesSymlink?: boolean;
}): string {
  const root = fs.realpathSync(allowedRoot);
  const lexical = path.resolve(candidate);
  const resolved = fs.realpathSync(lexical);
  const resolvedInside = isInside(root, resolved);
  if (!resolvedInside) {
    if (!allowNodeModulesSymlink || !isInside(fs.realpathSync(path.join(root, "node_modules")), resolved)) {
      throw new Error(`Core entry is outside allowed root: ${candidate}`);
    }
  }
  const inspectionPath = isInside(root, lexical) ? lexical : resolvedInside ? resolved : lexical;
  assertNoDisallowedSymlink(root, inspectionPath, allowNodeModulesSymlink);
  if (!fs.lstatSync(lexical).isFile()) throw new Error(`Core entry must be a regular file: ${candidate}`);
  return resolved;
}

type ComponentManifestFile = { path?: unknown; sha256?: unknown; size?: unknown };
type RuntimeDependencyManifest = { name?: unknown; version?: unknown; root?: unknown; files?: unknown };
type VerifiedManifestEntries = Map<string, string>;
const verifiedFiles = new Map<string, { stamp: string; hash: string; size: number }>();
// The paired Core contains over 13,000 audited files. Keep room for two
// independent roots without evicting the entire manifest during each read.
const MAX_VERIFIED_FILES = 32_768;

function verifyManifestFile(root: string, entry: ComponentManifestFile, seenPaths: Set<string>, verifiedEntries: VerifiedManifestEntries, allowNodeModulesSymlink = false): void {
  const entryPath = entry?.path;
  const entryHash = entry?.sha256;
  const entrySize = entry?.size;
  if (!safeManifestRelativePath(entryPath) || typeof entryHash !== "string" || !SHA256_PATTERN.test(entryHash)
    || typeof entrySize !== "number" || !Number.isSafeInteger(entrySize) || entrySize < 0) throw new Error("Invalid component manifest entry");
  if (seenPaths.has(entryPath)) throw new Error(`Duplicate component manifest path: ${entryPath}`);
  seenPaths.add(entryPath);
  const metadata = JSON.stringify(canonicalize(entry));
  const previous = verifiedEntries.get(entryPath);
  if (previous !== undefined) {
    if (previous !== metadata) throw new Error(`Conflicting component manifest metadata: ${entryPath}`);
    validateContainedRegularFile({ allowedRoot: root, candidate: path.join(root, entryPath), allowNodeModulesSymlink });
    return;
  }
  const resolved = validateContainedRegularFile({ allowedRoot: root, candidate: path.join(root, entryPath), allowNodeModulesSymlink });
  const stat = fs.statSync(resolved, { bigint: true });
  const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  const cached = verifiedFiles.get(resolved);
  if (cached?.stamp === stamp && cached.hash === entryHash && cached.size === entrySize) {
    verifiedEntries.set(entryPath, metadata);
    return;
  }
  const bytes = fs.readFileSync(resolved);
  if (entrySize !== bytes.byteLength) throw new Error(`Component size mismatch: ${entryPath}`);
  if (entryHash !== sha256(bytes)) throw new Error(`Component hash mismatch: ${entryPath}`);
  if (verifiedFiles.size >= MAX_VERIFIED_FILES) verifiedFiles.clear();
  verifiedFiles.set(resolved, { stamp, hash: entryHash, size: entrySize });
  verifiedEntries.set(entryPath, metadata);
}

function verifyRuntimeDependency(root: string, dependency: RuntimeDependencyManifest, seenPaths: Set<string>, seenPackages: Set<string>, verifiedEntries: VerifiedManifestEntries, allowNodeModulesSymlink: boolean): void {
  if (!dependency || typeof dependency.name !== "string" || !PACKAGE_NAME_PATTERN.test(dependency.name)
    || seenPackages.has(dependency.name)
    || typeof dependency.version !== "string" || !PACKAGE_VERSION_PATTERN.test(dependency.version)
    || typeof dependency.root !== "string" || dependency.root !== path.posix.join("node_modules", ...dependency.name.split("/"))
    || !Array.isArray(dependency.files)) {
    throw new Error("Invalid runtime dependency metadata");
  }
  seenPackages.add(dependency.name);
  const prefix = `${dependency.root}/`;
  for (const entry of dependency.files as ComponentManifestFile[]) {
    if (!safeManifestRelativePath(entry?.path) || (entry.path !== dependency.root && !entry.path.startsWith(prefix))) {
      throw new Error(`Runtime dependency path is outside its package root: ${dependency.name}`);
    }
    verifyManifestFile(root, entry, seenPaths, verifiedEntries, allowNodeModulesSymlink);
  }
  const packageJsonPath = `${dependency.root}/package.json`;
  if (!(dependency.files as ComponentManifestFile[]).some((entry) => entry.path === packageJsonPath)) {
    throw new Error(`Runtime dependency omits package.json: ${dependency.name}`);
  }
}

function readPinnedManifest(root: string, relativePath: string, pinnedHash: string, label: string): {
  manifest: Record<string, unknown>; filePath: string; hash: string;
} {
  if (!SHA256_PATTERN.test(pinnedHash)) throw new Error(`${label} hash is invalid`);
  const filePath = validateContainedRegularFile({ allowedRoot: root, candidate: path.join(root, relativePath) });
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.component_manifest_version !== COMPONENT_MANIFEST_VERSION || manifest.algorithm !== COMPONENT_MANIFEST_ALGORITHM) {
    throw new Error(`Unsupported ${label} version or algorithm`);
  }
  const { component_manifest_hash: recordedHash, ...payload } = manifest;
  if (typeof recordedHash !== "string" || !SHA256_PATTERN.test(recordedHash)) throw new Error(`${label} hash is invalid`);
  const calculatedHash = sha256(Buffer.from(JSON.stringify(canonicalize(payload)), "utf8"));
  if (recordedHash !== calculatedHash || recordedHash !== pinnedHash) throw new Error(`${label} hash mismatch`);
  return { manifest, filePath, hash: recordedHash };
}

function verifyManifestClosure(root: string, manifest: Record<string, unknown>, verifiedEntries: VerifiedManifestEntries,
  allowNodeModulesSymlink: boolean): void {
  if (!Array.isArray(manifest.modules) || !Array.isArray(manifest.assets) || !Array.isArray(manifest.runtime_dependencies)) {
    throw new Error("Component manifest is missing a required file or dependency list");
  }
  const seenPaths = new Set<string>();
  const seenPackages = new Set<string>();
  for (const entry of [...manifest.modules, ...manifest.assets] as ComponentManifestFile[]) {
    verifyManifestFile(root, entry, seenPaths, verifiedEntries);
  }
  for (const dependency of manifest.runtime_dependencies as RuntimeDependencyManifest[]) {
    verifyRuntimeDependency(root, dependency, seenPaths, seenPackages, verifiedEntries, allowNodeModulesSymlink);
  }
}

function verifyRuntimeManifest(root: string, pinnedHash: string, verifiedEntries: VerifiedManifestEntries): {
  manifest: Record<string, unknown>; filePath: string; hash: string;
} {
  const { manifest, filePath, hash } = readPinnedManifest(root, RUNTIME_MANIFEST_PATH, pinnedHash, "Runtime manifest");
  if (manifest.entrypoint !== RUNTIME_ENTRYPOINT) throw new Error("Runtime manifest entrypoint is invalid");
  verifyManifestClosure(root, manifest, verifiedEntries, false);
  const entries = [...manifest.modules as ComponentManifestFile[], ...manifest.assets as ComponentManifestFile[]];
  for (const required of RUNTIME_BOOTSTRAP_FILES) {
    if (!entries.some((entry) => entry.path === required)) throw new Error(`Runtime manifest omits required file: ${required}`);
  }
  return { manifest, filePath, hash };
}

export function verifyEduPiRuntimeManifest({ root, pinnedHash }: { root: string; pinnedHash: string }): {
  manifest: Record<string, unknown>; filePath: string; hash: string;
} {
  return verifyRuntimeManifest(root, pinnedHash, new Map());
}

export function resolveEduPiCoreRoot({
  configuredRoot,
  allowedRoot,
  runtimeIdentity,
  validationMode = "external",
}: {
  configuredRoot: string;
  allowedRoot: string;
  runtimeIdentity: CoreRuntimeIdentity;
  validationMode?: EduPiCoreValidationMode;
}): ResolvedEduPiCore {
  if (!configuredRoot || !allowedRoot || !runtimeIdentity) throw new Error("Core root and runtime identity are required");
  if (validationMode !== "external" && validationMode !== "bundled") throw new Error("Core validation mode must be external or bundled");
  const root = fs.realpathSync(configuredRoot);
  const allowed = fs.realpathSync(allowedRoot);
  if (!isInside(allowed, root)) throw new Error("Core root is outside allowed root");
  if (runtimeIdentity.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json") throw new Error("Unexpected component manifest path");

  if (validationMode === "external") {
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (head !== runtimeIdentity.core_commit) throw new Error(`Core commit mismatch: expected ${runtimeIdentity.core_commit}`);
  }

  const { manifest, filePath: componentManifestPath, hash: recordedHash } = readPinnedManifest(
    root, runtimeIdentity.component_manifest_path, runtimeIdentity.component_manifest_hash, "Component manifest");

  if (manifest.entrypoint !== "scripts/desktop_bridge_port.mjs") throw new Error("Component manifest entrypoint is invalid");
  const verifiedEntries = new Map<string, string>();
  verifyManifestClosure(root, manifest, verifiedEntries, true);
  const modules = manifest.modules as ComponentManifestFile[];

  const entrypointRelative = "scripts/desktop_bridge_port.mjs";
  if (!modules.some((entry) => entry.path === entrypointRelative)) throw new Error("Component manifest omits fixed entrypoint");
  const entrypoint = validateContainedRegularFile({ allowedRoot: root, candidate: path.join(root, entrypointRelative) });
  const runtimeManifest = verifyRuntimeManifest(root, runtimeIdentity.runtime_component_manifest_hash, verifiedEntries);
  return { root, cwd: root, entrypoint, componentManifestPath, componentManifestHash: recordedHash,
    runtimeComponentManifestPath: runtimeManifest.filePath, runtimeComponentManifestHash: runtimeManifest.hash,
    coreCommit: runtimeIdentity.core_commit, validationMode };
}
