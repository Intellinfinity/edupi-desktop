import { dirname, isAbsolute } from "node:path";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import scheduleOccurrenceSchema from "../contracts/edupi-schedule-occurrence-v1.2.schema.json";
import { callEduPiCore, EduPiCoreProcessError } from "./edupi-core-process-client";
import { isWindowsAbsolutePath } from "./file-access";
import { activeBridgeIdentity, scheduleOccurrenceIdentity } from "./edupi-bridge-manifest";
import { consumeCoreEnvelope } from "./edupi-bridge-consumer";
import type { BridgeErrorCode } from "./edupi-bridge-contract";
import type { EducationMemoryScopeProjection } from "./edupi-memory-scopes";
import { resolveEduPiCoreRoot, resolveEduPiDataRoot, type ResolvedEduPiCore, type ResolvedEduPiDataRoot } from "./edupi-core-root";
import { ensureEduPiRuntime } from "./edupi-runtime-supervisor";

export type CoreEducationWorkspace = Record<string, unknown>;
export type CoreEducationSnapshotPayload = Record<string, unknown> & {
  education_workspace: CoreEducationWorkspace;
};

export type CoreScheduleOccurrenceProjection = {
  contract_version: "1.2";
  schema_hash: string;
  snapshot_id: string;
  events: Array<Record<string, unknown>>;
  external_send: false;
};

export type EduPiBridgeRoots = {
  runtime: ResolvedEduPiCore;
  dataRoot: ResolvedEduPiDataRoot;
};

export class EduPiSnapshotError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EduPiSnapshotError";
  }
}

type CoreHealth = {
  ok: boolean;
  status?: string;
  contract_version?: string;
  schema_hash?: string;
  fixture_manifest_hash?: string;
  supported_commands?: unknown;
  supported_projections?: unknown;
  supported_operations?: unknown;
};

const CORE_OPERATIONS = ["health", "snapshot", "workspace-resources", "generated-artifacts", "command", "students", "teaching-priorities", "material-metadata", "education-facts", "delete", "kernel", "memory-scopes", "teaching-skills", "connectors", "agent-computer", "platform", "connector-setup"] as const;

export function validateScheduleOccurrenceV12Envelope(value: unknown): boolean {
  try {
    return Value.Check(scheduleOccurrenceSchema as TSchema, value);
  } catch {
    return false;
  }
}

export function validateScheduleOccurrenceV12Projection(value: unknown, snapshotId: string): value is CoreScheduleOccurrenceProjection {
  if (!validateScheduleOccurrenceV12Envelope(value) || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const projection = value as Record<string, unknown>;
  const identity = scheduleOccurrenceIdentity();
  return projection.contract_version === identity.contract_version
    && projection.schema_hash === identity.schema_hash
    && projection.snapshot_id === snapshotId
    && Array.isArray(projection.events)
    && projection.external_send === false;
}

export type CoreProactiveWorkRun = {
  run_id: string;
  trigger_id: string;
  fire_key?: string;
  status: "running" | "awaiting_delivery" | "failed" | "needs_review" | "succeeded" | "skipped";
  updated_at: string;
  result_summary: string | null;
  error_code?: string | null;
  error_message?: string | null;
  attempt_count: number;
};

export type CoreProactiveWorkProjection = {
  projection_kind: "proactive_work_kernel";
  state_version: number;
  updated_at: string;
  summary: { total: number; running: number; failed: number; needs_review: number; succeeded: number; skipped: number };
  runs: CoreProactiveWorkRun[];
};

export function isEduPiAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && (isAbsolute(value) || isWindowsAbsolutePath(value));
}

function absoluteConfiguredRoot(value: unknown, name: string): string {
  if (!isEduPiAbsolutePath(value)) throw new EduPiSnapshotError("configuration", `${name} must be configured as an absolute path`);
  return value;
}

export function resolveEduPiBridgeRoots(): EduPiBridgeRoots {
  const configuredCoreRoot = absoluteConfiguredRoot(process.env.EDUPI_CORE_ROOT, "EDUPI_CORE_ROOT");
  const coreAllowedRoot = process.env.EDUPI_CORE_ALLOWED_ROOT
    ? absoluteConfiguredRoot(process.env.EDUPI_CORE_ALLOWED_ROOT, "EDUPI_CORE_ALLOWED_ROOT")
    : dirname(configuredCoreRoot);
  const identity = activeBridgeIdentity();
  const validationMode = process.env.EDUPI_CORE_VALIDATION_MODE === "bundled" ? "bundled" : "external";
  try {
    return {
      runtime: resolveEduPiCoreRoot({
        configuredRoot: configuredCoreRoot,
        allowedRoot: coreAllowedRoot,
        runtimeIdentity: identity.runtime,
        validationMode,
      }),
      dataRoot: resolveEduPiDataRoot(),
    };
  } catch (error) {
    throw new EduPiSnapshotError("configuration", error instanceof Error ? error.message : String(error));
  }
}

