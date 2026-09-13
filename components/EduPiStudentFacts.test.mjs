import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { EduPiStudentFacts } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiStudentFacts.tsx");
const accepted = { id: "fact-1", entityId: "entity-student-1", kind: "academic", predicate: "掌握", value: "已掌握有理数加法", subjectRef: "数学", topicRef: "有理数", confidence: { basis: "explicit", score: 1 }, status: "accepted", sourceIds: ["session-1", "material-source-2"], observationIds: ["observation-1"], conflictIds: [], revision: 1 };
const factSpine = { stateHash: `sha256:${"a".repeat(64)}`, generatedAt: "2026-09-14T00:00:00.000Z", entities: [{ id: "entity-student-1", kind: "student", name: "林晓", externalRefs: [{ namespace: "school-roster", externalId: "roster-student-1" }], revision: 1 }], observations: [{ id: "observation-1", sourceKind: "teacher_utterance", sourceId: "session-1", sourceRevision: "message-1", text: "林晓已经掌握有理数加法。", contentHash: `sha256:${"b".repeat(64)}`, observedAt: "2026-09-14T00:00:00.000Z", actorRef: "teacher", entityIds: ["entity-student-1"], status: "active", revision: 1 }], acceptedFacts: [accepted], factCandidates: [], hypotheses: [], conflicts: [], studentViews: [{ studentId: "entity-student-1", name: "林晓", acceptedFactIds: ["fact-1"], pendingFactIds: [] }], teachingView: { acceptedFactIds: ["fact-1"], bySubject: [] }, nextLessonFactIds: ["fact-1"], uses: [] };

test("student details show Core fact status and the original source text", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiStudentFacts, { factSpine, studentId: "roster-student-1" }));
  assert.match(html, /Core 事实/);
  assert.match(html, /已掌握有理数加法/);
  assert.match(html, /已确认/);
  assert.match(html, /教师对话/);
  assert.match(html, /林晓已经掌握有理数加法/);
  assert.match(html, /material-source-2/);
});
