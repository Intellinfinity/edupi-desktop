import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const control = await jiti.import("../../../../lib/edupi-proactivity-control.ts");
const runtime = await jiti.import("../../../../lib/edupi-proactivity-runtime.ts");
const client = await jiti.import("../../../../lib/edupi-proactivity-client.ts");
const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const G1 = "teaching_preparation";
const G2 = "student_followup";
const PENDING_DOMAINS = ["calendar_administration", "lesson_reflection", "parent_communication"];
const scope = { classId: "class-7-1", subject: "数学" };
const rootRef = `sha256:${"a".repeat(64)}`;

function fixture({ isolated = true, g1Enabled = false, g2Processor = true, forceG2Active = false, failG2Grant = false, failPause = false, failDisabledWrite = false, ownerReadPatch = {} } = {}) {
  // In-memory config and Core transport only. This never starts a daemon,
  // reads teacher data, calls a model, or proves an installation flow.
  const events = [];
  const workspace = { timetable: [{ slot_id: "slot-1", class_id: scope.classId, class_name: "七一班", subject: scope.subject, kind: "class" }],
    students: [{ class_name: "七一班" }] };
  const teacherMaterials = [{ material_id: "material-1", class_id: scope.classId, subject: scope.subject }];
  const g1Binding = control.buildProactivityGrantBinding(scope, workspace, teacherMaterials);
  const activations = new Map([G1, G2, ...PENDING_DOMAINS].map(domain => [domain, { enabled: false, source: "default", configurationStatus: "missing",
    scope: null, grantId: null, updatedAt: null }]));
  const markers = new Map();
  const grants = new Map();
  const owner = { id: "owner-fixture" };
  if (g1Enabled) {
    activations.set(G1, { enabled: true, source: "desktop_canary", configurationStatus: "ready", scope,
      grantId: g1Binding.grantId, updatedAt: "2026-10-01T00:00:00.000Z" });
    grants.set(g1Binding.grantId, { id: g1Binding.grantId, version: 1, status: "active", ends_at: g1Binding.endsAt, spec: g1Binding.spec });
  }
  const read = domain => markers.has(domain) ? { enabled: false, source: "desktop_canary", configurationStatus: "stop_pending",
    ...markers.get(domain) } : activations.get(domain);
  const health = () => {
    const g1 = read(G1).enabled;
    const g2 = read(G2).enabled && g2Processor || forceG2Active;
    const g3 = false; // Current Core pin has no exact grant+scope startup binding.
    return { ok: true, result: { data_root_fingerprint: rootRef, capabilities: {
      g1_processor: g1 ? "active" : "activation_pending", g2_processor: g2 ? "active" : "activation_pending",
      g3_processor: g3 ? "active" : "activation_pending",
      internal_timer: "active", ambient_planning: g1 || g2 ? "active" : "activation_pending",
      owner_authorization: "active", owner_conversation: "active", owner_intent: "active",
      attention_delivery: "active", teacher_feedback: "active",
    } } };
  };
  const host = {
    async call(operation) {
      events.push({ operation });
      if (operation === "health") return health();
      if (operation === "prepare_due") return { ok: true, result: { tasks: [], failures: [] } };
      assert.equal(operation, "owner_read");
      return { ok: true, result: { root_ref: rootRef, owner, grants: [...grants.values()], g1_model_budget: [...grants.values()]
        .filter(grant => grant.spec.domains[0] === G1).map(grant => ({ grant_id: grant.id, budget_id: grant.spec.budget.id,
          used_calls: 0, max_calls: 12, remaining_calls: 12, exhausted: false, usage_unverified: false })), ...ownerReadPatch } };
    },
    async callOwnerControl(operation, payload) {
      assert.equal(operation, "owner_control");
      events.push({ operation, ...payload });
      if (failG2Grant && payload.spec?.domains[0] === G2) throw new Error("synthetic_grant_failure");
      if (failPause && payload.action === "pause") throw new Error("synthetic_pause_failure");
      const previous = grants.get(payload.grant_id);
      const grant = payload.action === "create" || payload.action === "update"
        ? { id: payload.grant_id, status: previous?.status ?? "active", version: (previous?.version ?? 0) + 1,
          ends_at: payload.spec.ends_at, spec: payload.spec }
        : { ...previous, status: payload.action === "pause" ? "paused" : "active", version: previous.version + 1 };
      grants.set(grant.id, grant);
      return { ok: true, result: { owner_id: owner.id, grant_id: grant.id, grant_version: grant.version } };
    },
  };
  const root = `/synthetic-proactivity-unit-${randomUUID()}`;
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status || 200 }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/safe-mode": { canStartEduPiProactivity: () => true, canStartEduPiStudentFollowup: () => isolated,
      canStartEduPiCapabilityCanary: () => isolated },
    "@/lib/edupi-core-snapshot": {
      resolveEduPiBridgeRoots: () => { events.push({ operation: "resolve" }); return { runtime: { coreCommit: "synthetic-old-pin" }, dataRoot: { root } }; },
      readEduPiEducationSnapshot: async () => { events.push({ operation: "snapshot" }); return { workspace }; },
    },
    "@/lib/edupi-generated-artifacts": { workspaceResourcesRequest: async () => { events.push({ operation: "materials" }); return { teacherMaterials }; } },
    "@/lib/edupi-proactivity-control": control,
    "@/lib/edupi-proactivity-runtime": runtime,
    "@/lib/edupi-proactivity-config": {
      readEduPiProactivityActivation: ({ domain = G1 }) => read(domain),
      writeEduPiProactivityConfig: (input, { domain = G1, now }) => {
        events.push({ operation: "config", domain, enabled: input.enabled });
        if (!input.enabled && failDisabledWrite) throw new Error("synthetic_config_failure");
        const activation = { ...input, source: "desktop_canary", configurationStatus: "ready", updatedAt: now };
        activations.set(domain, activation);
        return activation;
      },
      writeEduPiProactivityStopIntent: (input, { domain = G1, now }) => {
        events.push({ operation: "stop-marker", domain }); markers.set(domain, { ...input, updatedAt: now });
      },
      clearEduPiProactivityStopIntent: ({ domain = G1, grantId }) => {
        assert.equal(markers.get(domain).grantId, grantId);
        events.push({ operation: "clear-marker", domain }); markers.delete(domain);
      },
    },
    "@/lib/edupi-runtime-supervisor": {
      G3_DOMAINS: PENDING_DOMAINS,
      g3AllowedDomainsForActivations: (items, coreCommit) => {
        events.push({ operation: "startup-allowset", domains: items.map(item => item.domain), coreCommit });
        return [];
      },
      ensureEduPiRuntime: async () => { events.push({ operation: "ensure" }); return host; },
      restartEduPiRuntime: async () => { events.push({ operation: "restart" }); return host; },
      quarantineEduPiRuntime: async () => { events.push({ operation: "quarantine" }); },
      clearEduPiRuntimeQuarantine: () => { events.push({ operation: "clear-quarantine" }); },
    },
  };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected dependency ${name}`); return modules[name];
  }, routeModule, routeModule.exports);
  const request = body => new Request("http://localhost/api/edupi/proactivity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { events, grants, markers, activations, read, health,
    get: query => routeModule.exports.GET(new Request(`http://localhost/api/edupi/proactivity${query || ""}`)),
    post: body => routeModule.exports.POST(request(body)),
    toggle: (enabled, domain) => routeModule.exports.POST(request({ enabled, classId: enabled ? scope.classId : null,
      subject: enabled ? scope.subject : null, expectedUpdatedAt: read(domain ?? G1).updatedAt, ...(domain ? { domain } : {}) })),
  };
}

