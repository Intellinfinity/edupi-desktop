import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

type LiveRequest = Record<string, unknown>;
type LiveResult = Record<string, unknown>;
type ModelHost = { run(request: LiveRequest, options: { signal: AbortSignal }): Promise<LiveResult>; close(): Promise<void> };

export function createRuntimeModelHost({ coreRoot, projectRoot, agentDir = getAgentDir(), allowLoopback = false }: { coreRoot: string; projectRoot: string; agentDir?: string; allowLoopback?: boolean }): ModelHost {
  const packagedAdapter = path.join(process.cwd(), "scripts/core_runtime_model_adapter.mjs");
  const adapterFile = existsSync(packagedAdapter) ? packagedAdapter : path.join(coreRoot, "scripts/core_runtime_model_adapter.mjs");
  const running = new Map<AbortController, Promise<LiveResult>>();
  let closed = false;
  return {
    run(value, { signal }) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      if (closed || signal.aborted) controller.abort();
      const operation = (async () => {
        const g2 = value.model_kind === "student_followup";
        if (Object.hasOwn(value, "model_kind") && !g2) throw Object.assign(new Error("Invalid model request."), { code: "invalid_model_request" });
        let request: LiveRequest;
        if (g2) {
          const deadline = typeof value.deadline_at === "string" ? Date.parse(value.deadline_at) : NaN;
          if (Object.keys(value).sort().join(",") !== "deadline_at,model_kind,prompt"
            || typeof value.prompt !== "string" || !value.prompt.trim() || Buffer.byteLength(value.prompt) > 70000
            || !Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 125000) {
            throw Object.assign(new Error("Invalid model request."), { code: "invalid_model_request" });
          }
          request = value;
        } else {
          const { buildG1LiveRequest } = await import(/* webpackIgnore: true */ pathToFileURL(adapterFile).href);
          const { materials, ...lease } = value;
          request = buildG1LiveRequest({ lease, materials });
        }
        const binding = { ...request };
        delete binding.input;
        delete binding.materials;
        const failure = (error_code: string): LiveResult => {
          if (g2) throw Object.assign(new Error("Model host unavailable."), { code: error_code });
          return { ...binding, ok: false, error_code, retryable: error_code === "model_unavailable", output: null, external_send: false };
        };
        if (controller.signal.aborted) return failure("cancelled");
        try {
          const settings = SettingsManager.create(projectRoot, agentDir);
          const runtime = await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json"), signal: controller.signal });
          const provider = settings.getDefaultProvider();
          const id = settings.getDefaultModel();
          const model = provider && id ? runtime.getModel(provider, id) : undefined;
          if (!model) return failure("model_unavailable");
          const auth = await runtime.getAuth(model, { signal: controller.signal });
          const compatibility = runtime.getCompatibilityRequestConfig(model);
          // The isolated SDK accepts apiKey/baseUrl, but not resolved auth headers.
          if (!auth?.auth.apiKey || Object.keys(auth.auth.headers || {}).length || Object.keys(compatibility.headers || {}).length || runtime.isUsingOAuth(model.provider)) return failure("model_unavailable");
          if (controller.signal.aborted) return failure("cancelled");
          const endpoint = new URL(auth.auth.baseUrl || model.baseUrl);
          const configuredLoopback = endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname);
          if (configuredLoopback) endpoint.hostname = "127.0.0.1";
          const configuration = { model: { ...model, baseUrl: endpoint.href }, apiKey: auth.auth.apiKey,
            maxTokens: Math.min(model.maxTokens || 4096, 8192), maxCalls: 1, allowLoopback: allowLoopback || configuredLoopback };
          if (g2) {
            const remaining = Date.parse(String(request.deadline_at)) - Date.now();
            if (remaining <= 0) return failure("deadline_exceeded");
            const { createIsolatedG1ModelRunner } = await import(/* webpackIgnore: true */ pathToFileURL(path.join(path.dirname(adapterFile), "core_runtime_isolated_model.mjs")).href);
            const runner = createIsolatedG1ModelRunner({ ...configuration, timeoutMs: Math.min(120000, remaining) });
            const result = await runner({ prompt: request.prompt, signal: controller.signal });
            return { output: result.output };
          }
          const { createIsolatedG1ModelAdapter } = await import(/* webpackIgnore: true */ pathToFileURL(adapterFile).href);
          const adapter = createIsolatedG1ModelAdapter({ ...configuration, timeoutMs: 300000 });
          return await adapter.run(request, { signal: controller.signal });
        } catch { return failure(controller.signal.aborted ? "cancelled" : "model_unavailable"); }
      })().finally(() => { signal.removeEventListener("abort", cancel); running.delete(controller); });
      running.set(controller, operation);
      return operation;
    },
    async close() { closed = true; for (const controller of running.keys()) controller.abort(); await Promise.allSettled(running.values()); },
  };
}

export function attachRuntimeModelHost(child: ChildProcess, host: ModelHost) {
  const pending = new Map<string, AbortController>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    closed = true;
    child.off("message", message);
    for (const controller of pending.values()) controller.abort();
    closing = host.close().finally(() => pending.clear());
    return closing;
  };
  const message = (value: unknown) => {
    if (closed || !value || typeof value !== "object") return;
    const data = value as { type?: string; id?: string; request?: LiveRequest };
    if (typeof data.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(data.id)) return;
    if (data.type === "model-cancel") { pending.get(data.id)?.abort(); return; }
    if (data.type !== "model-run" || !data.request || pending.has(data.id)) return;
    if (pending.size >= 2) { if (child.connected) child.send({ type: "model-error", id: data.id, code: "model_unavailable" }, () => {}); return; }
    const id = data.id;
    const controller = new AbortController();
    pending.set(id, controller);
    void host.run(data.request, { signal: controller.signal }).then(result => {
      if (!closed && child.connected) child.send({ type: "model-result", id, result }, () => {});
    }, () => {
      if (!closed && child.connected) child.send({ type: "model-error", id, code: "model_unavailable" }, () => {});
    }).finally(() => pending.delete(id));
  };
  child.on("message", message);
  child.once("disconnect", () => { void close(); });
  child.once("exit", () => { void close(); });
  return { close };
}
