export type CatalogQuery =
  | { op: "search"; query: string }
  | { op: "inspect"; actionId: string };

export type CatalogAction = {
  id: string;
  service: string;
  name: string;
  description: string;
};

export type CatalogResult =
  | { kind: "search"; actions: CatalogAction[]; limited: boolean }
  | { kind: "inspect"; action: CatalogAction; fields: Array<{ name: string; type: string; description: string; required: boolean }>; limited: boolean };

const ACTION_ID = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/u;
const FIELD_NAME = /^[A-Za-z0-9_.-]{1,120}$/u;
const MAX_QUERY_LENGTH = 200;
const MAX_ACTIONS = 30;
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
  if (input.op === "search" && keysAre(input, ["op", "query"]) && typeof input.query === "string") {
    const query = input.query.trim();
    return query && query.length <= MAX_QUERY_LENGTH ? { op: "search", query } : null;
  }
  if (input.op === "inspect" && keysAre(input, ["op", "actionId"]) && typeof input.actionId === "string" && input.actionId.length <= 180 && ACTION_ID.test(input.actionId)) {
    return { op: "inspect", actionId: input.actionId };
  }
  return null;
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
  if (query.op === "search") {
    if (!Array.isArray(value)) return null;
    const actions = value.slice(0, MAX_ACTIONS).map(actionSummary);
    if (actions.some((action) => !action)) return null;
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
