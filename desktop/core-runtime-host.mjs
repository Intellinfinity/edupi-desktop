import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { boundedPrivateData, privateDataKeys, validatePrivateModelConfiguration, MAX_PRIVATE_MODEL_CONFIG_BYTES,
  G1_MODEL_MAX_CALLS, G1_MODEL_TIMEOUT_MS } from "./core-runtime-model-config.mjs";

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

export function createParentModelExecutor(channel = process, { configurationTimeoutMs = 6000 } = {}) {
  const pending = new Map();
  let closed = false;
  const error = () => Object.assign(new Error("Model host unavailable."), { code: "model_unavailable" });
  const message = value => {
    if (!value || !["model-result", "model-error", "model-config-result", "model-config-error"].includes(value.type)) return;
    const item = pending.get(value.id);
    if (!item) return;
    if ((item.kind === "configuration") !== value.type.startsWith("model-config-")) return;
    pending.delete(value.id); item.cleanup();
    try {
      if (value.type === "model-config-result") {
        if (!privateDataKeys(value, ["type", "id", "configuration"]) || !boundedPrivateData(value, MAX_PRIVATE_MODEL_CONFIG_BYTES + 256)) throw error();
        item.resolve(validatePrivateModelConfiguration(value.configuration));
      } else if (value.type === "model-result" && boundedPrivateData(value.result, 2 * 1024 * 1024 + 4096)) item.resolve(value.result);
      else item.reject(error());
    } catch { item.reject(error()); }
  };
  const close = () => {
    closed = true; channel.off("message", message);
    for (const [id, item] of pending) { if (channel.connected) channel.send({ type: item.kind === "configuration" ? "model-config-cancel" : "model-cancel", id }, () => {}); item.cleanup(); item.reject(error()); }
    pending.clear();
  };
  channel.on("message", message);
  channel.once("disconnect", close);
  return {
    configuration({ signal }) {
      if (closed || !channel.connected || signal.aborted || pending.size >= 2) return Promise.reject(error());
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const cancel = () => {
          if (!pending.has(id)) return;
          if (channel.connected) channel.send({ type: "model-config-cancel", id }, () => {});
          pending.delete(id); cleanup(); reject(error());
        };
        const timer = setTimeout(cancel, Math.max(1, Math.min(6000, configurationTimeoutMs)));
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); };
        pending.set(id, { kind: "configuration", resolve, reject, cleanup });
        signal.addEventListener("abort", cancel, { once: true });
        channel.send({ type: "model-config-request", id }, sendError => { if (sendError) { pending.delete(id); cleanup(); reject(error()); } });
        if (signal.aborted) cancel();
      });
    },
    run(request, { signal }) {
      if (closed || !channel.connected || signal.aborted || pending.size >= 2 || !boundedPrivateData(request, 100_000)) return Promise.reject(error());
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const cancel = () => { if (channel.connected) channel.send({ type: "model-cancel", id }, () => {}); };
        const timer = setTimeout(() => { cancel(); pending.delete(id); cleanup(); reject(error()); }, Math.max(1, Math.min(305000, Date.parse(request.deadline_at) - Date.now() + 5000)));
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); };
        pending.set(id, { kind: "run", resolve, reject, cleanup });
        signal.addEventListener("abort", cancel, { once: true });
        channel.send({ type: "model-run", id, request }, sendError => { if (sendError) { pending.delete(id); cleanup(); reject(error()); } });
        if (signal.aborted) cancel();
      });
    },
    close,
  };
}

function validScope(scope) {
  return scope && typeof scope === "object" && !Array.isArray(scope)
    && Object.keys(scope).length === 3 && ["classId", "subject", "grantId"].every(key => Object.hasOwn(scope, key))
    && /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u.test(scope.classId)
    && typeof scope.subject === "string" && scope.subject.trim() === scope.subject
    && scope.subject.length > 0 && scope.subject.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(scope.subject)
    && /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u.test(scope.grantId);
}

