import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FILE_NAME = "edupi-proactivity.json";
const STOP_FILE_NAME = "edupi-proactivity-stop.json";
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;

export type EduPiProactivityScope = { classId: string; subject: string };
export type EduPiProactivityActivation = {
  enabled: boolean;
  source: "default" | "desktop_canary" | "environment";
  configurationStatus: "missing" | "ready" | "legacy" | "stop_pending" | "mismatched" | "invalid";
  scope: EduPiProactivityScope | null;
  grantId: string | null;
  updatedAt: string | null;
};

type StoredConfig = {
  version: 1 | 2;
  data_root_hash: string;
  enabled: boolean;
  scope: { class_id: string; subject: string } | null;
  grant_id: string | null;
  updated_at: string;
};
type StoredStopIntent = {
  version: 1;
  data_root_hash: string;
  scope: { class_id: string; subject: string };
  grant_id: string;
  updated_at: string;
};

export class EduPiProactivityConfigError extends Error {
  readonly code = "proactivity_configuration_unavailable";
  constructor() { super("EduPi proactivity configuration unavailable."); this.name = "EduPiProactivityConfigError"; }
}

function fail(): never { throw new EduPiProactivityConfigError(); }

function validSubject(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validScope(value: unknown): value is StoredConfig["scope"] {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 2
    && ID.test(String((value as Record<string, unknown>).class_id || ""))
    && validSubject((value as Record<string, unknown>).subject));
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)));
}

function validStored(value: unknown): value is StoredConfig {
  if (!exactKeys(value, ["version", "data_root_hash", "enabled", "scope", "grant_id", "updated_at"])) return false;
  const scope = value.scope;
  const grantId = value.grant_id;
  return (value.version === 1 || value.version === 2) && HASH.test(String(value.data_root_hash || "")) && typeof value.enabled === "boolean"
    && (scope === null && grantId === null || validScope(scope) && typeof grantId === "string" && ID.test(grantId))
    && (!value.enabled || scope !== null)
    && typeof value.updated_at === "string" && new Date(value.updated_at).toISOString() === value.updated_at;
}

function validStopIntent(value: unknown): value is StoredStopIntent {
  if (!exactKeys(value, ["version", "data_root_hash", "scope", "grant_id", "updated_at"])) return false;
  try {
    return value.version === 1 && HASH.test(String(value.data_root_hash || "")) && value.scope !== null && validScope(value.scope)
      && typeof value.grant_id === "string" && ID.test(value.grant_id)
      && typeof value.updated_at === "string" && new Date(value.updated_at).toISOString() === value.updated_at;
  } catch { return false; }
}

function secureRoot(stateDir: string | undefined): string {
  if (!stateDir || !path.isAbsolute(stateDir)) fail();
  const before = fs.lstatSync(stateDir);
  if (!before.isDirectory() || before.isSymbolicLink()) fail();
  const root = fs.realpathSync(stateDir);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 0o022) !== 0
    || typeof process.getuid === "function" && stat.uid !== process.getuid())) fail();
  return root;
}

function syncStateDirectory(root: string): void {
  const directory = fs.openSync(root, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_DIRECTORY ?? 0));
  try {
    if (!fs.fstatSync(directory).isDirectory()) fail();
    fs.fsyncSync(directory);
  } finally { fs.closeSync(directory); }
}

function dataRootHash(dataRoot: string): string {
  if (!path.isAbsolute(dataRoot)) fail();
  const root = fs.realpathSync(dataRoot);
  if (!fs.lstatSync(root).isDirectory()) fail();
  return `sha256:${crypto.createHash("sha256").update(root, "utf8").digest("hex")}`;
}

function readStored(stateDir: string | undefined): { status: "missing" | "ready" | "invalid"; value: StoredConfig | null } {
  if (!stateDir) return { status: "missing", value: null };
  let root: string;
  try { root = secureRoot(stateDir); } catch { return { status: "invalid", value: null }; }
  const file = path.join(root, FILE_NAME);
  let descriptor: number | undefined;
  try {
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? { status: "missing", value: null } : { status: "invalid", value: null }; }
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > 4096
      || process.platform !== "win32" && ((before.mode & 0o077) !== 0
        || typeof process.getuid === "function" && before.uid !== process.getuid())) return { status: "invalid", value: null };
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || fs.realpathSync(file) !== file) {
      return { status: "invalid", value: null };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return { status: "invalid", value: null }; }
    return validStored(parsed) ? { status: "ready", value: parsed } : { status: "invalid", value: null };
  } catch { return { status: "invalid", value: null }; }
  finally { if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* read-only cleanup */ } }
}

