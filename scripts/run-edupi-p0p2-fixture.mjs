#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";

// Run only against the pinned Core and a newly-created synthetic workspace.
// Resume preserves the exact workspace and local model port; no real credentials
// or user sessions are copied. Ctrl-C stops the owned servers and preserves data.
const args = process.argv.slice(2);
const arg = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const production = args.includes("--production");
const worktree = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const coreRoot = fs.realpathSync(arg("--core") || process.env.EDUPI_CORE_ROOT || "");
const coreCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: coreRoot, encoding: "utf8" }).trim();
const compatibility = JSON.parse(fs.readFileSync(path.join(worktree, "contracts/edupi-core-compat.json"), "utf8"));
assert.equal(coreCommit, compatibility.core_runtime.core_commit, "Fixture requires the exact Desktop Core pin");
const resumed = arg("--resume");
const root = resumed ? fs.realpathSync(resumed) : fs.mkdtempSync(path.join(os.homedir(), "edupi-desktop-p0p2-canary-"));
assert.equal(path.dirname(root), os.homedir());
assert.equal(path.basename(root).startsWith("edupi-desktop-p0p2-canary-"), true);
const dataRoot = path.join(root, "teacher-data");
const memoryDir = path.join(dataRoot, ".edupi", "memory");
const outputDir = path.join(dataRoot, ".edupi", "output");
const lockDir = path.join(dataRoot, ".edupi", "locks");
const agentDir = path.join(root, "pi-agent");
const stateDir = path.join(root, "desktop-state");
for (const directory of [memoryDir, outputDir, lockDir, agentDir, stateDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const writeJSON = (filename, value) => fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { shanghaiDate } = await jiti.import("../lib/edupi-foreground.ts");
const { addCalendarDays } = await jiti.import("../lib/edupi-calendar-model.ts");
const today = shanghaiDate();
const port = Number(arg("--port") || 30373);
assert.equal(Number.isInteger(port) && port >= 1024 && port <= 65535, true);
async function listen(server, listenPort) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(listenPort, "127.0.0.1", resolve); });
  return server.address().port;
}
const probe = net.createServer();
await listen(probe, port);
await new Promise(resolve => probe.close(resolve));

