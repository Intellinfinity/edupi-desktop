import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import type { ResolvedEduPiCore, ResolvedEduPiDataRoot } from "./edupi-core-root";
import { getPendingEduPiRuntime, eduPiBridgeRequestBudget } from "./edupi-runtime-supervisor";
export { eduPiBridgeRequestBudget } from "./edupi-runtime-supervisor";
import { coreRuntimeCanaryEnvironment } from "./safe-mode";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const CORE_READ_TIMEOUT_MS = 15_000;
const MAX_MATERIAL_PROPOSAL_BYTES = 640 * 1024 + 4096;
const MAX_LESSON_PROPOSAL_BYTES = 16 * 1024;

export type EduPiMaterialScheduleReadResult = {
  version: 1; root_ref: string; owner_id: string;
  source: { material_id: string; review_target_id: string | null; staging_id: string; source_hash: string; expected_size_bytes: number;
    relative_path: string; intake_state: "accepted"; metadata_revision: number; metadata_head_hash: string;
    metadata: { title: string; kind: string; subject: string | null; class_id: string | null };
    review_target: { status: string; revision: number; teacher_review_state: string; teacher_review_revision: number } | null };
  options: { default_time_zone: string | null; window_start: string | null; window_end: string | null; max_occurrences: 200 };
  status: "ready" | "partial" | "unresolved";
  events: Array<{ event_id: string; date: string; end_date: string | null; name: string;
    type: "exam" | "activity" | "meeting" | "holiday" | "festival" | "teaching" | "custom"; confidence: "inferred"; notes: null;
    source_occurrence_ref?: string; location: string | null; time_interval?: { start: string; end: string; time_zone: string } }>;
  issues: Array<{ code: string; path: string; message: string; source_occurrence_ref?: string }>;
  evidence: Array<{ path: string; property: string; value: string; event_ids: string[] }>;
  parse_fingerprint: string; read_only: true; automatic_import: false; external_send: false;
};
export type EduPiMaterialScheduleProposal = { material_id: string; read_only: true; automatic_import: false; external_send: false } & (
  | { status: "proposed"; read_result: EduPiMaterialScheduleReadResult & { status: "ready" }; reason_code: null }
  | { status: "held"; read_result: EduPiMaterialScheduleReadResult; reason_code: "material_schedule_unresolved" }
  | { status: "unavailable"; read_result: null; reason_code: "owner_control_disabled" | "owner_identity_mismatch" | "material_schedule_invalid"
    | "material_schedule_unavailable" | "material_schedule_source_unavailable" | "material_schedule_stale" | "material_schedule_proposal_capacity" }
);
export type EduPiMaterialLessonProposal = { material_id: string; read_only: true; automatic_prepare: false; external_send: false } & (
  | { status: "proposed"; source_hash: string; metadata_revision: number; lesson_date: string; lesson_date_path: string;
    lesson: { slot_id: string; task_id: string; source_event_date: string; starts_at: string; time_zone: string };
    basis_hash: string; reason_code: null }
  | { status: "held" | "unavailable"; lesson: null; reason_code: string }
);
export type EduPiCoreProcessResult<T> = { response: T; bridgeFrame: string; runtimeMetadata: {
  materialScheduleProposal?: EduPiMaterialScheduleProposal;
  materialLessonProposal?: EduPiMaterialLessonProposal;
} };

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

