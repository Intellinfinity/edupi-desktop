import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiProactiveHub, proactiveBadgeCount } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiProactiveHub.tsx");

test("proactive collaboration counts real Core attention and unread reminders", () => {
  const kernel = { status: "ready", updatedAt: "2026-09-17T00:00:00Z", running: 1, runs: [
    { runId: "running", triggerId: "morning_brief", fireKey: null, status: "running", updatedAt: "2026-09-17T00:00:00Z", resultSummary: null, errorCode: null, errorMessage: null },
    { runId: "failed", triggerId: "g1_prepare_due", fireKey: null, status: "failed", updatedAt: "2026-09-17T00:00:00Z", resultSummary: null, errorCode: "source_unavailable", errorMessage: null },
  ] };
  const reminders = [
    { id: "new", taskId: "task", title: "待处理", kind: "due", identity: "a", createdAt: "2026-09-17T00:00:00Z", read: false, handled: false, snoozedUntil: null },
    { id: "read", taskId: "task-2", title: "已读", kind: "ready", identity: "b", createdAt: "2026-09-17T00:00:00Z", read: true, handled: false, snoozedUntil: null },
  ];
  assert.equal(proactiveBadgeCount(kernel, reminders), 3);
});

test("proactive collaboration is an icon entry with an accessible name", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiProactiveHub, { open: false, onOpenChange() {}, onAction: async () => true, onTarget() {}, onOpenReminders() {} }));
  assert.match(html, /aria-label="主动协作"/);
  assert.match(html, /class="edupi-chat-utility edupi-proactive-hub"/);
  assert.doesNotMatch(html, />主动协作<\/button>/);
});
