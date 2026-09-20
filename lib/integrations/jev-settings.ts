import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { removeStoredCredentialIfType, storeProviderCredential } from "../provider-credential-store";

const JEV_CREDENTIAL_ID = "edupi-jev";
const SETTINGS_VERSION = 1;
const MANAGED_ENV_KEYS = [
  "EDUPI_JEV_ENABLED",
  "EDUPI_JEV_ENDPOINT",
  "EDUPI_JEV_API_KEY",
  "EDUPI_JEV_MODEL",
  "EDUPI_JEV_TIMEOUT_MS",
  "EDUPI_JEV_MIN_CONFIDENCE",
  "EDUPI_JEV_MAX_CONSECUTIVE_FAILURES",
] as const;

export type JevSettingsInput = {
  enabled: boolean;
  endpoint: string;
  model: string;
  timeoutMs: number;
  minConfidence: number;
  maxConsecutiveFailures: number;
  apiKey?: string;
};

type StoredJevSettings = Omit<JevSettingsInput, "apiKey"> & {
  version: typeof SETTINGS_VERSION;
  updatedAt: string;
};

export type JevSettingsStatus = Omit<JevSettingsInput, "apiKey"> & {
  active: boolean;
  keyConfigured: boolean;
  environmentManaged: boolean;
};

export type JevSettingsPaths = {
  configPath?: string;
  authPath?: string;
};

const DEFAULT_SETTINGS: StoredJevSettings = {
  version: SETTINGS_VERSION,
  enabled: false,
  endpoint: "https://api.typesafe.ai/v1/systemone",
  model: "jev-latest",
  timeoutMs: 3_000,
  minConfidence: 0.6,
  maxConsecutiveFailures: 3,
  updatedAt: "1970-01-01T00:00:00.000Z",
};

function configPath(paths: JevSettingsPaths): string {
  return paths.configPath ?? join(getAgentDir(), "edupi-desktop", "jev.json");
}

function authPath(paths: JevSettingsPaths): string {
  return paths.authPath ?? join(getAgentDir(), "auth.json");
}

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes" || value.toLowerCase() === "on";
}

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
}

function isSecureEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !url.hostname) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1");
  } catch {
    return false;
  }
}

