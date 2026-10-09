import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EduPiProactivityDomain } from "./edupi-proactivity-config";

const FILE_NAME = "edupi-ambient-message-ledger.json";
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u;
const MESSAGE_REF = /^owner_message:[a-f0-9]{64}$/u;
const MAX_ENTRIES = 4096;
const MAX_PLANS = 4096;
const MAX_BYTES = 4 * 1024 * 1024;
const DOMAINS: EduPiProactivityDomain[] = ["teaching_preparation", "student_followup", "calendar_administration",
  "lesson_reflection", "parent_communication"];

export type EduPiAmbientMessageBinding = {
  sessionId: string;
  messageId: string;
  messageRef: string;
  ownerId: string;
  grantId: string;
  captureGrantVersion: number;
  occurredAt: string;
  status: "pending" | "captured" | "outcome_unknown" | "settled" | "withdrawn" | "abandoned" | "sealed_absent";
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
  status: "pending" | "captured" | "outcome_unknown" | "settled" | "withdrawn" | "abandoned" | "sealed_absent";
  withdrawn_at: string | null;
};

export type EduPiAmbientMessagePlan = { sessionId: string; messageId: string; occurredAt: string;
  status: "pending" | "complete" | "cancelled"; acknowledged: boolean;
  domains: Array<{ domain: EduPiProactivityDomain; grantId: string; scopeHash: string;
    state: "unattempted" | "unknown" | "unavailable" | "terminal" | "sealed_absent"; messageRef: string | null }> };
type StoredPlanDomain = { domain: EduPiProactivityDomain; grant_id: string; scope_hash: string;
  state: EduPiAmbientMessagePlan["domains"][number]["state"]; message_ref: string | null };
type StoredPlan = { session_id: string; message_id: string; occurred_at: string;
  status: "pending" | "complete" | "cancelled"; acknowledged: boolean; domains: StoredPlanDomain[] };
type StoredLedger = { version: 2 | 3; data_root_hash: string; revision: number; entries: StoredEntry[]; plans: StoredPlan[] };
type LegacyLedger = Omit<StoredLedger, "version" | "plans"> & { version: 1 };

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
    && canonicalTime(item.occurred_at) && ["pending", "captured", "outcome_unknown", "settled", "withdrawn", "abandoned", "sealed_absent"].includes(String(item.status))
    && (["pending", "captured", "outcome_unknown", "settled", "sealed_absent"].includes(String(item.status)) && item.withdrawn_at === null
      || ["withdrawn", "abandoned"].includes(String(item.status)) && canonicalTime(item.withdrawn_at));
}

function validPlan(value: unknown): value is StoredPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (Object.keys(plan).length !== 6 || !["session_id", "message_id", "occurred_at", "status", "acknowledged", "domains"]
    .every(key => Object.hasOwn(plan, key)) || !ID.test(String(plan.session_id || ""))
    || !ID.test(String(plan.message_id || "")) || !canonicalTime(plan.occurred_at)
    || !["pending", "complete", "cancelled"].includes(String(plan.status)) || typeof plan.acknowledged !== "boolean"
    || plan.acknowledged && !["complete", "cancelled"].includes(String(plan.status)) || !Array.isArray(plan.domains)
    || plan.domains.length < 1 || plan.domains.length > DOMAINS.length) return false;
  const seen = new Set<string>();
  for (const raw of plan.domains) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).length !== 5 || !["domain", "grant_id", "scope_hash", "state", "message_ref"]
      .every(key => Object.hasOwn(item, key)) || !DOMAINS.includes(item.domain as EduPiProactivityDomain)
      || seen.has(String(item.domain)) || !ID.test(String(item.grant_id || ""))
      || !HASH.test(String(item.scope_hash || ""))
      || !["unattempted", "unknown", "unavailable", "terminal", "sealed_absent"].includes(String(item.state))
      || ["terminal", "sealed_absent"].includes(String(item.state)) && !MESSAGE_REF.test(String(item.message_ref || ""))
      || !["terminal", "sealed_absent"].includes(String(item.state)) && item.message_ref !== null) return false;
    seen.add(String(item.domain));
  }
  return (plan.status === "complete") === plan.domains.every(item => ["terminal", "sealed_absent"].includes(item.state))
    && (plan.status !== "cancelled" || plan.domains.every(item => item.state === "unattempted"));
}

