import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateAgentImages } from "./image-attachments.ts";
import type { EduPiProactivityDomain } from "./edupi-proactivity-config.ts";

const DIRECTORY = "edupi-prompt-outbox-v1";
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MESSAGE_REF = /^owner_message:[a-f0-9]{64}$/u;
const OWNER_ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u;
const PRODUCER_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;
const RAW_ID = /^[^\u0000-\u001f\u007f]{1,128}$/u;
const EPOCH = /^[a-f0-9]{64}$/u;
const INSTANCE_NONCE = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,127}$/u;
const DOMAINS = new Set<EduPiProactivityDomain>(["teaching_preparation", "student_followup"]);
const MAX_PAYLOAD_BYTES = 150 * 1024 * 1024; // Ten existing 10 MiB image attachments encode below this limit.
const MAX_OUTBOX_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_STATE_BYTES = 16 * 1024;
const MAX_SUMMARY_BYTES = 4 * 1024;

export type EduPiPromptOutboxStage = "prepared" | "registered" | "captured" | "pi_dispatching" | "pi_accepted"
  | "pi_unknown" | "cancelled" | "pi_unverified_withdrawn" | "pi_accepted_withdrawn";
export function consumesEduPiPromptOutboxQuota(stage: EduPiPromptOutboxStage): boolean {
  return !["pi_accepted", "pi_accepted_withdrawn", "cancelled"].includes(stage);
}
export type EduPiPromptOutboxImage = { type: "image"; data: string; mimeType: string };
export type EduPiPromptOutboxPrompt = {
  type: "prompt";
  message: string;
  clientRequestId: string;
  images?: EduPiPromptOutboxImage[];
  streamingBehavior?: "steer" | "followUp";
};
export type EduPiPromptOutboxBindingInput = {
  domain: EduPiProactivityDomain;
  ownerId: string;
  grantId: string;
  grantVersion: number;
  captureMessageId: string;
  carrierId: string;
  planId: string;
};
export type EduPiPromptOutboxInput = {
  sessionId: string;
  clientRequestId: string;
  messageId: string;
  occurredAt: string;
  command: EduPiPromptOutboxPrompt;
  bindings: EduPiPromptOutboxBindingInput[];
};
export type EduPiPromptOutboxRegistration = {
  messageRef: string;
  producerEpoch: string;
  sequence: number;
  fencingGeneration: number;
  instanceNonce: string;
};
export type EduPiPromptOutboxBinding = EduPiPromptOutboxBindingInput & {
  messageRef: string | null;
  registration: EduPiPromptOutboxRegistration | null;
  captured: boolean;
};
export type EduPiPromptOutboxCancellationProof = {
  domain: EduPiProactivityDomain;
  messageRef: string;
  status: "sealed_absent" | "withdrawn";
};
export type EduPiPromptOutboxEntry = Omit<EduPiPromptOutboxInput, "bindings"> & {
  stage: EduPiPromptOutboxStage;
  bindings: EduPiPromptOutboxBinding[];
  cancellationProofs: EduPiPromptOutboxCancellationProof[] | null;
};
export type EduPiPromptOutboxSummary = {
  sessionId: string;
  clientRequestId: string;
  messageId: string;
  occurredAt: string;
  stage: EduPiPromptOutboxStage;
  domains: Array<{ domain: string; captured: boolean }>;
};
export type EduPiPromptOutboxOptions = { stateDir?: string; dataRoot: string };

type StoredPayload = EduPiPromptOutboxInput & { version: 1; dataRootHash: string };
type StoredSummary = {
  version: 1;
  dataRootHash: string;
  payloadSha256: string;
  payloadSize: number;
  payloadMtimeMs: number;
  payloadCtimeMs: number;
  sessionId: string;
  clientRequestId: string;
  messageId: string;
  occurredAt: string;
  bindingDomains: EduPiProactivityDomain[];
};
type StoredBinding = { domain: EduPiProactivityDomain; registration: EduPiPromptOutboxRegistration | null; captured: boolean };
type StoredState = {
  version: 1;
  dataRootHash: string;
  payloadSha256: string;
  revision: number;
  stage: EduPiPromptOutboxStage;
  bindings: StoredBinding[];
  cancellationProofs: EduPiPromptOutboxCancellationProof[] | null;
};

export class EduPiPromptOutboxError extends Error {
  readonly code: "prompt_outbox_invalid" | "prompt_outbox_conflict" | "prompt_outbox_unavailable" | "prompt_outbox_capacity";
  constructor(code: "prompt_outbox_invalid" | "prompt_outbox_conflict" | "prompt_outbox_unavailable" | "prompt_outbox_capacity") {
    super(code);
    this.code = code;
    this.name = "EduPiPromptOutboxError";
  }
}

