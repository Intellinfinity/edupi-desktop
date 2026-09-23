import { chmodSync, closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_QUEUE_MESSAGES = 50;
const MAX_QUEUE_CHARS = 1_500_000;
const MAX_QUEUE_FILE_BYTES = 3_000_000;
const MAX_RECOVERY_DIRECTORY_BYTES = 20_000_000;

type Queue = {
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  clearQueue(): { steering: string[]; followUp: string[] };
};

export type QueueRecoveryRecord = {
  schema: 1;
  sessionId: string;
  recoveryId: string;
  steering: string[];
  followUp: string[];
  status: "prepared" | "cleared" | "acknowledged";
};

function recoveryFile(agentDir: string, recoveryId: string): string {
  if (!ID.test(recoveryId)) throw new Error("Invalid queue recovery id");
  const root = resolve(agentDir);
  const base = join(root, "edupi-desktop");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const canonicalRoot = realpathSync(root);
  const canonicalBase = realpathSync(base);
  const baseRelative = relative(canonicalRoot, canonicalBase);
  if (!baseRelative || isAbsolute(baseRelative) || baseRelative.startsWith(`..${sep}`) || baseRelative === "..") throw new Error("Invalid queue recovery root");
  const directory = join(base, "queue-recovery");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const canonical = realpathSync(directory);
  const within = relative(canonicalRoot, canonical);
  if (!within || isAbsolute(within) || within.startsWith(`..${sep}`) || within === "..") throw new Error("Invalid queue recovery root");
  chmodSync(directory, 0o700);
  return join(directory, `${recoveryId}.json`);
}

function readRecovery(file: string, sessionId: string, recoveryId: string): QueueRecoveryRecord | null {
  if (!existsSync(file)) return null;
  if (statSync(file).size > MAX_QUEUE_FILE_BYTES) throw new Error("Queue recovery record too large");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<QueueRecoveryRecord>;
  if (parsed.schema !== 1 || parsed.sessionId !== sessionId || parsed.recoveryId !== recoveryId
    || !Array.isArray(parsed.steering) || !Array.isArray(parsed.followUp)
    || (parsed.status !== "prepared" && parsed.status !== "cleared" && parsed.status !== "acknowledged")
    || (parsed.status === "acknowledged" && (parsed.steering.length > 0 || parsed.followUp.length > 0))
    || [...parsed.steering, ...parsed.followUp].some(item => typeof item !== "string")) {
    throw new Error("Queue recovery record mismatch");
  }
  return parsed as QueueRecoveryRecord;
}

function flushDirectory(file: string): void {
  // POSIX rename durability requires the parent directory entry to be synced.
  // Windows does not expose a portable directory fsync through Node; its
  // remaining power-loss boundary is recorded in release acceptance.
  if (process.platform === "win32") return;
  const fd = openSync(dirname(file), constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function ensureRecoveryCapacity(file: string, nextBytes: number): void {
  const directory = dirname(file);
  const used = readdirSync(directory).filter(name => name.endsWith(".json"))
    .reduce((total, name) => total + statSync(join(directory, name)).size, 0);
  if (used + nextBytes > MAX_RECOVERY_DIRECTORY_BYTES) throw new Error("Queue recovery storage full");
}

/** Synchronous snapshot → private flushed file → SDK clear; no JS enqueue can interleave. */
export function clearQueueRecoverably(
  sessionId: string,
  recoveryId: string,
  queue: Queue,
  agentDir = getAgentDir(),
): QueueRecoveryRecord {
  const file = recoveryFile(agentDir, recoveryId);
  const existing = readRecovery(file, sessionId, recoveryId);
  if (existing?.status === "prepared") throw new Error("QUEUE_RECOVERY_MANUAL_REVIEW");
  if (existing) return existing;

  const record: QueueRecoveryRecord = {
    schema: 1,
    sessionId,
    recoveryId,
    steering: [...queue.getSteeringMessages()],
    followUp: [...queue.getFollowUpMessages()],
    status: "prepared",
  };
  const messages = [...record.steering, ...record.followUp];
  if (messages.length > MAX_QUEUE_MESSAGES || messages.join("").length > MAX_QUEUE_CHARS) {
    throw new Error("Queue recovery exceeds local storage limit");
  }
  if (messages.length === 0) return record;
  const body = JSON.stringify(record);
  const bodyBytes = Buffer.byteLength(body);
  if (bodyBytes > MAX_QUEUE_FILE_BYTES) throw new Error("Queue recovery exceeds local storage limit");
  ensureRecoveryCapacity(file, bodyBytes);
  writePrivateFileAtomicSync(file, body);
  flushDirectory(file);
  const removed = queue.clearQueue();
  if (JSON.stringify(removed) !== JSON.stringify({ steering: record.steering, followUp: record.followUp })) {
    throw new Error("Queue changed during atomic recovery");
  }
  const cleared = { ...record, status: "cleared" as const };
  writePrivateFileAtomicSync(file, JSON.stringify(cleared));
  flushDirectory(file);
  return cleared;
}

export function acknowledgeQueueRecovery(sessionId: string, recoveryId: string, agentDir = getAgentDir()): boolean {
  const file = recoveryFile(agentDir, recoveryId);
  const current = readRecovery(file, sessionId, recoveryId);
  if (!current) return false;
  if (current.status === "acknowledged") return true;
  if (current.status !== "cleared") throw new Error("QUEUE_RECOVERY_MANUAL_REVIEW");
  writePrivateFileAtomicSync(file, JSON.stringify({
    schema: 1, sessionId, recoveryId, steering: [], followUp: [], status: "acknowledged",
  } satisfies QueueRecoveryRecord));
  flushDirectory(file);
  return true;
}

export function abandonPreparedQueueRecovery(sessionId: string, recoveryId: string, agentDir = getAgentDir()): boolean {
  const file = recoveryFile(agentDir, recoveryId);
  const current = readRecovery(file, sessionId, recoveryId);
  if (!current) return false;
  if (current.status === "acknowledged") return true;
  if (current.status !== "prepared") throw new Error("QUEUE_RECOVERY_NOT_PREPARED");
  // Teacher explicitly chooses manual review. Keep the physical queue
  // untouched; its delivery state cannot be inferred from this record.
  writePrivateFileAtomicSync(file, JSON.stringify({
    schema: 1, sessionId, recoveryId, steering: [], followUp: [], status: "acknowledged",
  } satisfies QueueRecoveryRecord));
  flushDirectory(file);
  return true;
}
