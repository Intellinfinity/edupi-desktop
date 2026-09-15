import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = () => readFile(new URL("./EduPiCoreCompatibility.tsx", import.meta.url), "utf8");

test("Core compatibility surface exposes every pinned command and its Desktop entry point", async () => {
  const source = await read();
  for (const command of [
    "review_observation",
    "review_memory_candidate",
    "review_teacher_context",
    "review_work_candidate",
    "review_task",
    "import_calendar",
    "import_timetable",
    "intake_material",
    "create_task",
    "move_task_stage",
    "update_memory",
  ]) {
    assert.match(source, new RegExp(command));
  }
  for (const view of ["review", "dashboard", "tasks", "calendar", "materials", "workspace", "memory"]) {
    assert.match(source, new RegExp(`onNavigate\\(\\"${view}\\"`));
  }
  assert.match(source, /Core 兼容性/);
  assert.match(source, /未接入能力/);
  assert.match(source, /identityMatches/);
  assert.match(source, /sameList/);
  assert.match(source, /runtimeConnected/);
  assert.match(source, /版本不匹配/);
  assert.doesNotMatch(source, /<details open>/);
});

test("Core compatibility surface makes unsupported capabilities visible", async () => {
  const source = await read();
  assert.match(source, /unsupportedCommandReasons/);
  assert.match(source, /unsupportedProjectionReasons/);
  assert.match(source, /未启用/);
  assert.match(source, /待连接/);
  assert.match(source, /title=\{actual\?\.coreCommit/);
});
