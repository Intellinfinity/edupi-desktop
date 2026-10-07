import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { reminderEvents, selectForegroundReminders } = await jiti.import("./edupi-reminder-events.ts");
const { buildEducationContract } = await jiti.import("./edupi-education-contract.ts");

test("native foreground selection preserves source-lesson, undated, pinned, rescheduled, and executing exceptions without filtering raw history events", () => {
  const data = buildEducationContract({ tasks: [
    { id: "expired", title: "合成旧事务", due_date: "2026-09-01", status: "planned", evidence: {} },
    { id: "future-lesson", title: "未来课次旧准备截止", trigger: "teaching_before_class", source_event_date: "2026-10-20", due_date: "2026-09-01", status: "planned", evidence: {} },
    { id: "pinned", title: "合成旧置顶", due_date: "2026-09-01", status: "planned", evidence: {} },
    { id: "running", title: "合成旧运行", due_date: "2026-09-01", status: "planned", content_status: "running", evidence: {} },
    { id: "rescheduled", title: "合成旧改期", due_date: "2026-09-01", status: "planned", evidence: {} },
    { id: "unknown", title: "合成无日期", status: "planned", evidence: {} },
  ] });
  data.workCandidates = [{ taskId: "rescheduled", status: "snoozed", snoozeUntil: "2026-10-20" }];
  const rows = [...data.tasks.map(task => ({ id: task.id, taskId: task.id, kind: "due", identity: `due:${task.dueDate || "unknown"}`, snoozedUntil: null })),
    { id: "manual-snooze", taskId: "expired", kind: "due", identity: "due:2026-09-01", snoozedUntil: "2026-10-20T00:00:00+08:00" }];
  const selected = selectForegroundReminders(rows, data, { today: "2026-10-08", graceDays: 3, pinnedTaskIds: ["pinned"] });
  assert.deepEqual(selected.map(item => item.id), ["future-lesson", "pinned", "running", "rescheduled", "unknown", "manual-snooze"]);
  const raw = reminderEvents(data.tasks, "/tmp/synthetic-only", new Date("2026-10-08T01:00:00+08:00"));
  assert.equal(raw["due:expired"].completion, "due", "expiry cannot remove the event and accidentally withdraw its unread history");
  assert.equal(data.tasks.length, 6);
});
test("today's brief becomes one stable reminder, older reports do not", () => {
  const doc = {id:"daily-1",kind:"daily",date:"2026-09-08",title:"早安简报",path:".edupi/output/daily/a.md",excerpt:"今天的安排"};
  const now = new Date("2026-09-07T16:01:00Z");
  const events = reminderEvents([],"/tmp/test",now,[doc,{...doc,id:"old",date:"2026-09-07"}]);
  assert.equal(Object.keys(events).length,1);
  assert.equal(events["document:daily-1"].completion,"brief");
  assert.equal(reminderEvents([],"/tmp/test",now,[{...doc,excerpt:"补充内容"}])["document:daily-1"].identity,events["document:daily-1"].identity);
});
test("due reminders use Shanghai dates and exclude handled or held tasks", () => {
  const base = { id: "a", title: "课前准备", status: "planned", contentStatus: null, dueDate: "2026-09-07" };
  const tasks = [base, { ...base, id: "b", status: "rejected" }, { ...base, id: "c", status: "hold" }, { ...base, id: "d", dueDate: "2026-09-08" }];
  const events = reminderEvents(tasks, "/tmp/test", new Date("2026-09-06T16:01:00Z"));
  assert.equal(events["due:a"].completion, "due");
  assert.equal(events["due:b"], undefined);
  assert.equal(events["due:c"], undefined);
  assert.equal(events["due:d"], undefined);
  const completed = reminderEvents([{ ...base, contentStatus: "draft_ready", boardStage: "done" }, { ...base, id: "accepted", contentStatus: "draft_ready", status: "accepted" }], "/tmp/test");
  assert.deepEqual(completed, {});
  assert.equal(reminderEvents(tasks, "/tmp/test", new Date("2026-09-06T15:59:00Z"))["due:a"], undefined);
  const nextDay = reminderEvents(tasks, "/tmp/test", new Date("2026-09-07T16:01:00Z"));
  assert.equal(nextDay["due:a"].identity, events["due:a"].identity);
  assert.equal(nextDay["due:a"].completion, "due");
});