function validLedger(value: unknown): value is StoredLedger | LegacyLedger {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ledger = value as Record<string, unknown>;
  if (ledger.version !== 1 && ledger.version !== 2 && ledger.version !== 3
    || Object.keys(ledger).length !== (ledger.version === 1 ? 4 : 5)
    || !["version", "data_root_hash", "revision", "entries", ...(ledger.version === 1 ? [] : ["plans"])]
      .every((key) => Object.hasOwn(ledger, key))
    || !HASH.test(String(ledger.data_root_hash || ""))
    || !Number.isSafeInteger(ledger.revision) || Number(ledger.revision) < 0
    || !Array.isArray(ledger.entries) || ledger.entries.length > MAX_ENTRIES || !ledger.entries.every(validEntry)
    || ledger.version !== 1 && (!Array.isArray(ledger.plans) || ledger.plans.length > MAX_PLANS
      || !ledger.plans.every(validPlan))) return false;
  if (ledger.version !== 3 && ((ledger.entries as StoredEntry[]).some(entry => entry.status === "sealed_absent")
    || ledger.version === 2 && (ledger.plans as StoredPlan[]).some(plan => plan.domains.some(domain =>
      domain.state === "sealed_absent")))) return false;
  const keys = new Map<string, { occurredAt: string; ownerId: string }>(), refs = new Set<string>();
  for (const entry of ledger.entries as StoredEntry[]) {
    const key = `${entry.session_id}\0${entry.message_id}`;
    const prior = keys.get(key);
    if (prior && (prior.occurredAt !== entry.occurred_at || prior.ownerId !== entry.owner_id)
      || refs.has(entry.message_ref)) return false;
    keys.set(key, { occurredAt: entry.occurred_at, ownerId: entry.owner_id });
    refs.add(entry.message_ref);
  }
  if (ledger.version !== 1) {
    const planKeys = new Set<string>();
    for (const plan of ledger.plans as StoredPlan[]) {
      const key = `${plan.session_id}\0${plan.message_id}`;
      if (planKeys.has(key)) return false;
      planKeys.add(key);
      const matching = (ledger.entries as StoredEntry[]).filter(entry => entry.session_id === plan.session_id
        && entry.message_id === plan.message_id);
      if (matching.some(entry => entry.occurred_at !== plan.occurred_at)) return false;
      if (plan.status === "cancelled" && matching.length !== 0) return false;
      for (const domain of plan.domains) {
        if (!["terminal", "sealed_absent"].includes(domain.state)) continue;
        const receipt = matching.find(entry => entry.message_ref === domain.message_ref);
        if (!receipt || receipt.grant_id !== domain.grant_id
          || domain.state === "terminal" && !["settled", "withdrawn"].includes(receipt.status)
          || domain.state === "sealed_absent" && receipt.status !== "sealed_absent") return false;
      }
    }
    if ((ledger.entries as StoredEntry[]).some(entry => entry.status === "sealed_absent" && !(ledger.plans as StoredPlan[])
      .some(plan => plan.session_id === entry.session_id && plan.message_id === entry.message_id
        && plan.domains.some(domain => domain.state === "sealed_absent" && domain.message_ref === entry.message_ref)))) return false;
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

function empty(hash: string): StoredLedger { return { version: 2, data_root_hash: hash, revision: 0, entries: [], plans: [] }; }

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
    return { root, value: parsed.version === 1 ? { ...parsed, version: 2, plans: [] } : parsed };
  } catch { fail(); }
  finally { if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* read-only cleanup */ } }
  return fail();
}