test("G2 GET and enable remain independent of G1 and do not read materials or prepare due work", async () => {
  const f = fixture({ g1Enabled: true });
  const g1Before = structuredClone(f.read(G1));
  const initial = await f.get("?domain=student_followup");
  const initialBody = await initial.json();
  assert.equal(initial.status, 200);
  assert.equal(initialBody.activation.enabled, false);
  assert.equal(initialBody.limits.domain, G2);
  const enabled = await f.toggle(true, G2);
  const body = await enabled.json();
  assert.equal(enabled.status, 200);
  assert.equal(body.grant.status, "active");
  assert.equal(body.grant.modelBudget, null);
  assert.equal(body.capabilities.studentFollowup, true);
  assert.deepEqual(body.limits, { durationDays: 7, maxModelCalls: 4, domain: G2 });
  assert.equal(Object.hasOwn(body, "initialScan"), false);
  assert.doesNotThrow(() => client.parseEduPiProactivityState(body));
  assert.equal(f.events.some(event => event.operation === "prepare_due" || event.operation === "materials"), false);
  assert.deepEqual(f.read(G1), g1Before);
  assert.equal(f.events.filter(event => event.operation === "config").every(event => event.domain === G2), true);
  const beforeReplay = f.events.filter(event => event.operation === "owner_control").length;
  assert.equal((await f.toggle(true, G2)).status, 200);
  assert.equal(f.events.filter(event => event.operation === "owner_control").length, beforeReplay, "same enabled scope does not renew a grant");
});

