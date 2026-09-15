import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("growth uses confirmed teacher work and the real teaching skill lifecycle", async () => {
  const [panel, views, growth, sider] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiWorkspaceViews.tsx"),
    read("./EduPiGrowthWorkspace.tsx"),
    read("./EduPiObjectSider.tsx"),
  ]);
  assert.match(panel, /readEduPiTeachingSkills/);
  assert.match(panel, /setTeachingSkills/);
  assert.match(views, /teachingSkills=\{props\.teachingSkills\}/);
  assert.match(growth, /teachingSkills\.skills/);
  assert.match(growth, /教学方法从试用到后续备课复用的记录/);
  assert.match(growth, /teacherGrowth/);
  assert.match(sider, /teachingSkills\.teacherGrowth\.length/);
  assert.match(growth, /item\.kind === "weekly"/);
  assert.match(growth, /confirmedTaskArtifacts/);
  assert.doesNotMatch(growth, /data\.continuity\.themes/);
  assert.match(sider, /teachingSkills\.skills\.length/);
});
