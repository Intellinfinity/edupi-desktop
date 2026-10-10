import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DIRECTORY = "edupi-prompt-intent-v1";
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const MAX_BYTES = 1_200_000;
const MAX_ENTRIES = 10_000;
const RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u;
const REQUEST_ID = /^[0-9a-f-]{36}$/iu;
const FILE = /^[a-f0-9]{64}\.intent$/u;

export type EduPiPromptIntent = {
  sessionId: string;
  clientRequestId: string;
  occurredAt: string;
  message: string;
  draftValue: string;
  cwd: string;
};
type StoredIntent = EduPiPromptIntent & { version: 1; dataRootHash: string; requestDigest: string;
  status: "pending" | "resolved" | "discarded" };
export type EduPiPromptIntentOptions = { stateDir?: string; dataRoot: string };

function fail(): never { throw new Error("prompt_intent_unavailable"); }

function digest(input: EduPiPromptIntent): string {
  return crypto.createHash("sha256").update(JSON.stringify({ sessionId: input.sessionId,
    clientRequestId: input.clientRequestId, occurredAt: input.occurredAt,
    message: input.message, draftValue: input.draftValue, cwd: input.cwd })).digest("hex");
}

function valid(value: unknown, rootHash: string): value is StoredIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ["version", "dataRootHash", "requestDigest", "status", "sessionId", "clientRequestId", "occurredAt", "message", "draftValue", "cwd"];
  return Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key))
    && row.version === 1 && row.dataRootHash === rootHash && /^[a-f0-9]{64}$/u.test(String(row.requestDigest))
    && ["pending", "resolved", "discarded"].includes(String(row.status))
    && ID.test(String(row.sessionId)) && REQUEST_ID.test(String(row.clientRequestId))
    && typeof row.occurredAt === "string" && Number.isFinite(Date.parse(row.occurredAt))
    && new Date(row.occurredAt).toISOString() === row.occurredAt
    && typeof row.message === "string" && row.message.length <= 500_000
    && typeof row.draftValue === "string" && row.draftValue.length <= 500_000
    && (row.status !== "pending" || row.message.length > 0)
    && (row.status !== "pending" || row.requestDigest === digest(row as EduPiPromptIntent))
    && typeof row.cwd === "string" && path.isAbsolute(row.cwd) && row.cwd.length <= 1024
    && !row.cwd.includes("\0");
}

function privateDir(directory: string, root = false): string {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32"
    && ((stat.mode & (root ? 0o022 : 0o077)) !== 0
      || typeof process.getuid === "function" && stat.uid !== process.getuid())) fail();
  return fs.realpathSync(directory);
}

