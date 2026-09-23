import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FILE_NAME = "edupi-ambient-message-ledger.json";
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u;
const MESSAGE_REF = /^owner_message:[a-f0-9]{64}$/u;
const MAX_ENTRIES = 4096;
const MAX_BYTES = 4 * 1024 * 1024;

export type EduPiAmbientMessageBinding = {
  sessionId: string;
  messageId: string;
  messageRef: string;
  ownerId: string;
  grantId: string;
  captureGrantVersion: number;
  occurredAt: string;
  status: "pending" | "captured" | "withdrawn" | "abandoned";
  withdrawnAt: string | null;
};

type StoredEntry = {
  session_id: string;
  message_id: string;
  message_ref: string;
  owner_id: string;
  grant_id: string;
  capture_grant_version: number;
  occurred_at: string;
  status: "pending" | "captured" | "withdrawn" | "abandoned";
  withdrawn_at: string | null;
};

type StoredLedger = { version: 1; data_root_hash: string; revision: number; entries: StoredEntry[] };

export class EduPiAmbientMessageLedgerError extends Error {
  readonly code = "ambient_message_ledger_unavailable";
  constructor() { super("EduPi ambient message ledger unavailable."); this.name = "EduPiAmbientMessageLedgerError"; }
}

function fail(): never { throw new EduPiAmbientMessageLedgerError(); }

function canonicalTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function validEntry(value: unknown): value is StoredEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const keys = ["session_id", "message_id", "message_ref", "owner_id", "grant_id", "capture_grant_version", "occurred_at", "status", "withdrawn_at"];
  return Object.keys(item).length === keys.length && Object.keys(item).every((key) => keys.includes(key))
    && ID.test(String(item.session_id || "")) && ID.test(String(item.message_id || ""))
    && MESSAGE_REF.test(String(item.message_ref || "")) && ID.test(String(item.owner_id || "")) && ID.test(String(item.grant_id || ""))
    && Number.isSafeInteger(item.capture_grant_version) && Number(item.capture_grant_version) > 0
    && canonicalTime(item.occurred_at) && ["pending", "captured", "withdrawn", "abandoned"].includes(String(item.status))
    && (["pending", "captured"].includes(String(item.status)) && item.withdrawn_at === null
      || ["withdrawn", "abandoned"].includes(String(item.status)) && canonicalTime(item.withdrawn_at));
}

function validLedger(value: unknown): value is StoredLedger {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ledger = value as Record<string, unknown>;
  if (Object.keys(ledger).length !== 4 || !["version", "data_root_hash", "revision", "entries"].every((key) => Object.hasOwn(ledger, key))
    || ledger.version !== 1 || !HASH.test(String(ledger.data_root_hash || ""))
    || !Number.isSafeInteger(ledger.revision) || Number(ledger.revision) < 0
    || !Array.isArray(ledger.entries) || ledger.entries.length > MAX_ENTRIES || !ledger.entries.every(validEntry)) return false;
  const keys = new Set<string>(), refs = new Set<string>();
  for (const entry of ledger.entries as StoredEntry[]) {
    const key = `${entry.session_id}\0${entry.message_id}`;
    if (keys.has(key) || refs.has(entry.message_ref)) return false;
    keys.add(key); refs.add(entry.message_ref);
  }
  return true;
}

function secureStateRoot(stateDir: string | undefined): string {
  if (!stateDir || !path.isAbsolute(stateDir)) fail();
  const before = fs.lstatSync(stateDir);
  if (!before.isDirectory() || before.isSymbolicLink()) fail();
  const root = fs.realpathSync(stateDir);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 0o022) !== 0
    || typeof process.getuid === "function" && stat.uid !== process.getuid())) fail();
  return root;
}

function rootHash(dataRoot: string): string {
  if (!path.isAbsolute(dataRoot)) fail();
  const root = fs.realpathSync(dataRoot);
  if (!fs.lstatSync(root).isDirectory()) fail();
  return `sha256:${crypto.createHash("sha256").update(root, "utf8").digest("hex")}`;
}

function empty(hash: string): StoredLedger { return { version: 1, data_root_hash: hash, revision: 0, entries: [] }; }

function readLedger(stateDir: string | undefined, dataRoot: string): { root: string; value: StoredLedger } {
  const root = secureStateRoot(stateDir);
  const hash = rootHash(dataRoot);
  const file = path.join(root, FILE_NAME);
  let descriptor: number | undefined;
  try {
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { root, value: empty(hash) };
      fail();
    }
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > MAX_BYTES
      || process.platform !== "win32" && ((before.mode & 0o077) !== 0
        || typeof process.getuid === "function" && before.uid !== process.getuid())) fail();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || fs.realpathSync(file) !== file) fail();
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail(); }
    if (!validLedger(parsed) || parsed.data_root_hash !== hash) fail();
    return { root, value: parsed };
  } catch { fail(); }
  finally { if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* read-only cleanup */ } }
  return fail();
}

