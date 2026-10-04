import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createPreparationArtifactTool } = await jiti.import("./edupi-preparation-artifact-tool.ts");
const { normalizePreparationArtifact, revisePreparationArtifact } = await jiti.import("./edupi-preparation-artifact-client.ts");
const artifact = { artifact_id: "a", task_id: "task", title: "教案", content: "候选正文", revision: 2, current_revision: 2, relative_path: ".edupi/output/lesson.md", access: "editable", history: [{ revision: 2, updated_at: "2026-09-09", actor: "agent" }] };
test("artifact client rejects unsafe paths and mismatched saved text", async () => {
  assert.equal(normalizePreparationArtifact(artifact), artifact);
  assert.throws(() => normalizePreparationArtifact({ ...artifact, relative_path: ".edupi/output/../../private.md" }));
  assert.throws(() => normalizePreparationArtifact({ ...artifact, access: undefined }), /权限/);
  assert.throws(() => normalizePreparationArtifact({ ...artifact, access: "unknown" }), /权限/);
  assert.equal(normalizePreparationArtifact({ ...artifact, access: "read_only" }).access, "read_only");
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ artifact }), { status: 200 });
  try { await assert.rejects(revisePreparationArtifact("a", 1, "different"), /保存内容/); } finally { globalThis.fetch = original; }
});

test("a readonly readback cannot be reported as a successful revision", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ artifact: { ...artifact, content: "正文\n", access: "read_only" } });
  try { await assert.rejects(revisePreparationArtifact("a", 1, "正文"), /保存内容未确认/); }
  finally { globalThis.fetch = original; }
});
test("artifact client matches Core trailing-newline normalization without removing existing newlines", async () => {
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, options) => { const body = JSON.parse(options.body); sent.push(body.content); return new Response(JSON.stringify({ artifact: { ...artifact, content: body.content.endsWith("\n") ? body.content : body.content + "\n" } }), { status: 200 }); };
  try {
    assert.equal((await revisePreparationArtifact("a", 1, "正文")).content, "正文\n");
    assert.equal((await revisePreparationArtifact("a", 1, "正文\n\n")).content, "正文\n\n");
    assert.deepEqual(sent, ["正文\n", "正文\n\n"]);
  } finally { globalThis.fetch = original; }
});
test("AI revision uses the real user message as source and preserves the Core candidate result", async () => {
  const calls = [];
  const tool = createPreparationArtifactTool("/tmp/project", async (action, input) => { calls.push({ action, input }); return { artifact, unchanged: false }; });
  const ctx = { cwd: "/tmp/project", sessionManager: { getSessionId: () => "session", getBranch: () => [{ type: "message", id: "user-message", message: { role: "user", content: "请修改导入环节" } }] } };
  await tool.execute("read-call", { action: "read", artifact_id: "a", revision: 1 }, undefined, undefined, ctx);
  const result = await tool.execute("revise-call", { action: "revise", artifact_id: "a", expected_revision: 1, content: "候选正文" }, undefined, undefined, ctx);
  assert.deepEqual(calls[1].input.source, { session_id: "session", message_id: "user-message", tool_call_id: "revise-call", text: "请修改导入环节" });
  assert.equal(calls[1].input.actor, "agent");
  assert.equal(calls[1].input.expected_revision, 1);
  assert.match(result.content[0].text, /待教师审核/);
  await assert.rejects(tool.execute("bad", { action: "revise", artifact_id: "a", expected_revision: 1, content: "正文" }, undefined, undefined, { ...ctx, cwd: "/tmp/other" }), /所属工作区/);
});
