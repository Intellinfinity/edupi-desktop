import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { EduPiTaskDetailDrawer } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiTaskDetailDrawer.tsx");
const task = { id: "task-1", title: "备课", trigger: "capability_package", status: "planned", contentStatus: "draft_ready", deliveryStatus: "not_approved", sourceEventId: "trigger-1", sourceEventName: "备课", sourceEventDate: "2026-09-15", triggerDate: "2026-09-14", dueDate: "2026-09-14", deliverables: ["教案", "学案"], audience: ["teacher"], requiresTeacherReview: true, externalSend: false, scope: "teacher_internal", student: null, studentEventType: null, materialId: null, materialKind: null, topic: null, revision: 0, reviewedAt: null, reviewer: null, reviewNote: null, reviewHistory: [], evidence: {}, boardStage: "review", boardRevision: 0, boardUpdatedAt: null };
const workCase = { id: "case-1", kind: "capability_package", triggerId: "trigger-1", taskId: "task-1", title: "备课", currentState: "draft_ready", dueDate: "2026-09-14", executionRevision: 1, artifactRevision: 1, transitionRevision: 0, sourceIds: ["trigger-1"], artifactIds: ["artifact-1", "artifact-2"], artifacts: [{ id: "artifact-1", key: "lesson", title: "教案", type: "markdown", relativePath: ".edupi/output/lesson.md", sha256: `sha256:${"a".repeat(64)}`, revision: 1, evidenceIds: [], externalSend: false }, { id: "artifact-2", key: "worksheet", title: "学案", type: "markdown", relativePath: ".edupi/output/worksheet.md", sha256: `sha256:${"b".repeat(64)}`, revision: 1, evidenceIds: [], externalSend: false }], transitions: [], externalSend: false };

test("task details expose every authoritative work-case artifact when the generated index is empty", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiTaskDetailDrawer, { task, workCase, files: [], workspace: "/tmp/teacher", onClose() {}, onOpenFile() {}, onOpenTask() {}, onOpenAgent() {}, onDelete() {} }));
  assert.match(html, /<button[^>]*><strong>教案<\/strong>/);
  assert.match(html, /<button[^>]*><strong>学案<\/strong>/);
  assert.doesNotMatch(html, /打开产物/);
});

test("an indexed unavailable artifact is not revived by the work-case fallback", () => {
  const files = [{ artifact_id: "artifact-1", title: "教案", relative_path: ".edupi/output/lesson.md", available: false, session_id: "session-1", task_id: "task-1", updated_at: "2026-09-14T00:00:00.000Z", size_bytes: 0 }];
  const html = renderToStaticMarkup(React.createElement(EduPiTaskDetailDrawer, { task, workCase, files, workspace: "/tmp/teacher", onClose() {}, onOpenFile() {}, onOpenTask() {}, onOpenAgent() {}, onDelete() {} }));
  assert.match(html, /<button[^>]*disabled=""[^>]*><strong>教案<\/strong><small>文件不可用<\/small><\/button>/);
  assert.match(html, /<button[^>]*><strong>学案<\/strong><small>候选<\/small><\/button>/);
});

test("task handoff stays visibly pending and reports a retryable activation error", () => {
  const props = { task, workCase, workspace: "/tmp/teacher", onClose() {}, onOpenFile() {}, onOpenTask() {}, onOpenAgent() {}, onDelete() {} };
  const pending = renderToStaticMarkup(React.createElement(EduPiTaskDetailDrawer, { ...props, agentBusy: true }));
  assert.match(pending, /disabled=""[^>]*>正在准备<\/button>/);
  const failed = renderToStaticMarkup(React.createElement(EduPiTaskDetailDrawer, { ...props, agentError: "会话暂不可用" }));
  assert.match(failed, /role="alert"[^>]*>会话暂不可用<\/p>/);
  assert.match(failed, />继续让 EduPi 做<\/button>/);
});