test("G3 through G5 expose default-off state and reject live activation before Core grant fencing", async () => {
  const f = fixture();
  for (const domain of PENDING_DOMAINS) {
    const stateResponse = await f.get(`?domain=${domain}`);
    const state = await stateResponse.json();
    assert.equal(stateResponse.status, 200);
    assert.equal(state.activation.enabled, false);
    assert.equal(state.limits.domain, domain);
    assert.equal(state.limits.maxModelCalls, 0);
    assert.equal(state.activationBlocked, "activation_pending");
    assert.doesNotThrow(() => client.parseEduPiProactivityState(state));
    const enabled = await f.toggle(true, domain);
    assert.equal(enabled.status, 409);
    assert.equal((await enabled.json()).code, "proactivity_activation_pending");
    assert.equal(f.read(domain).enabled, false);
  }
  assert.equal(f.events.some(event => ["owner_control", "config", "prepare_due", "materials"].includes(event.operation)), false);
});

test("a stale G3 config never appears as an active live capability", async () => {
  const f = fixture();
  f.activations.set("calendar_administration", { enabled: true, source: "desktop_canary",
    configurationStatus: "ready", scope, grantId: "synthetic-old-calendar-grant",
    updatedAt: "2026-10-04T00:00:00.000Z" });
  const response = await f.get("?domain=calendar_administration");
  const state = await response.json();
  assert.equal(response.status, 200);
  assert.equal(state.activation.enabled, true, "the saved config must remain visible for withdrawal");
  assert.deepEqual(state.activation.scope, scope);
  assert.equal(state.activationBlocked, "activation_pending");
  assert.equal(state.capabilities, null);
  assert.equal(f.events.some(event => event.operation === "ensure" || event.operation === "owner_control"), false);
});

test("two old G3 configs can be stopped one by one while the shared processor remains fenced", async () => {
  const f = fixture();
  for (const domain of ["calendar_administration", "lesson_reflection"]) {
    const grantId = `synthetic-${domain}-grant`;
    f.activations.set(domain, { enabled: true, source: "desktop_canary", configurationStatus: "ready",
      scope, grantId, updatedAt: "2026-10-04T00:00:00.000Z" });
    f.grants.set(grantId, { id: grantId, version: 1, status: "active", ends_at: "2099-01-01T00:00:00.000Z",
      spec: { domains: [domain], budget: { id: `budget-${domain}`, max_calls: 0 } } });
  }
  const before = await f.get("?domain=calendar_administration");
  assert.equal((await before.json()).activation.enabled, true);
  const stopped = await f.toggle(false, "calendar_administration");
  assert.equal(stopped.status, 200);
  assert.equal(f.read("calendar_administration").enabled, false);
  assert.equal(f.read("lesson_reflection").enabled, true);
  assert.equal(f.health().result.capabilities.g3_processor, "activation_pending");
  const second = await f.toggle(false, "lesson_reflection");
  assert.equal(second.status, 200);
  assert.equal(f.read("lesson_reflection").enabled, false);
  assert.equal(f.grants.get("synthetic-calendar_administration-grant").status, "paused");
  assert.equal(f.grants.get("synthetic-lesson_reflection-grant").status, "paused");
  assert.ok(f.events.some(event => event.operation === "stop-marker" && event.domain === "calendar_administration"));
  assert.ok(f.events.some(event => event.operation === "restart"));
  assert.equal(f.events.filter(event => event.operation === "startup-allowset").length, 2);
  assert.ok(f.events.findLastIndex(event => event.operation === "clear-quarantine")
    > f.events.findLastIndex(event => event.operation === "quarantine"));
});

