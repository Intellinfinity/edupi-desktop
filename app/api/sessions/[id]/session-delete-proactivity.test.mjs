import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("session deletion withdraws Core-owned sources before destroying memory, rewriting children, or unlinking disk", () => {
  const deletion = source.slice(source.indexOf("export async function DELETE"));
  const lock = deletion.indexOf("withEduPiAmbientSessionLock(id");
  const withdrawal = deletion.indexOf("await withdrawEduPiAmbientMessagesForSession(id)");
  assert.ok(lock > 0 && lock < withdrawal);
  assert.ok(withdrawal < deletion.indexOf("live.destroy()"));
  assert.ok(withdrawal < deletion.indexOf("writeFileSync(childPath"));
  assert.ok(withdrawal < deletion.indexOf("unlinkSync(filePath)"));
  assert.match(deletion, /EduPiAmbientMessageWithdrawalError[\s\S]*status:\s*503/);
});

test("a Core identity mismatch returns 503 without deleting or reparenting a real session file", async t => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-delete-route-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "data"), stateDir = path.join(temporary, "state");
  fs.mkdirSync(dataRoot, { mode: 0o700 });
  fs.mkdirSync(stateDir, { mode: 0o700 });
  const sessionId = "synthetic-delete-session";
  const sessionPath = path.join(temporary, `${sessionId}.jsonl`);
  const childPath = path.join(temporary, "synthetic-child.jsonl");
  const parentSession = path.join(temporary, "synthetic-parent.jsonl");
  fs.writeFileSync(sessionPath, `${JSON.stringify({ type: "session", id: sessionId, parentSession })}\n`);
  fs.writeFileSync(childPath, `${JSON.stringify({ type: "session", id: "synthetic-child", parentSession: sessionPath })}\n`);
  const originalSession = fs.readFileSync(sessionPath);
  const originalChild = fs.readFileSync(childPath);
  const ledger = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-ambient-message-ledger.ts");
  const withdrawal = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-ambient-message-withdrawal.ts");
  const binding = { sessionId, messageId: "synthetic-message", messageRef: `owner_message:${"a".repeat(64)}`,
    ownerId: `owner_${"b".repeat(32)}`, grantId: "synthetic-grant", captureGrantVersion: 1,
    occurredAt: "2026-10-09T00:00:00.000Z" };
  ledger.prepareEduPiAmbientMessageBinding(binding, { stateDir, dataRoot });
  const rootRef = `sha256:${"c".repeat(64)}`;
  let coreAvailable = false;
  const host = { async call() { return { ok: true, result: { data_root_fingerprint: rootRef } }; },
    async callOwnerControl() { return coreAvailable ? { ok: true, result: { receipt: {
      action: "withdraw", message_ref: binding.messageRef, owner_id: binding.ownerId,
      root_ref: rootRef, revision: 2, recorded_at: "2026-10-09T00:01:00.000Z",
      apply: false, live_authority: false, external_send: false,
    } } } : { ok: false, error_code: "owner_identity_mismatch" }; } };
  let shutdownCalls = 0;
  const modules = {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ status: init.status ?? 200, json: async () => body }) } },
    fs, path,
    "@earendil-works/pi-coding-agent": { SessionManager: {} },
    "@/lib/session-reader": { resolveSessionPath: async () => sessionPath,
      readSessionHeader: file => JSON.parse(fs.readFileSync(file, "utf8").split("\n", 1)[0]),
      invalidateSessionPathCache() {}, invalidateSessionListCache() {}, invalidateScannedSession() {} },
    "@/lib/session-path": { sessionPathKey: file => path.resolve(file) },
    "@/lib/session-manager-access": { openSessionManagerForRead() {} },
    "@/lib/rpc-manager": { getRpcSession: () => ({ async shutdown() { shutdownCalls++; } }) },
    "@/lib/edupi-ambient-message-withdrawal": {
      EduPiAmbientMessageWithdrawalError: withdrawal.EduPiAmbientMessageWithdrawalError,
      withdrawEduPiAmbientMessagesForSession: id => withdrawal.withdrawEduPiAmbientMessagesForSession(id,
        { stateDir, roots: { dataRoot: { root: dataRoot } }, host }),
    },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_id, action) => action() },
  };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const route = {};
  vm.runInNewContext(code, { exports: route, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  const response = await route.DELETE(new Request(`http://localhost/api/sessions/${sessionId}`),
    { params: Promise.resolve({ id: sessionId }) });
  assert.equal(response.status, 503);
  assert.deepEqual(fs.readFileSync(sessionPath), originalSession);
  assert.deepEqual(fs.readFileSync(childPath), originalChild);
  assert.equal(shutdownCalls, 0);
  assert.equal(ledger.readWithdrawableEduPiAmbientMessages(sessionId, { stateDir, dataRoot })[0]?.status, "pending");
  coreAvailable = true;
  const retried = await route.DELETE(new Request(`http://localhost/api/sessions/${sessionId}`),
    { params: Promise.resolve({ id: sessionId }) });
  assert.equal(retried.status, 200);
  assert.equal(fs.existsSync(sessionPath), false);
  assert.equal(JSON.parse(fs.readFileSync(childPath, "utf8").split("\n", 1)[0]).parentSession, parentSession);
  assert.equal(shutdownCalls, 1);
  assert.deepEqual(ledger.readWithdrawableEduPiAmbientMessages(sessionId, { stateDir, dataRoot }), []);
});