function bridgeErrorMessage(code: BridgeErrorCode): string {
  if (code === "unknown_version" || code === "unknown_schema_hash") return "Core bridge contract is not the pinned v1.1 identity";
  if (code === "stale_snapshot") return "Core education snapshot is stale";
  if (code === "unsupported_command") return "Core bridge returned an unsupported command capability";
  return "Core education snapshot envelope is unavailable or malformed";
}

function sameCapabilityList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export async function readEduPiEducationSnapshot({
  requestId = `desktop-education-${Date.now().toString(36)}`,
  scheduleOccurrenceVersion,
  signal,
  roots,
}: {
  requestId?: string;
  scheduleOccurrenceVersion?: "1.2";
  signal?: AbortSignal;
  roots?: EduPiBridgeRoots;
} = {}): Promise<{
  envelope: Record<string, unknown>;
  payload: CoreEducationSnapshotPayload;
  workspace: CoreEducationWorkspace;
  occurrenceProjection: CoreScheduleOccurrenceProjection | null;
  runtime: ResolvedEduPiCore;
  dataRoot: ResolvedEduPiDataRoot;
}> {
  const resolved = roots || resolveEduPiBridgeRoots();
  if (!roots && process.env.EDUPI_AMBIENT_PLANNING === "1") await ensureEduPiRuntime(resolved);
  let response: Record<string, unknown>;
  try {
    response = await callEduPiCore<Record<string, unknown>>({
      operation: "snapshot",
      requestId,
      runtime: resolved.runtime,
      dataRoot: resolved.dataRoot,
      scheduleOccurrenceVersion,
      signal,
    });
  } catch (error) {
    if (error instanceof EduPiCoreProcessError) throw new EduPiSnapshotError(error.code, "Core education snapshot unavailable");
    throw new EduPiSnapshotError("process", "Core education snapshot unavailable");
  }
  if (response.ok !== true || response.operation !== "snapshot" || !response.envelope || typeof response.envelope !== "object" || Array.isArray(response.envelope)) {
    throw new EduPiSnapshotError("snapshot_unavailable", "Core education snapshot unavailable");
  }
  const identity = activeBridgeIdentity();
  if (!sameCapabilityList(response.supported_commands, identity.contract.supported_commands)
    || !sameCapabilityList(response.supported_projections, identity.contract.supported_projections)) {
    throw new EduPiSnapshotError("capability_mismatch", "Core education projection capability mismatch");
  }
  const consumed = consumeCoreEnvelope(response.envelope, { allowInvalidFactSpine: true });
  if (!consumed.ok) throw new EduPiSnapshotError(consumed.code, bridgeErrorMessage(consumed.code));
  if (consumed.kind !== "snapshot") throw new EduPiSnapshotError("unsupported_command", "Core returned an unsupported education receipt");
  const payload = consumed.value as CoreEducationSnapshotPayload;
  const workspace = payload.education_workspace;
  if (!workspace || workspace.projection_kind !== "education_workspace" || workspace.projection_version !== "1.1") throw new EduPiSnapshotError("projection_unavailable", "Core education workspace projection unavailable");
  if (scheduleOccurrenceVersion === undefined && Object.hasOwn(response, "occurrence_projection")) {
    throw new EduPiSnapshotError("invalid_envelope", "Core returned an unrequested schedule occurrence projection");
  }
  const occurrenceProjection = scheduleOccurrenceVersion === "1.2" ? response.occurrence_projection : null;
  if (scheduleOccurrenceVersion === "1.2" && !validateScheduleOccurrenceV12Projection(occurrenceProjection, String(payload.snapshot_id))) {
    throw new EduPiSnapshotError("projection_unavailable", "Core schedule occurrence projection unavailable");
  }
  return {
    envelope: response.envelope as Record<string, unknown>,
    payload,
    workspace,
    occurrenceProjection: occurrenceProjection as CoreScheduleOccurrenceProjection | null,
    runtime: resolved.runtime,
    dataRoot: resolved.dataRoot,
  };
}

