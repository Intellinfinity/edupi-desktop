import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const navigation = await createJiti(import.meta.url).import("./edupi-domain-navigation.ts");

test("exposes the teacher-facing memory and teaching categories in order", () => {
  assert.deepEqual(navigation.MEMORY_CATEGORIES.map((item) => item.label), ["学期事项", "学生", "教学", "教师偏好", "学校"]);
  assert.deepEqual(navigation.TEACHING_SECTIONS.map((item) => item.label), ["教学首页", "课程表", "教学重点", "备课任务", "教学记忆"]);
});

test("classifies insights and materials into one stable category", () => {
  assert.deepEqual(navigation.INSIGHT_STATUSES.map((item) => item.label), ["全部", "原始观察", "已浮出", "酝酿中", "弱信号"]);
  assert.equal(navigation.insightCategory("学生移项错因连续出现"), "learning");
  assert.equal(navigation.insightCategory("家校沟通与班级安全"), "class");
  assert.equal(navigation.insightCategory("下一节课堂教学调整"), "teaching");
  assert.equal(navigation.insightCategory("后台提醒策略"), "edupi");
  assert.equal(navigation.materialCategory({ materialKind: "assessment", title: "单元检测" }), "assessment");
  assert.equal(navigation.materialCategory({ title: "课堂观察记录" }), "classroom");
  const materials = [{ materialKind: "assessment", title: "单元检测" }, { title: "备课杂项" }];
  assert.equal(navigation.materialCategoryCount("all", materials, 2), 4);
  assert.equal(navigation.materialCategoryCount("assessment", materials, 2), 1);
  assert.equal(navigation.materialCategoryCount("other", materials, 2), 3);
});

test("parses category routes without exposing record ids", () => {
  assert.equal(navigation.routePart("memory:semester", "memory", "semester"), "semester");
  assert.equal(navigation.routePart("memory:item-1", "insights", "all"), "all");
  assert.equal(navigation.memoryCategoryRoute("memory:teaching"), "teaching");
  assert.equal(navigation.memoryCategoryRoute("memory:legacy-record-id"), "semester");
});

test("restored object routes retain filters and exact item identities", () => {
  const memoryRoute = navigation.memoryObjectId("semester-current", "preferences", "memory:a/b");
  assert.equal(navigation.memoryCategoryRoute(memoryRoute), "preferences");
  assert.equal(navigation.memorySemesterRoute(memoryRoute, null), "semester-current");
  assert.equal(navigation.memoryItemRoute(memoryRoute), "memory:a/b");
  const fallbackMemoryRoute = navigation.memoryObjectId(null, "teaching", "memory:1");
  assert.equal(navigation.memorySemesterRoute(fallbackMemoryRoute, "semester-fallback"), "semester-fallback");
  assert.equal(navigation.memoryItemRoute(fallbackMemoryRoute), "memory:1");
  const materialRoute = navigation.materialObjectId("all", "material:a/b");
  assert.equal(navigation.materialCategoryRoute(materialRoute), "all");
  assert.equal(navigation.materialItemRoute(materialRoute), "material:a/b");
});

test("keeps category routes for every database-style workspace", () => {
  for (const view of ["teaching", "memory", "insights", "growth", "materials"]) {
    assert.equal(navigation.viewKeepsObjectItem(view), true, view);
  }
  for (const view of ["home", "calendar", "students", "tasks", "review"]) {
    assert.equal(navigation.viewKeepsObjectItem(view), false, view);
  }
});

test("keeps only object routes owned by the destination workspace", () => {
  assert.equal(navigation.objectItemForView("memory", "memory:teaching"), "memory:teaching");
  assert.equal(navigation.objectItemForView("memory", "teaching:memory"), null);
  assert.equal(navigation.objectItemForView("calendar", "memory:teaching"), null);
});

test("matches workspace searches case-insensitively", () => {
  assert.equal(navigation.matchesWorkspaceQuery("Math 703", "math"), true);
  assert.equal(navigation.matchesWorkspaceQuery("Math 703", "704"), false);
  const knowledge = [{ subject: "数学", topic: "一元一次方程", commonErrors: [{ description: "移项变号" }] }, { subject: "英语", topic: "时态", commonErrors: [] }];
  assert.deepEqual(navigation.filterSubjectKnowledgeItems(knowledge, "移项").map((item) => item.subject), ["数学"]);
  const priorities = [{ subject: "数学", className: "703", topic: "移项", note: "先讲等式性质", status: "active" }, { subject: "英语", className: null, topic: "时态", note: null, status: "paused" }];
  assert.deepEqual(navigation.filterTeachingPriorityItems(priorities, "703").map((item) => item.topic), ["移项"]);
  assert.deepEqual(navigation.filterTeachingPriorityItems(priorities, "已暂停").map((item) => item.topic), ["时态"]);
});

test("keeps confirmed EduPi growth themes visibly confirmed", () => {
  assert.equal(navigation.growthReviewStateLabel("accepted"), "已确认");
  assert.equal(navigation.growthReviewStateLabel("confirmed"), "已确认");
  assert.equal(navigation.growthReviewStateLabel("pending_review"), "待验证");
});
