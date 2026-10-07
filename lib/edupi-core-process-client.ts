import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import type { ResolvedEduPiCore, ResolvedEduPiDataRoot } from "./edupi-core-root";
import { getPendingEduPiRuntime } from "./edupi-runtime-supervisor";
import { coreRuntimeCanaryEnvironment } from "./safe-mode";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const CORE_READ_TIMEOUT_MS = 15_000;
const CORE_COMMAND_TIMEOUT_MS = 15_000;
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

export function runCoreProcess<T = unknown>({
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
}): Promise<T> {
  if (!dataRoot) return Promise.reject(new EduPiCoreProcessError("data_root", "Validated EduPi data root is required"));
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) return Promise.reject(new EduPiCoreProcessError("request_limit", "Core request exceeds limit"));
  if (signal?.aborted) return Promise.reject(new EduPiCoreProcessError("aborted", "Core request aborted"));

  const pendingRuntime = getPendingEduPiRuntime(dataRoot.root);
  if (pendingRuntime) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void;
    const interrupted = new Promise<T>((_resolve, reject) => {
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
    try { return JSON.parse(frame) as T; }
    catch { throw new EduPiCoreProcessError("invalid_json", "Invalid Core runtime response"); }
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
      try { resolve(JSON.parse(frames[0]) as T); }
      catch { reject(new EduPiCoreProcessError("stdout_json", "Core stdout is not valid JSON")); }
    });
    child.stdin.end(input);
  });
}

export async function callEduPiCore<T = unknown>({
  operation,
  requestId,
  runtime,
  dataRoot,
  envelope,
  scheduleOccurrenceVersion,
  signal,
}: {
  operation: "health" | "snapshot" | "command" | "kernel" | "memory-scopes" | "teaching-skills" | "connectors" | "agent-computer" | "platform" | "connector-setup";
  requestId: string;
  runtime: ResolvedEduPiCore;
  dataRoot?: ResolvedEduPiDataRoot;
  envelope?: unknown;
  scheduleOccurrenceVersion?: "1.2";
  signal?: AbortSignal;
}): Promise<T> {
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
  return runCoreProcess<T>({ runtime, dataRoot, request, timeoutMs: operation === "command" ? CORE_COMMAND_TIMEOUT_MS : CORE_READ_TIMEOUT_MS, signal });
}
