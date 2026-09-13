#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.equal(typeof configuredCoreRoot, "string", "EDUPI_CORE_ROOT is required");
assert.equal(path.isAbsolute(configuredCoreRoot), true, "EDUPI_CORE_ROOT must be absolute");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-task-board-write-e2-"));
const dataRoot = path.join(temp, "teacher-data");
for (const directory of [path.join(dataRoot, ".edupi", "memory"), path.join(dataRoot, ".edupi", "output"), path.join(dataRoot, ".edupi", "locks")]) fs.mkdirSync(directory, { recursive: true });

process.env.EDUPI_CORE_ROOT = coreRoot;
process.env.EDUPI_CORE_ALLOWED_ROOT = path.dirname(coreRoot);
process.env.EDUPI_DATA_ROOT = dataRoot;
process.env.EDUPI_DATA_ALLOWED_ROOT = temp;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("../app/api/edupi/tasks/route.ts");
const { PATCH } = await jiti.import("../app/api/edupi/tasks/[taskId]/route.ts");
const { GET } = await jiti.import("../app/api/edupi/education/route.ts");

function request(url, method, body) {
  return new Request(url, { method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
}

try {
  const createdResponse = await POST(request("http://localhost/api/edupi/tasks", "POST", { clientRequestId: "10000000-0000-4000-8000-000000000001", title: "准备第一次单元检测", dueDate: "2026-09-10", note: "先整理范围" }));
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200, JSON.stringify(created));
  const task = created.data.tasks.find((item) => item.title === "准备第一次单元检测");
  assert.ok(task);
  assert.equal(task.boardStage, "todo");
  assert.equal(task.boardRevision, 0);

  let revision = 0;
  for (const stage of ["progress", "review", "done"]) {
    const response = await PATCH(request(`http://localhost/api/edupi/tasks/${encodeURIComponent(task.id)}`, "PATCH", { stage, expectedRevision: revision, note: null }), { params: Promise.resolve({ taskId: task.id }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    revision += 1;
    const updated = result.data.tasks.find((item) => item.id === task.id);
    assert.equal(updated.boardStage, stage);
    assert.equal(updated.boardRevision, revision);
  }

  const secondResponse = await POST(request("http://localhost/api/edupi/tasks", "POST", { clientRequestId: "10000000-0000-4000-8000-000000000002", title: "不可跳过流程的任务", dueDate: null, note: null }));
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200, JSON.stringify(second));
  const secondTask = second.data.tasks.find((item) => item.title === "不可跳过流程的任务");
  // Direct todo → done is an intentional teacher-board path: a teacher can
  // record work completed outside EduPi without manufacturing a review.
  const directCompletionResponse = await PATCH(request(`http://localhost/api/edupi/tasks/${encodeURIComponent(secondTask.id)}`, "PATCH", { stage: "done", expectedRevision: 0, note: null }), { params: Promise.resolve({ taskId: secondTask.id }) });
  const directCompletion = await directCompletionResponse.json();
  assert.equal(directCompletionResponse.status, 200, JSON.stringify(directCompletion));
  assert.equal(directCompletion.data.tasks.find((item) => item.id === secondTask.id).boardStage, "done");

  const finalResponse = await GET();
  const final = await finalResponse.json();
  assert.equal(finalResponse.status, 200, JSON.stringify(final));
  assert.equal(final.tasks.find((item) => item.id === task.id).boardStage, "done");
  assert.equal(final.tasks.find((item) => item.id === secondTask.id).boardStage, "done");
  assert.equal(fs.existsSync(path.join(dataRoot, ".edupi", "output", "task_board_state.json")), true);
  const { createEduPiTaskTool } = await jiti.import("../lib/edupi-task-tool.ts");
  const { taskCategory } = await jiti.import("../lib/edupi-task-category.ts");
  const tool = createEduPiTaskTool({ projectRoot: dataRoot });
  const chatResult = await tool.execute("chat-create-1", { title: "703班认识几何体备课", due_date: "2026-09-07" }, undefined, undefined, { cwd: dataRoot, sessionManager: { getBranch: () => [{ id: "teacher-chat-1", type: "message", message: {role:"user",content:"请建立703班备课任务"} }] } });
  const afterChat = await (await GET()).json();
  const chatTask = afterChat.tasks.find((item) => item.id === chatResult.details.taskId);
  assert.ok(chatTask, "chat task must be present in the same Desktop projection");
  assert.equal(taskCategory(chatTask), "teaching", "chat task must be visible in teaching preparation");
  assert.equal(chatTask.boardStage, "todo");
  const reloaded = await (await GET()).json();
  assert.ok(reloaded.tasks.some((item) => item.id === chatTask.id));
  const reminders = await jiti.import("../app/api/edupi/reminders/route.ts");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const reminderTaskResponse = await POST(request("http://localhost/api/edupi/tasks", "POST", { clientRequestId: "10000000-0000-4000-8000-000000000003", title: "提醒接口验收", dueDate: today, note: "隔离测试" }));
  assert.equal(reminderTaskResponse.status, 200);
  const inboxResponse = await reminders.GET();
  assert.equal(inboxResponse.status, 200);
  const inbox = await inboxResponse.json();
  const reminder = inbox.items.find(item => item.title === "提醒接口验收");
  assert.ok(reminder);
  assert.equal(reminder.kind, "due");
  const again = await (await reminders.GET()).json();
  assert.equal(again.items.filter(item => item.taskId === reminder.taskId).length, 1);
  assert.equal((await reminders.POST(request("http://localhost/api/edupi/reminders", "POST", { id: reminder.id, type: "handled" }))).status, 200);
  const persisted = await (await reminders.GET()).json();
  assert.equal(persisted.items.find(item => item.id === reminder.id).handled, true);
  console.log(JSON.stringify({ status: "passed", created: 2, moved: ["progress", "review", "done"], direct_completion: true, restart_reload: true }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
