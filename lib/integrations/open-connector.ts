import { createHash, randomUUID } from "node:crypto";

export type ExternalConnectorProviderId = "open-connector";

export type ExternalProviderSummary = {
  id: string;
  name?: string;
  description?: string;
};

export type ExternalConnectionSummary = {
  service: string;
  alias?: string;
  status?: string;
  accountLabel?: string;
};

export type ExternalConnectionRequest = {
  authorizationUrl: string;
  connectionRequestId: string;
  status: "initiated";
  expiresAt: string;
};

export type ExternalConnectionResult = ExternalConnectionSummary | ExternalConnectionRequest;

export type ExternalActionSummary = {
  id: string;
  name?: string;
  description?: string;
  operationType?: "read" | "write" | "destructive";
};

export type ExternalActionInspection = ExternalActionSummary & {
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  scopes?: string[];
  risk?: ExternalActionRisk;
};

export type ExternalActionRisk = "low" | "high";

export type ExternalActionAuthorization = {
  actionId: string;
  inputHash: string;
  connectionName: string;
  idempotencyKey: string;
  confirmationId: string;
  confirmedAt: string;
};

export type ExternalExecutionReceipt<T = unknown> = {
  executionId: string;
  actionId: string;
  connectionName?: string;
  connectionId?: string;
  connectionProfile?: Record<string, unknown>;
  idempotencyKey?: string;
  risk: ExternalActionRisk;
  status: "succeeded" | "failed";
  result?: T;
  input?: unknown;
  output?: unknown;
  error?: Record<string, unknown>;
  at: string;
  auditPersisted: boolean;
};

export type ExternalConnectorProvider = {
  readonly id: ExternalConnectorProviderId;
  listProviders(): Promise<ExternalProviderSummary[]>;
  listConnections(): Promise<ExternalConnectionSummary[]>;
  searchActions(input: { capability: string; query?: string }): Promise<ExternalActionSummary[]>;
  inspectAction(input: { actionId: string; capability: string }): Promise<ExternalActionInspection>;
  executeAction(input: {
    actionId: string;
    capability: string;
    input: Record<string, unknown>;
    connectionName?: string;
    idempotencyKey?: string;
    authorization?: ExternalActionAuthorization;
  }): Promise<ExternalExecutionReceipt>;
  connect(input: {
    service: string;
    authType: "oauth" | "api_key" | "custom_credential";
    values: Record<string, unknown>;
    appId?: string;
    returnUri?: string;
  }): Promise<ExternalConnectionResult>;
  reconnect(input: {
    service: string;
    appId: string;
    authType: "oauth" | "api_key" | "custom_credential";
    values: Record<string, unknown>;
    returnUri?: string;
  }): Promise<ExternalConnectionResult>;
  disconnect(input: { service: string; connectionName?: string }): Promise<{ disconnected: boolean }>;
  getExecutionReceipt(executionId: string, capability: string): Promise<ExternalExecutionReceipt>;
};

export type OpenConnectorCapabilityPolicy = Record<string, string[]>;

export type OpenConnectorConfig = {
  enabled: boolean;
  baseUrl: string;
  runtimeToken: string;
  adminToken: string;
  capabilities: OpenConnectorCapabilityPolicy;
  timeoutMs: number;
};

export type OpenConnectorProviderOptions = {
  baseUrl: string;
  runtimeToken: string;
  adminToken?: string;
  capabilities?: OpenConnectorCapabilityPolicy;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class ExternalConnectorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ExternalConnectorError";
  }
}

const DEFAULT_CAPABILITIES: OpenConnectorCapabilityPolicy = {
  email: ["gmail.*"],
  github: ["github.*"],
  documents: ["notion.*", "googledocs.*", "googledrive.*"],
  messages: ["slack.*", "slackbot.*", "googlechat.*"],
  workspace: [
    "googlecalendar.*",
    "googlechat.*",
    "googledocs.*",
    "googledrive.*",
    "googleforms.*",
    "googlemeet.*",
    "googlesheets.*",
    "googleslides.*",
    "googletasks.*",
  ],
  data: ["supabase.*", "airtable.*"],
};

const SENSITIVE_KEY = /(authorization|credential|secret|password|passcode|token|api[-_]?key|access[-_]?key|refresh[-_]?key|cookie)/iu;
const CONNECTION_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u;

function envFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes" || value?.toLowerCase() === "on";
}