function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${name} is required`);
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error(`${name} is invalid`);
  return text;
}

export function normalizeJevSettingsInput(value: unknown): JevSettingsInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JEV settings must be an object");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["enabled", "endpoint", "model", "timeoutMs", "minConfidence", "maxConsecutiveFailures", "apiKey"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("JEV settings contain unknown fields");
  if (typeof record.enabled !== "boolean") throw new Error("enabled must be a boolean");
  const endpoint = boundedText(record.endpoint, "endpoint", 2_048);
  if (!isSecureEndpoint(endpoint)) throw new Error("endpoint must use HTTPS or loopback HTTP");
  const model = boundedText(record.model, "model", 128);
  const timeoutMs = record.timeoutMs;
  const minConfidence = record.minConfidence;
  const maxConsecutiveFailures = record.maxConsecutiveFailures;
  if (!Number.isInteger(timeoutMs) || (timeoutMs as number) < 100 || (timeoutMs as number) > 30_000) throw new Error("timeoutMs is invalid");
  if (typeof minConfidence !== "number" || !Number.isFinite(minConfidence) || minConfidence < 0.01 || minConfidence > 1) throw new Error("minConfidence is invalid");
  if (!Number.isInteger(maxConsecutiveFailures) || (maxConsecutiveFailures as number) < 1 || (maxConsecutiveFailures as number) > 10) throw new Error("maxConsecutiveFailures is invalid");
  let apiKey: string | undefined;
  if (record.apiKey !== undefined) {
    apiKey = boundedText(record.apiKey, "apiKey", 1_024);
    if (apiKey.length < 16) throw new Error("apiKey is invalid");
  }
  return {
    enabled: record.enabled,
    endpoint,
    model,
    timeoutMs: timeoutMs as number,
    minConfidence,
    maxConsecutiveFailures: maxConsecutiveFailures as number,
    ...(apiKey ? { apiKey } : {}),
  };
}

function readStoredSettings(paths: JevSettingsPaths): StoredJevSettings {
  const file = configPath(paths);
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS };
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JEV settings file is invalid");
  const record = parsed as Record<string, unknown>;
  if (record.version !== SETTINGS_VERSION) throw new Error("JEV settings version is unsupported");
  const normalized = normalizeJevSettingsInput({
    enabled: record.enabled,
    endpoint: record.endpoint,
    model: record.model,
    timeoutMs: record.timeoutMs,
    minConfidence: record.minConfidence,
    maxConsecutiveFailures: record.maxConsecutiveFailures,
  });
  return {
    version: SETTINGS_VERSION,
    ...normalized,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : DEFAULT_SETTINGS.updatedAt,
  };
}

function readStoredApiKey(paths: JevSettingsPaths): string {
  const credential = readStoredCredential(JEV_CREDENTIAL_ID, authPath(paths));
  return credential?.type === "api_key" && typeof credential.key === "string" ? credential.key : "";
}

export function loadJevRuntimeEnvironment(
  env: Record<string, string | undefined> = process.env,
  paths: JevSettingsPaths = {},
): Record<string, string | undefined> {
  const settings = readStoredSettings(paths);
  const storedKey = readStoredApiKey(paths);
  const persisted: Record<string, string | undefined> = {
    EDUPI_JEV_ENABLED: settings.enabled ? "1" : "0",
    EDUPI_JEV_ENDPOINT: settings.endpoint,
    EDUPI_JEV_MODEL: settings.model,
    EDUPI_JEV_TIMEOUT_MS: String(settings.timeoutMs),
    EDUPI_JEV_MIN_CONFIDENCE: String(settings.minConfidence),
    EDUPI_JEV_MAX_CONSECUTIVE_FAILURES: String(settings.maxConsecutiveFailures),
    ...(storedKey ? { EDUPI_JEV_API_KEY: storedKey } : {}),
  };
  for (const key of MANAGED_ENV_KEYS) if (env[key] !== undefined) persisted[key] = env[key];
  return persisted;
}

export async function readJevSettingsStatus(
  env: Record<string, string | undefined> = process.env,
  paths: JevSettingsPaths = {},
): Promise<JevSettingsStatus> {
  const runtime = loadJevRuntimeEnvironment(env, paths);
  const settings = readStoredSettings(paths);
  const endpoint = runtime.EDUPI_JEV_ENDPOINT || settings.endpoint;
  const model = runtime.EDUPI_JEV_MODEL || settings.model;
  const timeoutMs = envNumber(runtime.EDUPI_JEV_TIMEOUT_MS, settings.timeoutMs);
  const minConfidence = envNumber(runtime.EDUPI_JEV_MIN_CONFIDENCE, settings.minConfidence);
  const maxConsecutiveFailures = envNumber(runtime.EDUPI_JEV_MAX_CONSECUTIVE_FAILURES, settings.maxConsecutiveFailures);
  const enabled = envFlag(runtime.EDUPI_JEV_ENABLED, settings.enabled);
  const keyConfigured = Boolean(runtime.EDUPI_JEV_API_KEY && runtime.EDUPI_JEV_API_KEY.length >= 16);
  return {
    enabled,
    active: enabled && keyConfigured && isSecureEndpoint(endpoint),
    endpoint,
    model,
    timeoutMs,
    minConfidence,
    maxConsecutiveFailures,
    keyConfigured,
    environmentManaged: MANAGED_ENV_KEYS.some((key) => env[key] !== undefined),
  };
}

export async function saveJevSettings(
  value: unknown,
  paths: JevSettingsPaths = {},
): Promise<JevSettingsStatus> {
  const input = normalizeJevSettingsInput(value);
  const file = configPath(paths);
  const parent = dirname(file);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(parent, 0o700);
  writePrivateFileAtomicSync(file, `${JSON.stringify({
    version: SETTINGS_VERSION,
    enabled: input.enabled,
    endpoint: input.endpoint,
    model: input.model,
    timeoutMs: input.timeoutMs,
    minConfidence: input.minConfidence,
    maxConsecutiveFailures: input.maxConsecutiveFailures,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  if (process.platform !== "win32") chmodSync(file, 0o600);
  if (input.apiKey) await storeProviderCredential(JEV_CREDENTIAL_ID, { type: "api_key", key: input.apiKey }, authPath(paths));
  return readJevSettingsStatus({}, paths);
}

export async function clearJevApiKey(paths: JevSettingsPaths = {}): Promise<JevSettingsStatus> {
  await removeStoredCredentialIfType(JEV_CREDENTIAL_ID, "api_key", authPath(paths));
  return readJevSettingsStatus({}, paths);
}
