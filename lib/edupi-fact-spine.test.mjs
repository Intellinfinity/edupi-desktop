import assert from "node:assert/strict";
import test from "node:test";
import { buildEducationContract } from "./edupi-education-contract.ts";

const fact = (status) => ({
  fact_id: `fact-${status}`,
  entity_id: "student-1",
  fact_kind: "academic",
  predicate: "掌握",
  value: status === "accepted" ? "已掌握有理数加法" : "分数乘法仍需确认",
  subject_ref: "数学",
  topic_ref: "有理数",
  confidence: { basis: "explicit", score: 1 },
  status,
  source_ids: ["session-1"],
  observation_ids: ["observation-1"],
  conflict_ids: [],
  revision: 1,
  external_send: false,
});

function spine() {
  return {
    projection_kind: "education_fact_v1",
    projection_version: "1.0",
    state_hash: `sha256:${"a".repeat(64)}`,
    generated_at: "2026-09-14T00:00:00.000Z",
    entities: [{ entity_id: "student-1", entity_kind: "student", canonical_name: "林晓", status: "active", revision: 1, external_send: false }],
    observations: [{ observation_id: "observation-1", source_kind: "teacher_utterance", source_id: "session-1", source_revision: "message-1", raw_text: "林晓已经掌握有理数加法。", content_hash: `sha256:${"b".repeat(64)}`, observed_at: "2026-09-14T00:00:00.000Z", actor_ref: "teacher", entity_ids: ["student-1"], status: "active", revision: 1, external_send: false }],
    accepted_facts: [fact("accepted")],
    fact_candidates: [fact("pending_review")],
    hypotheses: [],
    conflicts: [],
    student_views: [{ student_id: "student-1", name: "林晓", accepted_fact_ids: ["fact-accepted"], pending_fact_ids: ["fact-pending_review"], external_send: false }],
    teaching_view: { accepted_fact_ids: ["fact-accepted"], by_subject: [{ subject_ref: "数学", fact_ids: ["fact-accepted"] }], external_send: false },
    next_lesson_fact_ids: ["fact-accepted"],
    uses: [{ use_id: "use-1", use_key: "next-1", consumer_kind: "next_lesson", consumer_ref: "lesson-1", fact_ids: ["fact-accepted"], used_at: "2026-09-14T00:05:00.000Z", external_send: false }],
    legacy_shadow: [],
    external_send: false,
  };
}

function contract(factSpine) {
  return buildEducationContract({ workspace: { students: [{ student_id: "student-1", name: "林晓" }], timetable: [], calendar: [], tasks: [], source_summaries: [], continuity: {}, fact_spine: factSpine } });
}

test("carries the Core fact spine into stable Desktop student and teaching views", () => {
  const projected = contract(spine()).factSpine;
  assert.equal(projected.stateHash, `sha256:${"a".repeat(64)}`);
  assert.deepEqual(projected.studentViews[0], { studentId: "student-1", name: "林晓", acceptedFactIds: ["fact-accepted"], pendingFactIds: ["fact-pending_review"] });
  assert.equal(projected.acceptedFacts[0].value, "已掌握有理数加法");
  assert.equal(projected.factCandidates[0].status, "pending_review");
  assert.deepEqual(projected.teachingView.bySubject[0], { subjectRef: "数学", factIds: ["fact-accepted"] });
  assert.deepEqual(projected.nextLessonFactIds, ["fact-accepted"]);
  assert.equal(projected.observations[0].text, "林晓已经掌握有理数加法。");
});

test("rejects an invalid fact-spine identity without hiding the rest of the workspace", () => {
  const invalid = spine();
  invalid.state_hash = "bad";
  const projected = contract(invalid);
  assert.equal(projected.factSpine, null);
  assert.equal(projected.students.length, 1);
});