function validG3Bindings(bindings) {
  const id = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u;
  const domains = new Set(["calendar_administration", "lesson_reflection", "parent_communication"]);
  if (!Array.isArray(bindings) || Object.getPrototypeOf(bindings) !== Array.prototype
    || bindings.length < 1 || bindings.length > 128 || Reflect.ownKeys(bindings).length !== bindings.length + 1) return false;
  const seen = new Set();
  for (let index = 0; index < bindings.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(bindings, index);
    const binding = slot?.value;
    if (!slot?.enumerable || !Object.hasOwn(slot, "value") || !binding || typeof binding !== "object" || Array.isArray(binding)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(binding))) return false;
    const keys = Reflect.ownKeys(binding);
    if (keys.some(key => typeof key !== "string" || !["domain", "grantId", "scope", "ownerId"].includes(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(binding, key), "value"))
      || !["domain", "grantId", "scope"].every(key => Object.hasOwn(binding, key))) return false;
    const scope = binding.scope;
    if (!scope || typeof scope !== "object" || Array.isArray(scope) || ![Object.prototype, null].includes(Object.getPrototypeOf(scope))
      || Reflect.ownKeys(scope).length !== 2 || !["class_id", "subject"].every(key => Object.hasOwn(scope, key)
        && Object.hasOwn(Object.getOwnPropertyDescriptor(scope, key), "value"))) return false;
    if (!domains.has(binding.domain) || typeof binding.grantId !== "string" || !id.test(binding.grantId)
      || typeof scope.class_id !== "string" || !id.test(scope.class_id)
      || typeof scope.subject !== "string" || !scope.subject.trim() || scope.subject.length > 128
      || Object.hasOwn(binding, "ownerId") && (typeof binding.ownerId !== "string" || !id.test(binding.ownerId))) return false;
    const key = JSON.stringify([binding.domain, binding.grantId, scope.class_id, scope.subject]);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export async function startCoreRuntimeHost({ coreRoot, options }, channel = process) {
  const hasModelScope = options?.g1Scope !== undefined || options?.g2Scope !== undefined;
  const hasG3 = options?.g3AllowedBindings !== undefined;
  if (!options || Object.keys(options).some(key => !["dataRoot", "token", "supervisorSessionId", "coreCommit", "componentManifestHash", "port", "ambientPlanning", "ownerControlToken", "g1Scope", "g2Scope", "g3AllowedBindings"].includes(key))
    || (options.ambientPlanning !== undefined && typeof options.ambientPlanning !== "boolean")
    || (hasModelScope || hasG3) && (options.ambientPlanning !== true || typeof options.ownerControlToken !== "string")
    || options.g1Scope !== undefined && !validScope(options.g1Scope)
    || options.g2Scope !== undefined && (!validScope(options.g2Scope) || options.g2Scope.subject !== "数学")
    || hasG3 && !validG3Bindings(options.g3AllowedBindings)) throw new Error("Invalid runtime bootstrap.");
  const hostExecutor = hasModelScope ? createParentModelExecutor(channel) : null;
  try {
    const { createCoreRuntimeDaemon } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_daemon.mjs")).href);
    const { g1Scope, g2Scope, g3AllowedBindings, ...daemonOptions } = options;
    let g1Runner;
    if (g1Scope) {
      try {
        const configuration = await hostExecutor.configuration({ signal: new AbortController().signal });
        const { createIsolatedG1ModelRunner } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_isolated_model.mjs")).href);
        // This exact factory/function belongs to the actual Core process's brand
        // registry. Core owns Durable selection, claims and persistent reserves.
        g1Runner = createIsolatedG1ModelRunner({ ...configuration, maxCalls: G1_MODEL_MAX_CALLS, timeoutMs: G1_MODEL_TIMEOUT_MS });
      } catch {
        // Missing/unsupported configuration leaves generation inactive, while
        // Core read-only health and owner revoke/cancel remain available.
      }
      if (!channel.connected) throw Object.assign(new Error("Model host unavailable."), { code: "model_unavailable" });
    }
    let g2Live;
    if (g2Scope) {
      const { createStudentFollowUpModelAdapter } = await import(pathToFileURL(path.join(coreRoot, "scripts/student_followup_model_adapter.mjs")).href);
      // Core owns prompt/output validation and its adapter brand. Credentials
      // stay in the parent, which executes this prompt in the isolated worker.
      g2Live = { modelAdapter: createStudentFollowUpModelAdapter({ runModel: ({ prompt, signal }) => hostExecutor.run({
        model_kind: "student_followup", prompt, deadline_at: new Date(Date.now() + 120000).toISOString(),
      }, { signal }) }), leaseMs: 120000 };
    }
    const daemon = await createCoreRuntimeDaemon({ ...daemonOptions,
      ...(g2Live ? { g2Live } : {}),
      ...(g3AllowedBindings ? { g3Live: { allowedBindings: g3AllowedBindings } } : {}),
      ...(g1Runner ? { g1Live: { modelRunner: g1Runner, leaseMs: 300000,
        scope: { classId: g1Scope.classId, subject: g1Scope.subject }, grantId: g1Scope.grantId } } : {}) });
    return { daemon, async close() { hostExecutor?.close(); try { await daemon.close(); } finally { await g1Runner?.waitForIdle(); } } };
  } catch (error) { hostExecutor?.close(); throw error; }
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
