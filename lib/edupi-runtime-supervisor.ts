import { fork } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { validateContainedRegularFile, type ResolvedEduPiCore, type ResolvedEduPiDataRoot } from "./edupi-core-root";
import { attachRuntimeModelHost, createRuntimeModelHost } from "./edupi-runtime-model-host";

export type EduPiRuntimeHandle = { call(operation: string, payload: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; callOwnerControl(operation: string, payload: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; callBridge(request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> };
type Entry = { identity: string; startup: Promise<EduPiRuntimeHandle>; handle?: EduPiRuntimeHandle; kill?: () => void };
const shared = globalThis as typeof globalThis & {
  __edupiRuntimeSupervisors?: Map<string, Entry>;
  __edupiRuntimeRestartLocks?: Map<string, Promise<EduPiRuntimeHandle>>;
  __edupiRuntimeExitHook?: boolean;
};
const entries = shared.__edupiRuntimeSupervisors ||= new Map<string, Entry>();
const restartLocks = shared.__edupiRuntimeRestartLocks ||= new Map<string, Promise<EduPiRuntimeHandle>>();
const STARTUP_FAILURE_REASONS = Object.freeze({
  runtime_database_unavailable: "Core Runtime 数据库不可用（runtime_database_unavailable）",
  runtime_root_invalid: "Core Runtime 数据目录校验失败（runtime_root_invalid）",
  runtime_state_invalid: "Core Runtime 状态需要修复（runtime_state_invalid）",
  runtime_writer_unavailable: "Core Runtime 正被另一个写入进程占用（runtime_writer_unavailable）",
});
type StartupFailureCode = keyof typeof STARTUP_FAILURE_REASONS | "runtime_unavailable";
const STARTUP_FAILURE_CODES = new Set<StartupFailureCode>([...(Object.keys(STARTUP_FAILURE_REASONS) as Array<keyof typeof STARTUP_FAILURE_REASONS>), "runtime_unavailable"]);
function startupFailureCode(value: unknown): StartupFailureCode {
  const code = typeof value === "object" && value && "code" in value ? (value as { code?: unknown }).code : value;
  return typeof code === "string" && STARTUP_FAILURE_CODES.has(code as StartupFailureCode) ? code as StartupFailureCode : "runtime_unavailable";
}
const unavailable = (code: StartupFailureCode = "runtime_unavailable") => Object.assign(new Error("EduPi runtime unavailable."), { code: startupFailureCode(code) });

export function describeEduPiRuntimeStartupFailure(error: unknown): string | null {
  const code = startupFailureCode(error);
  return code === "runtime_unavailable" ? null : STARTUP_FAILURE_REASONS[code];
}
if (!shared.__edupiRuntimeExitHook) {
  shared.__edupiRuntimeExitHook = true;
  process.once("exit", () => { for (const entry of entries.values()) entry.kill?.(); });
}

export function getActiveEduPiRuntime(dataRoot: string): EduPiRuntimeHandle | null { return entries.get(dataRoot)?.handle || null; }
export function getPendingEduPiRuntime(dataRoot: string): Promise<EduPiRuntimeHandle> | null { return entries.get(dataRoot)?.startup || null; }
export async function closeAllEduPiRuntimes(): Promise<void> {
  await Promise.allSettled([...entries.values()].map(async entry => { try { await (await entry.startup).close(); } catch { entry.kill?.(); } }));
}

export function ensureEduPiRuntime({ runtime, dataRoot }: { runtime: ResolvedEduPiCore; dataRoot: ResolvedEduPiDataRoot }): Promise<EduPiRuntimeHandle> {
  const identity = `${runtime.root}:${runtime.coreCommit}:${runtime.componentManifestHash}`;
  const existing = entries.get(dataRoot.root);
  if (existing) {
    if (existing.identity !== identity) return Promise.reject(unavailable());
    return existing.startup;
  }
  const entry: Entry = { identity, startup: Promise.resolve(null as unknown as EduPiRuntimeHandle) };
  entries.set(dataRoot.root, entry);
  entry.startup = start(runtime, dataRoot, entry).then(handle => { entry.handle = handle; return handle; }).catch(error => { if (entries.get(dataRoot.root) === entry) entries.delete(dataRoot.root); throw unavailable(startupFailureCode(error)); });
  return entry.startup;
}

export function restartEduPiRuntime(args: { runtime: ResolvedEduPiCore; dataRoot: ResolvedEduPiDataRoot }): Promise<EduPiRuntimeHandle> {
  const key = args.dataRoot.root;
  const existingRestart = restartLocks.get(key);
  if (existingRestart) return existingRestart;

  const restart = (async () => {
    const existing = entries.get(key);
    if (existing) {
      try {
        const handle = await existing.startup;
        await handle.close();
      } catch {
        existing.kill?.();
        if (entries.get(key) === existing) entries.delete(key);
      }
    }
    return ensureEduPiRuntime(args);
  })();
  restartLocks.set(key, restart);
  void restart.finally(() => {
    if (restartLocks.get(key) === restart) restartLocks.delete(key);
  }).catch(() => {});
  return restart;
}

async function start(runtime: ResolvedEduPiCore, dataRoot: ResolvedEduPiDataRoot, entry: Entry): Promise<EduPiRuntimeHandle> {
  const load = (file: string) => import(/* webpackIgnore: true */ pathToFileURL(path.join(runtime.root, "scripts", file)).href);
  const manifestFile = validateContainedRegularFile({ allowedRoot: runtime.root, candidate: path.join(runtime.root, "contracts/edupi-core-runtime-component-manifest.json") });
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.entrypoint !== "scripts/core_runtime_daemon.mjs" || manifest.component_manifest_version !== "1" || !/^sha256:[a-f0-9]{64}$/.test(manifest.component_manifest_hash)) throw unavailable();
  for (const file of [...manifest.modules, ...manifest.assets]) validateContainedRegularFile({ allowedRoot: runtime.root, candidate: path.resolve(runtime.root, file.path) });
  for (const dependency of manifest.runtime_dependencies) for (const file of dependency.files) validateContainedRegularFile({ allowedRoot: runtime.root, candidate: path.resolve(runtime.root, file.path), allowNodeModulesSymlink: true });
  const { generateComponentManifest } = await load("edupi_component_manifest.mjs");
  const expected = generateComponentManifest({ root: runtime.root, entrypoint: manifest.entrypoint, assets: manifest.assets.map((item: { path: string }) => item.path), outputPath: manifestFile, write: false });
  if (!isDeepStrictEqual(expected, manifest)) throw unavailable();
  const protocol = await load("core_runtime_protocol.mjs");
  const { verifyCoreRuntimeRoot } = await load("core_runtime_root.mjs");
  const token = randomBytes(32).toString("hex");
  const supervisorSessionId = randomUUID();
  const packaged = path.join(process.cwd(), "core-runtime-host.mjs");
  const bootstrap = fs.existsSync(packaged) ? packaged : path.join(process.cwd(), "desktop/core-runtime-host.mjs");
  const configuredStateDir = process.env.PI_DESKTOP_STATE_DIR?.trim();
  const ambientPlanning = process.env.EDUPI_AMBIENT_PLANNING === "1";
  const ownerControlToken = ambientPlanning ? randomBytes(32).toString("base64url") : null;
  const child = fork(bootstrap, [], {
    cwd: runtime.root, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { PATH: process.env.PATH, LANG: process.env.LANG || "en_US.UTF-8", TZ: process.env.TZ || "Asia/Shanghai", NODE_ENV: process.env.NODE_ENV || "production", EDUPI_PROJECT_ROOT: dataRoot.root, EDUPI_HOME: path.join(dataRoot.root, ".edupi"), EDUPI_MEMORY_DIR: dataRoot.memoryDir, EDUPI_OUTPUT_DIR: dataRoot.outputDir, EDUPI_LOCK_DIR: dataRoot.lockDir, EDUPI_CORE_COMMIT: runtime.coreCommit, EDUPI_CORE_PARENT_PID: String(process.pid), ...(configuredStateDir && path.isAbsolute(configuredStateDir) ? { PI_DESKTOP_STATE_DIR: path.resolve(configuredStateDir) } : {}) },
  });
  entry.kill = () => { child.kill("SIGKILL"); };
  const modelHost = attachRuntimeModelHost(child, createRuntimeModelHost({ coreRoot: runtime.root, projectRoot: dataRoot.root }));
  let exited = false, stopping = false;
  const requests = new Set<AbortController>();
  const exit = new Promise<void>(resolve => child.once("close", () => { exited = true; for (const controller of requests) controller.abort(); if (entries.get(dataRoot.root) === entry) entries.delete(dataRoot.root); resolve(); }));
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    stopping = true;
    for (const controller of requests) controller.abort();
    closing = (async () => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        if (!exited) { if (child.connected) child.send({ type: "runtime-stop" }, () => {}); else child.kill("SIGTERM"); }
        await Promise.all([exit, modelHost.close()]);
      } finally { clearTimeout(timer); if (entries.get(dataRoot.root) === entry) entries.delete(dataRoot.root); }
    })();
    return closing;
  };
  child.once("disconnect", () => { void close(); });
  child.once("error", () => { void close(); });
  let endpoint: string;
  try {
    endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(unavailable()); }, 15000);
      const failed = (code: StartupFailureCode = "runtime_unavailable") => { cleanup(); reject(unavailable(code)); };
      const failedGenerically = () => { failed(); };
      const cleanup = () => { clearTimeout(timer); child.off("message", ready); child.off("exit", failedGenerically); child.off("error", failedGenerically); child.off("disconnect", failedGenerically); };
      const ready = (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const value = message as Record<string, unknown>;
        if (value.type === "runtime-error") { failed(startupFailureCode(value.code)); return; }
        if (value.type !== "runtime-ready") return;
        try {
          const url = new URL(String(value.endpoint));
          const verifiedRoot = verifyCoreRuntimeRoot(dataRoot.root);
          if (!verifiedRoot.ok || value.dataRootFingerprint !== verifiedRoot.dataRootFingerprint) throw unavailable();
          if (value.host !== "127.0.0.1" || url.hostname !== "127.0.0.1" || url.protocol !== "http:" || url.pathname !== protocol.CORE_RUNTIME_ENDPOINT || url.username || url.password || url.search || url.hash || Number(url.port) !== value.port || value.protocol !== protocol.CORE_RUNTIME_PROTOCOL || value.protocolVersion !== protocol.CORE_RUNTIME_PROTOCOL_VERSION || value.contractVersion !== protocol.CORE_RUNTIME_CONTRACT_VERSION || value.schemaHash !== protocol.CORE_RUNTIME_SCHEMA_HASH || value.supervisorSessionId !== supervisorSessionId || value.coreCommit !== runtime.coreCommit || value.componentManifestHash !== manifest.component_manifest_hash || !/^sha256:[a-f0-9]{64}$/.test(String(value.dataRootFingerprint)) || !Number.isSafeInteger(value.fencingGeneration) || Number(value.fencingGeneration) < 1 || typeof value.instanceNonce !== "string" || !value.instanceNonce) throw unavailable();
          cleanup(); resolve(url.href);
        } catch { failed(); }
      };
      child.on("message", ready); child.once("exit", failedGenerically); child.once("error", failedGenerically); child.once("disconnect", failedGenerically);
      child.send({ type: "runtime-start", coreRoot: runtime.root, options: {
        dataRoot: dataRoot.root, token, supervisorSessionId, coreCommit: runtime.coreCommit,
        componentManifestHash: manifest.component_manifest_hash, port: 0,
        ...(ambientPlanning ? { ambientPlanning: true } : {}),
        ...(ownerControlToken ? { ownerControlToken } : {}),
      } }, error => { if (error) failed(); });
    });
  } catch (error) { await close(); throw unavailable(startupFailureCode(error)); }
  const callRuntime = async (operation: string, payload: unknown, signal?: AbortSignal, ownerControl = false) => {
    if (ownerControl && !ownerControlToken) throw unavailable();
    if (exited || stopping) throw unavailable();
    const request = { protocol: protocol.CORE_RUNTIME_PROTOCOL, protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION, schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH, request_id: randomUUID(), operation, payload };
    if (!protocol.validateRuntimeRequest(request).ok) throw Object.assign(new Error("Invalid runtime request."), { code: "invalid_request" });
    const bytes = JSON.stringify(request);
    if (Buffer.byteLength(bytes) > protocol.CORE_RUNTIME_OUTER_REQUEST_MAX_BYTES) throw Object.assign(new Error("Runtime request too large."), { code: "invalid_request" });
    const controller = new AbortController(); requests.add(controller);
    const cancel = () => controller.abort(); signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(cancel, 30000);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      if (ownerControlToken && ownerControl) headers["x-edupi-owner-control"] = ownerControlToken;
      const response = await fetch(endpoint, { method: "POST", redirect: "error", headers, body: bytes, signal: controller.signal });
      if (!response.body) throw unavailable();
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > protocol.CORE_RUNTIME_OUTER_RESPONSE_MAX_BYTES) { await reader.cancel(); throw unavailable(); } chunks.push(next.value); }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!protocol.validateRuntimeResponse(result).ok || result.request_id !== request.request_id || result.operation !== operation) throw unavailable();
      return result;
    } catch { throw unavailable(); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); requests.delete(controller); }
  };
  return {
    close,
    async callBridge(this: EduPiRuntimeHandle, request: unknown, signal?: AbortSignal) {
      const kind = protocol.classifyCoreRuntimeBridgeRequest(request);
      if (kind !== "read" && kind !== "call") throw Object.assign(new Error("Invalid runtime bridge request."), { code: "invalid_request" });
      return callRuntime(kind === "read" ? "bridge_read" : "bridge_call", { bridge_frame: JSON.stringify(request) }, signal, false);
    },
    call: (operation, payload, signal) => callRuntime(operation, payload, signal, false),
    callOwnerControl: (operation, payload, signal) => callRuntime(operation, payload, signal, true),
  };
}