function context(options: EduPiPromptIntentOptions): { dir: string; hash: string } {
  const stateDir = options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR;
  if (!stateDir || !path.isAbsolute(stateDir) || !path.isAbsolute(options.dataRoot)) fail();
  try {
    const state = privateDir(stateDir, true);
    const dataRoot = fs.realpathSync(options.dataRoot);
    if (!fs.lstatSync(dataRoot).isDirectory()) fail();
    const hash = crypto.createHash("sha256").update(dataRoot).digest("hex");
    const parent = path.join(state, DIRECTORY);
    const dir = path.join(parent, hash);
    for (const item of [parent, dir]) {
      try { fs.mkdirSync(item, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      if (privateDir(item) !== item) fail();
    }
    return { dir, hash: `sha256:${hash}` };
  } catch { fail(); }
}

function fileFor(dir: string, sessionId: string, clientRequestId: string): string {
  if (!ID.test(sessionId) || !REQUEST_ID.test(clientRequestId)) fail();
  const name = crypto.createHash("sha256").update(`${sessionId}\0${clientRequestId}`).digest("hex");
  return path.join(dir, `${name}.intent`);
}

function readFile(file: string, hash: string): StoredIntent | null {
  let descriptor: number | undefined;
  try {
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > MAX_BYTES
      || process.platform !== "win32" && ((before.mode & 0o077) !== 0
        || typeof process.getuid === "function" && before.uid !== process.getuid())) fail();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || fs.realpathSync(file) !== file) fail();
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (!valid(parsed, hash)) fail();
    return parsed;
  } catch { fail(); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  return fail();
}

function syncDir(dir: string): void {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(dir, fs.constants.O_RDONLY | NOFOLLOW);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function writeAtomic(file: string, value: StoredIntent, replace: boolean): void {
  const dir = path.dirname(file);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.length > MAX_BYTES) fail();
  const temporary = path.join(dir, `.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    if (replace) fs.renameSync(temporary, file);
    else fs.linkSync(temporary, file);
    syncDir(dir);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* owned temporary */ }
  }
}

/** Cross-WebView-origin first-send journal, committed before any Core or Pi effect. */
export function prepareEduPiPromptIntent(input: EduPiPromptIntent, options: EduPiPromptIntentOptions): StoredIntent {
  const { dir, hash } = context(options);
  const candidate: StoredIntent = { version: 1, dataRootHash: hash, requestDigest: digest(input), status: "pending", ...input };
  if (!valid(candidate, hash)) fail();
  const file = fileFor(dir, input.sessionId, input.clientRequestId);
  const prior = readFile(file, hash);
  if (prior) {
    if (prior.status !== "pending") {
      if (prior.requestDigest !== candidate.requestDigest || prior.cwd !== candidate.cwd
        || prior.occurredAt !== candidate.occurredAt) fail();
      return prior; // ID is spent; never replay a terminal prompt.
    }
    if (JSON.stringify({ ...prior, status: "pending" }) !== JSON.stringify(candidate)) fail();
    return prior;
  }
  let names = fs.readdirSync(dir).filter(name => FILE.test(name));
  if (names.length >= MAX_ENTRIES) {
    const cutoff = Date.now() - RESOLVED_RETENTION_MS;
    for (const name of names) {
      const old = readFile(path.join(dir, name), hash);
      if (old?.status === "pending" || !old || Date.parse(old.occurredAt) >= cutoff) continue;
      fs.unlinkSync(path.join(dir, name));
    }
    syncDir(dir);
    names = fs.readdirSync(dir).filter(name => FILE.test(name));
    if (names.length >= MAX_ENTRIES) fail();
  }
  try { writeAtomic(file, candidate, false); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") fail();
    const concurrent = readFile(file, hash);
    if (!concurrent || JSON.stringify({ ...concurrent, status: "pending" }) !== JSON.stringify(candidate)) fail();
    return concurrent;
  }
  return candidate;
}

export function readEduPiPromptIntent(sessionId: string, clientRequestId: string,
  options: EduPiPromptIntentOptions): StoredIntent | null {
  const { dir, hash } = context(options);
  const file = fileFor(dir, sessionId, clientRequestId);
  const saved = readFile(file, hash);
  if (saved && (saved.sessionId !== sessionId || saved.clientRequestId !== clientRequestId)) fail();
  return saved;
}

export function listEduPiPromptIntents(options: EduPiPromptIntentOptions): StoredIntent[] {
  const { dir, hash } = context(options);
  return fs.readdirSync(dir).filter(name => FILE.test(name)).map(name => {
    const file = path.join(dir, name);
    const saved = readFile(file, hash);
    if (!saved || fileFor(dir, saved.sessionId, saved.clientRequestId) !== file) fail();
    return saved;
  }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export function resolveEduPiPromptIntent(sessionId: string, clientRequestId: string,
  options: EduPiPromptIntentOptions): StoredIntent {
  const { dir, hash } = context(options);
  const file = fileFor(dir, sessionId, clientRequestId);
  const saved = readFile(file, hash);
  if (!saved || saved.sessionId !== sessionId || saved.clientRequestId !== clientRequestId) fail();
  if (saved.status !== "pending") return saved;
  const next = { ...saved, status: "resolved" as const, message: "", draftValue: "" };
  writeAtomic(file, next, true);
  return next;
}

/** Separate, explicit teacher decision when no Core outbox exists and Pi delivery is unknown. */
export function discardEduPiPromptIntent(sessionId: string, clientRequestId: string,
  options: EduPiPromptIntentOptions): StoredIntent {
  const { dir, hash } = context(options);
  const file = fileFor(dir, sessionId, clientRequestId);
  const saved = readFile(file, hash);
  if (!saved || saved.sessionId !== sessionId || saved.clientRequestId !== clientRequestId) fail();
  if (saved.status !== "pending") return saved;
  const next = { ...saved, status: "discarded" as const, message: "", draftValue: "" };
  writeAtomic(file, next, true);
  return next;
}
