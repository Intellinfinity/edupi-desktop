import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const ledger = await jiti.import("../../../../../lib/edupi-ambient-message-ledger.ts");
const pending = await jiti.import("../../../../../lib/edupi-ambient-client-pending.ts");

function compile(file) {
  return ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

test("a cold client reload keeps native outbox pending after G1 applies and G2 becomes unavailable", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-message-outbox-restart-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state"), dataRoot = path.join(root, "data"), nativeFile = path.join(root, "native-outbox.json");
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
  const ledgerOptions = { stateDir, dataRoot };
  const native = {
    readAmbientCaptureOutboxNative: async () => fs.existsSync(nativeFile) ? JSON.parse(fs.readFileSync(nativeFile, "utf8")) : [],
    rememberAmbientCaptureNative: async entry => {
      const prior = fs.existsSync(nativeFile) ? JSON.parse(fs.readFileSync(nativeFile, "utf8")) : [];
      fs.writeFileSync(nativeFile, JSON.stringify([...prior, entry]), { mode: 0o600 });
    },
    clearAmbientCaptureNative: async (sessionId, messageId) => {
      const prior = fs.existsSync(nativeFile) ? JSON.parse(fs.readFileSync(nativeFile, "utf8")) : [];
      fs.writeFileSync(nativeFile, JSON.stringify(prior.filter(item => item.sessionId !== sessionId || item.messageId !== messageId)), { mode: 0o600 });
    },
  };
  const storage = {
    rememberEduPiAmbientUnconfirmedDurable: input => pending.rememberEduPiAmbientUnconfirmedDurable(input, native),
    readEduPiAmbientUnconfirmedDurable: sessionId => pending.readEduPiAmbientUnconfirmedDurable(sessionId, native),
    clearEduPiAmbientUnconfirmedDurable: (sessionId, messageId) => pending.clearEduPiAmbientUnconfirmedDurable(sessionId, messageId, native),
  };
  const prefs = new Map();
  const originalWindow = globalThis.window;
  t.after(() => { globalThis.window = originalWindow; });
  const setOrigin = values => { globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } }; };
  setOrigin(prefs);
  let g1Applies = 0;
  const roots = { runtime: { coreCommit: "synthetic-exact-pin" }, dataRoot: { root: dataRoot } };
  const ledgerModule = Object.fromEntries([
    "acknowledgeEduPiAmbientMessagePlan", "armEduPiAmbientMessagePlan", "cancelEduPiAmbientMessagePlan",
    "confirmEduPiAmbientMessageBinding", "finishEduPiAmbientPlanDomain", "markEduPiAmbientMessageOutcomeUnknown",
    "markEduPiAmbientMessageOutcomeVerified", "markEduPiAmbientPlanDomainUnavailable",
    "prepareEduPiAmbientMessageBinding", "readCompletedEduPiAmbientMessages", "readEduPiAmbientMessagePlan",
    "readPendingEduPiAmbientMessages", "readUnsettledEduPiAmbientMessages", "startEduPiAmbientPlanDomain",
  ].map(name => [name, (...args) => ledger[name](...args.slice(0, -1), ledgerOptions)]));
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status ?? 200,
      headers: { "content-type": "application/json" } }) } },
    "node:crypto": crypto,
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => roots },
    "@/lib/edupi-proactivity-control": { isCapabilityGrantBindingIdentity: () => true },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: ({ domain }) => ({ enabled: domain === "teaching_preparation"
      || domain === "student_followup", source: "desktop_canary", configurationStatus: "ready",
    grantId: `grant-${domain}`, scope: { classId: "synthetic-class", subject: "synthetic-subject" } }) },
    "@/lib/edupi-proactivity-runtime": { readProactivityOwnerContext: async () => ({ status: "active" }) },
    "@/lib/edupi-runtime-supervisor": { isEduPiG3ExactRuntimeSupported: () => false,
      ensureEduPiRuntime: async () => ({ call: async () => ({ ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
        capabilities: { ambient_planning: "active", owner_intent: "active", g2_processor: "active" } } }) }) },
    "@/lib/session-reader": { resolveSessionPath: async () => "synthetic-session" },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_id, operation) => operation() },
    "@/lib/safe-mode": { canStartEduPiStudentFollowup: () => true },
    "@/lib/edupi-ambient-message-ledger": ledgerModule,
    "@/lib/edupi-ambient-message-recovery": { readExactEduPiAmbientGoalBinding: async () => ({ status: "outcome_unknown" }),
      readExactEduPiG2Execution: async () => ({ status: "outcome_unknown" }) },
    "@/lib/edupi-ambient-message-runtime": { EduPiAmbientMessageError: class extends Error {},
      predictEduPiOwnerMessageRef: () => "", captureAndApplyAmbientMessage: async (_host, input, callbacks) => {
        if (input.domain === "student_followup") throw new Error("synthetic_g2_unavailable");
        g1Applies++;
        const binding = { messageRef: `owner_message:${"b".repeat(64)}`, ownerId: "owner-1",
          grantId: input.grantId, captureGrantVersion: 1 };
        await callbacks.onPrepared(binding); await callbacks.onCaptured(binding); await callbacks.onApplyPending(binding);
        return { status: "applied", goalId: "goal-1", workCaseId: "work-1", externalSend: false };
      } },
  };
  const route = {};
  vm.runInNewContext(compile("./route.ts"), { exports: route, URL, Request, Response,
    require: name => { assert.ok(modules[name], name); return modules[name]; } });
  const fetchDesktopApi = (url, options) => {
    const request = new Request(`http://localhost${url}`, { method: options.method,
      ...(options.body ? { body: options.body, headers: options.headers } : {}) });
    return options.method === "GET" ? route.GET(request) : route.POST(request);
  };
  const makeClient = () => {
    const exports = {};
    vm.runInNewContext(compile("../../../../../lib/edupi-ambient-message.ts"), { exports, URLSearchParams,
      require: name => {
        if (name === "./desktop-native") return { fetchDesktopApi };
        if (name === "./desktop-updater") return { isTauriDesktop: () => true };
        if (name === "./edupi-ambient-client-pending") return storage;
        throw new Error(name);
      } });
    return exports;
  };
  const input = { sessionId: "synthetic-session", messageId: "prompt-stable", occurredAt: "2026-10-08T00:00:00.000Z",
    text: "Synthetic teacher request" };
  const first = makeClient();
  assert.equal((await first.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await first.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(g1Applies, 1);
  assert.equal(JSON.parse(fs.readFileSync(nativeFile, "utf8")).length, 1);
  assert.equal(ledger.readEduPiAmbientMessagePlan(input.sessionId, input.messageId, ledgerOptions).status, "pending");
  setOrigin(new Map());
  const reloaded = makeClient();
  const state = await reloaded.readEduPiAmbientPending(input.sessionId, true);
  assert.equal(state.status, "outcome_unknown");
  assert.equal(state.pending[0].messageId, input.messageId);
  assert.equal((await reloaded.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(g1Applies, 1, "a restarted client cannot reapply G1");
  assert.equal(JSON.parse(fs.readFileSync(nativeFile, "utf8")).length, 1);
  assert.equal(fs.readFileSync(nativeFile, "utf8").includes(input.text), false);
});
