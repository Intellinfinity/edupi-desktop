import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { filterItems } = await jiti.import("./EduPiReminderInbox.tsx");
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const { paginateForeground } = await jiti.import("../lib/edupi-foreground.ts");
const policy = { today: "2026-10-07", graceDays: 3, pinnedTaskIds: [] };
const data = buildEducationContract({ tasks: [{ id: "old", title: "过期任务", trigger: "teacher_created", due_date: "2026-09-20", status: "planned", evidence: {} }, { id: "unknown", title: "日期未知", status: "planned", evidence: {} }] });
data.continuity.documents = [{ id: "daily:2026-09-27", kind: "daily", date: "2026-09-27", path: ".edupi/output/daily/2026-09-27.md", title: "旧简报", excerpt: "合成旧简报" }];
const reminder = { id: "old-reminder", taskId: "old", title: "过期事项", kind: "due", identity: "due:2026-09-20", createdAt: "2026-10-07T00:00:00Z", read: false, handled: false, snoozedUntil: null };

test("pending reminders expire from the real task or brief date and preserve undated objects", () => {
  const items = [reminder, { ...reminder, id: "brief", taskId: "document:daily:2026-09-27", kind: "brief", identity: "brief" }, { ...reminder, id: "unknown", taskId: "unknown", createdAt: "2020-01-01T00:00:00Z" }];
  assert.deepEqual(filterItems(items, "pending", policy, data).map(row => row.id), ["unknown"]);
  assert.equal(items[0].handled, false);
  assert.equal(items[0].withdrawn, undefined);
});

test("explicit future snoozes remain visible and history retains overdue unhandled reminders", () => {
  const items = [reminder, { ...reminder, id: "future-snooze", snoozedUntil: "2026-10-07T16:30:00Z" }, { ...reminder, id: "old-snooze", snoozedUntil: "2026-09-26T12:00:00Z" }];
  assert.deepEqual(filterItems(items, "snoozed", policy, data).map(row => row.id), ["future-snooze"]);
  assert.equal(filterItems(items, "history", policy, data).length, 3);
  assert.equal(items.every(row => row.handled === false), true);
  assert.equal(paginateForeground(Array.from({ length: 23 }, (_, index) => index), 0).rows.length, 10);
});

test("foreground reminder order follows the real occurrence or snooze day rather than notification creation", () => {
  const workspace = buildEducationContract({ tasks: [
    { id: "today", title: "今日事务", due_date: "2026-10-07", evidence: {} },
    { id: "future", title: "未来事务", due_date: "2026-10-12", evidence: {} },
    { id: "unknown", title: "日期未知", evidence: {} },
  ] });
  const items = [
    { ...reminder, id: "created-new", taskId: "future", createdAt: "2026-10-07T11:00:00Z" },
    { ...reminder, id: "created-old", taskId: "today", createdAt: "2026-10-01T00:00:00Z" },
    { ...reminder, id: "unknown", taskId: "unknown", createdAt: "2026-10-07T12:00:00Z" },
  ];
  assert.deepEqual(filterItems(items, "pending", policy, workspace).map(row => row.id), ["created-old", "created-new", "unknown"]);
  const snoozed = items.slice(0, 2).map((item, index) => ({ ...item, snoozedUntil: index ? "2026-10-07T16:30:00Z" : "2026-10-12" }));
  assert.deepEqual(filterItems(snoozed, "snoozed", policy, workspace).map(row => row.id), ["created-old", "created-new"]);
});
