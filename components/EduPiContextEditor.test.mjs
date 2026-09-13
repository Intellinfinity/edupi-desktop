import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("context editor is a compact five-field comparison sheet", async () => {
  const source = await read("./EduPiContextEditor.tsx");
  const css = await read("../app/edupi-context.css");
  assert.match(source, /TEACHER_CONTEXT_FIELDS\.map/);
  assert.match(source, /当前生效/);
  assert.match(source, /待确认更新/);
  assert.match(source, /未设置/);
  assert.match(source, /已变更/);
  assert.match(source, /candidate\?\.status \|\| candidate\?\.teacherReview\.state/);
  assert.doesNotMatch(source, /step|progress|roleOptions|choices|school|classCount|studentCount|painPoint|isHomeroom/);
  assert.doesNotMatch(css, /__progress|__choices|__step|260px/);
  assert.match(css, /var\(--ep-surface/);
  assert.match(css, /is-pending_review/);
  assert.match(css, /\.edupi-context-editor__header h2:focus \{ outline: 0; \}/);
  assert.match(css, /\.edupi-context-modal \.edupi-context-editor__header \{ padding-right: 40px; \}/);
  assert.match(css, /\.edupi-context-editor__actions > :only-child \{ grid-column: 1 \/ -1; \}/);
});

test("context actions are receipt-bound, strict, and keep Chat as a draft handoff", async () => {
  const source = await read("./EduPiContextEditor.tsx");
  const panel = await read("./EduPiEducationPanel.tsx");
  const modal = await read("../hooks/useModalDismiss.ts");
  const home = await read("./EduPiEducationHome.tsx");
  assert.match(source, /verifyTeacherContextReview/);
  assert.match(source, /expectedStateHash: candidate\.stateHash/);
  assert.match(source, /trustedAfterSnapshotRef/);
  assert.match(source, /candidate\.snapshotId === marker\.snapshotId/);
  assert.match(source, /trustedAfterSnapshotRef\.current = null/);
  assert.match(source, /await onReviewed/);
  assert.match(source, /matchesTeacherContextRefresh\(refreshed/);
  assert.match(source, /已收到回执，刷新失败。/);
  assert.match(source, /candidate \? <div className="edupi-context-editor__meta">教师资料/);
  assert.match(source, /setFeedback\(`✓ /);
  assert.match(source, /回执 \$\{String\(verified\.receipt\.receipt_id\)\}/);
  assert.match(source, /chatDraftOpen/);
  assert.match(source, /buildTeacherContextPrompt\(draft\)/);
  assert.match(source, /放入对话/);
  assert.match(source, /!modifyOpen && !chatDraftOpen && onAgentRequest \? <button/);
  assert.match(source, /event\.key === "Enter" && \(event\.metaKey \|\| event\.ctrlKey\)/);
  assert.doesNotMatch(source, /externalSend|external_send|onSaved|fetch\("\/api\/edupi\/onboarding"[\s\S]*GET/);
  assert.match(panel, /teacherContextPendingCount/);
  assert.match(panel, /pendingCount \+ c1PendingCount \+ teacherContextPendingCount/);
  assert.match(panel, /ref=\{contextModalRef\}/);
  assert.match(panel, /useModalDismiss<HTMLDivElement>/);
  assert.match(panel, /tabIndex=\{-1\}/);
  assert.match(modal, /focusables\.length === 0[\s\S]*event\.preventDefault\(\)/);
  assert.doesNotMatch(panel, /onKeyDown=\{handleContextModalKeyDown\}/);
  assert.match(panel, /role="dialog" aria-modal="true"/);
  assert.match(panel, /candidate=\{education\?\.teacherContextCandidates\[0\]/);
  assert.match(home, /candidate=\{data\.teacherContextCandidates\[0\]/);
  assert.match(home, /capability=\{data\.capabilities\.teacherContextReview\}/);
  assert.doesNotMatch(home, /onSaved=/);
});
