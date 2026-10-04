import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const client = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-proactivity-client.ts");

test("accepts only internal, bounded proactivity state", () => {
  const value = { ok: true, activation: { enabled: false, source: "default", configurationStatus: "missing", scope: null, updatedAt: null },
    scopes: [{ classId: "class-7-1", className: "七一班", subject: "数学", slotCount: 2, materialCount: 1, ready: true }],
    grant: null, capabilities: null, limits: { durationDays: 7, maxModelCalls: 12, domain: "teaching_preparation" }, externalSend: false };
  assert.deepEqual(client.parseEduPiProactivityState(value), value);
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...value, requiresSafeMode: true }));
  assert.throws(() => client.parseEduPiProactivityState({ ...value, requiresSafeMode: "yes" }));
  assert.throws(() => client.parseEduPiProactivityState({ ...value, externalSend: true }));
  assert.throws(() => client.parseEduPiProactivityState({ ...value, scopes: [{ ...value.scopes[0], slotCount: -1 }] }));
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...value, degraded: true,
    grant: { status: "expired", grantVersion: 2, endsAt: "2026-09-24T00:00:00.000Z",
      modelBudget: { usedCalls: 0, maxCalls: 12, remainingCalls: 12, usageUnverified: false } } }));
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...value,
    activation: { ...value.activation, configurationStatus: "legacy", scope: { classId: "class-7-1", subject: "数学" } } }));
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...value,
    activation: { ...value.activation, configurationStatus: "stop_pending", scope: { classId: "class-7-1", subject: "数学" } } }));
  const grant = { status: "active", grantVersion: 2, endsAt: "2026-09-30T08:00:00.000Z",
    modelBudget: { usedCalls: 12, maxCalls: 12, remainingCalls: 0, usageUnverified: false } };
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...value, grant }));
  assert.throws(() => client.parseEduPiProactivityState({ ...value, grant: { ...grant,
    modelBudget: { ...grant.modelBudget, remainingCalls: -1 } } }));
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...value,
    initialScan: { queued: 1, needsAttention: true } }));
  assert.throws(() => client.parseEduPiProactivityState({ ...value,
    initialScan: { queued: -1, needsAttention: false } }));
});

const g2State = { ok: true, activation: { enabled: true, source: "desktop_canary", configurationStatus: "ready",
  scope: { classId: "class-7-1", subject: "数学" }, updatedAt: "2026-10-04T00:00:00.000Z" },
scopes: [{ classId: "class-7-1", className: "七一班", subject: "数学", slotCount: 1, materialCount: 0, ready: true }],
grant: { status: "active", grantVersion: 1, endsAt: "2026-10-11T00:00:00.000Z", modelBudget: null },
capabilities: { ambientPlanning: true, ownerIntent: true, attentionDelivery: true, teacherFeedback: true, studentFollowup: true },
limits: { durationDays: 7, maxModelCalls: 4, domain: "student_followup" }, activationBlocked: null, externalSend: false };

test("G2 parser accepts old unknown budget and bounded new usage without weakening G1 validation", () => {
  assert.deepEqual(client.parseEduPiProactivityState(g2State), g2State);
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...g2State,
    grant: { ...g2State.grant, modelBudget: { usedCalls: 1, maxCalls: 4, remainingCalls: 3, usageUnverified: false } } }));
  for (const patch of [
    { limits: { ...g2State.limits, domain: "unknown" } },
    { limits: { ...g2State.limits, maxModelCalls: 12 } },
    { grant: { ...g2State.grant, modelBudget: { usedCalls: 0, maxCalls: 12, remainingCalls: 12, usageUnverified: false } } },
    { grant: { ...g2State.grant, modelBudget: undefined } },
    { capabilities: { ...g2State.capabilities, studentFollowup: undefined } },
    { initialScan: { queued: 0, needsAttention: false } },
  ]) assert.throws(() => client.parseEduPiProactivityState({ ...g2State, ...patch }));
  assert.throws(() => client.parseEduPiProactivityState({ ...g2State,
    limits: { durationDays: 7, maxModelCalls: 12, domain: "teaching_preparation" } }), "G1 cannot omit its budget");
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...g2State, activationBlocked: "isolated_canary_required" }));
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...g2State, activationBlocked: "windows_unavailable" }));
});

test("G2 client validates execution provenance and never accepts private fields", () => {
  const record = { executionId: "execution-1", followUpId: "follow-up-1", grantId: "grant-1", status: "completed",
    attempt: 1, errorCode: null, updatedAt: "2026-10-05T00:00:00.000Z", sourceStatus: "current" };
  const execution = { version: 1, available: true, revision: 1, records: [record], externalSend: false };
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...g2State, execution }));
  assert.doesNotThrow(() => client.parseEduPiProactivityState({ ...g2State,
    execution: { ...execution, records: [{ ...record, grantId: null, sourceStatus: "historical" }] } }));
  for (const patch of [{ available: false }, { revision: null }, { externalSend: true }, { records: [record, record] },
    ...[{ sourceStatus: "unknown" }, { sourceStatus: ["current"] }, { status: ["queued"] }, { grantId: null }, { attempt: -1 }, { updatedAt: "yesterday" },
      { draft: "private" }, { errorCode: "/private/path" }].map(patch => ({ records: [{ ...record, ...patch }] }))]) {
    assert.throws(() => client.parseEduPiProactivityState({ ...g2State, execution: { ...execution, ...patch } }));
  }
  assert.throws(() => client.parseEduPiProactivityState({ ...g2State, grant: null, execution,
    limits: { ...g2State.limits, domain: "teaching_preparation", maxModelCalls: 12 } }));
});

test("G2 client uses the desktop token for its fixed query and binds responses to the requested domain", async () => {
  const calls = [];
  let responseValue = g2State;
  const mockNative = {
    desktopApiHeaders: async () => new Headers({ "x-test-desktop-token": "synthetic-token" }),
    fetchDesktopApi: async (url, init) => { calls.push({ url, init, privileged: true }); return Response.json(responseValue); },
  };
  const source = fs.readFileSync(new URL("./edupi-proactivity-client.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const clientModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", compiled)(name => {
    assert.equal(name, "./desktop-native"); return mockNative;
  }, clientModule, clientModule.exports, async (url, init) => { calls.push({ url, init }); return Response.json(responseValue); });
  await clientModule.exports.readEduPiProactivity(undefined, "student_followup");
  assert.equal(calls[0].url, "/api/edupi/proactivity?domain=student_followup");
  assert.equal(calls[0].init.headers.get("x-test-desktop-token"), "synthetic-token");
  const input = { enabled: false, classId: null, subject: null, expectedUpdatedAt: g2State.activation.updatedAt, domain: "student_followup" };
  await clientModule.exports.updateEduPiProactivity(input);
  assert.equal(calls[1].privileged, true);
  assert.deepEqual(JSON.parse(calls[1].init.body), input);
  await assert.rejects(clientModule.exports.readEduPiProactivity(), /领域不匹配/);
  responseValue = { ...g2State, limits: { durationDays: 7, maxModelCalls: 12, domain: "teaching_preparation" },
    grant: null, capabilities: null };
  await clientModule.exports.readEduPiProactivity();
  assert.equal(calls.at(-1).url, "/api/edupi/proactivity");
  assert.equal(calls.at(-1).privileged, true);
});
