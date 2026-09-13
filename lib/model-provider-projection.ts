import { normalizeModelCost } from "@/lib/model-config-normalize";

/**
 * Project SDK model metadata into the subset that is safe for the Models UI.
 * Authentication state and request headers never cross this boundary.
 */
const SENSITIVE_METADATA_KEY = /(?:api[-_]?key|authorization|headers?|token|secret|password|credential)/i;

function projectSafeMetadata(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 2000);
  if (depth >= 4 || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.slice(0, 64).map((entry) => projectSafeMetadata(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_METADATA_KEY.test(key))
      .slice(0, 64)
      .flatMap(([key, entry]) => {
        const projected = projectSafeMetadata(entry, depth + 1);
        return projected === undefined ? [] : [[key, projected]];
      }),
  );
}

export function projectModel(model: Record<string, unknown>) {
  const cost = normalizeModelCost(model.cost);
  return {
    id: typeof model.id === "string" ? model.id : "",
    ...(typeof model.name === "string" ? { name: model.name } : {}),
    ...(typeof model.api === "string" ? { api: model.api } : {}),
    ...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
    ...(Array.isArray(model.input) ? { input: model.input.filter((value): value is string => typeof value === "string") } : {}),
    ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
    ...(typeof model.maxTokens === "number" ? { maxTokens: model.maxTokens } : {}),
    ...(cost ? { cost } : {}),
    ...(model.thinkingLevelMap && typeof model.thinkingLevelMap === "object" && !Array.isArray(model.thinkingLevelMap) ? { thinkingLevelMap: projectSafeMetadata(model.thinkingLevelMap) } : {}),
    ...(model.compat && typeof model.compat === "object" && !Array.isArray(model.compat) ? { compat: projectSafeMetadata(model.compat) } : {}),
  };
}