let modelCalls = 0;
const model = http.createServer(async (request, response) => {
  if (request.url === "/v1/models") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ data: [{ id: "local", object: "model", owned_by: "fixture" }] })); return; }
  if (request.url !== "/v1/chat/completions") { response.writeHead(404); response.end(); return; }
  let body = "";
  for await (const chunk of request) { body += chunk; if (body.length > 1_000_000) { response.writeHead(413); response.end(); return; } }
  let input;
  try { input = JSON.parse(body); } catch { response.writeHead(400); response.end(); return; }
  modelCalls += 1;
  const messages = input.messages || [];
  const userIndex = messages.findLastIndex(item => item.role === "user");
  const last = messages[userIndex];
  const content = typeof last?.content === "string" ? last.content
    : Array.isArray(last?.content) ? last.content.filter(item => item.type === "text").map(item => item.text).join("\n") : "合成验收请求";
  const toolCompleted = messages.slice(userIndex + 1).some(item => item.role === "tool");
  const calendarCall = content.includes("fixture-calendar-write") && !toolCompleted
    && input.tools?.some(item => item.function?.name === "calendar_import")
      ? { id: `fixture-calendar-${modelCalls}`, type: "function", function: { name: "calendar_import", arguments: JSON.stringify({ events:
        ["2026-10-08", "2026-10-09", "2026-10-10"].map(date => ({ date, name: "合成页面日程", type: "meeting", confidence: "teacher_confirmed" })) }) } }
      : null;
  const sourceStudent = /fixture-student-source:([A-Za-z0-9._-]{1,160})/u.exec(content)?.[1];
  const fixtureCall = calendarCall ?? (sourceStudent && !toolCompleted
    && input.tools?.some(item => item.function?.name === "edupi_student_records")
      ? { id: `fixture-source-${modelCalls}`, type: "function", function: { name: "edupi_student_records", arguments: JSON.stringify({ action: "record", records: [
        { kind: "learning", student_ids: [sourceStudent], summary: "合成原始对话验收：移项时先核对符号", topic: "移项", observed_on: today },
      ] }) } } : null);
  const message = `合成验收回复 ${modelCalls}：已收到 ${content.slice(0, 120)}。`;
  const id = `fixture-chat-${modelCalls}`;
  if (!input.stream) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ id, object: "chat.completion", model: "local", choices: [{ index: 0, message: { role: "assistant", content: fixtureCall ? null : message, ...(fixtureCall ? { tool_calls: [fixtureCall] } : {}) }, finish_reason: fixtureCall ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })); return; }
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  if (fixtureCall) {
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, ...fixtureCall }] }, finish_reason: null }] })}\n\n`);
    response.end(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
    return;
  }
  const chunks = message.match(/.{1,10}/gu) || [message];
  let index = 0;
  const timer = setInterval(() => {
    if (index < chunks.length) {
      response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local", choices: [{ index: 0, delta: index === 0 ? { role: "assistant", content: chunks[index++] } : { content: chunks[index++] }, finish_reason: null }] })}\n\n`);
    } else { clearInterval(timer); response.end(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`); }
  }, /fixture-long-running/.test(content) ? 500 : 75);
  response.on("close", () => clearInterval(timer));
});
const previousMetadata = resumed ? JSON.parse(fs.readFileSync(path.join(root, "fixture.json"), "utf8")) : null;
const modelPort = await listen(model, previousMetadata?.modelPort || 0);
const environment = {
  PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "Asia/Shanghai",
  NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", PI_OFFLINE: "1",
  PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_STATE_DIR: stateDir,
  EDUPI_DESKTOP_ISOLATED_CANARY: "1", EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: root, EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_HOME: path.join(dataRoot, ".edupi"), EDUPI_MEMORY_DIR: memoryDir, EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: lockDir,
  EDUPI_REGISTRATION_FILE: path.join(agentDir, "edupi-registration.json"),
  EDUPI_INVITE_CODE_SHA256: createHash("sha256").update("synthetic-fixture-only").digest("hex"),
};
Object.assign(process.env, environment);
writeJSON(path.join(agentDir, "models.json"), { providers: { local: { api: "openai-completions", apiKey: "synthetic-local-placeholder", baseUrl: `http://127.0.0.1:${modelPort}/v1`, models: [{ id: "local", name: "隔离验收模型", input: ["text"], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }] } } });
if (!resumed) writeJSON(path.join(agentDir, "settings.json"), { defaultProvider: "local", defaultModel: "local", extensions: [], packages: [], skills: [] });
const jsonRequest = (url, method, value) => new Request(url, { method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(value) });
const { closeAllEduPiRuntimes } = await jiti.import("../lib/edupi-runtime-supervisor.ts");
if (!resumed) {
  writeJSON(path.join(memoryDir, "calendar.json"), { events: [
    { id: "old-festival", name: "合成旧节日", type: "festival", date: addCalendarDays(today, -15), end_date: addCalendarDays(today, -10), source: "teacher", confidence: "teacher_confirmed" },
    { id: "current-week", name: "第1周 · 合成验收周", type: "teaching", date: addCalendarDays(today, -2), end_date: addCalendarDays(today, 4), source: "teacher", confidence: "teacher_confirmed" },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `upcoming-${index}`, name: `合成近期日程 ${String(index + 1).padStart(2, "0")}`, type: "meeting", date: addCalendarDays(today, index + 1), source: "teacher", confidence: "teacher_confirmed" })),
  ] });
  writeJSON(path.join(memoryDir, "timetable.json"), { slots: [1, 2, 3, 4, 5].map(day => ({ id: `fixture-slot-${day}`, day_of_week: day, period: 2, subject: "数学", class_name: "703", kind: "class" })) });
  writeJSON(path.join(memoryDir, "preferences.json"), { entries: [] });
  writeJSON(path.join(memoryDir, "semester.json"), { start_date: addCalendarDays(today, -30), end_date: addCalendarDays(today, 90), entries: [] });
  writeJSON(path.join(memoryDir, "parent_profiles.json"), { "synthetic-contact": { student: "验收学生乙", name: "合成联系人", relationship: "教师记录称谓", concerns: ["合成学习情况"], communication_style: [], history: [{ date: new Date().toISOString(), topic: "合成学习沟通", outcome: "仅用于验收，监护身份未核实" }] } });
  const old = addCalendarDays(today, -10);
  for (const date of [old, today]) {
    const directory = path.join(outputDir, "daily"); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${date}.md`), `---\ntitle: 合成简报 ${date}\ndate: ${date}\n---\n# 合成简报 ${date}\n\n${date === today ? "今日合成简报正文" : "旧简报正文不得冒充今日"}\n`, { mode: 0o600 });
  }
  writeJSON(path.join(outputDir, "rhythm_plan.json"), { tasks: [{ id: "fixture-old-festival", title: "合成旧节日准备", trigger: "festival", source_event_id: "old-festival", source_event_name: "合成旧节日", source_event_date: addCalendarDays(today, -15), due_date: addCalendarDays(today, -16), status: "planned", content_status: "not_generated", deliverables: ["合成节日记录"], scope: "teacher_internal", requires_teacher_review: true, external_send: false, evidence: {} }] });
  const { prepareCoreRuntimeRoot } = await import(path.join(coreRoot, "scripts", "core_runtime_root.mjs"));
  assert.equal(prepareCoreRuntimeRoot(dataRoot).ok, true);
  const { registerEduPi } = await jiti.import("../lib/edupi-registration.ts");
  registerEduPi("synthetic-fixture-only");
  const onboarding = await jiti.import("../app/api/edupi/onboarding/route.ts");
  const identity = await onboarding.POST(jsonRequest("http://localhost/api/edupi/onboarding", "POST", { name: "合成验收老师", subject: "数学", grade: "七年级", class_name: "703", role: "subject_teacher" }));
  assert.equal(identity.status, 200, JSON.stringify(await identity.clone().json()));
  const { importStudentRoster } = await jiti.import("../lib/edupi-student-roster-server.ts");
  await importStudentRoster({ students: [
    { name: "验收学生甲", className: "703", traits: [], parentNotes: [] },
    { name: "验收学生乙", className: "703", traits: [], parentNotes: ["合成教师记录，不表示监护身份已核实"] },
    { name: "验收学生甲", className: "704", traits: [], parentNotes: [] },
  ], sourceName: "p0p2-synthetic-fixture" });
  const { GET: getWorkspace } = await jiti.import("../app/api/edupi/workspace/route.ts");
  const initial = await (await getWorkspace()).json();
  const student = (name, className) => initial.data.students.find(row => row.name === name && row.class_name === className).student_id;
  const ids = [student("验收学生甲", "703"), student("验收学生乙", "703")];
  const { createStudentEventTool } = await jiti.import("../lib/edupi-student-event-tool.ts");
  const tool = createStudentEventTool(dataRoot);
  for (let batch = 0; batch < 2; batch += 1) {
    const records = Array.from({ length: 13 }, (_, index) => ({ kind: index % 2 ? "interaction" : "learning", student_ids: index % 2 ? ids : [ids[0]], summary: `合成验收观察 ${batch * 13 + index + 1}：${index % 2 ? "学生乙帮助学生甲讲解移项" : "学生甲在移项练习中核对符号"}`, topic: "移项", observed_on: addCalendarDays(today, -index) }));
    await tool.execute(`fixture-events-${batch}`, { action: "record", records }, undefined, undefined, { cwd: dataRoot, sessionManager: { getSessionId: () => "synthetic-fixture-source-session", getBranch: () => [{ type: "message", id: `synthetic-fixture-source-message-${batch}`, message: { role: "user", content: records.map(row => row.summary).join("。") } }] } });
  }
  const { POST: createTask } = await jiti.import("../app/api/edupi/tasks/route.ts");
  const { PATCH: moveTask } = await jiti.import("../app/api/edupi/tasks/[taskId]/route.ts");
  for (let index = 0; index < 35; index += 1) {
    const suffix = String(index + 1).padStart(12, "0");
    const group = index < 12 ? "近期备课" : index < 24 ? "已完成备课" : index < 32 ? "过期备课" : "无日期备课";
    const dueDate = index < 24 ? addCalendarDays(today, index % 3) : index < 32 ? addCalendarDays(today, -10 - index % 5) : null;
    const response = await createTask(jsonRequest("http://localhost/api/edupi/tasks", "POST", { clientRequestId: `10000000-0000-4000-8000-${suffix}`, title: `合成${group} ${String(index + 1).padStart(2, "0")}`, dueDate, note: "合成验收数据" }));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    if (index >= 12 && index < 24) {
      const moved = await moveTask(jsonRequest("http://localhost/api/edupi/tasks/fixture", "PATCH", { stage: "done", expectedRevision: 0, note: "合成教师记录完成" }), { params: Promise.resolve({ taskId: result.taskId }) });
      assert.equal(moved.status, 200, JSON.stringify(await moved.clone().json()));
    }
  }
  await closeAllEduPiRuntimes();
}
const log = fs.openSync(path.join(root, "next.log"), "a", 0o600);
let next, builder, stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  builder?.kill("SIGTERM"); next?.kill("SIGTERM");
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); await closeAllEduPiRuntimes();
  console.log(JSON.stringify({ status: "stopped", root, preserved: true })); process.exit(0);
}
process.on("SIGINT", () => void stop()); process.on("SIGTERM", () => void stop());
const nextBinary = path.join(worktree, "node_modules", "next", "dist", "bin", "next");
if (production) {
  environment.NODE_ENV = "production";
  environment.PI_WEB_DESKTOP_BUILD = "1";
  console.log(JSON.stringify({ status: "production-source-build", root, installedApp: false }));
  builder = spawn(process.execPath, [nextBinary, "build", "--webpack"], { cwd: worktree, env: environment, stdio: ["ignore", log, log] });
  const code = await new Promise((resolve, reject) => { builder.once("error", reject); builder.once("exit", resolve); });
  builder = null;
  if (code !== 0) { console.error(JSON.stringify({ status: "build-failed", code, root })); await stop(); }
}
next = spawn(process.execPath, [nextBinary, production ? "start" : "dev", ...(production ? [] : ["--webpack"]), "-H", "127.0.0.1", "-p", String(port)], { cwd: worktree, env: environment, stdio: ["ignore", log, log] });
fs.closeSync(log);
const supplemental = fs.existsSync(path.join(root, "p0p2-resources.json")) ? JSON.parse(fs.readFileSync(path.join(root, "p0p2-resources.json"), "utf8")) : null;
const metadata = { root, dataRoot, agentDir, stateDir, url: `http://127.0.0.1:${port}`, port, modelPort, coreRoot, coreCommit, runnerPid: process.pid, nextPid: next.pid, today, synthetic: true, mode: production ? "production_source" : "development", students: 3, studentEvents: supplemental?.studentEvents ?? 26, taskCount: 36, resume: `node scripts/run-edupi-p0p2-fixture.mjs --core ${coreRoot} --resume ${root} --port ${port}${production ? " --production" : ""}` };
writeJSON(path.join(root, "fixture.json"), metadata);
next.on("exit", code => { if (!stopping) { console.error(JSON.stringify({ status: "next-exited", code, root })); void stop(); } });
for (let attempt = 0; attempt < 100; attempt += 1) {
  try { const response = await fetch(`${metadata.url}/api/home`); if (response.ok) { console.log(JSON.stringify({ status: "ready", ...metadata })); break; } } catch { /* Cold compilation. */ }
  await new Promise(resolve => setTimeout(resolve, 300));
  if (attempt === 99) throw new Error(`Fixture dev server did not start; inspect ${path.join(root, "next.log")}`);
}