function isSecureServiceUrl(value: string): boolean {
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

function parseCapabilityPolicy(value: string | undefined): OpenConnectorCapabilityPolicy {
  if (!value) return DEFAULT_CAPABILITIES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ExternalConnectorError("invalid_configuration", "EDUPI_OPENCONNECTOR_CAPABILITY_ACTIONS must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ExternalConnectorError("invalid_configuration", "capability policy must be an object");
  }
  const result: OpenConnectorCapabilityPolicy = {};
  for (const [capability, patterns] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/iu.test(capability) || !Array.isArray(patterns)
      || patterns.length === 0 || patterns.length > 100
      || patterns.some((pattern) => typeof pattern !== "string" || pattern.length > 200 || !/^[A-Za-z0-9_.:-]+[*]?$/.test(pattern))) {
      throw new ExternalConnectorError("invalid_configuration", "capability policy is invalid");
    }
    result[capability] = patterns as string[];
  }
  return result;
}

export function resolveOpenConnectorConfig(env: Record<string, string | undefined> = process.env): OpenConnectorConfig {
  const baseUrl = env.EDUPI_OPENCONNECTOR_BASE_URL || "";
  const runtimeToken = env.EDUPI_OPENCONNECTOR_RUNTIME_TOKEN || "";
  const validUrl = isSecureServiceUrl(baseUrl);
  const timeout = Number(env.EDUPI_OPENCONNECTOR_TIMEOUT_MS);
  const enabled = envFlag(env.EDUPI_OPENCONNECTOR_ENABLED) && validUrl && runtimeToken.length >= 16;
  return {
    enabled,
    baseUrl,
    runtimeToken,
    adminToken: env.EDUPI_OPENCONNECTOR_ADMIN_TOKEN || "",
    capabilities: enabled ? parseCapabilityPolicy(env.EDUPI_OPENCONNECTOR_CAPABILITY_ACTIONS) : DEFAULT_CAPABILITIES,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 10_000,
  };
}

const REGEX_SPECIAL = [".", "*", "+", "?", "^", "$", "(", ")", "[", "]", "{", "}", "|", "\\"];

function escapeRegExp(value: string): string {
  return value.split("").map((char) => REGEX_SPECIAL.includes(char) ? "\\" + char : char).join("");
}

function patternToRegExp(pattern: string): RegExp {
  return new RegExp("^" + pattern.split("*").map(escapeRegExp).join(".*") + "$");
}

export function actionAllowed(actionId: string, capability: string, policy: OpenConnectorCapabilityPolicy): boolean {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(actionId)) return false;
  const patterns = policy[capability];
  return Array.isArray(patterns) && patterns.some((pattern) => patternToRegExp(pattern).test(actionId));
}

function stableHash(value: unknown): string {
  const source = typeof value === "string" ? value : JSON.stringify(value);
  return "sha256:" + createHash("sha256").update(source ?? "null", "utf8").digest("hex");
}

function normalizeConnectionName(value: string): string {
  const name = value.trim();
  if (!CONNECTION_NAME.test(name)) throw new ExternalConnectorError("invalid_input", "connectionName is invalid");
  return name;
}

function validateActionInput(input: Record<string, unknown>): void {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== "object") return;
    if (depth > 100 || seen.has(value)) throw new ExternalConnectorError("invalid_input", "action input is too deeply nested or cyclic");
    seen.add(value);
    for (const item of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) visit(item, depth + 1);
    seen.delete(value);
  };
  visit(input, 0);
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new ExternalConnectorError("invalid_input", "action input must be JSON serializable");
  }
  if (Buffer.byteLength(encoded, "utf8") > 256 * 1024) {
    throw new ExternalConnectorError("invalid_input", "action input is too large");
  }
}

export function createActionAuthorization(
  actionId: string,
  input: Record<string, unknown>,
  connectionName: string,
  confirmationId: string,
  idempotencyKey: string,
  confirmedAt = new Date().toISOString(),
): ExternalActionAuthorization {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(actionId)) throw new ExternalConnectorError("invalid_action", "action id is invalid");
  const timestamp = Date.parse(confirmedAt);
  if (!confirmationId || confirmationId.length > 128 || !idempotencyKey.trim()
    || Buffer.byteLength(idempotencyKey, "utf8") > 255
    || !Number.isFinite(timestamp) || timestamp > Date.now() + 60_000) {
    throw new ExternalConnectorError("invalid_authorization", "confirmation is invalid");
  }
  return { actionId, inputHash: stableHash(input), connectionName: normalizeConnectionName(connectionName), idempotencyKey, confirmationId, confirmedAt };
}

