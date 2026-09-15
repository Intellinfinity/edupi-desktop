import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("EduPi content rows use disclosures inside category databases and drawers", async () => {
  const views = await read("./EduPiWorkspaceViews.tsx");
  const sider = await read("./EduPiObjectSider.tsx");
  const student = await read("./EduPiStudentWorkspace.tsx");
  const teaching = await read("./EduPiTeachingWorkspace.tsx");
  const memory = await read("./EduPiMemoryDatabase.tsx");
  const insights = await read("./EduPiInsightDatabase.tsx");
  const growth = await read("./EduPiGrowthWorkspace.tsx");
  const navigation = await read("../lib/edupi-domain-navigation.ts");
  const css = await read("../app/edupi-workbench.css");
  for (const source of [teaching, memory, insights, growth]) assert.match(source, /<details[\s\S]*?<summary(?:\s|>)/);
  assert.match(sider, /<button type="button" className=\{`edupi-object-row edupi-object-student/);
  assert.match(sider, /edupi-object-fact is-interactive/);
  assert.match(views, /EduPiMemoryDatabase/);
  assert.match(student, /edupi-student-drawer/);
  assert.doesNotMatch(sider, /edupi-object-person/);
  assert.match(css, /\.edupi-database-row > summary/);
  assert.match(css, /\.edupi-student-drawer/);
  assert.match(student, /trajectory\.slice\(\)\.reverse\(\)/);
  assert.doesNotMatch(views, /JSON\.stringify\(item\)/);
  assert.doesNotMatch(views, /evidenceIds\.join/);
  assert.doesNotMatch(sider, /String\(pattern\.(?:status|last_seen)\)|String\(student\.updated_at\)/);
  assert.match(growth, /METHOD_STATE_LABELS/);
  assert.match(growth, /teachingSkills\.skills/);
  assert.match(navigation, /待验证/);
  assert.doesNotMatch(growth, /审核状态：\{item\.reviewState\}/);
});