test("only newly projected teacher-created tasks without a work case carry legacy native provenance", () => {
  const now = new Date("2026-09-22T16:01:00Z");
  const manual = { id: "teacher-task-10000000-0000-4000-8000-000000000001", title: "确认会议室", status: "planned", contentStatus: null,
    dueDate: "2026-09-22", trigger: "teacher_created", sourceEventId: null };
  const sourceBound = "teacher-task-10000000-0000-4000-8000-000000000002";
  const workCaseTask = "teacher-task-10000000-0000-4000-8000-000000000003";
  const preparation = "teacher-task-10000000-0000-4000-8000-000000000004";
  const tasks = [manual, { ...manual, id: sourceBound, sourceEventId: "calendar-1" },
    { ...manual, id: workCaseTask }, { ...manual, id: preparation, trigger: "teaching_before_class" },
    { ...manual, id: "manual-without-source-proof" }];
  const workCases = [{ id: "case-1", taskId: workCaseTask }];
  const events = reminderEvents(tasks, "/tmp/test", now, [], workCases);
  assert.equal(events[`due:${manual.id}`].nativeSource, "teacher_created");
  assert.equal(events[`due:${sourceBound}`].nativeSource, undefined);
  assert.equal(events[`due:${workCaseTask}`].nativeSource, undefined);
  assert.equal(events[`due:${preparation}`].nativeSource, undefined);
  assert.equal(events["due:manual-without-source-proof"].nativeSource, undefined);
  assert.equal(reminderEvents([manual], "/tmp/test", now)[`due:${manual.id}`].nativeSource, undefined);
});

test("only a matching current Core G1 work case marks a completed internal draft for native delivery", () => {
  const task = { id: "teaching_before_class:timetable:slot-1:2026-09-27", title: "七一班数学课前准备",
    trigger: "teaching_before_class", sourceEventId: "timetable:slot-1:2026-09-27",
    status: "planned", contentStatus: "draft_ready", dueDate: "2026-09-26", scope: "teacher_internal",
    requiresTeacherReview: true, externalSend: false, evidence: {} };
  const workCase = { id: "work_case_1", taskId: task.id, kind: "teaching_before_class", currentState: "draft_ready", artifactIds: ["artifact-1"], externalSend: false };
  const artifacts = [{ artifact_id: "artifact-1", task_id: task.id, available: true }];
  const event = reminderEvents([task], "/tmp/test", new Date("2026-09-26T04:00:00Z"), [], [workCase], artifacts)[task.id];
  assert.equal(event.nativeSource, "core_g1");
  for (const bad of [{ ...workCase, taskId: "other" }, { ...workCase, currentState: "failed" },
    { ...workCase, externalSend: true }, { ...workCase, kind: "student_followup" }]) {
    assert.equal(reminderEvents([task], "/tmp/test", new Date(), [], [bad], artifacts)[task.id].nativeSource, undefined);
  }
  assert.equal(reminderEvents([task], "/tmp/test", new Date(), [], [workCase], [{ ...artifacts[0], available: false }])[task.id].nativeSource, undefined);
  assert.equal(reminderEvents([task], "/tmp/test", new Date(), [], [workCase], [{ ...artifacts[0], task_id: "other" }])[task.id].nativeSource, undefined);
  assert.equal(reminderEvents([{ ...task, requiresTeacherReview: false }], "/tmp/test", new Date(), [], [workCase], artifacts)[task.id].nativeSource, undefined);
  assert.equal(reminderEvents([{ ...task, status: "accepted" }], "/tmp/test", new Date(), [], [workCase], artifacts)[task.id], undefined);
});