function writeLedger(root: string, value: StoredLedger): void {
  let candidate = value;
  let content = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  while (candidate.entries.length > MAX_ENTRIES || candidate.plans.length > MAX_PLANS || content.length > MAX_BYTES) {
    // A native outbox ACK is the only evidence that a completed message no longer
    // needs a server receipt for cold-start reconciliation.
    const retired = candidate.plans.find(plan => ["complete", "cancelled"].includes(plan.status) && plan.acknowledged);
    if (!retired) fail();
    candidate = { ...candidate, plans: candidate.plans.filter(plan => plan !== retired),
      entries: candidate.entries.filter(entry => entry.session_id !== retired.session_id || entry.message_id !== retired.message_id) };
    content = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  }
  if (!validLedger(candidate)) fail();
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

function publicPlan(plan: StoredPlan): EduPiAmbientMessagePlan {
  return { sessionId: plan.session_id, messageId: plan.message_id, occurredAt: plan.occurred_at,
    status: plan.status, acknowledged: plan.acknowledged,
    domains: plan.domains.map(domain => ({ domain: domain.domain, grantId: domain.grant_id,
      scopeHash: domain.scope_hash, state: domain.state, messageRef: domain.message_ref })) };
}

function findPlan(value: StoredLedger, sessionId: string, messageId: string): StoredPlan | undefined {
  return value.plans.find(plan => plan.session_id === sessionId && plan.message_id === messageId);
}

export function armEduPiAmbientMessagePlan(input: { sessionId: string; messageId: string; occurredAt: string;
  domains: Array<{ domain: EduPiProactivityDomain; grantId: string; scopeHash: string }> },
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessagePlan {
  const candidate: StoredPlan = { session_id: input.sessionId, message_id: input.messageId, occurred_at: input.occurredAt,
    status: "pending", acknowledged: false,
    domains: input.domains.map(item => ({ domain: item.domain, grant_id: item.grantId, scope_hash: item.scopeHash,
      state: "unattempted", message_ref: null })) };
  if (!validPlan(candidate)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = findPlan(value, input.sessionId, input.messageId);
  if (prior) {
    if (prior.occurred_at !== candidate.occurred_at
      || JSON.stringify(prior.domains.map(({ domain, grant_id, scope_hash }) => ({ domain, grant_id, scope_hash })))
        !== JSON.stringify(candidate.domains.map(({ domain, grant_id, scope_hash }) => ({ domain, grant_id, scope_hash })))) fail();
    return publicPlan(prior);
  }
  // A legacy receipt has no durable expected-domain set. Never retrofit a new
  // plan over it and accidentally treat missing domains as completed.
  if (value.entries.some(entry => entry.session_id === input.sessionId && entry.message_id === input.messageId)) fail();
  writeLedger(root, { ...value, revision: value.revision + 1, plans: [...value.plans, candidate] });
  return publicPlan(candidate);
}

export function readEduPiAmbientMessagePlan(sessionId: string, messageId: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessagePlan | null {
  if (!ID.test(sessionId) || !ID.test(messageId)) fail();
  const plan = findPlan(readLedger(stateDir, dataRoot).value, sessionId, messageId);
  return plan ? publicPlan(plan) : null;
}

export function readPendingEduPiAmbientMessages(sessionId: string,
  options: { stateDir?: string; dataRoot: string }): Array<{ messageId: string; occurredAt: string;
    nonBlocking: boolean; partiallyHandled: boolean; unprocessed: boolean }> {
  if (!ID.test(sessionId)) fail();
  const value = readLedger(options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR, options.dataRoot).value;
  const pending = value.plans.filter(plan => plan.session_id === sessionId && plan.status === "pending")
    .map(plan => ({ messageId: plan.message_id, occurredAt: plan.occurred_at,
      nonBlocking: plan.domains.some(item => item.state === "unavailable")
        && plan.domains.every(item => item.state !== "unknown"),
      partiallyHandled: plan.domains.some(item => item.state === "terminal")
        && plan.domains.every(item => item.state !== "unknown"),
      unprocessed: plan.domains.some(item => item.state === "unavailable")
        && plan.domains.every(item => item.state !== "terminal" && item.state !== "unknown") }));
  const plannedIds = new Set(value.plans.filter(plan => plan.session_id === sessionId).map(plan => plan.message_id));
  const pendingIds = new Set(pending.map(item => item.messageId));
  for (const entry of value.entries.filter(item => item.session_id === sessionId
    && !plannedIds.has(item.message_id) && ["pending", "captured", "outcome_unknown", "abandoned"].includes(item.status))) {
    if (!pendingIds.has(entry.message_id)) {
      pending.push({ messageId: entry.message_id, occurredAt: entry.occurred_at,
        nonBlocking: false, partiallyHandled: false, unprocessed: false });
      pendingIds.add(entry.message_id);
    }
  }
  return pending;
}

export function readCompletedEduPiAmbientMessages(sessionId: string,
  options: { stateDir?: string; dataRoot: string }): Array<{ messageId: string; occurredAt: string }> {
  if (!ID.test(sessionId)) fail();
  return readLedger(options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR, options.dataRoot).value.plans
    .filter(plan => plan.session_id === sessionId && plan.status === "complete" && !plan.acknowledged)
    .map(plan => ({ messageId: plan.message_id, occurredAt: plan.occurred_at }));
}

export function readCancelledEduPiAmbientMessages(sessionId: string,
  options: { stateDir?: string; dataRoot: string }): Array<{ messageId: string; occurredAt: string }> {
  if (!ID.test(sessionId)) fail();
  return readLedger(options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR, options.dataRoot).value.plans
    .filter(plan => plan.session_id === sessionId && plan.status === "cancelled" && !plan.acknowledged)
    .map(plan => ({ messageId: plan.message_id, occurredAt: plan.occurred_at }));
}

export function readLegacySettledEduPiAmbientMessages(sessionId: string,
  options: { stateDir?: string; dataRoot: string }): Array<{ messageId: string; occurredAt: string }> {
  if (!ID.test(sessionId)) fail();
  const value = readLedger(options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR, options.dataRoot).value;
  const plannedIds = new Set(value.plans.filter(plan => plan.session_id === sessionId).map(plan => plan.message_id));
  return value.entries.filter(entry => entry.session_id === sessionId && entry.status === "settled"
    && !plannedIds.has(entry.message_id)).map(entry => ({ messageId: entry.message_id, occurredAt: entry.occurred_at }));
}

export function prepareEduPiAmbientPlanDomainBinding(
  input: Omit<EduPiAmbientMessageBinding, "status" | "withdrawnAt"> & { domain: EduPiProactivityDomain },
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  const candidate: StoredEntry = { session_id: input.sessionId, message_id: input.messageId, message_ref: input.messageRef,
    owner_id: input.ownerId, grant_id: input.grantId, capture_grant_version: input.captureGrantVersion,
    occurred_at: input.occurredAt, status: "pending", withdrawn_at: null };
  if (!validEntry(candidate)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const plan = findPlan(value, input.sessionId, input.messageId);
  const planned = plan?.domains.find(item => item.domain === input.domain);
  if (!plan || plan.status !== "pending" || plan.occurred_at !== input.occurredAt
    || !planned || planned.state !== "unattempted" || planned.grant_id !== input.grantId
    || value.entries.some(entry => entry.message_ref === input.messageRef
      || entry.session_id === input.sessionId && entry.message_id === input.messageId
        && (entry.occurred_at !== input.occurredAt || entry.owner_id !== input.ownerId))) fail();
  const updated: StoredPlan = { ...plan, domains: plan.domains.map(item => item === planned ? { ...item, state: "unknown" } : item) };
  writeLedger(root, { ...value, revision: value.revision + 1,
    plans: value.plans.map(item => item === plan ? updated : item),
    entries: [...value.entries, candidate].sort((left, right) => `${left.session_id}\0${left.message_id}\0${left.message_ref}`
      .localeCompare(`${right.session_id}\0${right.message_id}\0${right.message_ref}`)) });
  return publicEntry(candidate);
}

export function markEduPiAmbientPlanDomainUnavailable(sessionId: string, messageId: string, domain: EduPiProactivityDomain,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): void {
  const { root, value } = readLedger(stateDir, dataRoot);
  const plan = findPlan(value, sessionId, messageId);
  const planned = plan?.domains.find(item => item.domain === domain);
  if (!plan || plan.status !== "pending" || !planned || planned.state !== "unattempted") fail();
  const updated: StoredPlan = { ...plan, domains: plan.domains.map(item => item === planned ? { ...item, state: "unavailable" } : item) };
  writeLedger(root, { ...value, revision: value.revision + 1,
    plans: value.plans.map(item => item === plan ? updated : item) });
}

function finishPlanDomain(sessionId: string, messageId: string, domain: EduPiProactivityDomain,
  messageRef: string, stateDir: string | undefined, dataRoot: string,
  unstartedAsUnavailable: boolean): EduPiAmbientMessagePlan {
  if (!MESSAGE_REF.test(messageRef)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const plan = findPlan(value, sessionId, messageId);
  const planned = plan?.domains.find(item => item.domain === domain);
  const entry = value.entries.find(item => item.session_id === sessionId && item.message_id === messageId
    && item.message_ref === messageRef && item.grant_id === planned?.grant_id);
  if (!plan || plan.status !== "pending" || !planned || planned.state !== "unknown" || !entry
    || !["pending", "captured", "outcome_unknown", "settled"].includes(entry.status)) fail();
  const domains: StoredPlanDomain[] = plan.domains.map(item => item === planned
    ? { ...item, state: "terminal", message_ref: messageRef }
    : unstartedAsUnavailable && item.state === "unattempted" ? { ...item, state: "unavailable" } : item);
  const updated: StoredPlan = { ...plan, status: domains.every(item => ["terminal", "sealed_absent"].includes(item.state)) ? "complete" : "pending", domains };
  writeLedger(root, { ...value, revision: value.revision + 1,
    plans: value.plans.map(item => item === plan ? updated : item),
    entries: value.entries.map(item => item === entry ? { ...item, status: "settled" as const } : item) });
  return publicPlan(updated);
}

export function finishEduPiAmbientPlanDomain(sessionId: string, messageId: string, domain: EduPiProactivityDomain,
  messageRef: string, { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessagePlan {
  return finishPlanDomain(sessionId, messageId, domain, messageRef, stateDir, dataRoot, false);
}

export function finishEduPiAmbientPlanDomainCapturedNoAction(sessionId: string, messageId: string,
  domain: EduPiProactivityDomain, messageRef: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessagePlan {
  return finishPlanDomain(sessionId, messageId, domain, messageRef, stateDir, dataRoot, true);
}

export function sealEduPiAmbientPlanDomainAbsent(sessionId: string, messageId: string, domain: EduPiProactivityDomain,
  messageRef: string, { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessagePlan {
  if (!MESSAGE_REF.test(messageRef)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const plan = findPlan(value, sessionId, messageId);
  const planned = plan?.domains.find(item => item.domain === domain);
  const entry = value.entries.find(item => item.session_id === sessionId && item.message_id === messageId
    && item.message_ref === messageRef && item.grant_id === planned?.grant_id);
  if (!plan || plan.status !== "pending" || !planned || planned.state !== "unknown" || !entry
    || entry.occurred_at !== plan.occurred_at
    || !["pending", "captured", "outcome_unknown"].includes(entry.status)) fail();
  const domains: StoredPlanDomain[] = plan.domains.map(item => item === planned
    ? { ...item, state: "sealed_absent", message_ref: messageRef }
    : item.state === "unattempted" ? { ...item, state: "unavailable" } : item);
  const updated: StoredPlan = { ...plan,
    status: domains.every(item => ["terminal", "sealed_absent"].includes(item.state)) ? "complete" : "pending", domains };
  writeLedger(root, { ...value, version: 3, revision: value.revision + 1,
    plans: value.plans.map(item => item === plan ? updated : item),
    entries: value.entries.map(item => item === entry ? { ...item, status: "sealed_absent" as const } : item) });
  return publicPlan(updated);
}

export function acknowledgeEduPiAmbientMessagePlan(sessionId: string, messageId: string, occurredAt: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): void {
  const { root, value } = readLedger(stateDir, dataRoot);
  const plan = findPlan(value, sessionId, messageId);
  if (!plan || plan.occurred_at !== occurredAt || !["complete", "cancelled"].includes(plan.status)) fail();
  if (plan.acknowledged) return;
  writeLedger(root, { ...value, revision: value.revision + 1,
    plans: value.plans.map(item => item === plan ? { ...item, acknowledged: true } : item) });
}

export function cancelEduPiAmbientMessagePlan(sessionId: string, messageId: string, occurredAt: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): void {
  const { root, value } = readLedger(stateDir, dataRoot);
  const plan = findPlan(value, sessionId, messageId);
  if (!plan || plan.occurred_at !== occurredAt) fail();
  if (plan.status === "cancelled") return;
  if (plan.status !== "pending"
    || plan.domains.some(item => item.state !== "unattempted")
    || value.entries.some(item => item.session_id === sessionId && item.message_id === messageId)) fail();
  writeLedger(root, { ...value, revision: value.revision + 1,
    plans: value.plans.map(item => item === plan ? { ...item, status: "cancelled" } : item) });
}

export function prepareEduPiAmbientMessageBinding(input: Omit<EduPiAmbientMessageBinding, "status" | "withdrawnAt">,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  const candidate: StoredEntry = { session_id: input.sessionId, message_id: input.messageId, message_ref: input.messageRef,
    owner_id: input.ownerId, grant_id: input.grantId, capture_grant_version: input.captureGrantVersion,
    occurred_at: input.occurredAt, status: "pending", withdrawn_at: null };
  if (!validEntry(candidate)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = value.entries.find((entry) => entry.session_id === candidate.session_id && entry.message_id === candidate.message_id
    && entry.message_ref === candidate.message_ref);
  if (prior) {
    if (JSON.stringify({ ...prior, status: "pending", withdrawn_at: null }) !== JSON.stringify(candidate)) fail();
    return publicEntry(prior);
  }
  if (value.entries.some((entry) => entry.session_id === candidate.session_id && entry.message_id === candidate.message_id
    && (entry.occurred_at !== candidate.occurred_at || entry.owner_id !== candidate.owner_id))) fail();
  if (value.entries.some((entry) => entry.message_ref === candidate.message_ref)) fail();
  const next = { ...value, revision: value.revision + 1, entries: [...value.entries, candidate]
    .sort((left, right) => `${left.session_id}\0${left.message_id}\0${left.message_ref}`
      .localeCompare(`${right.session_id}\0${right.message_id}\0${right.message_ref}`)) };
  writeLedger(root, next);
  return publicEntry(candidate);
}

export function confirmEduPiAmbientMessageBinding(sessionId: string, messageId: string, messageRef: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  if (!ID.test(sessionId) || !ID.test(messageId) || !MESSAGE_REF.test(messageRef)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = value.entries.find((entry) => entry.session_id === sessionId && entry.message_id === messageId && entry.message_ref === messageRef);
  if (!prior || ["withdrawn", "abandoned", "sealed_absent"].includes(prior.status)) fail();
  if (prior.status === "captured" || prior.status === "outcome_unknown" || prior.status === "settled") return publicEntry(prior);
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
    && ["pending", "captured", "outcome_unknown", "settled", "abandoned"].includes(entry.status)).map(publicEntry);
}

export function readUnsettledEduPiAmbientMessages(sessionId: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding[] {
  if (!ID.test(sessionId)) fail();
  return readLedger(stateDir, dataRoot).value.entries.filter((entry) => entry.session_id === sessionId
    && ["pending", "captured", "outcome_unknown"].includes(entry.status)).map(publicEntry);
}

export function readSettledEduPiAmbientMessages(sessionId: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding[] {
  if (!ID.test(sessionId)) fail();
  return readLedger(stateDir, dataRoot).value.entries.filter((entry) => entry.session_id === sessionId
    && entry.status === "settled").map(publicEntry);
}

export function readUncertainEduPiAmbientMessages(sessionId: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding[] {
  if (!ID.test(sessionId)) fail();
  return readLedger(stateDir, dataRoot).value.entries.filter((entry) => entry.session_id === sessionId
    && entry.status === "outcome_unknown").map(publicEntry);
}

export function markEduPiAmbientMessageOutcomeUnknown(sessionId: string, messageRef: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  if (!ID.test(sessionId) || !MESSAGE_REF.test(messageRef)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = value.entries.find((entry) => entry.session_id === sessionId && entry.message_ref === messageRef);
  if (!prior || ["settled", "withdrawn", "abandoned", "sealed_absent"].includes(prior.status)) fail();
  if (prior.status === "outcome_unknown") return publicEntry(prior);
  const updated: StoredEntry = { ...prior, status: "outcome_unknown" };
  writeLedger(root, { ...value, revision: value.revision + 1,
    entries: value.entries.map((entry) => entry === prior ? updated : entry) });
  return publicEntry(updated);
}

export function markEduPiAmbientMessageOutcomeVerified(sessionId: string, messageRef: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  if (!ID.test(sessionId) || !MESSAGE_REF.test(messageRef)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = value.entries.find((entry) => entry.session_id === sessionId && entry.message_ref === messageRef);
  if (!prior || prior.status !== "outcome_unknown") fail();
  const updated: StoredEntry = { ...prior, status: "settled" };
  writeLedger(root, { ...value, revision: value.revision + 1,
    entries: value.entries.map((entry) => entry === prior ? updated : entry) });
  return publicEntry(updated);
}

export function markEduPiAmbientMessageOutcomeSettled(sessionId: string, messageRef: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  if (!ID.test(sessionId) || !MESSAGE_REF.test(messageRef)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = value.entries.find((entry) => entry.session_id === sessionId && entry.message_ref === messageRef);
  if (!prior || !["captured", "outcome_unknown", "settled"].includes(prior.status)) fail();
  if (prior.status === "settled") return publicEntry(prior);
  const updated: StoredEntry = { ...prior, status: "settled" };
  writeLedger(root, { ...value, revision: value.revision + 1,
    entries: value.entries.map((entry) => entry === prior ? updated : entry) });
  return publicEntry(updated);
}

export function markEduPiAmbientMessageWithdrawn(sessionId: string, messageRef: string, withdrawnAt: string,
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot }: { stateDir?: string; dataRoot: string }): EduPiAmbientMessageBinding {
  if (!ID.test(sessionId) || !MESSAGE_REF.test(messageRef) || !canonicalTime(withdrawnAt)) fail();
  const { root, value } = readLedger(stateDir, dataRoot);
  const prior = value.entries.find((entry) => entry.session_id === sessionId && entry.message_ref === messageRef);
  if (!prior) fail();
  if (prior.status === "withdrawn") return publicEntry(prior);
  if (prior.status === "sealed_absent") fail();
  const updated: StoredEntry = { ...prior, status: "withdrawn", withdrawn_at: withdrawnAt };
  const next = { ...value, revision: value.revision + 1,
    entries: value.entries.map((entry) => entry === prior ? updated : entry) };
  writeLedger(root, next);
  return publicEntry(updated);
}