test("stopping either domain permits the other processor and ambient planning to remain active", async () => {
  for (const stoppedDomain of [G1, G2]) {
    const f = fixture({ g1Enabled: true });
    assert.equal((await f.toggle(true, G2)).status, 200);
    const remainingDomain = stoppedDomain === G1 ? G2 : G1;
    const otherActivation = structuredClone(f.read(remainingDomain));
    const selectedGrant = f.read(stoppedDomain).grantId;
    const beforeStop = f.events.length;
    const stopped = await f.toggle(false, stoppedDomain);
    assert.equal(stopped.status, 200);
    const body = await stopped.json();
    assert.equal(body.activation.enabled, false);
    assert.equal(body.activation.scope, null);
    assert.equal(body.grantPaused, true);
    assert.equal(f.grants.get(selectedGrant).status, "paused");
    assert.deepEqual(f.read(remainingDomain), otherActivation);
    assert.equal(f.health().result.capabilities.ambient_planning, "active");
    assert.equal(f.markers.size, 0);
    const stopEvents = f.events.slice(beforeStop);
    assert.equal(stopEvents.filter(event => event.operation === "config" || event.operation === "stop-marker" || event.operation === "clear-marker")
      .every(event => event.domain === stoppedDomain), true);
    assert.ok(stopEvents.findIndex(event => event.operation === "stop-marker") < stopEvents.findIndex(event => event.action === "pause"));
  }
});

test("default requests retain G1 budget checks and its initial scan", async () => {
  const f = fixture();
  const enabled = await f.toggle(true);
  assert.equal(enabled.status, 200);
  const body = await enabled.json();
  assert.equal(body.limits.domain, G1);
  assert.equal(body.grant.modelBudget.remainingCalls, 12);
  assert.deepEqual(body.initialScan, { queued: 0, needsAttention: false });
  assert.equal(f.read(G2).enabled, false);
  assert.equal(f.events.filter(event => event.operation === "prepare_due").length, 1);
  assert.equal((await (await f.get()).json()).limits.domain, G1);
});

test("G2 GET consumes one public read and retains historical records after stopping", async () => {
  const ownerReadPatch = {};
  const f = fixture({ ownerReadPatch });
  assert.equal((await f.toggle(true, G2)).status, 200);
  const grantId = f.read(G2).grantId;
  ownerReadPatch.g2_model_budget = [{ grant_id: grantId, budget_id: "g2-budget", used_calls: 2, max_calls: 4,
    remaining_calls: 2, exhausted: false, usage_unverified: false }];
  ownerReadPatch.g2_execution = { version: 1, available: true, revision: 2, records: [{ execution_id: "execution-1",
    follow_up_id: "follow-up-1", grant_id: grantId, status: "completed", attempt: 1, error_code: null,
    updated_at: "2026-10-05T00:00:00.000Z", source_status: "current" }], external_send: false };
  const before = f.events.length;
  const active = await (await f.get("?domain=student_followup")).json();
  assert.doesNotThrow(() => client.parseEduPiProactivityState(active));
  assert.equal(active.grant.modelBudget.remainingCalls, 2);
  assert.equal(active.execution.records[0].status, "completed");
  assert.equal(f.events.slice(before).filter(event => event.operation === "owner_read").length, 1);
  assert.equal(f.events.slice(before).some(event => ["owner_control", "prepare_due", "restart", "config"].includes(event.operation)), false);
  ownerReadPatch.g2_execution.records[0].grant_id = null;
  ownerReadPatch.g2_execution.records[0].source_status = "unverified";
  const unknown = await (await f.get("?domain=student_followup")).json();
  assert.equal(unknown.execution.available, false, "missing source binding is not an empty queue");
  ownerReadPatch.g2_execution.records[0].grant_id = grantId;
  ownerReadPatch.g2_execution.records[0].source_status = "historical";
  const stopped = await (await f.toggle(false, G2)).json();
  assert.equal(stopped.activation.enabled, false);
  assert.equal(stopped.grant, null);
  assert.equal(stopped.capabilities.studentFollowup, false);
  assert.equal(stopped.execution.records[0].sourceStatus, "historical");
  assert.doesNotThrow(() => client.parseEduPiProactivityState(stopped));
});

