import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readFile } from "node:fs/promises";
const { bindReminderSession } = await createJiti(import.meta.url).import("./edupi-reminder-session.ts");
test("reminder continuation binds the real session to its task", async () => {
  let request;
  await bindReminderSession("task/a", "session-1", async (url, init) => { request = { url, init }; return { ok: true }; });
  assert.equal(request.url, "/api/edupi/tasks/task%2Fa/session");
  assert.equal(request.init.method, "PUT");
  assert.deepEqual(JSON.parse(request.init.body), { sessionId: "session-1" });
  await assert.rejects(bindReminderSession("task/a", "session-1", async () => ({ ok: false })), /任务关联失败/);
});
test("new reminder conversations isolate drafts and preserve the general workspace draft", async () => {
  const shell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  const chat = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(shell, /const reminderKey = `reminder:\$\{data\.workspace\}:\$\{taskId\}`/);
  assert.match(shell, /if \(workspaceDraft\) setDraft\(workspaceDraftKey, workspaceDraft\)/);
  assert.match(chat, /session\?\.id \?\? reminderDraftKey \?\?/);
  const selectSession = shell.slice(shell.indexOf("const handleEducationSelectSession"), shell.indexOf("const handleNewSession"));
  assert.match(selectSession, /params\.delete\("task"\)/);
  assert.match(selectSession, /params\.delete\("reminders"\)/);
});