function validAuthorization(authorization: ExternalActionAuthorization | undefined, actionId: string, input: Record<string, unknown>, connectionName: string, idempotencyKey: string): boolean {
  if (!authorization) return false;
  const confirmedAt = Date.parse(authorization.confirmedAt);
  return authorization.actionId === actionId
    && authorization.inputHash === stableHash(input)
    && authorization.connectionName === connectionName
    && authorization.idempotencyKey === idempotencyKey
    && Boolean(authorization.confirmationId)
    && Number.isFinite(confirmedAt)
    && confirmedAt <= Date.now() + 60_000
    && confirmedAt + 10 * 60_000 >= Date.now();
}

function redact<T>(value: T, depth = 0): T {
  if (depth > 12) return "[truncated]" as T;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1)) as T;
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return result as T;
}

function requireText(value: string, name: string, max = 200): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new ExternalConnectorError("invalid_input", name + " is invalid");
  return trimmed;
}

function optionalSummaryText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

type ConnectorEnvelope<T = unknown> = {
  success?: boolean;
  message?: string;
  data?: T;
  meta?: Record<string, unknown>;
  errorCode?: string;
  error?: string | { code?: string; message?: string };
};

type ConnectorRequestInit = RequestInit & {
  auth: "runtime" | "admin";
  idempotencyKey?: string;
  connectionName?: string;
  query?: Record<string, string>;
};