function invalid(): never { throw new EduPiPromptOutboxError("prompt_outbox_invalid"); }
function conflict(): never { throw new EduPiPromptOutboxError("prompt_outbox_conflict"); }
function unavailable(): never { throw new EduPiPromptOutboxError("prompt_outbox_unavailable"); }
function capacity(): never { throw new EduPiPromptOutboxError("prompt_outbox_capacity"); }

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function canonicalTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function positiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validRegistration(value: unknown): value is EduPiPromptOutboxRegistration {
  return exact(value, ["messageRef", "producerEpoch", "sequence", "fencingGeneration", "instanceNonce"])
    && MESSAGE_REF.test(String(value.messageRef)) && EPOCH.test(String(value.producerEpoch))
    && positiveInt(value.sequence) && positiveInt(value.fencingGeneration)
    && INSTANCE_NONCE.test(String(value.instanceNonce));
}

function validCancellationProof(value: unknown): value is EduPiPromptOutboxCancellationProof {
  return exact(value, ["domain", "messageRef", "status"])
    && DOMAINS.has(value.domain as EduPiProactivityDomain)
    && MESSAGE_REF.test(String(value.messageRef))
    && ["sealed_absent", "withdrawn"].includes(String(value.status));
}

function validBinding(value: unknown): value is EduPiPromptOutboxBindingInput {
  return exact(value, ["domain", "ownerId", "grantId", "grantVersion", "captureMessageId", "carrierId", "planId"])
    && DOMAINS.has(value.domain as EduPiProactivityDomain) && OWNER_ID.test(String(value.ownerId)) && OWNER_ID.test(String(value.grantId))
    && positiveInt(value.grantVersion) && RAW_ID.test(String(value.captureMessageId))
    && PRODUCER_ID.test(String(value.carrierId)) && PRODUCER_ID.test(String(value.planId));
}

function normalizedInput(input: EduPiPromptOutboxInput): StoredPayload {
  if (!exact(input, ["sessionId", "clientRequestId", "messageId", "occurredAt", "command", "bindings"])
    || !RAW_ID.test(String(input.sessionId)) || !PRODUCER_ID.test(String(input.clientRequestId))
    || !RAW_ID.test(String(input.messageId)) || !canonicalTime(input.occurredAt)
    || !input.command || typeof input.command !== "object" || Array.isArray(input.command)
    || !Array.isArray(input.bindings) || input.bindings.length < 1 || input.bindings.length > DOMAINS.size
    || !input.bindings.every(validBinding)) invalid();
  const prompt = input.command as EduPiPromptOutboxPrompt;
  const promptKeys = ["type", "message", "clientRequestId",
    ...(prompt.images === undefined ? [] : ["images"]), ...(prompt.streamingBehavior === undefined ? [] : ["streamingBehavior"])];
  if (!exact(prompt, promptKeys) || prompt.type !== "prompt" || prompt.clientRequestId !== input.clientRequestId
    || typeof prompt.message !== "string" || (!prompt.message.trim() && (!Array.isArray(prompt.images) || prompt.images.length === 0))
    || prompt.message.length > 4000
    || (typeof prompt.message.isWellFormed === "function" && !prompt.message.isWellFormed())
    || ![undefined, "steer", "followUp"].includes(prompt.streamingBehavior)
    || validateAgentImages(prompt.images) !== null
    || prompt.images?.some((image) => !exact(image, ["type", "data", "mimeType"]))) invalid();
  const bindings = [...input.bindings].sort((left, right) => left.domain.localeCompare(right.domain));
  if (new Set(bindings.map((item) => item.domain)).size !== bindings.length
    || new Set(bindings.map((item) => item.captureMessageId)).size !== bindings.length
    || new Set(bindings.map((item) => item.planId)).size !== bindings.length
    || new Set(bindings.map((item) => item.carrierId)).size !== bindings.length
    || new Set(bindings.map((item) => item.ownerId)).size !== 1) invalid();
  return { version: 1, dataRootHash: "", sessionId: input.sessionId, clientRequestId: input.clientRequestId,
    messageId: input.messageId, occurredAt: input.occurredAt,
    command: { type: "prompt", message: prompt.message, clientRequestId: prompt.clientRequestId,
      ...(prompt.images === undefined ? {} : { images: prompt.images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })) }),
      ...(prompt.streamingBehavior === undefined ? {} : { streamingBehavior: prompt.streamingBehavior }) },
    bindings: bindings.map((item) => ({ domain: item.domain, ownerId: item.ownerId, grantId: item.grantId,
      grantVersion: item.grantVersion, captureMessageId: item.captureMessageId, carrierId: item.carrierId, planId: item.planId })) };
}

