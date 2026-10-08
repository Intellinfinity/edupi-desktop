import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const ledger = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../../lib/edupi-ambient-message-ledger.ts");

test("owner read failure before onPrepared remains known pre-write and never strands a fake unknown", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-owner-prewrite-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state"), dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
  const options = { stateDir, dataRoot };
  let mode = "owner_unavailable", writes = 0;
  class AmbientError extends Error {
    constructor(code, stage) { super(code); this.code = code; this.stage = stage; }
  }
  const modules = {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ status: init.status ?? 200, json: async () => body }) } },
    "node:crypto": crypto,
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ runtime: { coreCommit: "synthetic-pin" }, dataRoot: { root: dataRoot } }) },
    "@/lib/edupi-proactivity-control": { isCapabilityGrantBindingIdentity: () => true },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: ({ domain }) => ({ enabled: domain === "teaching_preparation",
      source: "desktop_canary", configurationStatus: "ready", grantId: "grant-g1",
      scope: { classId: "synthetic-class", subject: "synthetic-subject" } }) },
    "@/lib/edupi-proactivity-runtime": { readProactivityOwnerContext: async () => ({ status: "active" }) },
    "@/lib/edupi-runtime-supervisor": { isEduPiG3ExactRuntimeSupported: () => false,
      ensureEduPiRuntime: async () => ({ call: async () => ({ ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
        capabilities: { ambient_planning: "active", owner_intent: "active" } } }) }) },
    "@/lib/session-reader": { resolveSessionPath: async () => "synthetic-session" },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_id, action) => action() },
    "@/lib/safe-mode": { canStartEduPiStudentFollowup: () => false },
    "@/lib/edupi-ambient-message-ledger": Object.fromEntries([
      "acknowledgeEduPiAmbientMessagePlan", "armEduPiAmbientMessagePlan", "cancelEduPiAmbientMessagePlan",
      "confirmEduPiAmbientMessageBinding", "finishEduPiAmbientPlanDomain", "markEduPiAmbientMessageOutcomeUnknown",
      "markEduPiAmbientMessageOutcomeVerified", "markEduPiAmbientPlanDomainUnavailable", "prepareEduPiAmbientPlanDomainBinding",
      "readCompletedEduPiAmbientMessages", "readCancelledEduPiAmbientMessages", "readLegacySettledEduPiAmbientMessages",
      "readEduPiAmbientMessagePlan", "readPendingEduPiAmbientMessages", "readUnsettledEduPiAmbientMessages",
    ].map(name => [name, (...args) => ledger[name](...args.slice(0, -1), options)])),
    "@/lib/edupi-ambient-message-recovery": { readExactEduPiAmbientGoalBinding: async () => ({ status: "outcome_unknown" }),
      readExactEduPiG2Execution: async () => ({ status: "outcome_unknown" }) },
    "@/lib/edupi-ambient-message-runtime": { EduPiAmbientMessageError: AmbientError,
      predictEduPiOwnerMessageRef: () => "", captureAndApplyAmbientMessage: async (_host, input, callbacks) => {
        if (mode === "owner_unavailable") throw new AmbientError("proactivity_grant_unavailable", "owner");
        const binding = { messageRef: `owner_message:${"b".repeat(64)}`, ownerId: "owner-1",
          grantId: input.grantId, captureGrantVersion: 1 };
        await callbacks.onPrepared(binding); await callbacks.onCaptured(binding); await callbacks.onApplyPending(binding);
        writes++;
        throw new Error("synthetic_apply_reply_lost");
      } },
  };
  const code = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const route = {};
  vm.runInNewContext(code, { exports: route, URL,
    require: name => { assert.ok(modules[name], name); return modules[name]; } });
  const post = (messageId, occurredAt, action = null) => route.POST(new Request("http://localhost/api/edupi/proactivity/messages",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "synthetic-session",
      messageId, occurredAt, ...(action ? { action } : { text: "Synthetic teacher request" }) }) }));
  const firstAt = "2026-10-08T00:00:00.000Z";
  assert.equal((await(await post("prompt-one", firstAt, "arm")).json()).status, "armed");
  await post("prompt-one", firstAt);
  const restarted = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../../lib/edupi-ambient-message-ledger.ts");
  assert.equal(restarted.readEduPiAmbientMessagePlan("synthetic-session", "prompt-one", options).domains[0].state, "unavailable");
  const modulePath = new URL("../../../../../lib/edupi-ambient-message-ledger.ts", import.meta.url).pathname;
  const child = `import { createJiti } from "jiti";
const ledger = await createJiti(import.meta.url, { tsconfigPaths: true }).import(${JSON.stringify(modulePath)});
const plan = ledger.readEduPiAmbientMessagePlan("synthetic-session", "prompt-one", ${JSON.stringify(options)});
process.stdout.write(plan.domains[0].state);`;
  const cold = spawnSync(process.execPath, ["--input-type=module", "-e", child], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(cold.status, 0, cold.stderr);
  assert.equal(cold.stdout, "unavailable");
  assert.equal(restarted.readUnsettledEduPiAmbientMessages("synthetic-session", options).length, 0);
  const pending = await route.GET(new Request("http://localhost/api/edupi/proactivity/messages?sessionId=synthetic-session"));
  const firstPending = (await pending.json()).pending[0];
  assert.equal(firstPending.nonBlocking, true);
  assert.equal(firstPending.unprocessed, true);
  assert.equal(firstPending.partiallyHandled, false);
  mode = "apply_reply_lost";
  const secondAt = "2026-10-08T00:00:01.000Z";
  assert.equal((await(await post("prompt-two", secondAt, "arm")).json()).status, "armed");
  await post("prompt-two", secondAt);
  assert.equal(writes, 1);
  assert.equal(restarted.readEduPiAmbientMessagePlan("synthetic-session", "prompt-two", options).domains[0].state, "unknown");
  assert.equal((await(await post("prompt-three", "2026-10-08T00:00:02.000Z", "arm")).json()).status, "verification_pending");
});