function safeExternalMessage(value: unknown, fallback: string): string {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text
    .replace(/(Bearer\s+)[^\s,;]+/giu, "$1[redacted]")
    .replace(/\b(api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]")
    .slice(0, 500);
}

function responseError(payload: unknown, status?: number): ExternalConnectorError {
  const record = payload && typeof payload === "object" ? payload as ConnectorEnvelope : null;
  const nested = record?.error && typeof record.error === "object" ? record.error : null;
  return new ExternalConnectorError(
    record?.errorCode || nested?.code || "runtime_error",
    safeExternalMessage((typeof record?.error === "string" ? record.error : nested?.message) || record?.message, "OpenConnector request failed"),
    status,
  );
}

export class OpenConnectorProvider implements ExternalConnectorProvider {
  readonly id = "open-connector" as const;
  private readonly baseUrl: URL;
  private readonly runtimeToken: string;
  private readonly adminToken: string;
  private readonly capabilities: OpenConnectorCapabilityPolicy;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenConnectorProviderOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.runtimeToken = options.runtimeToken;
    this.adminToken = options.adminToken || "";
    this.capabilities = options.capabilities ?? DEFAULT_CAPABILITIES;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private url(path: string, query?: Record<string, string>): string {
    const url = new URL(this.baseUrl);
    const prefix = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "");
    url.pathname = prefix + "/" + path.replace(/^\/+/, "");
    url.search = "";
    url.hash = "";
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  private async fetchJson(path: string, init: ConnectorRequestInit): Promise<{ response: Response; payload: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const token = init.auth === "runtime" ? this.runtimeToken : this.adminToken;
    if (init.auth === "admin" && !token) throw new ExternalConnectorError("configuration", "OpenConnector admin token is required");
    try {
      const response = await this.fetchImpl(this.url(path, init.query), {
        method: init.method,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + token,
          ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
          ...(init.connectionName ? { "x-oo-connector-alias": init.connectionName } : {}),
        },
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: controller.signal,
      });
      return { response, payload: await response.json().catch(() => null) };
    } catch (error) {
      if (error instanceof ExternalConnectorError) throw error;
      if ((error as { name?: string })?.name === "AbortError") throw new ExternalConnectorError("timeout", "OpenConnector request timed out");
      throw new ExternalConnectorError("service_unavailable", "OpenConnector runtime is unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request<T>(path: string, init: ConnectorRequestInit): Promise<{ data: T; meta: Record<string, unknown> }> {
    const { response, payload } = await this.fetchJson(path, init);
    const envelope = payload as ConnectorEnvelope<T> | null;
    if (!response.ok || !envelope?.success || envelope.data === undefined) throw responseError(payload, response.status);
    return { data: envelope.data, meta: envelope.meta ?? {} };
  }

  private async requestRaw<T>(path: string, init: ConnectorRequestInit): Promise<T> {
    const { response, payload } = await this.fetchJson(path, init);
    if (!response.ok || payload === null) throw responseError(payload, response.status);
    return payload as T;
  }

  private ensureAllowed(actionId: string, capability: string): void {
    if (!actionAllowed(actionId, capability, this.capabilities)) {
      throw new ExternalConnectorError("action_not_allowed", actionId + " is not allowed for capability " + capability);
    }
  }

  async listProviders(): Promise<ExternalProviderSummary[]> {
    const { data } = await this.request<Array<Record<string, unknown>>>("/v1/providers", { method: "GET", auth: "runtime" });
    return (Array.isArray(data) ? data : []).flatMap((provider) => {
      const id = optionalSummaryText(provider.id ?? provider.service, 100);
      if (!id) return [];
      const name = optionalSummaryText(provider.name ?? provider.displayName, 200);
      const description = optionalSummaryText(provider.description, 1_000);
      return [{ id, ...(name ? { name } : {}), ...(description ? { description } : {}) }];
    });
  }

  async listConnections(): Promise<ExternalConnectionSummary[]> {
    const { data } = await this.request<ExternalConnectionSummary[]>("/v1/connections", { method: "GET", auth: "admin" });
    return Array.isArray(data) ? data : [];
  }

  async searchActions({ capability, query }: { capability: string; query?: string }): Promise<ExternalActionSummary[]> {
    requireText(capability, "capability", 64);
    const path = query?.trim() ? "/v1/actions/search" : "/v1/actions";
    const { data } = await this.request<ExternalActionSummary[]>(path, {
      method: "GET",
      auth: "runtime",
      ...(query?.trim() ? { query: { query: query.trim().slice(0, 200) } } : {}),
    });
    return (Array.isArray(data) ? data : [])
      .filter((action) => actionAllowed(String(action?.id), capability, this.capabilities))
      .slice(0, 50)
      .map((action) => {
        const name = optionalSummaryText(action.name, 200);
        const description = optionalSummaryText(action.description, 1_000);
        return {
          id: action.id,
          ...(name ? { name } : {}),
          ...(description ? { description } : {}),
          ...(action.operationType === "read" || action.operationType === "write" || action.operationType === "destructive"
            ? { operationType: action.operationType }
            : {}),
        };
      });
  }

  async inspectAction({ actionId, capability }: { actionId: string; capability: string }): Promise<ExternalActionInspection> {
    const action = requireText(actionId, "actionId");
    this.ensureAllowed(action, requireText(capability, "capability", 64));
    const { data } = await this.request<ExternalActionInspection>("/v1/actions/" + encodeURIComponent(action), { method: "GET", auth: "runtime" });
    if (!data || typeof data !== "object" || data.id !== action) {
      throw new ExternalConnectorError("invalid_action", "OpenConnector returned metadata for a different action");
    }
    const { operationType, ...inspection } = data;
    return {
      ...inspection,
      ...(operationType === "read" || operationType === "write" || operationType === "destructive" ? { operationType } : {}),
      // Runtime metadata is a separate request from execution and cannot authorize a later POST.
      risk: "high",
    };
  }

  async executeAction({ actionId, capability, input, connectionName = "default", idempotencyKey, authorization }: {
    actionId: string;
    capability: string;
    input: Record<string, unknown>;
    connectionName?: string;
    idempotencyKey?: string;
    authorization?: ExternalActionAuthorization;
  }): Promise<ExternalExecutionReceipt> {
    const action = requireText(actionId, "actionId");
    this.ensureAllowed(action, requireText(capability, "capability", 64));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ExternalConnectorError("invalid_input", "action input must be an object");
    validateActionInput(input);
    const selectedConnection = normalizeConnectionName(connectionName);
    const key = idempotencyKey?.trim() || authorization?.idempotencyKey || "edupi-" + randomUUID();
    if (Buffer.byteLength(key, "utf8") > 255) throw new ExternalConnectorError("invalid_input", "idempotency key is too long");
    const risk = "high";
    if (!validAuthorization(authorization, action, input, selectedConnection, key)) {
      throw new ExternalConnectorError("authorization_required", "This external action requires exact teacher confirmation");
    }
    const { response, payload } = await this.fetchJson("/v1/actions/" + encodeURIComponent(action), {
      method: "POST",
      auth: "runtime",
      connectionName: selectedConnection,
      idempotencyKey: key,
      body: JSON.stringify({ input }),
    });
    const envelope = payload as ConnectorEnvelope | null;
    const meta = envelope?.meta ?? {};
    const executionId = typeof meta.executionId === "string" ? meta.executionId : "";
    if (!executionId) throw responseError(payload, response.status);
    if (typeof meta.actionId === "string" && meta.actionId !== action) {
      throw new ExternalConnectorError("invalid_receipt", "OpenConnector returned an execution receipt for a different action");
    }
    const auditPersisted = meta.auditPersisted !== false;
    if (!response.ok || !envelope?.success) {
      return {
        executionId,
        actionId: action,
        connectionName: selectedConnection,
        idempotencyKey: key,
        risk,
        status: "failed",
        error: redact({
          code: envelope?.errorCode || "runtime_error",
          message: safeExternalMessage(envelope?.message, "OpenConnector action failed"),
          ...(envelope?.data !== undefined ? { details: envelope.data } : {}),
          httpStatus: response.status,
        }),
        at: new Date().toISOString(),
        auditPersisted,
      };
    }
    if (envelope.data === undefined) throw new ExternalConnectorError("invalid_receipt", "OpenConnector returned an incomplete execution receipt");
    return {
      executionId,
      actionId: action,
      connectionName: selectedConnection,
      idempotencyKey: key,
      risk,
      status: "succeeded",
      result: redact(envelope.data),
      at: new Date().toISOString(),
      auditPersisted,
    };
  }

  async connect({ service, authType, values, appId, returnUri }: Parameters<ExternalConnectorProvider["connect"]>[0]): Promise<ExternalConnectionResult> {
    const selectedService = requireText(service, "service", 100);
    const body = authType === "oauth"
      ? { ...(returnUri ? { returnUri } : {}) }
      : authType === "api_key"
        ? { apiKey: values.apiKey, ...(values.extra ? { extra: values.extra } : {}), ...(values.comment ? { comment: values.comment } : {}) }
        : { values, ...(values.comment ? { comment: values.comment } : {}) };
    const base = appId
      ? "/v1/connections/by-id/" + encodeURIComponent(appId)
      : "/v1/connections/" + encodeURIComponent(selectedService);
    const suffix = authType === "oauth" ? "/connect" : authType === "api_key" ? "/connect/api-key" : "/connect/custom-credential";
    const { data } = await this.request<ExternalConnectionResult>(base + suffix, { method: "POST", auth: "admin", body: JSON.stringify(body) });
    return redact(data);
  }

  async reconnect(input: Parameters<ExternalConnectorProvider["reconnect"]>[0]): Promise<ExternalConnectionResult> {
    if (!input.appId) throw new ExternalConnectorError("invalid_input", "appId is required to reconnect");
    return this.connect({ ...input, appId: input.appId });
  }

  async disconnect({ service, connectionName }: { service: string; connectionName?: string }): Promise<{ disconnected: boolean }> {
    const selectedService = requireText(service, "service", 100);
    const selectedConnection = connectionName ? normalizeConnectionName(connectionName) : undefined;
    const query = selectedConnection && selectedConnection !== "default" ? { alias: selectedConnection } : undefined;
    await this.requestRaw<unknown>("/api/connections/" + encodeURIComponent(selectedService), { method: "DELETE", auth: "admin", ...(query ? { query } : {}) });
    return { disconnected: true };
  }

  async getExecutionReceipt(executionId: string, capability: string): Promise<ExternalExecutionReceipt> {
    const id = requireText(executionId, "executionId", 200);
    const data = await this.requestRaw<Record<string, unknown>>("/api/runs/" + encodeURIComponent(id), { method: "GET", auth: "admin" });
    const actionId = typeof data.actionId === "string" ? data.actionId : "";
    if (!actionId) throw new ExternalConnectorError("invalid_receipt", "OpenConnector audit record is invalid");
    const inspection = await this.inspectAction({ actionId, capability: requireText(capability, "capability", 64) });
    return redact({
      executionId: id,
      actionId,
      ...(typeof data.connectionId === "string" ? { connectionId: data.connectionId } : {}),
      ...(data.connectionProfile && typeof data.connectionProfile === "object" && !Array.isArray(data.connectionProfile)
        ? { connectionProfile: data.connectionProfile as Record<string, unknown> }
        : {}),
      risk: inspection.risk ?? "high",
      status: data.ok === false ? "failed" : "succeeded",
      input: data.inputSummary as Record<string, unknown> | undefined,
      output: data.outputSummary as Record<string, unknown> | undefined,
      ...(data.ok === false ? {
        error: {
          ...(typeof data.errorCode === "string" ? { code: data.errorCode } : {}),
          ...(typeof data.errorMessage === "string" ? { message: data.errorMessage } : {}),
        },
      } : {}),
      at: typeof data.completedAt === "string"
        ? data.completedAt
        : typeof data.startedAt === "string" ? data.startedAt : new Date().toISOString(),
      auditPersisted: true,
    });
  }
}

export function createOpenConnectorProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): OpenConnectorProvider | null {
  const config = resolveOpenConnectorConfig(env);
  if (!config.enabled) return null;
  return new OpenConnectorProvider({
    baseUrl: config.baseUrl,
    runtimeToken: config.runtimeToken,
    ...(config.adminToken ? { adminToken: config.adminToken } : {}),
    capabilities: config.capabilities,
    timeoutMs: config.timeoutMs,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
