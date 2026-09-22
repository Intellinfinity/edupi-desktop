import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const coreRoot = process.env.EDUPI_CORE_ROOT;
const dataRoot = process.env.EDUPI_DATA_ROOT;
const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

test("projects only validated Core health and education snapshot", { skip: !coreRoot || !dataRoot }, async () => {
  const response = await GET(new Request("http://localhost/api/edupi/status"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.scope, "teacher_internal");
  assert.equal(body.externalSend, false);
  assert.equal(typeof body.proactivity.ambientPlanning, "boolean");
  assert.equal(typeof body.proactivity.attentionDelivery, "boolean");
  assert.equal(typeof body.proactivity.teacherFeedback, "boolean");
  assert.equal(body.core.status, "ready");
  assert.equal(body.core.contractVersion, "1.1");
  assert.deepEqual(body.core.supportedCommands, ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"]);
  assert.deepEqual(body.core.supportedProjections, ["education_workspace"]);
  assert.equal(body.compatibility.expected.coreCommit, body.compatibility.actual.coreCommit);
  assert.equal(body.compatibility.expected.componentManifestHash, body.compatibility.actual.componentManifestHash);
  assert.deepEqual(body.compatibility.expected.supportedCommands, body.core.supportedCommands);
  assert.deepEqual(body.compatibility.actual.supportedProjections, body.core.supportedProjections);
  assert.equal(body.projection.status, "ready");
  assert.equal(body.proactivity.externalSend, false);
  assert.equal(body.kernel.status, "ready");
  assert.equal(body.kernel.projection_kind, "proactive_work_kernel");
  for (const key of ["students", "timetable", "calendar", "tasks"]) assert.ok(Number.isInteger(body.projection.counts[key]) && body.projection.counts[key] >= 0);
  assert.equal("preferences" in body, false);
  assert.equal("students" in body, false);
  assert.equal("calendar" in body, false);
});

test("summary mode omits kernel history while preserving the run summary", { skip: !coreRoot || !dataRoot }, async () => {
  const response = await GET(new Request("http://localhost/api/edupi/status?summary=1"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.kernel.status, "ready");
  assert.deepEqual(body.kernel.runs, []);
  assert.ok(Number.isInteger(body.kernel.summary.total));
  assert.equal(body.projection.status, "ready");
});

test("fails visibly without a local JSON fallback", async () => {
  const previous = process.env.EDUPI_CORE_ROOT;
  process.env.EDUPI_CORE_ROOT = "/definitely/missing/edupi-core";
  try {
  const response = await GET(new Request("http://localhost/api/edupi/status"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.core.status, "unavailable");
    assert.match(body.core.reason, /Core/);
    assert.equal(body.projection.status, "unavailable");
    assert.equal(body.compatibility.actual, null);
    assert.equal(body.proactivity.status, "unavailable");
  } finally {
    if (previous === undefined) delete process.env.EDUPI_CORE_ROOT;
    else process.env.EDUPI_CORE_ROOT = previous;
  }
});

test("returns unavailable when the explicit data root is missing", async () => {
  const previous = process.env.EDUPI_DATA_ROOT;
  process.env.EDUPI_DATA_ROOT = "/definitely/missing/edupi-data";
  try {
    const response = await GET(new Request("http://localhost/api/edupi/status"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.core.status, "unavailable");
    assert.equal(body.projection.status, "unavailable");
  } finally {
    if (previous === undefined) delete process.env.EDUPI_DATA_ROOT;
    else process.env.EDUPI_DATA_ROOT = previous;
  }
});

test("route source contains no legacy education JSON reads", () => {
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /preferences\.json|student_profiles\.json|timetable\.json|calendar\.json|rhythm_plan\.json/);
  assert.doesNotMatch(source, /readFile|loadJson|memoryDir|outputDir/);
  assert.match(source, /readEduPiCoreHealth|readEduPiEducationSnapshot|readEduPiKernelProjection/);
  assert.match(source, /!runtime\s*\? \{ reason: runtimeReason \}/);
});
