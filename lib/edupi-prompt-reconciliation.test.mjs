import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
import { createHash } from "node:crypto";

const { inspectEduPiPromptSession } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./edupi-prompt-reconciliation.ts");
const command = { type: "prompt", message: "合成备课", clientRequestId: "request-1" };
const entry = { command, clientRequestId: "request-1" };

test("an exact persisted Pi marker binds only its first user message to the outbox request", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-prompt-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, path.join(root, "sessions"));
  const file = manager.getSessionFile();
  assert.equal(inspectEduPiPromptSession(entry, file), "unknown");
  const commandHash = `sha256:${createHash("sha256").update(JSON.stringify(command)).digest("hex")}`;
  manager.appendCustomEntry("edupi_prompt_dispatch_v1", { clientRequestId: "request-1", commandHash });
  assert.equal(inspectEduPiPromptSession(entry, file), "unknown", "a new Pi session has no file before its first user message");
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "合成备课" }], timestamp: Date.now() });
  assert.equal(inspectEduPiPromptSession(entry, file), "confirmed");
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "已收到" }], timestamp: Date.now() });
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "另一条" }], timestamp: Date.now() });
  assert.equal(inspectEduPiPromptSession(entry, file), "confirmed", "later chat is not mistaken for the first marked submission");
});

test("a marker alone or a mismatched first user message never proves Pi acceptance", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-prompt-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, path.join(root, "sessions"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "先前对话" }], timestamp: Date.now() });
  const file = manager.getSessionFile();
  const commandHash = `sha256:${createHash("sha256").update(JSON.stringify(command)).digest("hex")}`;
  manager.appendCustomEntry("edupi_prompt_dispatch_v1", { clientRequestId: "request-1", commandHash });
  assert.equal(inspectEduPiPromptSession(entry, file), "marker_only");
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "不同内容" }], timestamp: Date.now() });
  assert.equal(inspectEduPiPromptSession(entry, file), "mismatch");
});

test("image prompts stay unknown until an exact image proof exists", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-prompt-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(inspectEduPiPromptSession({ ...entry, command: { ...command,
    images: [{ type: "image", data: "AQID", mimeType: "image/png" }] } }, path.join(root, "missing.jsonl")), "unknown");
});
