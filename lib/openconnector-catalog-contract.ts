export type CatalogQuery =
  | { op: "providers" }
  | { op: "actions"; service: string }
  | { op: "search"; query: string; service?: string }
  | { op: "inspect"; actionId: string };

export type CatalogProvider = {
  service: string;
  displayName: string;
  categories: string[];
  authTypes: string[];
  scenario: string;
};

export type CatalogAction = {
  id: string;
  service: string;
  name: string;
  description: string;
};

export type CatalogResult =
  | { kind: "providers"; providers: CatalogProvider[]; total: number; limited: boolean }
  | { kind: "actions"; service: string; actions: CatalogAction[]; total: number; limited: boolean }
  | { kind: "search"; actions: CatalogAction[]; limited: boolean }
  | { kind: "inspect"; action: CatalogAction; fields: Array<{ name: string; type: string; description: string; required: boolean }>; limited: boolean };

const ACTION_ID = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/u;
const SERVICE_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/u;
const FIELD_NAME = /^[A-Za-z0-9_.-]{1,120}$/u;
const MAX_QUERY_LENGTH = 200;
const MAX_ACTIONS = 30;
const MAX_PROVIDER_ACTIONS = 100;
const MAX_PROVIDERS = 2_000;
const MAX_FIELDS = 30;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function keysAre(value: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(value).sort().join(",") === names.sort().join(",");
}

function displayText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, maxLength) : "";
}

export function parseCatalogQuery(value: unknown): CatalogQuery | null {
  const input = record(value);
  if (!input) return null;
  if (input.op === "providers" && keysAre(input, ["op"])) return { op: "providers" };
  if (input.op === "actions" && keysAre(input, ["op", "service"]) && typeof input.service === "string" && SERVICE_ID.test(input.service)) {
    return { op: "actions", service: input.service };
  }
  if (input.op === "search" && (keysAre(input, ["op", "query"]) || keysAre(input, ["op", "query", "service"]))
    && typeof input.query === "string" && (input.service === undefined || typeof input.service === "string" && SERVICE_ID.test(input.service))) {
    const query = input.query.trim();
    return query && query.length <= MAX_QUERY_LENGTH ? { op: "search", query, ...(input.service === undefined ? {} : { service: input.service }) } : null;
  }
  if (input.op === "inspect" && keysAre(input, ["op", "actionId"]) && typeof input.actionId === "string" && input.actionId.length <= 180 && ACTION_ID.test(input.actionId)) {
    return { op: "inspect", actionId: input.actionId };
  }
  return null;
}

function providerSummary(value: unknown): CatalogProvider | null {
  const item = record(value);
  if (!item || typeof item.service !== "string" || !SERVICE_ID.test(item.service)
    || !Array.isArray(item.categories) || !Array.isArray(item.authTypes)) return null;
  const categories = item.categories.slice(0, 8).map((value) => {
    const category = record(value);
    return displayText(category?.displayName, 80) || displayText(category?.id, 80);
  }).filter(Boolean);
  const authTypes = item.authTypes.slice(0, 8).map((value) => displayText(value, 40)).filter(Boolean);
  return {
    service: item.service,
    displayName: displayText(item.displayName, 120) || item.service,
    categories,
    authTypes,
    scenario: displayText(item.scenario, 120),
  };
}

function actionSummary(value: unknown): CatalogAction | null {
  const item = record(value);
  if (!item || typeof item.id !== "string" || item.id.length > 180 || !ACTION_ID.test(item.id)) return null;
  return {
    id: item.id,
    service: displayText(item.service, 120),
    name: displayText(item.name, 120) || item.id,
    description: displayText(item.description, 500),
  };
}

export function projectCatalogData(query: CatalogQuery, value: unknown): CatalogResult | null {
  if (query.op === "providers") {
    if (!Array.isArray(value)) return null;
    const providers = value.slice(0, MAX_PROVIDERS).map(providerSummary);
    if (providers.some((provider) => !provider)) return null;
    const items = providers as CatalogProvider[];
    if (new Set(items.map((provider) => provider.service)).size !== items.length) return null;
    return { kind: "providers", providers: items, total: value.length, limited: value.length > MAX_PROVIDERS };
  }
  if (query.op === "actions") {
    if (!Array.isArray(value)) return null;
    const actions = value.slice(0, MAX_PROVIDER_ACTIONS).map(actionSummary);
    if (actions.some((action) => !action || action.service !== query.service)) return null;
    return { kind: "actions", service: query.service, actions: actions as CatalogAction[], total: value.length, limited: value.length > MAX_PROVIDER_ACTIONS };
  }
  if (query.op === "search") {
    if (!Array.isArray(value)) return null;
    const actions = value.slice(0, MAX_ACTIONS).map(actionSummary);
    if (actions.some((action) => !action || query.service && action.service !== query.service)) return null;
    return { kind: "search", actions: actions as CatalogAction[], limited: value.length > MAX_ACTIONS };
  }

  const item = record(value);
  const action = actionSummary(item);
  if (!item || !action || action.id !== query.actionId) return null;
  const schema = record(item.inputSchema);
  const properties = record(schema?.properties);
  if (schema?.type !== "object" || !properties) return null;
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((name) => typeof name === "string"))) return null;
  const required = new Set((schema.required || []) as string[]);
  const entries = Object.entries(properties);
  const fields = [];
  for (const [name, definition] of entries.slice(0, MAX_FIELDS)) {
    const field = record(definition);
    if (!FIELD_NAME.test(name) || !field || typeof field.type !== "string") return null;
    fields.push({ name, type: displayText(field.type, 60), description: displayText(field.description, 300), required: required.has(name) });
  }
  return { kind: "inspect", action, fields, limited: entries.length > MAX_FIELDS };
}
