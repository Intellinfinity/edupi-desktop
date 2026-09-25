import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { parseCatalogQuery, projectCatalogData } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./openconnector-catalog-contract.ts");

test("catalog query accepts only bounded read-only discovery requests", () => {
  assert.deepEqual(parseCatalogQuery({ op: "providers" }), { op: "providers" });
  assert.deepEqual(parseCatalogQuery({ op: "actions", service: "outlook_calendar" }), { op: "actions", service: "outlook_calendar" });
  assert.deepEqual(parseCatalogQuery({ op: "search", query: " calendar " }), { op: "search", query: "calendar" });
  assert.deepEqual(parseCatalogQuery({ op: "search", query: " meeting ", service: "outlook_calendar" }), { op: "search", query: "meeting", service: "outlook_calendar" });
  assert.deepEqual(parseCatalogQuery({ op: "inspect", actionId: "npm.get_package" }), { op: "inspect", actionId: "npm.get_package" });
  for (const value of [{ op: "execute", actionId: "npm.get_package" }, { op: "providers", token: "leak" }, { op: "actions", service: "../admin" }, { op: "actions", service: "npm", input: {} }, { op: "search", query: "" }, { op: "search", query: "x".repeat(201) }, { op: "search", query: "ok", service: "../admin" }, { op: "search", query: "ok", token: "leak" }, { op: "inspect", actionId: "npm/other" }, { op: "inspect", actionId: "npm.get_package", input: {} }]) {
    assert.equal(parseCatalogQuery(value), null);
  }
});

test("provider browser projects bounded plain text without logos, URLs or credentials", () => {
  const source = [{ service: "outlook_calendar", displayName: "Outlook Calendar", categories: [{ id: "Productivity", displayName: "Productivity" }], authTypes: ["oauth2"], scenario: "work", iconUrl: "https://tracker.example/icon", homepageUrl: "https://example.com", credentials: { secret: "never" } }];
  assert.deepEqual(projectCatalogData({ op: "providers" }, source), { kind: "providers", providers: [{ service: "outlook_calendar", displayName: "Outlook Calendar", categories: ["Productivity"], authTypes: ["oauth2"], scenario: "work" }], total: 1, limited: false });
  assert.equal(projectCatalogData({ op: "providers" }, [{ ...source[0], service: "../admin" }]), null);
  assert.equal(projectCatalogData({ op: "providers" }, [source[0], source[0]]), null);
});

test("service action list is bounded to the selected provider", () => {
  const action = { id: "outlook_calendar.get_calendar", service: "outlook_calendar", name: "get_calendar", description: "Read one calendar", inputSchema: { secret: "not in list" } };
  assert.deepEqual(projectCatalogData({ op: "actions", service: "outlook_calendar" }, [action]), { kind: "actions", service: "outlook_calendar", actions: [{ id: action.id, service: action.service, name: action.name, description: action.description }], total: 1, limited: false });
  assert.equal(projectCatalogData({ op: "actions", service: "outlook_calendar" }, [{ ...action, service: "gmail" }]), null);
});

test("catalog search projects a bounded plain-text list", () => {
  const source = [{ id: "npm.get_package", service: "npm", name: "get_package", description: "Get package", inputSchema: { secret: "not for search" } }];
  assert.deepEqual(projectCatalogData({ op: "search", query: "npm" }, source), { kind: "search", actions: [{ id: "npm.get_package", service: "npm", name: "get_package", description: "Get package" }], limited: false });
  assert.equal(projectCatalogData({ op: "search", query: "npm" }, [{ id: "invalid" }]), null);
  assert.equal(projectCatalogData({ op: "search", query: "npm" }, { actions: source }), null);
  assert.equal(projectCatalogData({ op: "search", query: "npm", service: "npm" }, [{ ...source[0], service: "github" }]), null);
});

test("catalog inspect exposes field names without execution or credential metadata", () => {
  const data = { id: "npm.get_package", service: "npm", name: "get_package", description: "Get package", operationType: "read", execution: { requiredAuthTypes: ["api_key"] }, inputSchema: { type: "object", properties: { packageName: { type: "string", description: "Name" }, select: { type: "array", description: "Fields" } }, required: ["packageName"] } };
  assert.deepEqual(projectCatalogData({ op: "inspect", actionId: "npm.get_package" }, data), { kind: "inspect", action: { id: "npm.get_package", service: "npm", name: "get_package", description: "Get package" }, fields: [{ name: "packageName", type: "string", description: "Name", required: true }, { name: "select", type: "array", description: "Fields", required: false }], limited: false });
  assert.equal(projectCatalogData({ op: "inspect", actionId: "npm.get_package" }, { ...data, id: "npm.other" }), null);
  assert.equal(projectCatalogData({ op: "inspect", actionId: "npm.get_package" }, { ...data, inputSchema: { type: "object", properties: { x: { type: 42 } } } }), null);
  assert.equal(projectCatalogData({ op: "inspect", actionId: "npm.get_package" }, { ...data, inputSchema: { type: "object", properties: {}, required: [42] } }), null);
});