function readStopIntent(stateDir: string | undefined, dataRoot: string): StoredStopIntent | null {
  if (!stateDir) return null;
  const root = secureRoot(stateDir);
  const file = path.join(root, STOP_FILE_NAME);
  let descriptor: number | undefined;
  try {
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > 4096
      || process.platform !== "win32" && ((before.mode & 0o077) !== 0
        || typeof process.getuid === "function" && before.uid !== process.getuid())) fail();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || fs.realpathSync(file) !== file) fail();
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!validStopIntent(parsed) || parsed.data_root_hash !== dataRootHash(dataRoot)) fail();
    return parsed;
  } catch { return fail(); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

export function writeEduPiProactivityStopIntent(input: { scope: EduPiProactivityScope; grantId: string },
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot, now = new Date().toISOString() }:
    { stateDir?: string; dataRoot: string; now?: string }): void {
  const root = secureRoot(stateDir);
  const existing = readStopIntent(root, dataRoot);
  if (existing && (existing.grant_id !== input.grantId || existing.scope.class_id !== input.scope.classId
    || existing.scope.subject !== input.scope.subject)) fail();
  const value: StoredStopIntent = { version: 1, data_root_hash: dataRootHash(dataRoot),
    scope: { class_id: input.scope.classId, subject: input.scope.subject }, grant_id: input.grantId, updated_at: now };
  if (!validStopIntent(value)) fail();
  const file = path.join(root, STOP_FILE_NAME);
  const temporary = path.join(root, `.edupi-proactivity-stop.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    if (fs.writeSync(descriptor, bytes) !== bytes.length) fail();
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, file);
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
    syncStateDirectory(root);
    if (JSON.stringify(readStopIntent(root, dataRoot)) !== JSON.stringify(value)) fail();
  } catch { fail(); }
  finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* cleanup */ }
    try { fs.unlinkSync(temporary); } catch { /* owned temporary remains visible */ }
  }
}

export function clearEduPiProactivityStopIntent({ stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot, grantId }:
  { stateDir?: string; dataRoot: string; grantId: string }): void {
  const root = secureRoot(stateDir);
  const existing = readStopIntent(root, dataRoot);
  if (!existing) return;
  if (existing.grant_id !== grantId) fail();
  try {
    fs.unlinkSync(path.join(root, STOP_FILE_NAME));
    syncStateDirectory(root);
    if (readStopIntent(root, dataRoot) !== null) fail();
  } catch { fail(); }
}

function publicActivation(value: StoredConfig, source: EduPiProactivityActivation["source"]): EduPiProactivityActivation {
  return {
    enabled: value.enabled,
    source,
    configurationStatus: "ready",
    scope: value.scope ? { classId: value.scope.class_id, subject: value.scope.subject } : null,
    grantId: value.grant_id,
    updatedAt: value.updated_at,
  };
}

export function readEduPiProactivityActivation({
  stateDir = process.env.PI_DESKTOP_STATE_DIR,
  dataRoot,
  env = process.env,
}: { stateDir?: string; dataRoot: string; env?: Record<string, string | undefined> }): EduPiProactivityActivation {
  const stop = readStopIntent(stateDir, dataRoot);
  if (stop) return { enabled: false, source: "desktop_canary", configurationStatus: "stop_pending",
    scope: { classId: stop.scope.class_id, subject: stop.scope.subject }, grantId: stop.grant_id,
    updatedAt: stop.updated_at };
  const stored = readStored(stateDir);
  let rootHash: string | null = null;
  try { rootHash = dataRootHash(dataRoot); } catch { /* fail closed below */ }
  const matches = stored.status === "ready" && stored.value?.data_root_hash === rootHash;
  const base: EduPiProactivityActivation = matches && stored.value
    ? stored.value.version === 1
      ? { ...publicActivation(stored.value, "desktop_canary"), enabled: false, configurationStatus: "legacy" }
      : publicActivation(stored.value, "desktop_canary")
    : { enabled: false, source: "default", configurationStatus: stored.status === "ready" ? "mismatched" : stored.status,
      scope: null, grantId: null, updatedAt: null };
  return env.EDUPI_AMBIENT_PLANNING === "1" ? { ...base, enabled: true, source: "environment" } : base;
}

export function writeEduPiProactivityConfig(
  input: { enabled: boolean; scope: EduPiProactivityScope | null; grantId: string | null },
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot, now = new Date().toISOString() }:
    { stateDir?: string; dataRoot: string; now?: string },
): EduPiProactivityActivation {
  let canonicalNow: string;
  try { canonicalNow = new Date(now).toISOString(); } catch { fail(); }
  if (typeof input.enabled !== "boolean" || canonicalNow !== now || input.enabled && input.scope === null
    || (input.scope === null) !== (input.grantId === null)
    || input.scope !== null && (!ID.test(input.scope.classId) || !validSubject(input.scope.subject))
    || input.grantId !== null && !ID.test(input.grantId)) fail();
  const root = secureRoot(stateDir);
  const value: StoredConfig = {
    version: 2,
    data_root_hash: dataRootHash(dataRoot),
    enabled: input.enabled,
    scope: input.scope ? { class_id: input.scope.classId, subject: input.scope.subject.trim() } : null,
    grant_id: input.grantId,
    updated_at: canonicalNow,
  };
  if (!validStored(value)) fail();
  const file = path.join(root, FILE_NAME);
  const temporary = path.join(root, `.edupi-proactivity.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (fs.writeSync(descriptor, bytes) !== bytes.length) fail();
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    try {
      const target = fs.lstatSync(file);
      if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 1) fail();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    fs.renameSync(temporary, file);
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
    syncStateDirectory(root);
    const committed = readStored(root);
    if (committed.status !== "ready" || JSON.stringify(committed.value) !== JSON.stringify(value)) fail();
  } catch { fail(); }
  finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* cleanup */ }
    try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { /* owned temp remains visible */ } }
  }
  return publicActivation(value, "desktop_canary");
}
