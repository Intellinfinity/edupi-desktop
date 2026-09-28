import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const runtime = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-proactivity-runtime.ts");
const rootRef = `sha256:${"a".repeat(64)}`;
const binding = {
  grantId: "desktop_canary_1234",
  endsAt: "2026-09-30T08:00:00.000Z",
  spec: { scope: { class_id: "class-7-1", subject: "数学" }, domains: ["teaching_preparation"], actions: ["prepare", "update"],
    source_ids: [`conversation:${"b".repeat(64)}`], starts_at: "2026-09-23T07:59:00.000Z", ends_at: "2026-09-30T08:00:00.000Z",
    budget: { id: "budget-1", max_calls: 12 } },
};

test("bootstraps an owner and creates one bounded active grant", async () => {
  const calls = [];
  let owner = null;
  let grant = null;
  const host = {
    async call(operation, payload) {
      assert.equal(operation, "owner_read");
      calls.push([operation, payload]);
      return { ok: true, result: { root_ref: rootRef, owner, grants: grant ? [grant] : [] } };
    },
    async callOwnerControl(operation, payload) {
      assert.equal(operation, "owner_control");
      calls.push([operation, payload]);
      if (payload.action === "bootstrap") owner = { id: `owner_${"c".repeat(32)}` };
      if (payload.action === "create") grant = { id: binding.grantId, version: 1, status: "active", ends_at: binding.endsAt };
      return { ok: true, result: { owner_id: owner.id, grant_id: grant?.id || null, grant_version: grant?.version || null } };
    },
  };
  const result = await runtime.ensureProactivityGrant(host, rootRef, binding);
  assert.deepEqual(result, { ownerId: owner.id, grantId: binding.grantId, grantVersion: 1, status: "active", endsAt: binding.endsAt });
  assert.deepEqual(calls.map((item) => item[1].action || item[0]), ["owner_read", "bootstrap", "owner_read", "create", "owner_read"]);
  assert.equal(calls.find((item) => item[1].action === "create")[1].spec.budget.max_calls, 12);
});

test("updates then resumes a paused grant and pauses an active grant", async () => {
  const owner = { id: `owner_${"d".repeat(32)}` };
  let grant = { id: binding.grantId, version: 3, status: "paused", ends_at: "2026-09-25T00:00:00.000Z" };
  const actions = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner, grants: [grant] } }; },
    async callOwnerControl(_operation, payload) {
      actions.push(payload.action);
      if (payload.action === "update") grant = { ...grant, version: 4, ends_at: binding.endsAt };
      if (payload.action === "resume") grant = { ...grant, version: 5, status: "active" };
      if (payload.action === "pause") grant = { ...grant, version: 6, status: "paused" };
      return { ok: true, result: { owner_id: owner.id, grant_id: grant.id, grant_version: grant.version } };
    },
  };
  const enabled = await runtime.ensureProactivityGrant(host, rootRef, binding);
  assert.equal(enabled.grantVersion, 5);
  assert.deepEqual(actions, ["update", "resume"]);
  const paused = await runtime.pauseProactivityGrant(host, rootRef, binding.grantId);
  assert.deepEqual(paused, { state: "paused", grantVersion: 6 });
  assert.deepEqual(actions, ["update", "resume", "pause"]);
});

test("grant reads expose expiry and distinguish safe stop outcomes", async () => {
  const owner = { id: `owner_${"f".repeat(32)}` };
  const active = { id: binding.grantId, version: 2, status: "active", ends_at: "2026-09-24T00:00:00.000Z" };
  const budget = { grant_id: active.id, budget_id: "budget-1", used_calls: 3, max_calls: 12,
    remaining_calls: 9, exhausted: false, usage_unverified: false };
  const host = { async call() { return { ok: true, result: { root_ref: rootRef, owner, grants: [active], g1_model_budget: [budget] } }; } };
  assert.deepEqual(await runtime.readProactivityGrantStatus(host, rootRef, binding.grantId, Date.parse("2026-09-24T00:00:00.000Z")),
    { status: "expired", grantVersion: 2, endsAt: active.ends_at,
      modelBudget: { usedCalls: 3, maxCalls: 12, remainingCalls: 9, usageUnverified: false } });
  assert.equal((await runtime.readProactivityOwnerContext(host, rootRef, binding.grantId, Date.parse("2026-09-25T00:00:00.000Z"))).status, "expired");
  assert.deepEqual(await runtime.pauseProactivityGrant({ ...host, callOwnerControl: async () => { throw new Error("must not call"); } }, rootRef, "missing"),
    { state: "missing", grantVersion: null });
});

