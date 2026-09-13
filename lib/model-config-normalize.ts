export interface NormalizedModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tiers?: Array<{
    inputTokensAbove: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeTier(value: unknown): NonNullable<NormalizedModelCost["tiers"]>[number] | undefined {
  if (!isRecord(value)) return undefined;
  if (!["inputTokensAbove", "input", "output", "cacheRead", "cacheWrite"].every((key) => finiteNumber(value[key]))) return undefined;
  return {
    inputTokensAbove: value.inputTokensAbove as number,
    input: value.input as number,
    output: value.output as number,
    cacheRead: value.cacheRead as number,
    cacheWrite: value.cacheWrite as number,
  };
}

/** Return a schema-valid cost, or omit cost when the source is incomplete. */
export function normalizeModelCost(value: unknown): NormalizedModelCost | undefined {
  if (!isRecord(value)) return undefined;
  if (!["input", "output", "cacheRead", "cacheWrite"].every((key) => finiteNumber(value[key]))) return undefined;
  const tiers = Array.isArray(value.tiers)
    ? value.tiers.map(normalizeTier).filter((tier): tier is NonNullable<typeof tier> => tier !== undefined)
    : undefined;
  return {
    input: value.input as number,
    output: value.output as number,
    cacheRead: value.cacheRead as number,
    cacheWrite: value.cacheWrite as number,
    ...(tiers?.length ? { tiers } : {}),
  };
}

/** Keep model metadata usable by Pi's strict models.json validator. */
export function normalizeModelEntry<T extends object>(model: T): T {
  const next = { ...model } as T & { cost?: unknown };
  const cost = normalizeModelCost(next.cost);
  if (cost) next.cost = cost;
  else delete next.cost;
  return next;
}

export function normalizeModelsConfig(value: Record<string, unknown>): Record<string, unknown> {
  const providers = isRecord(value.providers) ? value.providers : {};
  const normalizedProviders = Object.fromEntries(Object.entries(providers).map(([providerId, rawProvider]) => {
    if (!isRecord(rawProvider)) return [providerId, rawProvider];
    const provider = { ...rawProvider };
    if (Array.isArray(provider.models)) {
      provider.models = provider.models.map((model) => isRecord(model) ? normalizeModelEntry(model) : model);
    }
    return [providerId, provider];
  }));
  return { ...value, providers: normalizedProviders };
}