test("invalid G2 execution degrades reads without presenting a false empty queue", async () => {
  const f = fixture({ ownerReadPatch: { g2_execution: { version: 1, available: false, revision: 0, records: [], external_send: false } } });
  const state = await (await f.get("?domain=student_followup")).json();
  assert.equal(state.degraded, true);
  assert.equal(state.execution, null);
  assert.equal(state.grant, null);
  assert.doesNotThrow(() => client.parseEduPiProactivityState(state));
});

test("unknown domains and non-isolated G2 enables stop before any Core access", async () => {
  const f = fixture({ isolated: false });
  for (const query of ["?domain=unknown", "?domain=", "?domain=student_followup&domain=teaching_preparation"]) {
    assert.equal((await f.get(query)).status, 400);
  }
  for (const domain of ["unknown", null]) {
    assert.equal((await f.post({ enabled: true, classId: scope.classId, subject: scope.subject, expectedUpdatedAt: null, domain })).status, 400);
  }
  const denied = await f.toggle(true, G2);
  assert.equal(denied.status, 409);
  assert.equal((await denied.json()).code, "proactivity_isolated_canary_required");
  assert.deepEqual(f.events, []);
});

test("G2 activation requires its processor and failure recovery only touches its own config", async () => {
  for (const options of [{ g2Processor: false }, { failG2Grant: true }]) {
    const f = fixture({ ...options, g1Enabled: true });
    const original = structuredClone(f.read(G1));
    const failed = await f.toggle(true, G2);
    assert.equal(failed.status, 503);
    assert.equal(f.read(G2).enabled, false);
    assert.equal(f.read(G2).scope, null);
    assert.deepEqual(f.read(G1), original);
    assert.equal(f.markers.size, 0);
    assert.ok(f.events.some(event => event.operation === "stop-marker" && event.domain === G2));
    assert.equal(f.events.some(event => event.operation === "prepare_due"), false);
  }
});

test("G2 stop failures retain the durable domain fence and quarantine until recovery", async () => {
  const f = fixture({ g1Enabled: true, failPause: true, failDisabledWrite: true });
  assert.equal((await f.toggle(true, G2)).status, 200);
  const failed = await f.toggle(false, G2);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, "proactivity_stop_uncertain");
  assert.equal(f.read(G2).enabled, false);
  assert.equal(f.read(G2).configurationStatus, "stop_pending");
  assert.equal(f.read(G1).enabled, true);
  assert.ok(f.markers.has(G2));
  assert.equal(f.events.at(-1).operation, "quarantine");
  const reenable = await f.toggle(true, G2);
  assert.equal(reenable.status, 409);
  assert.equal((await reenable.json()).code, "proactivity_scope_conflict");
});

test("G2 stop cannot report success while the selected processor is still active", async () => {
  const f = fixture({ forceG2Active: true });
  assert.equal((await f.toggle(true, G2)).status, 200);
  const stopped = await f.toggle(false, G2);
  assert.equal(stopped.status, 503);
  assert.equal((await stopped.json()).code, "proactivity_stop_uncertain");
  assert.equal(f.events.at(-1).operation, "quarantine");
});
