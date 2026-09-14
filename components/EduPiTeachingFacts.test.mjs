import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { EduPiTeachingFacts } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiTeachingFacts.tsx");
const fact = { id: "fact-1", entityId: "student-1", kind: "error_pattern", predicate: "math.equation.transposition", value: "移项符号仍需练习", subjectRef: "数学", topicRef: "方程", confidence: { basis: "explicit", score: 1 }, status: "accepted", sourceIds: ["session-1"], observationIds: ["observation-1"], conflictIds: [], hasPredecessor: false, revision: 1 };
const factSpine = { stateHash: `sha256:${"a".repeat(64)}`, generatedAt: "2026-09-14T00:00:00.000Z", entities: [{ id: "student-1", kind: "student", name: "林晓", externalRefs: [{ namespace: "school-roster", externalId: "roster-student-1" }], revision: 1 }], observations: [{ id: "observation-1", sourceKind: "teacher_utterance", sourceId: "session-1", sourceRevision: "message-1", text: "林晓移项时容易忘记变号。", contentHash: `sha256:${"b".repeat(64)}`, observedAt: "2026-09-14T00:00:00.000Z", actorRef: "teacher", entityIds: ["student-1"], status: "active", revision: 1 }], acceptedFacts: [fact], factCandidates: [], hypotheses: [], conflicts: [], studentViews: [{ studentId: "student-1", name: "林晓", acceptedFactIds: ["fact-1"], pendingFactIds: [] }], teachingView: { acceptedFactIds: ["fact-1"], bySubject: [{ subjectRef: "数学", factIds: ["fact-1"] }] }, nextLessonFactIds: ["fact-1"], uses: [] };

test("teaching knowledge uses the Core teaching projection and keeps source evidence", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiTeachingFacts, { factSpine, reviewer: "teacher", onEducation() {} }));
  assert.match(html, /教学依据/);
  assert.match(html, /移项符号仍需练习/);
  assert.match(html, /林晓/);
  assert.match(html, /下节课采用/);
  assert.match(html, /教师对话/);
  assert.match(html, /林晓移项时容易忘记变号/);
});

test("teaching facts follow the teaching-page search", () => {
  assert.match(renderToStaticMarkup(React.createElement(EduPiTeachingFacts, { factSpine, query: "方程", reviewer: "teacher", onEducation() {} })), /移项符号仍需练习/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(EduPiTeachingFacts, { factSpine, query: "几何", reviewer: "teacher", onEducation() {} })), /移项符号仍需练习/);
});
