import fs from "node:fs";
import path from "node:path";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { validatePrivateModelConfiguration, modelConfigurationError, ISOLATED_MODEL_APIS } from "../desktop/core-runtime-model-config.mjs";

export type PrivateRuntimeModelConfiguration = {
  model: Record<string, unknown>; apiKey: string; maxTokens: number; allowLoopback: boolean;
};

/** Read current local settings only: no catalog network, auth refresh, commands or writes. */
export async function readRuntimeModelConfiguration({ projectRoot, agentDir, signal, allowLoopback = false }: {
  projectRoot: string; agentDir: string; signal: AbortSignal; allowLoopback?: boolean;
}): Promise<PrivateRuntimeModelConfiguration> {
  const assertActive = () => { if (signal.aborted) throw modelConfigurationError(); };
  try {
    assertActive();
    // Match pinned Pi's line-comment/trailing-comma JSON syntax without a
    // dynamic private SDK import that would escape Next's packaging graph.
    const stripJsonComments = (input: string) => input
      .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, match => match[0] === '"' ? match : "")
      .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail) => tail ?? (match[0] === '"' ? match : ""));
    const read = (file: string): Record<string, unknown> => {
      try {
        if (!fs.statSync(file).isFile() || fs.statSync(file).size > 1_500_000) throw modelConfigurationError();
        const value = JSON.parse(stripJsonComments(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, "")));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw modelConfigurationError();
        return value;
      } catch (error) { if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {}; throw modelConfigurationError(); }
    };
    const settings = SettingsManager.inMemory({ ...read(path.join(agentDir, "settings.json")), ...read(path.join(projectRoot, ".pi/settings.json")) });
    const provider = settings.getDefaultProvider(), id = settings.getDefaultModel();
    if (!provider || !id) throw modelConfigurationError();
    const models = read(path.join(agentDir, "models.json"));
    const providers = models.providers as Record<string, Record<string, unknown>> | undefined;
    const configured = providers?.[provider] ?? {};
    const selectedModels = (configured.models as Array<Record<string, unknown>> | undefined)?.filter(item => item.id === id) ?? [];
    if (selectedModels.length > 1) throw modelConfigurationError();
    const model = selectedModels[0] ?? {};
    const override = (configured.modelOverrides as Record<string, Record<string, unknown>> | undefined)?.[id] ?? {};
    const hasFields = (value: unknown) => value != null && (typeof value !== "object" || Object.keys(value).length > 0);
    // registerProvider's extension contract does not apply file modelOverrides.
    // Reject a selected override rather than silently widen tokens or drop knobs.
    if (hasFields(override) || configured.oauth || [configured.headers, model.headers].some(hasFields)
      || typeof configured.apiKey === "string" && configured.apiKey.startsWith("!")) throw modelConfigurationError();
    // Inspect before resolution: no OAuth refresh or credential shell may run.
    const stored = read(path.join(agentDir, "auth.json"))[provider] as { type?: string; key?: string; env?: unknown } | undefined;
    if (stored?.type === "oauth" || hasFields(stored?.env)
      || stored?.type === "api_key" && (typeof stored.key !== "string" || stored.key.startsWith("!"))
      || !(stored?.type === "api_key" && stored.key || typeof configured.apiKey === "string" && configured.apiKey)) throw modelConfigurationError();
    assertActive();
    const selectedCredential = stored?.type === "api_key" && typeof stored.key === "string" ? { type: "api_key" as const, key: stored.key } : undefined;
    const credentials: CredentialStore = {
      async read(providerId) { assertActive(); return providerId === provider ? selectedCredential : undefined; },
      async list() { assertActive(); return []; },
      async modify() { throw modelConfigurationError(); }, async delete() { throw modelConfigurationError(); },
    };
    // Never let the SDK reopen models.json after preflight: its compatibility
    // and key resolvers support !commands. Only this validated snapshot enters.
    const runtime = await ModelRuntime.create({ credentials, modelsPath: null, signal,
      allowModelNetwork: false, refreshOnCreate: false,
      modelsStore: { async read() { return undefined; }, async write() { throw modelConfigurationError(); }, async delete() { throw modelConfigurationError(); } } });
    if (Object.keys(configured).length) runtime.registerProvider(provider, structuredClone(configured));
    const selected = runtime.getPhysicalModel(provider, id);
    if (runtime.getError() || !selected || runtime.isUsingOAuth(provider) || !ISOLATED_MODEL_APIS.includes(selected.api)) throw modelConfigurationError();
    const compatibility = runtime.getCompatibilityRequestConfig(selected);
    if (hasFields(selected.headers) || hasFields(compatibility.headers)) throw modelConfigurationError();
    const auth = await runtime.getAuth(selected, { signal });
    if (!auth?.auth.apiKey || hasFields(auth.env)
      || Object.entries(auth.auth.headers ?? {}).some(([name, value]) => name.toLowerCase() !== "authorization" || value !== `Bearer ${auth.auth.apiKey}`)) throw modelConfigurationError();
    assertActive();
    const endpoint = new URL(auth.auth.baseUrl || selected.baseUrl);
    const loopback = endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname);
    return validatePrivateModelConfiguration({ model: { ...selected, baseUrl: endpoint.href }, apiKey: auth.auth.apiKey,
      maxTokens: Math.min(selected.maxTokens, 8192), allowLoopback: allowLoopback || loopback });
  } catch { throw modelConfigurationError(); }
}