async function runtimeMetadata(runtime: ResolvedEduPiCore, request: unknown, response: unknown, outer: unknown): Promise<EduPiCoreProcessResult<unknown>["runtimeMetadata"]> {
  const proposal = record(outer)?.material_schedule_proposal;
  const lesson = record(outer)?.material_lesson_proposal;
  if (proposal === undefined && lesson === undefined) return {};
  const frame = record(request), envelope = record(frame?.envelope), command = record(envelope?.command);
  const receiptEnvelope = record(record(response)?.receipt), receipt = record(receiptEnvelope?.payload);
  const id = Array.isArray(receipt?.applied_ids) && receipt.applied_ids.length === 1 ? receipt.applied_ids[0] : undefined;
  if (frame?.operation !== "command" || command?.command_type !== "intake_material" || record(response)?.ok !== true
    || record(response)?.operation !== "command" || frame.request_id !== envelope?.request_id
    || record(response)?.request_id !== frame.request_id || receipt?.command_type !== "intake_material"
    || receipt.command_id !== envelope?.message_id || receipt.request_id !== envelope?.request_id
    || receiptEnvelope?.request_id !== envelope?.request_id || receipt.receipt_phase !== "mutation"
    || !["accepted", "modified"].includes(String(receipt.status)) || !Array.isArray(receipt.rejected_ids) || receipt.rejected_ids.length
    || record(receipt.target)?.target_kind !== "material_intake" || typeof id !== "string" || !id || id.length > 160) return {};
  const metadata: EduPiCoreProcessResult<unknown>["runtimeMetadata"] = {};
  try {
    const protocol = await import(/* webpackIgnore: true */ pathToFileURL(resolve(runtime.root, "scripts/core_runtime_protocol.mjs")).href);
    if (proposal !== undefined) {
      const oversized = Buffer.byteLength(JSON.stringify(proposal)) > MAX_MATERIAL_PROPOSAL_BYTES;
      const read = record(record(proposal)?.read_result), source = record(read?.source);
      const valid = !oversized && protocol.MaterialScheduleProposalSchema
        && Value.Check(protocol.MaterialScheduleProposalSchema as TSchema, proposal)
        && record(proposal)?.material_id === id
        && (!read || source?.material_id === id && source.source_hash === record(command.material)?.source_hash);
      metadata.materialScheduleProposal = valid ? structuredClone(proposal) as EduPiMaterialScheduleProposal
        : { status: "unavailable", material_id: id, read_result: null,
          reason_code: oversized ? "material_schedule_proposal_capacity" : "material_schedule_invalid",
          read_only: true, automatic_import: false, external_send: false };
    }
    if (lesson !== undefined) {
      const oversized = Buffer.byteLength(JSON.stringify(lesson)) > MAX_LESSON_PROPOSAL_BYTES;
      const valid = !oversized && protocol.MaterialLessonProposalSchema
        && Value.Check(protocol.MaterialLessonProposalSchema as TSchema, lesson)
        && record(lesson)?.material_id === id
        && (record(lesson)?.status !== "proposed" || record(lesson)?.source_hash === record(command.material)?.source_hash);
      metadata.materialLessonProposal = valid ? structuredClone(lesson) as EduPiMaterialLessonProposal
        : { status: "unavailable", material_id: id, lesson: null,
          reason_code: oversized ? "lesson_proposal_capacity" : "lesson_source_unavailable",
          read_only: true, automatic_prepare: false, external_send: false };
    }
    return metadata;
  } catch {
    return {
      ...(proposal === undefined ? {} : { materialScheduleProposal: { status: "unavailable", material_id: id, read_result: null,
        reason_code: "material_schedule_invalid", read_only: true, automatic_import: false, external_send: false } as const }),
      ...(lesson === undefined ? {} : { materialLessonProposal: { status: "unavailable", material_id: id, lesson: null,
        reason_code: "lesson_source_unavailable", read_only: true, automatic_prepare: false, external_send: false } as const }),
    };
  }
}
const CORE_WRITER_DENIAL_CODES = new Set([
  "writer_admission_unavailable", "writer_admission_layout_mismatch", "writer_admission_invalid_root",
  "writer_admission_root_mismatch", "writer_admission_schema_mismatch", "writer_admission_path_invalid",
  "writer_admission_required", "writer_admission_invalidated", "writer_admission_release_failed",
]);

export function isCoreWriterDenialCode(value: unknown): value is string {
  return typeof value === "string" && CORE_WRITER_DENIAL_CODES.has(value);
}