function secureDirectory(directory: string, privateDirectory = true): string {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || process.platform !== "win32" && ((stat.mode & (privateDirectory ? 0o077 : 0o022)) !== 0
      || typeof process.getuid === "function" && stat.uid !== process.getuid())) unavailable();
  return fs.realpathSync(directory);
}

function context(options: EduPiPromptOutboxOptions, create: boolean): { dir: string; hash: string } {
  const configured = options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR;
  if (!configured || !path.isAbsolute(configured) || !path.isAbsolute(options.dataRoot)) unavailable();
  try {
    const root = secureDirectory(configured, false);
    const dataRoot = fs.realpathSync(options.dataRoot);
    if (!fs.lstatSync(dataRoot).isDirectory()) unavailable();
    const hash = `sha256:${crypto.createHash("sha256").update(dataRoot, "utf8").digest("hex")}`;
    const parent = path.join(root, DIRECTORY);
    const dir = path.join(parent, hash.slice("sha256:".length));
    if (create) {
      try { fs.mkdirSync(parent, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    if (secureDirectory(parent) !== parent) unavailable();
    if (create) {
      try { fs.mkdirSync(dir, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    if (secureDirectory(dir) !== dir) unavailable();
    return { dir, hash };
  } catch { unavailable(); }
}

function paths(dir: string, hash: string, sessionId: string, clientRequestId: string):
  { directory: string; payload: string; state: string; summary: string } {
  if (!RAW_ID.test(sessionId) || !PRODUCER_ID.test(clientRequestId)) invalid();
  const key = crypto.createHash("sha256").update(`${hash}\0${sessionId}\0${clientRequestId}`, "utf8").digest("hex");
  const directory = path.join(dir, `${key}.entry`);
  return { directory, payload: path.join(directory, "payload.json"), state: path.join(directory, "state.json"),
    summary: path.join(directory, "summary.json") };
}

function readPrivate(file: string, maxBytes: number): Buffer {
  let descriptor: number | undefined;
  try {
    const linkBefore = fs.lstatSync(file);
    if (!linkBefore.isFile() || linkBefore.isSymbolicLink() || linkBefore.nlink !== 1) unavailable();
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > maxBytes
      || before.dev !== linkBefore.dev || before.ino !== linkBefore.ino
      || process.platform !== "win32" && ((before.mode & 0o077) !== 0
        || typeof process.getuid === "function" && before.uid !== process.getuid())) unavailable();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const linkAfter = fs.lstatSync(file);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || !linkAfter.isFile() || linkAfter.isSymbolicLink() || linkAfter.dev !== after.dev || linkAfter.ino !== after.ino
      || process.platform !== "win32" && fs.realpathSync(file) !== file) unavailable();
    return bytes;
  } catch { unavailable(); }
  finally { if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* read cleanup */ } }
  return unavailable();
}

function parsePrivate(file: string, maxBytes: number): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readPrivate(file, maxBytes))); }
  catch { unavailable(); }
}

