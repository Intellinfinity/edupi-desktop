import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { EduPiFactActions } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiFactActions.tsx");
const oldFact = { id: "fact-old", entityId: "student-1", kind: "error_pattern", predicate: "math.sign", value: "仍需练习", subjectRef: "数学", topicRef: "移项", confidence: { basis: "explicit", score: 1 }, status: "accepted", sourceIds: ["source-1"], observationIds: ["observation-1"], conflictIds: ["conflict-1"], hasPredecessor: false, revision: 3 };
const candidate = { ...oldFact, id: "fact-new", kind: "progress", value: "已经掌握", status: "pending_review", revision: 1 };
const spine = { acceptedFacts: [oldFact], factCandidates: [candidate], conflicts: [{ id: "conflict-1", entityId: "student-1", predicate: "math.sign", factIds: [oldFact.id, candidate.id], sourceIds: ["source-1"], revision: 0 }], entities: [], observations: [], hypotheses: [], studentViews: [], teachingView: { acceptedFactIds: [], bySubject: [] }, nextLessonFactIds: [], uses: [], stateHash: "sha256:x", generatedAt: "2026-09-15T00:00:00.000Z" };

test("renders conflict-aware candidate review and accepted fact editing", () => {
  const candidateHtml = renderToStaticMarkup(React.createElement(EduPiFactActions, { fact: candidate, spine, reviewer: "teacher", onEducation() {} }));
  assert.match(candidateHtml, /接受并替换/);
  assert.match(candidateHtml, /仍需练习/);
  assert.match(candidateHtml, /暂缓/);
  assert.match(candidateHtml, /拒绝/);
  const restoredHtml = renderToStaticMarkup(React.createElement(EduPiFactActions, { fact: { ...candidate, hasPredecessor: true }, spine, reviewer: "teacher", onEducation() {} }));
  assert.match(restoredHtml, /先处理冲突事实/);
  assert.match(restoredHtml, /disabled/);
  const secondAccepted = { ...oldFact, id: "fact-other", value: "另一条冲突事实" };
  const multipleConflictSpine = { ...spine, acceptedFacts: [oldFact, secondAccepted], conflicts: [{ ...spine.conflicts[0], factIds: [oldFact.id, secondAccepted.id, candidate.id] }] };
  const multipleHtml = renderToStaticMarkup(React.createElement(EduPiFactActions, { fact: candidate, spine: multipleConflictSpine, reviewer: "teacher", onEducation() {} }));
  assert.match(multipleHtml, /存在 2 条冲突事实/);
  assert.match(multipleHtml, /先处理冲突事实/);
  assert.match(multipleHtml, /disabled/);
  const acceptedHtml = renderToStaticMarkup(React.createElement(EduPiFactActions, { fact: oldFact, spine, reviewer: "teacher", onEducation() {} }));
  assert.match(acceptedHtml, /修改/);
  assert.match(acceptedHtml, /删除/);
});

test("fact actions bind both revisions and refresh the shared education snapshot", async () => {
  const [actions, deleted, insights, board, panel] = await Promise.all([
    readFile(new URL("./EduPiFactActions.tsx", import.meta.url), "utf8"),
    readFile(new URL("./EduPiDeletedFacts.tsx", import.meta.url), "utf8"),
    readFile(new URL("./EduPiInsightDatabase.tsx", import.meta.url), "utf8"),
    readFile(new URL("./EduPiReviewBoard.tsx", import.meta.url), "utf8"),
    readFile(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(actions, /expectedRevision: fact\.revision/);
  assert.match(actions, /supersedesFactRevision: decision === "accept" \? conflicting\?\.revision/);
  assert.match(actions, /onEducation\(result\.data\)/);
  assert.match(actions, /runSerializedFactMutation/);
  assert.match(actions, /EDUPI_FACTS_UPDATED_EVENT/);
  assert.match(deleted, /offset=\$\{page \* PAGE_SIZE\}&limit=\$\{PAGE_SIZE\}/);
  assert.match(deleted, /supersedesFactRevision: conflict\?\.revision/);
  assert.match(deleted, /fact\.restoreConflicts/);
  assert.match(deleted, /runSerializedFactMutation/);
  assert.match(insights, /factInsightStatus/);
  assert.match(insights, /<EduPiDeletedFacts/);
  assert.match(board, /事实确认/);
  assert.match(panel, /factPendingCount/);
});
