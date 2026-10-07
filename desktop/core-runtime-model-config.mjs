export const MAX_PRIVATE_MODEL_CONFIG_BYTES = 32_768;
export const G1_MODEL_MAX_CALLS = 12;
export const G1_MODEL_TIMEOUT_MS = 300_000;
export const ISOLATED_MODEL_APIS = Object.freeze(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]);

export const modelConfigurationError = () => Object.assign(new Error("Model configuration unavailable."), { code: "model_unavailable" });
const plain = value => value && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function privateDataKeys(value, keys) {
  return plain(value) && Reflect.ownKeys(value).every(key => {
    const descriptor = typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : null;
    return keys.includes(key) && descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  });
}
export function boundedPrivateData(value, maxBytes) {
  let nodes = 0, stringBytes = 0;
  const walk = (item, depth) => {
    if (depth > 12 || ++nodes > 4096) return false;
    if (typeof item === "string") { stringBytes += Buffer.byteLength(item); return stringBytes <= maxBytes; }
    if (item == null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.length <= 1024 && item.every(child => walk(child, depth + 1));
    return plain(item) && Reflect.ownKeys(item).length <= 256 && Reflect.ownKeys(item).every(key => {
      const descriptor = typeof key === "string" ? Object.getOwnPropertyDescriptor(item, key) : null;
      return descriptor?.enumerable && Object.hasOwn(descriptor, "value") && walk(descriptor.value, depth + 1);
    });
  };
  try { return walk(value, 0) && Buffer.byteLength(JSON.stringify(value)) <= maxBytes; } catch { return false; }
}

/** Only the parent-selected configuration may cross private IPC. No caller budgets. */
export function validatePrivateModelConfiguration(value) {
  if (!privateDataKeys(value, ["model", "apiKey", "maxTokens", "allowLoopback"])
    || Object.keys(value).length !== 4 || !boundedPrivateData(value, MAX_PRIVATE_MODEL_CONFIG_BYTES)
    || !plain(value.model) || !boundedPrivateData(value.model, 16_384)
    || typeof value.apiKey !== "string" || !value.apiKey || value.apiKey.length > 8192 || /[\r\n]/u.test(value.apiKey)
    || !Number.isSafeInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > 8192
    || typeof value.allowLoopback !== "boolean") throw modelConfigurationError();
  const model = value.model;
  if (!["id", "provider", "name"].every(key => typeof model[key] === "string" && model[key].length > 0 && model[key].length <= 512)
    || !ISOLATED_MODEL_APIS.includes(model.api)
    || model.type !== undefined && model.type !== "chat"
    || typeof model.reasoning !== "boolean" || !Array.isArray(model.input) || !model.input.includes("text")
    || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1
    || !Number.isSafeInteger(model.maxTokens) || model.maxTokens < value.maxTokens
    || model.headers != null && (!plain(model.headers) || Object.keys(model.headers).length)) throw modelConfigurationError();
  let endpoint;
  try { endpoint = new URL(model.baseUrl); } catch { throw modelConfigurationError(); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.protocol !== "https:" && !(value.allowLoopback && endpoint.protocol === "http:"
      && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname))) throw modelConfigurationError();
  return structuredClone(value);
}