function syncDirectory(dir: string): void {
  if (process.platform === "win32") return; // Node cannot portably fsync a Windows directory; payload and state files are fsynced.
  const descriptor = fs.openSync(dir, fs.constants.O_RDONLY | NOFOLLOW);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function writePrivate(dir: string, file: string, bytes: Buffer): void {
  const temporary = path.join(dir, `.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    try {
      const prior = fs.lstatSync(file);
      if (!prior.isFile() || prior.isSymbolicLink() || prior.nlink !== 1) unavailable();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    fs.renameSync(temporary, file);
    syncDirectory(dir);
  } catch { unavailable(); }
  finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* write cleanup */ }
    try { fs.unlinkSync(temporary); } catch { /* only an owned temporary */ }
  }
}

function validPayload(value: unknown, hash: string): value is StoredPayload {
  if (!exact(value, ["version", "dataRootHash", "sessionId", "clientRequestId", "messageId", "occurredAt", "command", "bindings"])
    || value.version !== 1 || value.dataRootHash !== hash) return false;
  try {
    const payload = value as StoredPayload;
    const normalized = normalizedInput({ sessionId: payload.sessionId, clientRequestId: payload.clientRequestId,
      messageId: payload.messageId, occurredAt: payload.occurredAt, command: payload.command, bindings: payload.bindings });
    return JSON.stringify({ ...normalized, dataRootHash: hash }) === JSON.stringify(value);
  } catch { return false; }
}

function statPrivatePayload(file: string): fs.Stats {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 2 || stat.size > MAX_PAYLOAD_BYTES
      || process.platform !== "win32" && ((stat.mode & 0o077) !== 0
        || typeof process.getuid === "function" && stat.uid !== process.getuid())) unavailable();
    return stat;
  } catch { unavailable(); }
}

function summaryFor(payload: StoredPayload, digest: string, file: string): StoredSummary {
  const stat = statPrivatePayload(file);
  return { version: 1, dataRootHash: payload.dataRootHash, payloadSha256: digest,
    payloadSize: stat.size, payloadMtimeMs: stat.mtimeMs, payloadCtimeMs: stat.ctimeMs,
    sessionId: payload.sessionId, clientRequestId: payload.clientRequestId, messageId: payload.messageId,
    occurredAt: payload.occurredAt, bindingDomains: payload.bindings.map((binding) => binding.domain) };
}

function validSummary(value: unknown, hash: string, payloadFile: string): value is StoredSummary {
  if (!exact(value, ["version", "dataRootHash", "payloadSha256", "payloadSize", "payloadMtimeMs", "payloadCtimeMs",
    "sessionId", "clientRequestId", "messageId", "occurredAt", "bindingDomains"])
    || value.version !== 1 || value.dataRootHash !== hash || !SHA256.test(String(value.payloadSha256))
    || !Number.isSafeInteger(value.payloadSize) || Number(value.payloadSize) < 2 || Number(value.payloadSize) > MAX_PAYLOAD_BYTES
    || typeof value.payloadMtimeMs !== "number" || !Number.isFinite(value.payloadMtimeMs)
    || typeof value.payloadCtimeMs !== "number" || !Number.isFinite(value.payloadCtimeMs)
    || !RAW_ID.test(String(value.sessionId)) || !PRODUCER_ID.test(String(value.clientRequestId))
    || !RAW_ID.test(String(value.messageId)) || !canonicalTime(value.occurredAt)
    || !Array.isArray(value.bindingDomains) || value.bindingDomains.length < 1 || value.bindingDomains.length > DOMAINS.size
    || !value.bindingDomains.every((domain) => DOMAINS.has(domain as EduPiProactivityDomain))
    || new Set(value.bindingDomains).size !== value.bindingDomains.length
    || JSON.stringify(value.bindingDomains) !== JSON.stringify([...value.bindingDomains].sort())) return false;
  const stat = statPrivatePayload(payloadFile);
  return stat.size === value.payloadSize && stat.mtimeMs === value.payloadMtimeMs && stat.ctimeMs === value.payloadCtimeMs;
}

function validState(value: unknown, payload: { dataRootHash: string; bindings: Array<{ domain: EduPiProactivityDomain }> }, digest: string): value is StoredState {
  if (!exact(value, ["version", "dataRootHash", "payloadSha256", "revision", "stage", "bindings", "cancellationProofs"])
    || value.version !== 1 || value.dataRootHash !== payload.dataRootHash || value.payloadSha256 !== digest
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || !["prepared", "registered", "captured", "pi_dispatching", "pi_accepted", "pi_unknown", "cancelled",
      "pi_unverified_withdrawn", "pi_accepted_withdrawn"].includes(String(value.stage))
    || !Array.isArray(value.bindings) || value.bindings.length !== payload.bindings.length) return false;
  for (let index = 0; index < payload.bindings.length; index += 1) {
    const binding = value.bindings[index];
    if (!exact(binding, ["domain", "registration", "captured"]) || binding.domain !== payload.bindings[index].domain
      || binding.registration !== null && !validRegistration(binding.registration)
      || typeof binding.captured !== "boolean" || binding.captured && binding.registration === null) return false;
  }
  const allRegistered = value.bindings.every((binding) => binding.registration !== null);
  const allCaptured = value.bindings.every((binding) => binding.captured);
  if (value.stage === "cancelled") {
    const bindings = value.bindings as StoredBinding[];
    return allRegistered && Array.isArray(value.cancellationProofs)
      && value.cancellationProofs.length === bindings.length
      && value.cancellationProofs.every((proof, index) => {
        const binding = bindings[index];
        return validCancellationProof(proof) && proof.domain === binding.domain
          && proof.messageRef === binding.registration?.messageRef
          && (!binding.captured || proof.status === "withdrawn");
      });
  }
  if (["pi_unverified_withdrawn", "pi_accepted_withdrawn"].includes(String(value.stage))) {
    const bindings = value.bindings as StoredBinding[];
    return allCaptured && Array.isArray(value.cancellationProofs)
      && value.cancellationProofs.length === bindings.length
      && value.cancellationProofs.every((proof, index) => validCancellationProof(proof)
        && proof.domain === bindings[index].domain
        && proof.messageRef === bindings[index].registration?.messageRef
        && proof.status === "withdrawn");
  }
  if (value.cancellationProofs !== null) return false;
  return value.stage === "prepared" && !allRegistered
    || value.stage === "registered" && allRegistered && !allCaptured
    || ["captured", "pi_dispatching", "pi_accepted", "pi_unknown"].includes(String(value.stage)) && allCaptured;
}

function readStored(sessionId: string, clientRequestId: string, options: EduPiPromptOutboxOptions):
  { dir: string; payloadFile: string; stateFile: string; payload: StoredPayload; state: StoredState } | null {
  const { dir, hash } = context(options, true);
  const files = paths(dir, hash, sessionId, clientRequestId);
  try { secureDirectory(files.directory); }
  catch (error) {
    try { fs.lstatSync(files.directory); } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === "ENOENT") return null;
    }
    throw error;
  }
  const payloadBytes = readPrivate(files.payload, MAX_PAYLOAD_BYTES);
  const digest = `sha256:${crypto.createHash("sha256").update(payloadBytes).digest("hex")}`;
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes)); } catch { unavailable(); }
  if (!validPayload(payload, hash) || payload.sessionId !== sessionId || payload.clientRequestId !== clientRequestId) unavailable();
  const summary = parsePrivate(files.summary, MAX_SUMMARY_BYTES);
  if (!validSummary(summary, hash, files.payload) || summary.payloadSha256 !== digest
    || summary.sessionId !== payload.sessionId || summary.clientRequestId !== payload.clientRequestId
    || summary.messageId !== payload.messageId || summary.occurredAt !== payload.occurredAt
    || JSON.stringify(summary.bindingDomains) !== JSON.stringify(payload.bindings.map((binding) => binding.domain))) unavailable();
  let state: unknown;
  try { state = parsePrivate(files.state, MAX_STATE_BYTES); }
  catch { unavailable(); }
  if (!validState(state, payload, digest)) unavailable();
  return { dir: files.directory, payloadFile: files.payload, stateFile: files.state, payload, state };
}

function entry(payload: StoredPayload, state: StoredState): EduPiPromptOutboxEntry {
  return { sessionId: payload.sessionId, clientRequestId: payload.clientRequestId, messageId: payload.messageId,
    occurredAt: payload.occurredAt, command: payload.command, stage: state.stage,
    cancellationProofs: state.cancellationProofs,
    bindings: payload.bindings.map((binding, index) => ({ ...binding, ...state.bindings[index],
      messageRef: state.bindings[index].registration?.messageRef ?? null })) };
}

function writeState(dir: string, file: string, value: StoredState, payload: StoredPayload, digest: string): void {
  if (!validState(value, payload, digest)) unavailable();
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.length > MAX_STATE_BYTES) unavailable();
  writePrivate(dir, file, bytes);
}

function update(sessionId: string, clientRequestId: string, options: EduPiPromptOutboxOptions,
  change: (state: StoredState) => StoredState): EduPiPromptOutboxEntry {
  const stored = readStored(sessionId, clientRequestId, options);
  if (!stored) unavailable();
  const next = change(stored.state);
  if (next !== stored.state) writeState(stored.dir, stored.stateFile, next, stored.payload, stored.state.payloadSha256);
  return entry(stored.payload, next);
}

/** Persist the complete Pi request before Core registration or Pi dispatch. A matching retry is idempotent. */
export function prepareEduPiPromptOutbox(input: EduPiPromptOutboxInput, options: EduPiPromptOutboxOptions): EduPiPromptOutboxEntry {
  const normalized = normalizedInput(input);
  const { dir, hash } = context(options, true);
  const payload = { ...normalized, dataRootHash: hash };
  const bytes = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  if (bytes.length > MAX_PAYLOAD_BYTES) invalid();
  const files = paths(dir, hash, input.sessionId, input.clientRequestId);
  const existing = readStored(input.sessionId, input.clientRequestId, options);
  if (existing) {
    if (JSON.stringify(existing.payload) !== JSON.stringify(payload)) conflict();
    return entry(existing.payload, existing.state);
  }
  // Terminal requests retain their exact ID for safe late retries. They do
  // not consume the quota reserved for prompts that still need recovery.
  const pending = listEduPiPromptOutbox(options).filter((item) => consumesEduPiPromptOutboxQuota(item.stage));
  if (pending.length >= MAX_ENTRIES) capacity();
  const total = pending.reduce((sum, item) => {
    const files = paths(dir, hash, item.sessionId, item.clientRequestId);
    if (secureDirectory(files.directory) !== files.directory) unavailable();
    return sum + fs.lstatSync(files.payload).size;
  }, 0);
  if (total + bytes.length > MAX_OUTBOX_BYTES) capacity();
  const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  const state: StoredState = { version: 1, dataRootHash: hash, payloadSha256: digest, revision: 0,
    stage: "prepared", bindings: payload.bindings.map((binding) => ({ domain: binding.domain, registration: null, captured: false })),
    cancellationProofs: null };
  const temporary = path.join(dir, `.${crypto.randomUUID()}.tmp`);
  try {
    fs.mkdirSync(temporary, { mode: 0o700 });
    const pendingPayload = path.join(temporary, "payload.json");
    writePrivate(temporary, pendingPayload, bytes);
    const summary = summaryFor(payload, digest, pendingPayload);
    writePrivate(temporary, path.join(temporary, "summary.json"), Buffer.from(`${JSON.stringify(summary)}\n`, "utf8"));
    writeState(temporary, path.join(temporary, "state.json"), state, payload, digest);
    syncDirectory(temporary);
    fs.renameSync(temporary, files.directory);
    syncDirectory(dir);
    return entry(payload, state);
  } catch (error) {
    const concurrent = readStored(input.sessionId, input.clientRequestId, options);
    if (concurrent && JSON.stringify(concurrent.payload) === JSON.stringify(payload)) return entry(concurrent.payload, concurrent.state);
    throw error;
  } finally {
    // This exact random directory is private, uncommitted and owned by this call.
    for (const name of ["payload.json", "state.json", "summary.json"]) {
      try { fs.unlinkSync(path.join(temporary, name)); } catch { /* already committed or absent */ }
    }
    try { fs.rmdirSync(temporary); } catch { /* already committed or incomplete */ }
  }
}

export function readEduPiPromptOutbox(sessionId: string, clientRequestId: string,
  options: EduPiPromptOutboxOptions): EduPiPromptOutboxEntry | null {
  const stored = readStored(sessionId, clientRequestId, options);
  return stored ? entry(stored.payload, stored.state) : null;
}

export function summarizeEduPiPromptOutboxEntry(value: EduPiPromptOutboxEntry): EduPiPromptOutboxSummary {
  return { sessionId: value.sessionId, clientRequestId: value.clientRequestId, messageId: value.messageId,
    occurredAt: value.occurredAt, stage: value.stage,
    domains: value.bindings.map((binding) => ({ domain: binding.domain, captured: binding.captured })) };
}

/** Recovery listing reads only small private summary/state files, never image payload bytes. */
export function listEduPiPromptOutbox(options: EduPiPromptOutboxOptions): EduPiPromptOutboxSummary[] {
  const { dir, hash } = context(options, true);
  return fs.readdirSync(dir).filter((name) => /^[a-f0-9]{64}\.entry$/u.test(name)).map((name) => {
    const directory = path.join(dir, name);
    if (secureDirectory(directory) !== directory) unavailable();
    const summary = parsePrivate(path.join(directory, "summary.json"), MAX_SUMMARY_BYTES);
    if (!validSummary(summary, hash, path.join(directory, "payload.json"))) unavailable();
    const files = paths(dir, hash, summary.sessionId, summary.clientRequestId);
    if (path.basename(files.directory) !== name) unavailable();
    const state = parsePrivate(files.state, MAX_STATE_BYTES);
    if (!validState(state, { dataRootHash: hash,
      bindings: summary.bindingDomains.map((domain) => ({ domain })) }, summary.payloadSha256)) unavailable();
    return { sessionId: summary.sessionId, clientRequestId: summary.clientRequestId,
      messageId: summary.messageId, occurredAt: summary.occurredAt, stage: state.stage,
      domains: state.bindings.map((binding) => ({ domain: binding.domain, captured: binding.captured })) };
  }).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

/**
 * Called only after the session deletion path has confirmed that every Core
 * source was withdrawn or explicitly sealed absent. Uncertain Pi requests
 * remain recoverable and make deletion fail closed.
 */
export function removeEduPiPromptOutboxForSession(sessionId: string, options: EduPiPromptOutboxOptions): number {
  if (!RAW_ID.test(sessionId)) invalid();
  const { dir } = context(options, true);
  const matches = listEduPiPromptOutbox(options).filter((summary) => summary.sessionId === sessionId);
  const targets = matches.map((summary) => {
    const stored = readStored(summary.sessionId, summary.clientRequestId, options);
    if (!stored) unavailable();
    if (!["pi_accepted", "cancelled", "pi_accepted_withdrawn"].includes(stored.state.stage)) conflict();
    if (secureDirectory(stored.dir) !== stored.dir
      || JSON.stringify(fs.readdirSync(stored.dir).sort()) !== JSON.stringify(["payload.json", "state.json", "summary.json"])) unavailable();
    const stat = fs.lstatSync(stored.dir);
    return { dir: stored.dir, dev: stat.dev, ino: stat.ino };
  });
  for (const target of targets) {
    const current = fs.lstatSync(target.dir);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== target.dev || current.ino !== target.ino) unavailable();
    const deleting = path.join(dir, `.${path.basename(target.dir)}.${crypto.randomUUID()}.deleting`);
    try {
      fs.renameSync(target.dir, deleting);
      syncDirectory(dir);
      const moved = fs.lstatSync(deleting);
      if (!moved.isDirectory() || moved.isSymbolicLink() || moved.dev !== target.dev || moved.ino !== target.ino
        || JSON.stringify(fs.readdirSync(deleting).sort()) !== JSON.stringify(["payload.json", "state.json", "summary.json"])) unavailable();
      for (const name of ["payload.json", "state.json", "summary.json"]) {
        const file = path.join(deleting, name);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) unavailable();
        fs.unlinkSync(file);
      }
      fs.rmdirSync(deleting);
      syncDirectory(dir);
    } catch { unavailable(); }
  }
  return targets.length;
}

export function recordEduPiPromptOutboxRegistration(sessionId: string, clientRequestId: string, domain: string,
  registration: EduPiPromptOutboxRegistration, options: EduPiPromptOutboxOptions): EduPiPromptOutboxEntry {
  if (!validRegistration(registration)) invalid();
  return update(sessionId, clientRequestId, options, (state) => {
    if (!["prepared", "registered", "captured"].includes(state.stage)) conflict();
    const index = state.bindings.findIndex((binding) => binding.domain === domain);
    if (index < 0) conflict();
    const old = state.bindings[index];
    if (old.registration) {
      if (old.registration.messageRef !== registration.messageRef
        || old.registration.producerEpoch !== registration.producerEpoch
        || old.registration.sequence !== registration.sequence) conflict();
      if (JSON.stringify(old.registration) === JSON.stringify(registration)) return state;
      // Core replays the durable plan with a fresh process fence/nonce after
      // restart. Only that transient binding may change; epoch/sequence may not.
      const bindings = state.bindings.map((binding, position) => position === index ? { ...binding, registration } : binding);
      return { ...state, revision: state.revision + 1, bindings };
    }
    const bindings = state.bindings.map((binding, position) => position === index ? { ...binding, registration } : binding);
    return { ...state, revision: state.revision + 1, bindings,
      stage: bindings.every((binding) => binding.registration !== null) ? "registered" : "prepared" };
  });
}

export function recordEduPiPromptOutboxCapture(sessionId: string, clientRequestId: string, domain: string,
  receipt: { captured: true; messageRef: string }, options: EduPiPromptOutboxOptions): EduPiPromptOutboxEntry {
  if (!exact(receipt, ["captured", "messageRef"]) || receipt.captured !== true || !MESSAGE_REF.test(String(receipt.messageRef))) invalid();
  return update(sessionId, clientRequestId, options, (state) => {
    if (!["prepared", "registered", "captured"].includes(state.stage)) conflict();
    const index = state.bindings.findIndex((binding) => binding.domain === domain);
    if (index < 0) conflict();
    const old = state.bindings[index];
    if (!old.registration || old.registration.messageRef !== receipt.messageRef) conflict();
    if (old.captured) return state;
    const bindings = state.bindings.map((binding, position) => position === index ? { ...binding, captured: true } : binding);
    return { ...state, revision: state.revision + 1, bindings,
      stage: bindings.every((binding) => binding.captured) ? "captured"
        : bindings.every((binding) => binding.registration !== null) ? "registered" : "prepared" };
  });
}

/** Terminal only after every registered Core source has an exact absence/withdrawal proof. */
export function markEduPiPromptOutboxCancelled(sessionId: string, clientRequestId: string,
  proofs: EduPiPromptOutboxCancellationProof[], options: EduPiPromptOutboxOptions): EduPiPromptOutboxEntry {
  if (!Array.isArray(proofs) || proofs.length < 1 || proofs.length > DOMAINS.size || !proofs.every(validCancellationProof)) invalid();
  const ordered = [...proofs].sort((left, right) => left.domain.localeCompare(right.domain));
  if (new Set(ordered.map((proof) => proof.domain)).size !== ordered.length) invalid();
  return update(sessionId, clientRequestId, options, (state) => {
    if (!["prepared", "registered", "captured", "cancelled"].includes(state.stage)) conflict();
    if (ordered.length !== state.bindings.length) conflict();
    for (let index = 0; index < ordered.length; index += 1) {
      const proof = ordered[index], binding = state.bindings[index];
      if (proof.domain !== binding.domain || proof.messageRef !== binding.registration?.messageRef
        || binding.captured && proof.status !== "withdrawn") conflict();
    }
    if (state.stage === "cancelled") {
      if (JSON.stringify(state.cancellationProofs) !== JSON.stringify(ordered)) conflict();
      return state;
    }
    return { ...state, revision: state.revision + 1, stage: "cancelled", cancellationProofs: ordered };
  });
}

/** Core sources were withdrawn, but the Pi dispatch outcome remains explicitly unverified. */
export function markEduPiPromptOutboxSourceWithdrawn(sessionId: string, clientRequestId: string,
  proofs: EduPiPromptOutboxCancellationProof[], options: EduPiPromptOutboxOptions): EduPiPromptOutboxEntry {
  if (!Array.isArray(proofs) || proofs.length < 1 || proofs.length > DOMAINS.size
    || !proofs.every((proof) => validCancellationProof(proof) && proof.status === "withdrawn")) invalid();
  const ordered = [...proofs].sort((left, right) => left.domain.localeCompare(right.domain));
  if (new Set(ordered.map((proof) => proof.domain)).size !== ordered.length) invalid();
  return update(sessionId, clientRequestId, options, (state) => {
    if (!["pi_dispatching", "pi_unknown", "pi_unverified_withdrawn"].includes(state.stage)) conflict();
    if (ordered.length !== state.bindings.length) conflict();
    for (let index = 0; index < ordered.length; index += 1) {
      const proof = ordered[index], binding = state.bindings[index];
      if (!binding.captured || proof.domain !== binding.domain || proof.messageRef !== binding.registration?.messageRef) conflict();
    }
    if (state.stage === "pi_unverified_withdrawn") {
      if (JSON.stringify(state.cancellationProofs) !== JSON.stringify(ordered)) conflict();
      return state;
    }
    return { ...state, revision: state.revision + 1, stage: "pi_unverified_withdrawn", cancellationProofs: ordered };
  });
}

function transition(sessionId: string, clientRequestId: string, stage: EduPiPromptOutboxStage,
  from: EduPiPromptOutboxStage[], options: EduPiPromptOutboxOptions): EduPiPromptOutboxEntry {
  return update(sessionId, clientRequestId, options, (state) => {
    if (state.stage === stage) return state;
    if (!from.includes(state.stage)) conflict();
    return { ...state, revision: state.revision + 1, stage };
  });
}

/** Must be committed immediately before Pi dispatch. Recovery treats this stage as uncertain, never replayable. */
export function markEduPiPromptOutboxPiDispatching(sessionId: string, clientRequestId: string,
  options: EduPiPromptOutboxOptions): EduPiPromptOutboxEntry {
  return transition(sessionId, clientRequestId, "pi_dispatching", ["captured"], options);
}

/** Requires an affirmative Pi response or independently verified session-history reconciliation. */
export function markEduPiPromptOutboxPiAccepted(sessionId: string, clientRequestId: string,
  options: EduPiPromptOutboxOptions): EduPiPromptOutboxEntry {
  return update(sessionId, clientRequestId, options, (state) => {
    if (["pi_accepted", "pi_accepted_withdrawn"].includes(state.stage)) return state;
    if (state.stage === "pi_unverified_withdrawn") {
      return { ...state, revision: state.revision + 1, stage: "pi_accepted_withdrawn" };
    }
    if (!["pi_dispatching", "pi_unknown"].includes(state.stage)) conflict();
    return { ...state, revision: state.revision + 1, stage: "pi_accepted" };
  });
}

export function markEduPiPromptOutboxPiUnknown(sessionId: string, clientRequestId: string,
  options: EduPiPromptOutboxOptions): EduPiPromptOutboxEntry {
  return transition(sessionId, clientRequestId, "pi_unknown", ["pi_dispatching"], options);
}