test("active grant budget is required and legacy unknown usage stays exhausted", async () => {
  const owner = { id: `owner_${"f".repeat(32)}` };
  const active = { id: binding.grantId, version: 2, status: "active", ends_at: binding.endsAt };
  const response = budget => ({ ok: true, result: { root_ref: rootRef, owner, grants: [active], g1_model_budget: budget } });
  await assert.rejects(runtime.readProactivityGrantStatus({ call: async () => response(undefined) }, rootRef, active.id),
    (error) => error?.code === "proactivity_response_invalid");
  const legacy = { grant_id: active.id, budget_id: "budget-1", used_calls: 0, max_calls: 12,
    remaining_calls: 0, exhausted: true, usage_unverified: true };
  assert.deepEqual((await runtime.readProactivityGrantStatus({ call: async () => response([legacy]) }, rootRef, active.id))?.modelBudget,
    { usedCalls: 0, maxCalls: 12, remainingCalls: 0, usageUnverified: true });
});

test("activation catch-up cannot report success for denied or wholly blocked work", () => {
  const scan = (tasks, failures) => ({ ok: true, result: { tasks, failures } });
  assert.deepEqual(runtime.inspectProactivityCatchUp(scan([], [])), { queued: 0, needsAttention: false });
  assert.deepEqual(runtime.inspectProactivityCatchUp(scan([{ task_id: "task-1" }], [{ code: "excerpt_unconfirmed" }])),
    { queued: 1, needsAttention: true });
  assert.deepEqual(runtime.inspectProactivityCatchUp(scan([], [{ code: "completed_source_changed" }])),
    { queued: 0, needsAttention: true }, "Core verified the current source and retained an older completed draft for review");
  assert.throws(() => runtime.inspectProactivityCatchUp(scan([], [{ code: "excerpt_unconfirmed" }])),
    (error) => error?.code === "proactivity_preparation_blocked");
  assert.throws(() => runtime.inspectProactivityCatchUp(scan([], [{ code: "stale_source" }])),
    (error) => error?.code === "proactivity_preparation_blocked");
  assert.throws(() => runtime.inspectProactivityCatchUp(scan([], [{ code: "completed_source_changed" }, { code: "source_unavailable" }])),
    (error) => error?.code === "proactivity_preparation_blocked");
  assert.throws(() => runtime.inspectProactivityCatchUp(scan([{ task_id: "task-1" }], [{ code: "permission_denied" }])),
    (error) => error?.code === "proactivity_grant_denied");
  assert.throws(() => runtime.inspectProactivityCatchUp(scan([], [{ code: "budget_exhausted" }])),
    (error) => error?.code === "proactivity_budget_exhausted");
  assert.throws(() => runtime.inspectProactivityCatchUp({ ok: true, result: { tasks: [], failures: "hidden" } }),
    (error) => error?.code === "proactivity_response_invalid");
});

test("invalid, revoked, or mismatched owner responses fail closed", async () => {
  const bad = { call: async () => ({ ok: true, result: { root_ref: rootRef, owner: { id: "bad owner" }, grants: [] } }), callOwnerControl: async () => ({ ok: true }) };
  await assert.rejects(runtime.ensureProactivityGrant(bad, rootRef, binding), (error) => error?.code === "proactivity_response_invalid");
  const revoked = { call: async () => ({ ok: true, result: { root_ref: rootRef, owner: { id: `owner_${"e".repeat(32)}` }, grants: [{ id: binding.grantId, version: 2, status: "revoked", ends_at: binding.endsAt }] } }), callOwnerControl: async () => ({ ok: true }) };
  await assert.rejects(runtime.ensureProactivityGrant(revoked, rootRef, binding), (error) => error?.code === "proactivity_grant_revoked");
});
