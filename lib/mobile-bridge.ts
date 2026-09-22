import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const MOBILE_TOKEN_HEADER = "x-edupi-mobile-token";
export const MOBILE_TOKEN_COOKIE = "edupi_mobile_token";
export const MOBILE_PAIRING_TTL_MS = 10 * 60 * 1000;
export const MOBILE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const MOBILE_SCOPES = ["mobile:read", "mobile:chat"] as const;
export type MobileScope = typeof MOBILE_SCOPES[number];

type PairingStatus = "waiting" | "requested" | "approved" | "active" | "revoked";

type PairingRecord = {
  id: string;
  codeDigest: string;
  tokenDigest: string;
  token: string;
  status: PairingStatus;
  createdAt: number;
  expiresAt: number;
  deviceLabel: string;
  scopes: readonly MobileScope[];
};

type PublicPairing = Omit<PairingRecord, "codeDigest" | "tokenDigest" | "token" | "scopes"> & { scopes: readonly MobileScope[] };

type MobileBridgeState = { pairings: Map<string, PairingRecord>; attempts: Map<string, { count: number; resetAt: number }> };

declare global {
  var __edupiMobileBridgeState: MobileBridgeState | undefined;
}

function state(): MobileBridgeState {
  const current = globalThis.__edupiMobileBridgeState;
  if (current) {
    current.attempts ??= new Map();
    return current;
  }
  return globalThis.__edupiMobileBridgeState = { pairings: new Map(), attempts: new Map() };
}

function metadataPath(): string {
  const root = process.env.PI_DESKTOP_STATE_DIR?.trim() || resolve(process.env.EDUPI_DATA_ROOT || ".", ".edupi/desktop");
  return resolve(root, "mobile-pairings.json");
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function equalDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanup(now = Date.now()): void {
  for (const [id, record] of state().pairings) {
    if (record.expiresAt <= now || record.status === "revoked") state().pairings.delete(id);
  }
  for (const [key, attempt] of state().attempts) if (attempt.resetAt <= now) state().attempts.delete(key);
}

export function allowMobilePairAttempt(key: string, now = Date.now()): boolean {
  cleanup(now);
  const normalized = key.trim().slice(0, 120) || "unknown";
  const current = state().attempts.get(normalized);
  if (!current || current.resetAt <= now) {
    state().attempts.set(normalized, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (current.count >= 120) return false;
  current.count += 1;
  return true;
}

function publicPairing(record: PairingRecord): PublicPairing {
  const { codeDigest, tokenDigest, token, ...safe } = record;
  void codeDigest;
  void tokenDigest;
  void token;
  return safe;
}

function persistMetadata(): void {
  const path = metadataPath();
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const records = [...state().pairings.values()].map(publicPairing);
    writeFileSync(path, JSON.stringify({ version: 1, records }, null, 2), { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* best effort on Windows */ }
  } catch {
    // Pairing remains valid in memory; diagnostics must not reveal the code.
  }
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function safeLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 80) || "手机" : "手机";
}

export function createMobilePairing(): { id: string; code: string; expiresAt: string; scopes: readonly MobileScope[] } {
  cleanup();
  let code = randomCode();
  while ([...state().pairings.values()].some((record) => equalDigest(record.codeDigest, digest(code)))) code = randomCode();
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const record: PairingRecord = {
    id: randomUUID(),
    codeDigest: digest(code),
    tokenDigest: digest(token),
    token,
    status: "waiting",
    createdAt: now,
    expiresAt: now + MOBILE_PAIRING_TTL_MS,
    deviceLabel: "手机",
    scopes: MOBILE_SCOPES,
  };
  state().pairings.set(record.id, record);
  persistMetadata();
  return { id: record.id, code, expiresAt: new Date(record.expiresAt).toISOString(), scopes: record.scopes };
}

export function listMobilePairings(): PublicPairing[] {
  cleanup();
  return [...state().pairings.values()].filter((record) => record.status !== "revoked").map(publicPairing);
}

export function requestMobilePairing(codeInput: string, deviceLabel?: unknown): PublicPairing | null {
  cleanup();
  const code = normalizeCode(codeInput);
  if (!code) return null;
  const record = [...state().pairings.values()].find((candidate) => candidate.status === "waiting" && equalDigest(candidate.codeDigest, digest(code)));
  if (!record) return null;
  record.status = "requested";
  record.deviceLabel = safeLabel(deviceLabel);
  persistMetadata();
  return publicPairing(record);
}

export function approveMobilePairing(id: string): PublicPairing | null {
  cleanup();
  const record = state().pairings.get(id);
  if (!record || record.status !== "requested") return null;
  record.status = "approved";
  persistMetadata();
  return publicPairing(record);
}

export function completeMobilePairing(id: string, codeInput: string): { status: PairingStatus; token?: string; scopes?: readonly MobileScope[] } | null {
  cleanup();
  const record = state().pairings.get(id);
  if (!record || !equalDigest(record.codeDigest, digest(normalizeCode(codeInput)))) return null;
  if (record.status === "approved") {
    record.status = "active";
    record.expiresAt = Date.now() + MOBILE_TOKEN_TTL_MS;
    persistMetadata();
    return { status: record.status, token: record.token, scopes: record.scopes };
  }
  return { status: record.status };
}

export function revokeMobilePairing(id: string): boolean {
  const record = state().pairings.get(id);
  if (!record) return false;
  record.status = "revoked";
  state().pairings.delete(id);
  persistMetadata();
  return true;
}

export function authorizeMobileRequest(request: Request, scope: MobileScope): PublicPairing | null {
  cleanup();
  const headerToken = request.headers.get(MOBILE_TOKEN_HEADER)?.trim();
  const cookieToken = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${MOBILE_TOKEN_COOKIE}=`))?.slice(MOBILE_TOKEN_COOKIE.length + 1).trim();
  const token = headerToken || cookieToken;
  if (!token || token.length < 32) return null;
  const record = [...state().pairings.values()].find((candidate) => candidate.status === "active" && candidate.scopes.includes(scope) && equalDigest(candidate.tokenDigest, digest(token)));
  return record ? publicPairing(record) : null;
}
