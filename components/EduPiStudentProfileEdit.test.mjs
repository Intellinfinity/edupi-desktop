import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("student drawer docks on wide screens and becomes an overlay on narrow screens", async () => {
  const [student, css] = await Promise.all([read("./EduPiStudentWorkspace.tsx"), read("../app/edupi-workbench.css")]);
  assert.match(student, /has-student-drawer/);
  assert.match(css, /\.edupi-class-workspace\.has-student-drawer\s*\{[^}]*padding-right:\s*calc\(clamp\(400px, 34vw, 560px\) \+ 36px\)/s);
  assert.match(css, /\.edupi-student-drawer\s*\{[^}]*position:\s*absolute;[^}]*width:\s*clamp\(400px, 34vw, 560px\)/s);
  assert.match(css, /@media \(max-width: 1240px\)[\s\S]*\.edupi-class-workspace\.has-student-drawer\s*\{[^}]*padding-right:\s*28px/s);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.edupi-student-drawer\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*300;[^}]*width:\s*100%/s);
});

test("student profiles expose real manual replacement and global AI collaboration", async () => {
  const student = await read("./EduPiStudentWorkspace.tsx");
  assert.match(student, /icon="edit" label="手动修改"/);
  assert.match(student, /icon="agent" label="AI 协作"/);
  assert.match(student, /buildStudentProfileConversationPrompt/);
  assert.match(student, /onStartAgent\(prompt, "replace"\)/);
  assert.match(student, /method: "PUT"/);
  assert.match(student, /expectedUpdatedAt/);
  assert.match(student, /expectedRevision/);
  assert.match(student, /parseStudentProfileList/);
  assert.match(student, /保存修改/);
  assert.doesNotMatch(student, /补充学生档案/);
});

test("student profile history explains and performs full snapshot restore", async () => {
  const [student, css] = await Promise.all([read("./EduPiStudentWorkspace.tsx"), read("../app/edupi-workbench.css")]);
  assert.match(student, /档案历史/);
  assert.match(student, /恢复会同时替换班级、学生特征和家校备注/);
  assert.match(student, /side === "before" \? "修改前" : "修改后"/);
  assert.match(student, /`恢复\$\{sideLabel\}`/);
  assert.match(student, /profile_history_count/);
  assert.match(student, /profile_revision/);
  assert.match(student, /\/versions/);
  assert.match(student, /method: "POST"/);
  assert.match(css, /\.edupi-student-profile-history__sides/);
});
