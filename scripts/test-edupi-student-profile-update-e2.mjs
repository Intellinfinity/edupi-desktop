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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-student-profile-update-e2-"));
const memoryDir = path.join(temp, ".edupi", "memory");
const outputDir = path.join(temp, ".edupi", "output");
const lockDir = path.join(temp, ".edupi", "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true });

fs.writeFileSync(path.join(memoryDir, "student_profiles.json"), `${JSON.stringify({ students: { 李四: { name: "李四", traits: ["旧特征"], parent_notes: ["旧备注"], error_patterns: [{ description: "移项", status: "active" }], trajectory: [{ date: "2026-08-20", event: "进步" }], created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-09-01T07:00:00.000Z" } }, updated_at: "2026-09-01T07:00:00.000Z" }, null, 2)}\n`);

Object.assign(process.env, {
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_DATA_ROOT: temp,
  EDUPI_DATA_ALLOWED_ROOT: path.dirname(temp),
  EDUPI_PROJECT_ROOT: temp,
  EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir,
  EDUPI_LOCK_DIR: lockDir,
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { PUT } = await jiti.import("../app/api/edupi/students/[name]/route.ts");
const { GET } = await jiti.import("../app/api/edupi/education/route.ts");

function request(body) {
  return new Request("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B", { method: "PUT", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
}

try {
  const initialResponse = await GET();
  const initial = await initialResponse.json();
  assert.equal(initialResponse.status, 200, JSON.stringify(initial));
  const before = initial.students.find((student) => student.name === "李四");
  assert.equal(before.updated_at, "2026-09-01T07:00:00.000Z");

  const response = await PUT(request({ studentId: before.student_id, traits: ["耐心", "主动提问"], parentNotes: [], expectedUpdatedAt: before.updated_at, expectedRevision: before.profile_revision }), { params: Promise.resolve({ name: "李四" }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  const updated = result.data.students.find((student) => student.name === "李四");
  assert.deepEqual(updated.traits, ["耐心", "主动提问"]);
  assert.deepEqual(updated.parent_notes, []);
  assert.equal(updated.error_patterns.length, 1);
  assert.deepEqual({ description: updated.error_patterns[0].description, status: updated.error_patterns[0].status }, { description: "移项", status: "active" });
  assert.equal(updated.trajectory.length, 1);
  assert.deepEqual({ date: updated.trajectory[0].date, event: updated.trajectory[0].event }, { date: "2026-08-20", event: "进步" });

  const staleResponse = await PUT(request({ studentId: before.student_id, traits: [], parentNotes: [], expectedUpdatedAt: before.updated_at, expectedRevision: before.profile_revision }), { params: Promise.resolve({ name: "李四" }) });
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).code, "stale_student");

  const finalResponse = await GET();
  const final = await finalResponse.json();
  assert.deepEqual(final.students.find((student) => student.name === "李四").traits, ["耐心", "主动提问"]);
  console.log(JSON.stringify({ status: "passed", student: "李四", replacement: true, stale_rejected: true, preserved_system_records: true }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
