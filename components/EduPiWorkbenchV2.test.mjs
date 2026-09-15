import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("education modules start directly below navigation without the global top strip", async () => {
  const [panel, sider, css] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiObjectSider.tsx"),
    read("../app/edupi-workbench.css"),
  ]);
  assert.doesNotMatch(panel, /edupi-teacher-topbar/);
  assert.match(sider, /edupi-object-sider__search/);
  assert.match(sider, /onQuery/);
  assert.match(css, /\.edupi-teacher-app\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/s);
});

test("calendar separates content type and keeps editing inside the detail drawer", async () => {
  const calendar = await read("./EduPiCalendarWorkspace.tsx");
  assert.match(calendar, /type CalendarContentMode = "summary" \| "calendar" \| "timetable"/);
  for (const label of ["汇总", "校历", "课程表"]) assert.match(calendar, new RegExp(`label: "${label}"`));
  assert.match(calendar, /edupi-calendar-content-segment/);
  assert.match(calendar, /entry\.kind === contentMode/);
  assert.match(calendar, /embedded/);
  assert.match(calendar, /editor=\{/);
  assert.doesNotMatch(calendar, /setComposer\("calendar"\);\s*onSelect\(null\)/);
  assert.doesNotMatch(calendar, /setComposer\("timetable"\);\s*onSelect\(null\)/);
});

test("task board and task sidebar expose the same teacher-facing categories", async () => {
  const [board, sider, categories] = await Promise.all([
    read("./EduPiWorkspaceBoard.tsx"),
    read("./EduPiObjectSider.tsx"),
    read("../lib/edupi-task-category.ts"),
  ]);
  assert.match(board, /TASK_CATEGORY_CONFIG/);
  assert.match(board, /edupi-task-category-segment/);
  assert.match(sider, /groupTasksByCategory/);
  for (const label of ["教学准备", "学生跟进", "校历节点", "材料证据", "活动安排"]) {
    assert.match(`${board}\n${sider}\n${categories}`, new RegExp(label));
  }
  assert.match(board, /\["queued", "running", "draft_ready", "failed"\]\.includes\(workCase\.currentState\)/);
  assert.match(board, /hasCurrentExplicitBoardStage\(task\)/);
});

test("class and student modules select one student and expose real import and export actions", async () => {
  const [panel, sider, views, student, route] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiObjectSider.tsx"),
    read("./EduPiWorkspaceViews.tsx"),
    read("./EduPiStudentWorkspace.tsx"),
    read("../app/api/edupi/students/import/route.ts"),
  ]);
  assert.match(panel, /selectedStudentId/);
  assert.match(panel, /onStudent=\{selectStudent\}/);
  assert.match(sider, /edupi-object-student/);
  assert.doesNotMatch(sider, /<details className="edupi-object-person"/);
  assert.match(views, /mode=\{props\.view\}/);
  for (const label of ["导入名单", "导出档案", "导出轨迹", "学习模式", "成长轨迹", "家校记录", "相关任务"]) assert.match(student, new RegExp(label));
  assert.match(student, /\/api\/edupi\/students\/import/);
  assert.match(student, /\.xlsx/);
  assert.match(student, /new FormData\(\)/);
  assert.match(student, /\^id\$\|_id\$\|_ids\$\|hash\|path/);
  assert.match(route, /importStudentRoster/);
  assert.match(route, /parseStudentRosterFile/);
  assert.match(route, /parseFormDataWithinLimit/);
  assert.match(route, /readEducationContract/);
});

test("teaching prepares the next class and continuity modules render one selected record", async () => {
  const [panel, sider, views, teaching, memory, insights, growth] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiObjectSider.tsx"),
    read("./EduPiWorkspaceViews.tsx"),
    read("./EduPiTeachingWorkspace.tsx"),
    read("./EduPiMemoryDatabase.tsx"),
    read("./EduPiInsightDatabase.tsx"),
    read("./EduPiGrowthWorkspace.tsx"),
  ]);
  assert.match(teaching, /对话补充重点/);
  assert.match(teaching, /准备下一节课/);
  assert.match(teaching, /请为\$\{nextSubject\}/);
  assert.match(panel, /selectedObjectId/);
  assert.match(panel, /onObject=\{selectObject\}/);
  assert.match(sider, /MEMORY_CATEGORIES\.map/);
  assert.match(sider, /INSIGHT_CATEGORIES\.map/);
  assert.match(memory, /edupi-database/);
  assert.match(insights, /edupi-database/);
  assert.match(growth, /edupi-database/);
  assert.doesNotMatch(views, /edupi-memory-groups/);
  assert.doesNotMatch(views, /edupi-insight-layout/);
  assert.doesNotMatch(views, /edupi-growth-grid/);
});

test("review renders one selected decision and the rail exposes real EduPi activity", async () => {
  const [panel, review, rail, css] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiC1Review.tsx"),
    read("./EduPiNavigationRail.tsx"),
    read("../app/edupi-workbench.css"),
  ]);
  assert.match(panel, /reviewMode/);
  assert.match(panel, /searchParams\.get\("task"\) && requestedStage === "review" \? "task" : "board"/);
  assert.match(panel, /selectedC1Target/);
  assert.match(review, /visibleTarget/);
  assert.doesNotMatch(review, /targets\.map\(\(target\)/);
  assert.match(rail, /runningAgentCount/);
  assert.match(rail, /memoryCount/);
  assert.match(rail, /edupi-activity-pulse/);
  assert.match(css, /@keyframes edupiActivityPulse/);
});

test("activity pulse includes proactive kernel runs", async () => {
  const panel = await read("./EduPiEducationPanel.tsx");
  assert.match(panel, /\/api\/edupi\/kernel/);
  assert.match(panel, /runningSessionCount \+ runningKernelCount/);
});

test("education memory uses Core semesters before category and pagination", async () => {
  const [panel, sider, database, scopes] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiObjectSider.tsx"),
    read("./EduPiMemoryDatabase.tsx"),
    read("../lib/edupi-memory-scopes.ts"),
  ]);
  assert.match(panel, /readEducationMemoryScopes/);
  assert.match(scopes, /\/api\/edupi\/memory-scopes/);
  assert.match(sider, /memoryScopes\?\.semesters/);
  assert.match(sider, />学期</);
  assert.match(database, /semester\?\.label/);
  assert.match(database, /scopedMemoryIds/);
  assert.match(database, /edupi-database-pagination/);
});

test("narrow screens retain the object selector and exports neutralize spreadsheet formulas", async () => {
  const [css, student, sider] = await Promise.all([
    read("../app/edupi-workbench.css"),
    read("./EduPiStudentWorkspace.tsx"),
    read("./EduPiObjectSider.tsx"),
  ]);
  assert.match(css, /\.edupi-content-sider \{ position: absolute;[^}]*display: flex;/);
  assert.doesNotMatch(css, /\.edupi-content-sider \{ display: none; \}/);
  assert.match(student, /\^\\s\*\[=\+\\-@\]/);
  assert.doesNotMatch(student, /mode === "students" \? students\[0\] : null/);
  assert.match(student, /edupi-class-summary-strip/);
  assert.match(student, /edupi-student-drawer/);
  assert.match(sider, /const insights = data\.continuity\.insights\.filter/);
  assert.doesNotMatch(sider, /surfacedInsights.*slice\(0, 6\)/s);
});
