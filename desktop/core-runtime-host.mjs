import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STARTUP_ERROR_CODES = Object.freeze({
  database_unavailable: "runtime_database_unavailable",
  runtime_store_unavailable: "runtime_database_unavailable",
  runtime_store_busy: "runtime_writer_unavailable",
  authority_unavailable: "runtime_writer_unavailable",
  writer_admission_unavailable: "runtime_writer_unavailable",
  schema_mismatch: "runtime_state_invalid",
  root_fingerprint_mismatch: "runtime_state_invalid",
  invalid_state: "runtime_state_invalid",
  unsupported_root: "runtime_root_invalid",
  native_attestation_required: "runtime_root_invalid",
  invalid_root: "runtime_root_invalid",
  runtime_path_invalid: "runtime_root_invalid",
  layout_mismatch: "runtime_root_invalid",
  writer_admission_root_mismatch: "runtime_root_invalid",
  writer_admission_path_invalid: "runtime_root_invalid",
});

export function classifyCoreRuntimeStartupError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  return STARTUP_ERROR_CODES[code] || (code.startsWith("writer_admission_") ? "runtime_writer_unavailable" : "runtime_unavailable");
}

export function createParentModelExecutor(channel = process) {
  const pending = new Map();
  let closed = false;
  const error = () => Object.assign(new Error("Model host unavailable."), { code: "model_unavailable" });
  const message = value => {
    if (!value || !["model-result", "model-error"].includes(value.type)) return;
    const item = pending.get(value.id);
    if (!item) return;
    pending.delete(value.id); item.cleanup();
    if (value.type === "model-result") item.resolve(value.result); else item.reject(error());
  };
  const close = () => {
    closed = true; channel.off("message", message);
    for (const [id, item] of pending) { if (channel.connected) channel.send({ type: "model-cancel", id }, () => {}); item.cleanup(); item.reject(error()); }
    pending.clear();
  };
  channel.on("message", message);
  channel.once("disconnect", close);
  return {
    run(request, { signal }) {
      if (closed || !channel.connected || signal.aborted) return Promise.reject(error());
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const cancel = () => { if (channel.connected) channel.send({ type: "model-cancel", id }, () => {}); };
        const timer = setTimeout(() => { cancel(); pending.delete(id); cleanup(); reject(error()); }, Math.max(1, Math.min(305000, Date.parse(request.deadline_at) - Date.now() + 5000)));
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); };
        pending.set(id, { resolve, reject, cleanup });
        signal.addEventListener("abort", cancel, { once: true });
        channel.send({ type: "model-run", id, request }, sendError => { if (sendError) { pending.delete(id); cleanup(); reject(error()); } });
        if (signal.aborted) cancel();
      });
    },
    close,
  };
}

export async function startCoreRuntimeHost({ coreRoot, options }, channel = process) {
  if (!options || Object.keys(options).some(key => !["dataRoot", "token", "supervisorSessionId", "coreCommit", "componentManifestHash", "port", "ambientPlanning", "ownerControlToken"].includes(key))
    || (options.ambientPlanning !== undefined && typeof options.ambientPlanning !== "boolean")) throw new Error("Invalid runtime bootstrap.");
  const hostExecutor = createParentModelExecutor(channel);
  try {
    const { createCoreRuntimeDaemon } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_daemon.mjs")).href);
    const daemon = await createCoreRuntimeDaemon({ ...options, g1Live: { hostExecutor: { run: hostExecutor.run }, leaseMs: 300000 } });
    return { daemon, async close() { hostExecutor.close(); await daemon.close(); } };
  } catch (error) { hostExecutor.close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let started = false;
  let startup;
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    try { const host = await startup; await host?.close(); process.exit(0); } catch { process.exit(1); }
  };
  process.once("disconnect", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
  process.once("SIGINT", () => { void stop(); });
  const startupTimer = setTimeout(() => { void stop(); }, 10000);
  process.on("message", value => {
    if (value?.type === "runtime-stop") { void stop(); return; }
    if (value?.type !== "runtime-start" || started || closing) return;
    started = true; clearTimeout(startupTimer);
    startup = startCoreRuntimeHost(value);
    void startup.then(({ daemon }) => {
      if (!process.connected || closing) return;
      const { endpoint, host, port, protocol, protocolVersion, contractVersion, schemaHash, supervisorSessionId, instanceNonce, coreCommit, componentManifestHash, dataRootFingerprint, fencingGeneration } = daemon;
      process.send({ type: "runtime-ready", endpoint, host, port, protocolVersion, protocol, contractVersion, schemaHash, supervisorSessionId, instanceNonce, coreCommit, componentManifestHash, dataRootFingerprint, fencingGeneration });
    }, error => { if (process.connected) process.send({ type: "runtime-error", code: classifyCoreRuntimeStartupError(error) }, () => process.exit(1)); else process.exit(1); });
  });
}