export class EduPiCoreProcessError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EduPiCoreProcessError";
  }
}

function redactedDiagnostic(value: string): string {
  return value
    .replace(/(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi, "[redacted]")
    .slice(0, 2000);
}

function allowedEnvironment(runtime: ResolvedEduPiCore, dataRoot: ResolvedEduPiDataRoot): NodeJS.ProcessEnv {
  const configuredStateDir = process.env.PI_DESKTOP_STATE_DIR?.trim();
  return {
    PATH: process.env.PATH,
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    TZ: process.env.TZ || "Asia/Shanghai",
    NODE_ENV: process.env.NODE_ENV || "production",
    EDUPI_PROJECT_ROOT: dataRoot.root,
    EDUPI_HOME: resolve(dataRoot.root, ".edupi"),
    EDUPI_CORE_PARENT_PID: String(process.pid),
    EDUPI_MEMORY_DIR: dataRoot.memoryDir,
    EDUPI_OUTPUT_DIR: dataRoot.outputDir,
    EDUPI_LOCK_DIR: dataRoot.lockDir,
    EDUPI_CORE_COMMIT: runtime.coreCommit,
    ...coreRuntimeCanaryEnvironment(process.platform, process.env),
    ...(configuredStateDir && isAbsolute(configuredStateDir) ? { PI_DESKTOP_STATE_DIR: resolve(configuredStateDir) } : {}),
  };
}

export function runCoreProcess<T = unknown>(options: Parameters<typeof runCoreProcessWithMetadata<T>>[0]): Promise<T> {
  return runCoreProcessWithMetadata<T>(options).then(result => result.response);
}

export function runCoreProcessWithMetadata<T = unknown>({
  runtime,
  dataRoot,
  request,
  timeoutMs,
  signal,
}: {
  runtime: ResolvedEduPiCore;
  dataRoot?: ResolvedEduPiDataRoot;
  request: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<EduPiCoreProcessResult<T>> {
  if (!dataRoot) return Promise.reject(new EduPiCoreProcessError("data_root", "Validated EduPi data root is required"));
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) return Promise.reject(new EduPiCoreProcessError("request_limit", "Core request exceeds limit"));
  if (signal?.aborted) return Promise.reject(new EduPiCoreProcessError("aborted", "Core request aborted"));

  const pendingRuntime = getPendingEduPiRuntime(dataRoot.root);
  if (pendingRuntime) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void;
    const interrupted = new Promise<EduPiCoreProcessResult<T>>((_resolve, reject) => {
      abort = () => { controller.abort(); reject(new EduPiCoreProcessError("aborted", "Core request aborted")); };
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new EduPiCoreProcessError("timeout", "Core request timed out")); }, timeoutMs);
      if (signal?.aborted) abort();
    });
    const completed = pendingRuntime.then(async (host) => {
    if (controller.signal.aborted) throw new EduPiCoreProcessError("aborted", "Core request aborted");
    const result = await host.callBridge(request, controller.signal);
    if (!result.ok) throw new EduPiCoreProcessError("runtime_unavailable", "Core runtime rejected the request");
    const frame = (result.result as { bridge_frame?: unknown } | undefined)?.bridge_frame;
    if (typeof frame !== "string" || Buffer.byteLength(frame) > MAX_STDOUT_BYTES) throw new EduPiCoreProcessError("stdout_limit", "Invalid Core runtime frame");
    let response: T;
    try { response = JSON.parse(frame) as T; }
    catch { throw new EduPiCoreProcessError("invalid_json", "Invalid Core runtime response"); }
    const metadata = await runtimeMetadata(runtime, request, response, result.result);
    if (controller.signal.aborted) throw new EduPiCoreProcessError("aborted", "Core request aborted");
    return { response, bridgeFrame: frame, runtimeMetadata: metadata };
    });
    return Promise.race([completed, interrupted]).finally(() => { clearTimeout(timer); signal?.removeEventListener("abort", abort); });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtime.entrypoint], {
      cwd: runtime.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: allowedEnvironment(runtime, dataRoot),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (!child.killed) child.kill("SIGKILL");
      reject(error);
    };
    const onAbort = () => finishError(new EduPiCoreProcessError("aborted", "Core request aborted"));
    const timer = setTimeout(() => finishError(new EduPiCoreProcessError("timeout", "Core request timeout")), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) return finishError(new EduPiCoreProcessError("stdout_limit", "Core stdout limit exceeded"));
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) return finishError(new EduPiCoreProcessError("stderr_limit", "Core stderr limit exceeded"));
      stderr.push(chunk);
    });
    child.on("error", (error) => finishError(new EduPiCoreProcessError("spawn_error", error.message)));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const stderrText = redactedDiagnostic(Buffer.concat(stderr).toString("utf8"));
      const text = Buffer.concat(stdout).toString("utf8").trim();
      const frames = text ? text.split("\n").filter((line) => line.trim()) : [];
      if (code !== 0) {
        if (frames.length === 1) {
          try {
            const failure = JSON.parse(frames[0]) as Record<string, unknown> | null;
            const sent = request as { operation?: unknown; request_id?: unknown } | null;
            if (failure?.ok === false && typeof sent?.request_id === "string" && failure.request_id === sent.request_id
              && typeof sent.operation === "string" && failure.operation === sent.operation && isCoreWriterDenialCode(failure.code)) {
              return reject(new EduPiCoreProcessError(failure.code, "Core writer admission denied"));
            }
          } catch { /* Unknown or malformed failures retain the generic nonzero exit. */ }
        }
        return reject(new EduPiCoreProcessError("nonzero_exit", `Core process exit ${code}: ${stderrText}`));
      }
      if (frames.length !== 1) return reject(new EduPiCoreProcessError("stdout_frames", "Core stdout must contain exactly one frame"));
      try { resolve({ response: JSON.parse(frames[0]) as T, bridgeFrame: Buffer.concat(stdout).toString("utf8"), runtimeMetadata: {} }); }
      catch { reject(new EduPiCoreProcessError("stdout_json", "Core stdout is not valid JSON")); }
    });
    child.stdin.end(input);
  });
}

