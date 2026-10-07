import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildStudentProfileConversationPrompt } = await jiti.import("./edupi-student-profile-prompt.ts");

test("builds student-profile reference facts without prescribing teacher input", () => {
  const prompt = buildStudentProfileConversationPrompt({ name: "李四", traits: ["耐心"], parentNotes: ["本周已沟通"], patternCount: 2, trajectoryCount: 1 });
  assert.match(prompt, /李四/);
  assert.match(prompt, /耐心/);
  assert.match(prompt, /本周已沟通/);
  assert.match(prompt, /2 条学习问题 · 1 条成长记录/);
  assert.match(prompt, /^学生档案：李四/);
  assert.doesNotMatch(prompt, /如果这一栏留空|不要直接写入|在这里输入或口述/);
});

test("zero counters are omitted without declaring that the student has no records", () => {
  const prompt = buildStudentProfileConversationPrompt({ name: "合成学生甲", studentId: "synthetic-student-a", className: "测试班", traits: ["合成特征"], parentNotes: ["合成备注"], patternCount: 0, trajectoryCount: 0 });
  assert.match(prompt, /学生 ID：synthetic-student-a/);
  assert.match(prompt, /班级：测试班/);
  assert.match(prompt, /合成特征/);
  assert.match(prompt, /合成备注/);
  assert.doesNotMatch(prompt, /系统记录：|学习模式|成长节点|无学习记录|暂无学习问题/);
});

test("only recorded counts are added to the editable profile reference", () => {
  const prompt = buildStudentProfileConversationPrompt({ name: "合成学生乙", traits: [], parentNotes: [], patternCount: 0, trajectoryCount: 3 });
  assert.match(prompt, /系统记录：3 条成长记录。/);
  assert.doesNotMatch(prompt, /0 条学习问题/);
});
