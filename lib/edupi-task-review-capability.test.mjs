import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildEducationContractFromWorkspace } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-education-contract.ts");
const workspace = { tasks: [], calendar: [], timetable: [], students: [], continuity: {}, source_summaries: [] };

test("enables native task review only when both pinned and snapshot capabilities contain review_task", () => {
  const commands = ["review_observation", "review_task"];
  const enabled = buildEducationContractFromWorkspace(workspace, { workspacePath: "/tmp/edupi", supportedCommands: commands, snapshotPayload: { capabilities: { supported_commands: commands } } });
  assert.equal(enabled.capabilities.taskReview.enabled, true);
  assert.equal(enabled.capabilities.taskReview.mode, "canonical_safe_store");

  const missingManifest = buildEducationContractFromWorkspace(workspace, { workspacePath: "/tmp/edupi", supportedCommands: ["review_observation"], snapshotPayload: { capabilities: { supported_commands: commands } } });
  assert.equal(missingManifest.capabilities.taskReview.enabled, false);
  const missingSnapshot = buildEducationContractFromWorkspace(workspace, { workspacePath: "/tmp/edupi", supportedCommands: commands, snapshotPayload: { capabilities: { supported_commands: ["review_observation"] } } });
  assert.equal(missingSnapshot.capabilities.taskReview.enabled, false);
});

test("projects Core intake commands as writable capabilities instead of stale read-only flags", () => {
  const commands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];
  const data = buildEducationContractFromWorkspace(workspace, {
    workspacePath: "/tmp/edupi",
    supportedCommands: commands,
    snapshotPayload: { capabilities: { supported_commands: commands } },
  });
  for (const capability of [data.capabilities.calendar, data.capabilities.timetable, data.capabilities.materialIntake]) {
    assert.equal(capability.enabled, true);
    assert.equal(capability.mode, "canonical_safe_store");
  }

  const stale = buildEducationContractFromWorkspace(workspace, {
    workspacePath: "/tmp/edupi",
    supportedCommands: commands,
    snapshotPayload: { capabilities: { supported_commands: commands.slice(0, -1) } },
  });
  assert.equal(stale.capabilities.calendar.enabled, false);
  assert.equal(stale.capabilities.timetable.enabled, false);
  assert.equal(stale.capabilities.materialIntake.enabled, false);
});