type EduPiCoreCallOptions = {
  operation: "health" | "snapshot" | "command" | "kernel" | "memory-scopes" | "teaching-skills" | "connectors" | "agent-computer" | "platform" | "connector-setup";
  requestId: string; runtime: ResolvedEduPiCore; dataRoot?: ResolvedEduPiDataRoot; envelope?: unknown;
  scheduleOccurrenceVersion?: "1.2"; signal?: AbortSignal;
};
export async function callEduPiCore<T = unknown>(options: EduPiCoreCallOptions): Promise<T> {
  return (await callEduPiCoreWithMetadata<T>(options)).response;
}

export async function callEduPiCoreWithMetadata<T = unknown>({
  operation,
  requestId,
  runtime,
  dataRoot,
  envelope,
  scheduleOccurrenceVersion,
  signal,
}: EduPiCoreCallOptions): Promise<EduPiCoreProcessResult<T>> {
  if (scheduleOccurrenceVersion !== undefined && operation !== "snapshot") {
    throw new EduPiCoreProcessError("invalid_request", "Schedule occurrence projection is available only for snapshot reads");
  }
  const request = {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation,
    request_id: requestId,
    ...(scheduleOccurrenceVersion === undefined ? {} : { schedule_occurrence_version: scheduleOccurrenceVersion }),
    ...(envelope === undefined ? {} : { envelope }),
  };
  return runCoreProcessWithMetadata<T>({ runtime, dataRoot, request, timeoutMs: operation === "command" ? eduPiBridgeRequestBudget(request).transportMs : CORE_READ_TIMEOUT_MS, signal });
}
