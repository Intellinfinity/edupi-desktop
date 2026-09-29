import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { currentTaskFeedback, taskFeedbackDecision } = await jiti.import("./EduPiTaskFeedback.tsx");

test("task review keeps a value-feedback path for each recorded decision", () => {
  const reviewed = (status, state) => ({ status, teacherReview: { state, reviewerId: "teacher", reviewedAt: "2026-09-29T00:00:00.000Z" } });
  assert.equal(taskFeedbackDecision(reviewed("pending_review", "pending_review")), null);
  assert.equal(taskFeedbackDecision(reviewed("accepted", "accepted")), "accept");
  assert.equal(taskFeedbackDecision(reviewed("modified", "modified")), "modify");
  assert.equal(taskFeedbackDecision(reviewed("rejected", "rejected")), "reject");
  assert.equal(taskFeedbackDecision(reviewed("held", "held")), "hold");
  assert.equal(taskFeedbackDecision(reviewed("snoozed", "held")), "snooze");
  assert.equal(taskFeedbackDecision(reviewed("suppressed", "rejected")), "suppress");
  assert.equal(taskFeedbackDecision({ status: "held", teacherReview: { state: "pending_review", reviewerId: null, reviewedAt: null } }), null);
  assert.equal(taskFeedbackDecision({ status: "held", teacherReview: { state: "held", reviewerId: null, reviewedAt: null } }), null);
});

test("an already recorded candidate revision is not offered a second value submission", () => {
  const candidate = { candidateId: "candidate-1", revision: 2 };
  const current = { feedback_id: "feedback-1", session_id: "desktop-today", current: true,
    target: { kind: "work_candidate", target_id: "candidate-1", revision: 2 } };
  assert.deepEqual(currentTaskFeedback([current], candidate), current);
  assert.equal(currentTaskFeedback([{ ...current, current: false }], candidate), null);
  assert.equal(currentTaskFeedback([{ ...current, target: { ...current.target, revision: 1 } }], candidate), null);
  assert.equal(currentTaskFeedback([{ ...current, session_id: "another-session" }], candidate), null);
});
