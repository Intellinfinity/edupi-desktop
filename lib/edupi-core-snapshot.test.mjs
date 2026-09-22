import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readFile } from "node:fs/promises";

const jiti = createJiti(import.meta.url);
const { isEduPiAbsolutePath, readEduPiEducationSnapshot, resolveEduPiBridgeRoots } = await jiti.import("./edupi-core-snapshot.ts");
const coreRoot = process.env.EDUPI_CORE_ROOT;
const dataRoot = process.env.EDUPI_DATA_ROOT;

test("recognizes POSIX and Windows absolute roots without accepting relative paths", () => {
  assert.equal(isEduPiAbsolutePath("/Users/teacher/edupi"), true);
  assert.equal(isEduPiAbsolutePath("C:\\Users\\teacher\\edupi"), true);
  assert.equal(isEduPiAbsolutePath("\\\\server\\share\\edupi"), true);
  assert.equal(isEduPiAbsolutePath("edupi"), false);
  assert.equal(isEduPiAbsolutePath("./edupi"), false);
});

test("consumes the pinned Core education_workspace snapshot from the separate data root", { skip: !coreRoot || !dataRoot }, async () => {
  const result = await readEduPiEducationSnapshot({ requestId: "snapshot-consumer-test" });
  assert.equal(result.runtime.root, coreRoot && await import("node:fs").then(({ realpathSync }) => realpathSync(coreRoot)));
  assert.equal(result.dataRoot.root, dataRoot && await import("node:fs").then(({ realpathSync }) => realpathSync(dataRoot)));
  assert.equal(result.workspace.projection_kind, "education_workspace");
  assert.equal(result.workspace.projection_version, "1.1");
  assert.ok(result.workspace.students.length > 0);
  assert.ok(result.workspace.calendar.length > 0);
  assert.ok(result.workspace.tasks.length > 0);
  assert.deepEqual(result.payload.capabilities.supported_commands, ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"]);
  assert.deepEqual(result.payload.capabilities.supported_projections, ["education_workspace"]);
});

test("requires both explicit roots", () => {
  const previousCore = process.env.EDUPI_CORE_ROOT;
  const previousData = process.env.EDUPI_DATA_ROOT;
  delete process.env.EDUPI_CORE_ROOT;
  delete process.env.EDUPI_DATA_ROOT;
  try {
    assert.throws(() => resolveEduPiBridgeRoots(), /EDUPI_CORE_ROOT|absolute/i);
  } finally {
    if (previousCore === undefined) delete process.env.EDUPI_CORE_ROOT;
    else process.env.EDUPI_CORE_ROOT = previousCore;
    if (previousData === undefined) delete process.env.EDUPI_DATA_ROOT;
    else process.env.EDUPI_DATA_ROOT = previousData;
  }
});

test("health requires every platform projection operation", async () => {
  const source = await readFile(new URL("./edupi-core-snapshot.ts", import.meta.url), "utf8");
  assert.match(source, /CORE_OPERATIONS = \["health", "snapshot", "workspace-resources", "generated-artifacts", "command", "students", "teaching-priorities", "material-metadata", "education-facts", "delete", "kernel", "memory-scopes", "teaching-skills", "connectors", "agent-computer", "platform", "connector-setup"\]/);
  assert.match(source, /sameCapabilityList\(health\.supported_operations, CORE_OPERATIONS\)/);
});