export async function readEduPiCoreHealth({
  requestId = `desktop-health-${Date.now().toString(36)}`,
  signal,
  roots,
}: {
  requestId?: string;
  signal?: AbortSignal;
  roots?: EduPiBridgeRoots;
} = {}): Promise<{ health: CoreHealth; runtime: ResolvedEduPiCore; dataRoot: ResolvedEduPiDataRoot }> {
  const resolved = roots || resolveEduPiBridgeRoots();
  let health: CoreHealth;
  try {
    health = await callEduPiCore<CoreHealth>({ operation: "health", requestId, runtime: resolved.runtime, dataRoot: resolved.dataRoot, signal });
  } catch (error) {
    if (error instanceof EduPiCoreProcessError) throw new EduPiSnapshotError(error.code, "Core health unavailable");
    throw new EduPiSnapshotError("process", "Core health unavailable");
  }
  const identity = activeBridgeIdentity();
  if (health.ok !== true
    || health.contract_version !== identity.contract.contract_version
    || health.schema_hash !== identity.contract.schema_hash
    || health.fixture_manifest_hash !== identity.contract.fixture_manifest_hash
    || !sameCapabilityList(health.supported_operations, CORE_OPERATIONS)
    || !sameCapabilityList(health.supported_commands, identity.contract.supported_commands)
    || !sameCapabilityList(health.supported_projections, identity.contract.supported_projections)) {
    throw new EduPiSnapshotError("health_identity", "Core health identity mismatch");
  }
  return { health, runtime: resolved.runtime, dataRoot: resolved.dataRoot };
}

export async function readEduPiKernelProjection({
  requestId = `desktop-kernel-${Date.now().toString(36)}`,
  signal,
  roots,
}: {
  requestId?: string;
  signal?: AbortSignal;
  roots?: EduPiBridgeRoots;
} = {}): Promise<{ projection: CoreProactiveWorkProjection; runtime: ResolvedEduPiCore; dataRoot: ResolvedEduPiDataRoot }> {
  const resolved = roots || resolveEduPiBridgeRoots();
  let response: Record<string, unknown>;
  try {
    response = await callEduPiCore<Record<string, unknown>>({ operation: "kernel", requestId, runtime: resolved.runtime, dataRoot: resolved.dataRoot, signal });
  } catch (error) {
    if (error instanceof EduPiCoreProcessError) throw new EduPiSnapshotError(error.code, "Core proactive work projection unavailable");
    throw new EduPiSnapshotError("process", "Core proactive work projection unavailable");
  }
  const projection = response.projection as CoreProactiveWorkProjection | undefined;
  const summary = projection?.summary;
  if (response.ok !== true
    || response.operation !== "kernel"
    || projection?.projection_kind !== "proactive_work_kernel"
    || !Array.isArray(projection.runs)
    || !summary
    || ![summary.total, summary.running, summary.failed, summary.needs_review, summary.succeeded, summary.skipped].every(Number.isInteger)) {
    throw new EduPiSnapshotError("projection_unavailable", "Core proactive work projection unavailable");
  }
  return { projection, runtime: resolved.runtime, dataRoot: resolved.dataRoot };
}

export async function readEduPiMemoryScopes({
  requestId = `desktop-memory-scopes-${Date.now().toString(36)}`,
  signal,
  roots,
}: {
  requestId?: string;
  signal?: AbortSignal;
  roots?: EduPiBridgeRoots;
} = {}): Promise<{ projection: EducationMemoryScopeProjection; runtime: ResolvedEduPiCore; dataRoot: ResolvedEduPiDataRoot }> {
  const resolved = roots || resolveEduPiBridgeRoots();
  let response: Record<string, unknown>;
  try {
    response = await callEduPiCore<Record<string, unknown>>({ operation: "memory-scopes", requestId, runtime: resolved.runtime, dataRoot: resolved.dataRoot, signal });
  } catch (error) {
    if (error instanceof EduPiCoreProcessError) throw new EduPiSnapshotError(error.code, "Core memory scope projection unavailable");
    throw new EduPiSnapshotError("process", "Core memory scope projection unavailable");
  }
  const projection = response.projection as EducationMemoryScopeProjection | undefined;
  if (response.ok !== true
    || response.operation !== "memory-scopes"
    || projection?.projection_kind !== "scoped_education_memory"
    || projection.projection_version !== 1
    || !Array.isArray(projection.contexts)
    || !Array.isArray(projection.semesters)
    || !Array.isArray(projection.bindings)
    || projection.external_send !== false) {
    throw new EduPiSnapshotError("projection_unavailable", "Core memory scope projection unavailable");
  }
  return { projection, runtime: resolved.runtime, dataRoot: resolved.dataRoot };
}
