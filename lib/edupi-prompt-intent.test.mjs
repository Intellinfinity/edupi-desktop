import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { prepareEduPiPromptIntent, readEduPiPromptIntent, listEduPiPromptIntents,
  resolveEduPiPromptIntent } = await createJiti(import.meta.url).import("./edupi-prompt-intent.ts");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-prompt-intent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state"), dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
  return { root, stateDir, dataRoot, options: { stateDir, dataRoot } };
}
const input = { sessionId: "session-1", clientRequestId: "66666666-6666-4666-8666-666666666666",
  occurredAt: "2026-10-10T00:00:00.000Z", message: "合成消息", draftValue: "合成消息", cwd: "/synthetic/cwd" };

test("the intent is durable and private before Core or Pi can receive the first prompt", t => {
  const f = fixture(t);
  assert.equal(prepareEduPiPromptIntent(input, f.options).status, "pending");
  assert.equal(readEduPiPromptIntent(input.sessionId, input.clientRequestId, f.options)?.message, input.message);
  assert.equal(listEduPiPromptIntents(f.options).length, 1);
  assert.equal(prepareEduPiPromptIntent(input, f.options).status, "pending");
  assert.throws(() => prepareEduPiPromptIntent({ ...input, message: "不同消息" }, f.options), /prompt_intent_unavailable/);
  const files = fs.readdirSync(path.join(f.stateDir, "edupi-prompt-intent-v1"));
  assert.equal(files.length, 1);
  const names = fs.readdirSync(path.join(f.stateDir, "edupi-prompt-intent-v1", files[0]));
  assert.equal(names.length, 1);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(f.stateDir, "edupi-prompt-intent-v1", files[0], names[0])).mode & 0o077, 0);
  }
});

test("resolved identity is a compact tombstone and cannot be replayed", t => {
  const f = fixture(t);
  prepareEduPiPromptIntent(input, f.options);
  const resolved = resolveEduPiPromptIntent(input.sessionId, input.clientRequestId, f.options);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.message, "");
  assert.equal(prepareEduPiPromptIntent(input, f.options).status, "resolved");
  assert.throws(() => prepareEduPiPromptIntent({ ...input, message: "被篡改的重试" }, f.options), /prompt_intent_unavailable/);
  assert.equal(listEduPiPromptIntents(f.options)[0].status, "resolved");
});

test("different Core roots keep disjoint intent journals", t => {
  const f = fixture(t);
  const otherRoot = path.join(f.root, "other-data");
  fs.mkdirSync(otherRoot, { mode: 0o700 });
  prepareEduPiPromptIntent(input, f.options);
  assert.equal(listEduPiPromptIntents({ stateDir: f.stateDir, dataRoot: otherRoot }).length, 0);
});
