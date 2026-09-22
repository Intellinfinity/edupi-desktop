import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { renderToStaticMarkup } from "react-dom/server";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const React = await jiti.import("react");
const { EduPiTodayWork, feedbackCaptureFor } = await jiti.import("./EduPiTodayWork.tsx");
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");

test("renders Core ambient preparation without exposing decision authority controls", () => {
  const data = buildEducationContract({
    workspace: {
      students: [],
      timetable: [],
      calendar: [],
      tasks: [],
      continuity: {},
      capabilities: {
        taskReview: { enabled: false, commands: [], actions: [], reason: "read only" },
        supported_commands: [],
        supported_projections: ["education_workspace"],
      },
      l4_preparation: {
        version: 1,
        policy_version: "priority-v1",
        generated_at: "2026-09-19T01:00:00.000Z",
        goals: [{
          id: "goal-1", text: "下周课程材料按时就绪", scope: { class_id: "class-7-1", subject: "数学" },
          starts_at: "2026-09-19T00:00:00.000Z", ends_at: "2026-09-26T00:00:00.000Z",
          success_condition: "四份材料通过校验", allowed_actions: ["prepare"], budget: { max_calls: 12 },
          prepare_hours: 24, escalate_hours: 2, version: 1, source_ref: "goal-history:goal-1:1", status: "active",
        }],
        opportunities: [{
          opportunity_id: "sha256:ready", shadow_opportunity_id: "goal-1:lesson", goal_id: "goal-1",
          work_case_id: "work_case_ready", logical_occurrence_key: "lesson:lesson", source_revision: "sha256:source",
          evidence_ids: ["event"], gap: "none", action: "act", reason: "prepare", current: true,
          valid_until: "2026-09-20T00:00:00.000Z", next_wakeup_at: null, recheck_on: [], fire_key: "sha256:fire",
          priority: { urgency: 90, impact: 85, evidence_quality: 60, risk: 10, interruption_cost: 10, compute_cost: 30, score: 700 },
          expected_satisfied: true,
        }],
        decisions: [],
        next_wakeup_at: null,
        attention_intents: [],
        external_send: false,
      },
    },
  });
  const html = renderToStaticMarkup(React.createElement(EduPiTodayWork, {
    data,
    onEducation: () => {},
    onTaskDetail: () => {},
  }));
  assert.match(html, /自动准备/);
  assert.match(html, /已准备好/);
  assert.match(html, /下周课程材料按时就绪/);
  assert.doesNotMatch(html, /priority-v1/);
  assert.doesNotMatch(html, /work_case_ready/);
  assert.doesNotMatch(html, /sha256:ready/);
});

test("Today records only explicitly rated usefulness in a verified class scope", () => {
  const candidate = { candidateId: "candidate-1", taskId: "task-1", revision: 0, evidenceIds: ["evidence-1"], sourceIds: ["source-1"], reason: "calendar_review" };
  const task = { id: "task-1", trigger: "teaching_before_class", topic: null, evidence: { class_id: "class-7b", subject: "math" } };
  const capture = feedbackCaptureFor(candidate, task, "accept", "useful", undefined, "2026-09-22T01:02:03.000Z");
  assert.equal(capture.domain, "teaching_preparation");
  assert.equal(capture.usefulness, "useful");
  assert.equal(capture.used, false);
  assert.equal(capture.wouldUseAgain, null);
  assert.equal(capture.occurredAt, "2026-09-22T01:02:03.000Z");
  assert.equal(feedbackCaptureFor(candidate, { ...task, trigger: "unknown" }, "accept", "useful"), null);
  for (const trigger of ["teaching_node_preparation", "exam_preparation", "calendar_event_preparation", "activity_preparation", "meeting_preparation", "holiday_preparation", "monthly_class_activity"]) {
    assert.equal(feedbackCaptureFor(candidate, { ...task, trigger }, "accept", "useful"), null, trigger);
  }
  assert.equal(feedbackCaptureFor(candidate, { ...task, evidence: {} }, "accept", "useful"), null);
  assert.equal(feedbackCaptureFor(candidate, { ...task, evidence: { class_id: "class-7b" } }, "accept", "useful"), null);
  assert.equal(feedbackCaptureFor({ ...candidate, evidenceIds: [], sourceIds: [] }, task, "accept", "useful"), null);
  assert.equal(feedbackCaptureFor(candidate, { ...task, evidence: { class_id: "wrong class", subject: "math" } }, "accept", "useful"), null);
  assert.match(capture.commandId, /^desktop-feedback-[a-f0-9-]{36}$/);
  assert.equal(feedbackCaptureFor(candidate, task, "accept", "unsafe")?.issueCodes?.[0], "safety");
});