function writeLedger(root: string, value: StoredLedger): void {
  if (!validLedger(value)) fail();
  const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (content.length > MAX_BYTES) fail();
  const file = path.join(root, FILE_NAME);
  const temporary = path.join(root, `.edupi-ambient-message-ledger.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    if (fs.writeSync(descriptor, content) !== content.length) fail();
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    try {
      const target = fs.lstatSync(file);
      if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 1) fail();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    fs.renameSync(temporary, file);
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
    try {
      const directory = fs.openSync(root, fs.constants.O_RDONLY);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch { /* Windows and some filesystems do not fsync directories. */ }
  } catch { fail(); }
  finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* cleanup */ }
    try { fs.unlinkSync(temporary); } catch { /* owned temporary is non-authoritative */ }
  }
}

function publicEntry(entry: StoredEntry): EduPiAmbientMessageBinding {
  return { sessionId: entry.session_id, messageId: entry.message_id, messageRef: entry.message_ref,
    ownerId: entry.owner_id, grantId: entry.grant_id, captureGrantVersion: entry.capture_grant_version,
    occurredAt: entry.occurred_at, status: entry.status, withdrawnAt: entry.withdrawn_at };
}

export function prepareEduPiAmbientMessageBinding(input: Omit<EduPiAmbientMessageBinding, "status" | "withdrawnAt">,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  const candidate: StoredEntry = { session_id: input.sessionId, message_id: input.messageId, message_ref: input.messageRef,
    owner_id: input.ownerId, grant_id: input.grantId, capture_grant_version: input.captureGrantVersion,
    occurred_at: input.occurredAt, status: "pending", withdrawn_at: null };
  if (!validEntry(candidate)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = value.entries.find((entry) => entry.session_id === candidate.session_id && entry.message_id === candidate.message_id);
  if (prior) {
    if (JSON.stringify({ ...prior, status: "pending", withdrawn_at: null }) !== JSON.stringify(candidate)) fail();
    return publicEntry(prior);
  }
  if (value.entries.some((entry) => entry.message_ref === candidate.message_ref)) fail();
  let retained = value.entries;
  if (retained.length >= MAX_ENTRIES) {
    const oldestWithdrawn = retained.filter((entry) => ["withdrawn", "abandoned"].includes(entry.status))
      .sort((left, right) => String(left.withdrawn_at).localeCompare(String(right.withdrawn_at)))[0];
    if (!oldestWithdrawn) fail();
    retained = retained.filter((entry) => entry !== oldestWithdrawn);
  }
  const next = { ...value, revision: value.revision + 1, entries: [...retained, candidate]
    .sort((left, right) => `${left.session_id}\0${left.message_id}`.localeCompare(`${right.session_id}\0${right.message_id}`)) };
  writeLedger(root, next);
  return publicEntry(candidate);
}

export function confirmEduPiAmbientMessageBinding(sessionId: string, messageId: string, messageRef: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  if (!ID.test(sessionId) || !ID.test(messageId) || !MESSAGE_REF.test(messageRef)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = value.entries.find((entry) => entry.session_id === sessionId && entry.message_id === messageId && entry.message_ref === messageRef);
  if (!prior || ["withdrawn", "abandoned"].includes(prior.status)) fail();
  if (prior.status === "captured") return publicEntry(prior);
  const updated: StoredEntry = { ...prior, status: "captured" };
  writeLedger(root, { ...value, revision: value.revision + 1,
    entries: value.entries.map((entry) => entry === prior ? updated : entry) });
  return publicEntry(updated);
}

export function recordEduPiAmbientMessageBinding(input: Omit<EduPiAmbientMessageBinding, "status" | "withdrawnAt">,
  options: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  const pending = prepareEduPiAmbientMessageBinding(input, options);
  return pending.status === "pending" ? confirmEduPiAmbientMessageBinding(input.sessionId, input.messageId, input.messageRef, options) : pending;
}

export function readCapturedEduPiAmbientMessages(sessionId: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding[] {
  if (!ID.test(sessionId)) fail();
  return readLedger(stateDir, dataRoot).value.entries.filter((entry) => entry.session_id === sessionId && entry.status === "captured").map(publicEntry);
}

export function readWithdrawableEduPiAmbientMessages(sessionId: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding[] {
  if (!ID.test(sessionId)) fail();
  return readLedger(stateDir, dataRoot).value.entries.filter((entry) => entry.session_id === sessionId
    && ["pending", "captured"].includes(entry.status)).map(publicEntry);
}

export function markEduPiAmbientMessageWithdrawn(sessionId: string, messageRef: string, withdrawnAt: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  if (!ID.test(sessionId) || !MESSAGE_REF.test(messageRef) || !canonicalTime(withdrawnAt)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = value.entries.find((entry) => entry.session_id === sessionId && entry.message_ref === messageRef);
  if (!prior) fail();
  if (prior.status === "withdrawn") return publicEntry(prior);
  const updated: StoredEntry = { ...prior, status: "withdrawn", withdrawn_at: withdrawnAt };
  const next = { ...value, revision: value.revision + 1,
    entries: value.entries.map((entry) => entry === prior ? updated : entry) };
  writeLedger(root, next);
  return publicEntry(updated);
}

export function markEduPiAmbientMessageAbandoned(sessionId: string, messageRef: string, abandonedAt: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  if (!ID.test(sessionId) || !MESSAGE_REF.test(messageRef) || !canonicalTime(abandonedAt)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = value.entries.find((entry) => entry.session_id === sessionId && entry.message_ref === messageRef);
  if (!prior || prior.status !== "pending") fail();
  const updated: StoredEntry = { ...prior, status: "abandoned", withdrawn_at: abandonedAt };
  writeLedger(root, { ...value, revision: value.revision + 1,
    entries: value.entries.map((entry) => entry === prior ? updated : entry) });
  return publicEntry(updated);
}
