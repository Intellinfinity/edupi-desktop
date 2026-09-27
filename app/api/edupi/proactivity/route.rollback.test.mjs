import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

test("failed enable orders stop marker and quarantine before rollback retries", async () => {
  // This stubs dependencies to prove route ordering only; filesystem and
  // cross-process durability are exercised by separate isolated tests.
  const events = [];
  const root = `/isolated-proactivity-rollback-${Date.now()}`;
  const scope = { classId: "class-7-1", subject: "数学" };
  const grantId = "desktop_canary_v2_test";
  let marker = null;
  let activation = { enabled: false, source: "desktop_canary", configurationStatus: "ready",
    scope: null, grantId: null, updatedAt: null };
  const fingerprint = `sha256:${"a".repeat(64)}`;
  const capabilities = { g1_processor: "active", internal_timer: "active", ambient_planning: "active",
    owner_authorization: "active", owner_conversation: "active", owner_intent: "active",
    attention_delivery: "active", teacher_feedback: "active" };
  const host = { async call(operation) {
    events.push(operation);
    if (operation === "health") return { ok: true, result: { data_root_fingerprint: fingerprint, capabilities } };
    if (operation === "prepare_due") return { ok: true, result: { tasks: [], failures: [] } };
    throw new Error(`unexpected operation ${operation}`);
  } };
  class RuntimeError extends Error { constructor(code) { super(code); this.code = code; } }
  class ControlError extends Error { constructor(code) { super(code); this.code = code; } }
  class BodyTooLarge extends Error {}
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status || 200 }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: BodyTooLarge },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/safe-mode": { canStartEduPiProactivity: () => true },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root } }),
      readEduPiEducationSnapshot: async () => ({ workspace: {} }) },
    "@/lib/edupi-generated-artifacts": { workspaceResourcesRequest: async () => ({ teacherMaterials: [] }) },
    "@/lib/edupi-proactivity-control": { buildProactivityScopeCandidates: () => [{ ...scope, ready: true }],
      buildProactivityGrantBinding: () => ({ grantId, endsAt: "2099-01-01T00:00:00.000Z", spec: {} }),
      EDUPI_PROACTIVITY_DURATION_DAYS: 7, EDUPI_PROACTIVITY_MAX_CALLS: 12, EduPiProactivityControlError: ControlError },
    "@/lib/edupi-proactivity-config": {
      readEduPiProactivityActivation: () => marker ? { enabled: false, source: "desktop_canary",
        configurationStatus: "stop_pending", scope, grantId, updatedAt: marker.updatedAt } : activation,
      writeEduPiProactivityConfig: input => {
        events.push(input.enabled ? "config-enabled" : "config-rollback-failed");
        if (!input.enabled) throw new Error("synthetic_directory_sync_failure");
        activation = { ...activation, ...input, updatedAt: "2026-09-27T00:00:00.000Z" };
      },
      writeEduPiProactivityStopIntent: input => { events.push("marker-durable"); marker = { ...input, updatedAt: "2026-09-27T00:00:01.000Z" }; },
      clearEduPiProactivityStopIntent: () => { throw new Error("marker must remain"); },
    },
    "@/lib/edupi-proactivity-runtime": { EduPiProactivityRuntimeError: RuntimeError,
      ensureProactivityGrant: async () => { events.push("grant-active"); },
      readProactivityGrantStatus: async () => ({ modelBudget: { remainingCalls: 12, usageUnverified: false } }),
      inspectProactivityCatchUp: () => { events.push("catchup-failed"); throw new Error("synthetic_catchup_failure"); },
      pauseProactivityGrant: async () => { events.push("pause-failed"); throw new Error("synthetic_pause_failure"); },
      proactivityRuntimeError: error => error?.code ? error : new RuntimeError("proactivity_runtime_unavailable") },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => { events.push("ensure-default-off"); return host; },
      restartEduPiRuntime: async () => { events.push("restart-scoped"); return host; },
      quarantineEduPiRuntime: async () => { events.push("quarantine"); },
      clearEduPiRuntimeQuarantine: () => { events.push("release-quarantine"); } },
  };
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (!Object.hasOwn(modules, name)) throw new Error(`unexpected dependency ${name}`);
    return modules[name];
  }, route, route.exports);
  const request = body => new Request("http://localhost/api/edupi/proactivity", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const failed = await route.exports.POST(request({ enabled: true, classId: scope.classId,
    subject: scope.subject, expectedUpdatedAt: null }));
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, "proactivity_stop_uncertain");
  assert.equal(events.indexOf("grant-active") < events.indexOf("catchup-failed"), true);
  assert.equal(events.indexOf("catchup-failed") < events.indexOf("marker-durable"), true);
  assert.equal(events.indexOf("marker-durable") < events.indexOf("pause-failed"), true);
  assert.equal(events.at(-1), "quarantine", "failed fallback never leaves a scoped executor available");
  assert.ok(marker, "the durable marker survives both Core and config rollback failures");
  const blocked = await route.exports.POST(request({ enabled: true, classId: scope.classId,
    subject: scope.subject, expectedUpdatedAt: marker.updatedAt }));
  assert.equal(blocked.status, 409, "same-scope re-enable cannot bypass a pending stop fence");
});

test("Windows normal mode refuses G1 enable before reading or mutating Core", async () => {
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status || 200 }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/safe-mode": { canStartEduPiProactivity: () => false },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => { throw new Error("Core must not be read"); } },
    "@/lib/edupi-generated-artifacts": {},
    "@/lib/edupi-proactivity-control": {},
    "@/lib/edupi-proactivity-config": {},
    "@/lib/edupi-proactivity-runtime": {},
    "@/lib/edupi-runtime-supervisor": {},
  };
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (!Object.hasOwn(modules, name)) throw new Error(`unexpected dependency ${name}`);
    return modules[name];
  }, route, route.exports);
  const response = await route.exports.POST(new Request("http://localhost/api/edupi/proactivity", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, classId: "class-7-1", subject: "数学", expectedUpdatedAt: null }) }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "proactivity_safe_mode_required");
  assert.equal(body.externalSend, false);
});
