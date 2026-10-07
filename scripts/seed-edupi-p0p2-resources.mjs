#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes("--root") && process.argv.includes("--core"), "--root and --core are required");
const root = fs.realpathSync(arg("--root"));
const coreRoot = fs.realpathSync(arg("--core"));
const metadata = JSON.parse(fs.readFileSync(path.join(root, "fixture.json"), "utf8"));
const coreCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: coreRoot, encoding: "utf8" }).trim();
assert.ok(path.basename(root).startsWith("edupi-desktop-p0p2-canary-"), "Only the named synthetic canary is supported");
assert.equal(metadata.synthetic, true);
assert.equal(metadata.root, root);
assert.equal(metadata.coreRoot, coreRoot);
assert.equal(metadata.coreCommit, coreCommit);
assert.equal(coreCommit, "a84590cbd62ada4f75fa10e109f0cdc07a13368e", "The Core pin must remain unchanged");
const dataRoot = path.join(root, "teacher-data");
const agentDir = path.join(root, "pi-agent");
const stateDir = path.join(root, "desktop-state");
assert.equal(metadata.dataRoot, dataRoot);
assert.equal(metadata.agentDir, agentDir);
assert.equal(metadata.stateDir, stateDir);
for (const directory of [root, dataRoot, agentDir, stateDir]) {
  assert.equal(fs.realpathSync(directory), directory, "Canary paths cannot redirect to another workspace");
}

async function assertNoListener(port) {
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); reject(new Error(`Stop the canary listener on ${port} before seeding`)); });
    socket.once("error", (error) => error.code === "ECONNREFUSED" ? resolve() : reject(error));
    socket.once("timeout", () => { socket.destroy(); reject(new Error(`Listener state on ${port} is inconclusive`)); });
  });
}
await assertNoListener(metadata.port);
await assertNoListener(metadata.modelPort);

