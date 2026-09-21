import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildEducationContract } = await createJiti(import.meta.url).import("./edupi-education-contract.ts");
const commands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];

test("projects the manual memory revision and enables direct editing only for the exact Core capability", () => {
  const data = buildEducationContract({
    memoryStores: { preferences: { entries: [{ id: "pref-1", content: "称呼我为吴老师", tags: ["称呼"], revision: 2 }] } },
    snapshotPayload: { capabilities: { supported_commands: commands } },
    supportedCommands: commands,
  });
  assert.equal(data.continuity.memories[0].revision, 2);
  assert.equal(data.capabilities.memoryUpdate.enabled, true);
  assert.deepEqual(data.capabilities.memoryUpdate.commands, ["update_memory"]);

  const stale = buildEducationContract({ memoryStores: { preferences: { entries: [{ id: "pref-1", content: "称呼我为吴老师" }] } }, snapshotPayload: { capabilities: { supported_commands: commands.slice(0, -1) } }, supportedCommands: commands });
  assert.equal(stale.capabilities.memoryUpdate.enabled, false);
});