Object.assign(process.env, {
  NODE_ENV: "development", PI_OFFLINE: "1", PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_STATE_DIR: stateDir,
  EDUPI_DESKTOP_ISOLATED_CANARY: "1", EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: root, EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_HOME: path.join(dataRoot, ".edupi"), EDUPI_MEMORY_DIR: path.join(dataRoot, ".edupi", "memory"),
  EDUPI_OUTPUT_DIR: path.join(dataRoot, ".edupi", "output"), EDUPI_LOCK_DIR: path.join(dataRoot, ".edupi", "locks"),
  EDUPI_REGISTRATION_FILE: path.join(agentDir, "edupi-registration.json"),
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { resolveEduPiBridgeRoots, readEduPiEducationSnapshot } = await jiti.import("../lib/edupi-core-snapshot.ts");
const { buildEducationContractFromWorkspace } = await jiti.import("../lib/edupi-education-contract.ts");
const { createStudentEventTool } = await jiti.import("../lib/edupi-student-event-tool.ts");
const { studentEventRequest } = await jiti.import("../lib/edupi-student-events.ts");
const { createMemoryWriteTool } = await jiti.import("../lib/edupi-memory-write-tool.ts");
const { stageMaterialInputs } = await jiti.import("../lib/edupi-material-staging.ts");
const { intakeRecognizedMaterial } = await jiti.import("../lib/edupi-material-intake-flow.ts");
const { issueEducationIntake } = await jiti.import("../lib/edupi-education-intake.ts");
const { workspaceResourcesRequest } = await jiti.import("../lib/edupi-generated-artifacts.ts");
const { closeAllEduPiRuntimes } = await jiti.import("../lib/edupi-runtime-supervisor.ts");
const roots = resolveEduPiBridgeRoots();
const snapshot = () => readEduPiEducationSnapshot({ roots });
const contract = async () => {
  const value = await snapshot();
  return buildEducationContractFromWorkspace(value.workspace, { workspacePath: dataRoot, snapshotPayload: value.payload });
};
const context = (sessionId, messageId, text) => ({ cwd: dataRoot, sessionManager: {
  getSessionId: () => sessionId,
  getBranch: () => [{ type: "message", id: messageId, message: { role: "user", content: text } }],
} });

function fixturePdf() {
  const stream = "BT /F1 14 Tf 72 770 Td (Synthetic mathematics fixture) Tj 0 -28 Td (Exercise: x + 3 = 7. Answer: x = 4.) Tj 0 -28 Td (For isolated resource-reference verification.) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const summary = { synthetic: true, root, dataRoot, coreCommit, learning: null, material: null, memory: null, skill: null };
try {
  const initial = await contract();
  assert.equal(initial.students.length, 3);
  const student = initial.students.find(item => item.name === "验收学生甲" && item.class_name === "703");
  assert.ok(student && typeof student.student_id === "string", "The synthetic 703 student must have a Core identity");
  const records = Array.from({ length: 8 }, (_, index) => ({ kind: "learning", student_ids: [student.student_id],
    summary: `合成分页验收记录 ${index + 1}：移项练习观察`, topic: "移项", observed_on: metadata.today }));
  const events = await createStudentEventTool(dataRoot).execute("p2-pagination", { action: "record", records }, undefined, undefined,
    context("synthetic-p2-pagination-source-session", "synthetic-p2-pagination-source-message", `${metadata.today}的合成分页验收资料，仅用于隔离验证。${records.map(item => item.summary).join("。")} `));
  assert.equal(events.details.record_ids.length, 8);
  const learning = await studentEventRequest({ action: "list_events", student_id: student.student_id, kind: "learning" });
  assert.equal(learning.total, 22, "The loaded-page workflow needs exactly 22 synthetic learning records");
  assert.equal(learning.records.length, 20);
  assert.equal(learning.records.filter(item => item.summary.startsWith("合成分页验收记录 ")).length, 8);
  summary.learning = { studentId: student.student_id, total: learning.total, firstPage: learning.records.length, replayed: events.details.replayed === true };

  const materialTitle = "合成验收数学材料";
  const pdfBytes = fixturePdf();
  let material = (await workspaceResourcesRequest()).teacherMaterials?.find(item => item.title === materialTitle);
  let receipts = [];
  if (!material) {
    const descriptor = stageMaterialInputs([{ name: "synthetic-p0p2-math.pdf", mimeType: "application/pdf", bytes: new Uint8Array(pdfBytes) }])[0];
    const imported = await intakeRecognizedMaterial({ descriptor, title: materialTitle, materialKind: "assessment", subject: "数学", classId: "703", recognize: false }, {
      issue: command => issueEducationIntake(command, { readSnapshot: async () => ({ payload: (await snapshot()).payload, roots }) }),
    });
    assert.equal(imported.receipts[0].status, "accepted");
    receipts = imported.receipts.map(item => ({ id: item.receipt_id, status: item.status, appliedIds: item.applied_ids }));
    material = (await workspaceResourcesRequest()).teacherMaterials?.find(item => item.material_id === `material-${descriptor.staging_id.slice(4)}`);
  }
  assert.ok(material && material.available === true, "Core must read back the physical material");
  assert.equal(material.title, materialTitle);
  assert.equal(material.subject, "数学");
  assert.equal(material.class_id, "703");
  assert.equal(material.external_send, false);
  const materialFile = path.resolve(dataRoot, material.relative_path);
  assert.ok(materialFile.startsWith(`${dataRoot}${path.sep}`));
  assert.equal(fs.realpathSync(materialFile), materialFile);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(materialFile)).digest("hex"), crypto.createHash("sha256").update(pdfBytes).digest("hex"));
  summary.material = { id: material.material_id, title: material.title, file: materialFile, available: material.available, receipts };

  const content = "合成验收知识：解方程后用代入法核对结果。";
  try {
    let memory = (await contract()).continuity.memories.find(item => item.category === "teaching" && item.content === content && item.state === "active");
    if (!memory) {
      const stored = await createMemoryWriteTool(dataRoot).execute("synthetic-p0p2-knowledge", { category: "teaching", content, tags: ["synthetic"] }, undefined, undefined,
        context("synthetic-p0p2-knowledge-session", "synthetic-p0p2-knowledge-message", content));
      assert.equal(stored.details.ok, true);
      memory = (await contract()).continuity.memories.find(item => item.id === stored.details.id && item.content === content && item.state === "active");
    }
    assert.ok(memory, "The official memory write must be visible in the active projection");
    summary.memory = { state: "active", id: memory.id, category: memory.category, content: memory.content };
  } catch (error) {
    summary.memory = { state: "unverified", error: error instanceof Error ? error.message : String(error) };
  }

  const skillDir = path.join(agentDir, "skills", "synthetic-fixture");
  const skillFile = path.join(skillDir, "SKILL.md");
  const skillText = "---\nname: synthetic-fixture\ndescription: 隔离资源引用验收\n---\n\n# 合成引用\n\n读取传入的合成标记，并在回复中原样引用。\n";
  fs.mkdirSync(skillDir, { recursive: true, mode: 0o700 });
  assert.equal(fs.realpathSync(skillDir), skillDir);
  if (fs.existsSync(skillFile)) assert.equal(fs.readFileSync(skillFile, "utf8"), skillText, "Keep any unrelated skill content intact");
  else fs.writeFileSync(skillFile, skillText, { mode: 0o600, flag: "wx" });
  const settingsFile = path.join(agentDir, "settings.json");
  assert.equal(fs.realpathSync(settingsFile), settingsFile);
  const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  assert.ok(settings.skills === undefined || Array.isArray(settings.skills));
  settings.skills = [...new Set([...(settings.skills || []), skillDir])];
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  assert.equal(fs.readFileSync(skillFile, "utf8"), skillText);
  summary.skill = { name: "synthetic-fixture", file: skillFile, allowedPath: skillDir };
  const all = await studentEventRequest({ action: "list_events", student_id: student.student_id });
  summary.studentEvents = all.total;
  const evidenceFile = path.join(root, "p0p2-resources.json");
  fs.writeFileSync(evidenceFile, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...summary, evidenceFile }));
} finally {
  await closeAllEduPiRuntimes();
}
