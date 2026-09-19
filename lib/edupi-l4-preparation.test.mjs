import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { normalizeL4Preparation, summarizeL4Preparation } = await jiti.import("./edupi-l4-preparation.ts");
const { buildEducationContract } = await jiti.import("./edupi-education-contract.ts");

const projection = {
  version: 1,
  policy_version: "priority-v1",
  generated_at: "2026-09-19T01:00:00.000Z",
  goals: [{
    id: "goal-1",
    text: "下周课程材料按时就绪",
    scope: { class_id: "class-7-1", subject: "数学" },
    starts_at: "2026-09-19T00:00:00.000Z",
    ends_at: "2026-09-26T00:00:00.000Z",
    success_condition: "四份材料通过校验",
    allowed_actions: ["prepare", "update"],
    budget: { max_calls: 12 },
    prepare_hours: 24,
    escalate_hours: 2,
    version: 1,
    source_ref: "goal-history:goal-1:1",
    status: "active",
  }],
  opportunities: [
    {
      opportunity_id: "sha256:opportunity-ready",
      shadow_opportunity_id: "goal-1:lesson-1",
      goal_id: "goal-1",
      work_case_id: "work_case_ready",
      logical_occurrence_key: "lesson:lesson-1",
      source_revision: "sha256:source",
      evidence_ids: ["event-1"],
      gap: "none",
      action: "act",
      reason: "prepare",
      current: true,
      valid_until: "2026-09-20T00:00:00.000Z",
      next_wakeup_at: "2026-09-19T02:00:00.000Z",
      recheck_on: [],
      fire_key: "sha256:fire",
      priority: { urgency: 90, impact: 85, evidence_quality: 60, risk: 10, interruption_cost: 10, compute_cost: 30, score: 700 },
      expected_satisfied: true,
    },
    {
      opportunity_id: "sha256:opportunity-attention",
      shadow_opportunity_id: "goal-1:lesson-2",
      goal_id: "goal-1",
      work_case_id: "work_case_attention",
      logical_occurrence_key: "lesson:lesson-2",
      source_revision: "sha256:source",
      evidence_ids: ["event-2"],
      gap: "missing_material",
      action: "escalate",
      reason: "missing_material",
      current: true,
      valid_until: "2026-09-20T00:00:00.000Z",
      next_wakeup_at: null,
      recheck_on: ["accepted_material"],
      fire_key: "sha256:fire-2",
      priority: { urgency: 100, impact: 100, evidence_quality: 40, risk: 10, interruption_cost: 70, compute_cost: 5, score: 565 },
      expected_satisfied: false,
    },
  ],
  decisions: [
    {
      decision_id: "sha256:decision",
      goal_id: "goal-1",
      opportunity_id: "sha256:opportunity-ready",
      action: "act",
      reason: "prepare",
      evidence_ids: ["event-1"],
      policy_version: "priority-v1",
      decided_at: "2026-09-19T01:00:00.000Z",
      next_wakeup_at: "2026-09-19T02:00:00.000Z",
      notify: false,
      apply: false,
    },
  ],
  next_wakeup_at: "2026-09-19T02:00:00.000Z",
  attention_intents: [{
    attention_intent_id: "sha256:attention",
    opportunity_id: "sha256:opportunity-attention",
    work_case_id: "work_case_attention",
    reason: "missing_material",
    created_at: "2026-09-19T01:00:00.000Z",
    delivery_policy: "desktop_only",
    deep_link: "edupi://today/work/work_case_attention",
    external_send: false,
  }],
  external_send: false,
};

test("normalizes the Core l4 projection without weakening its safety boundary", () => {
  const normalized = normalizeL4Preparation(projection);
  assert.equal(normalized.version, 1);
  assert.equal(normalized.goals[0].id, "goal-1");
  assert.equal(normalized.opportunities.length, 2);
  assert.equal(normalized.opportunities[0].workCaseId, "work_case_ready");
  assert.equal(normalized.decisions[0].apply, false);
  assert.equal(normalized.attentionIntents[0].deliveryPolicy, "desktop_only");
  assert.equal(normalized.externalSend, false);
  assert.equal(normalizeL4Preparation({ ...projection, external_send: true }), null);
  assert.equal(normalizeL4Preparation({ ...projection, decisions: [{ ...projection.decisions[0], apply: true }] }), null);
  assert.equal(normalizeL4Preparation({ ...projection, attention_intents: [{ ...projection.attention_intents[0], external_send: true }] }), null);
  assert.equal(normalizeL4Preparation({
    ...projection,
    goals: [{ ...projection.goals[0], budget: { max_calls: 1.5 } }],
  }), null);
  assert.equal(normalizeL4Preparation({
    ...projection,
    goals: [{ ...projection.goals[0], allowed_actions: ["prepare", "prepare"] }],
  }), null);
});

test("summarizes current preparation into teacher-facing groups", () => {
  const summary = summarizeL4Preparation(normalizeL4Preparation(projection));
  assert.deepEqual(summary.ready.map(item => item.workCaseId), ["work_case_ready"]);
  assert.deepEqual(summary.running.map(item => item.workCaseId), []);
  assert.deepEqual(summary.attention.map(item => item.workCaseId), ["work_case_attention"]);
  assert.equal(summary.ready[0].title, "下周课程材料按时就绪");
  assert.equal(summary.ready[0].statusLabel, "已准备好");
  assert.equal(summary.attention[0].statusLabel, "缺少材料");
  assert.equal(summary.nextWakeupAt, "2026-09-19T02:00:00.000Z");
});

test("projects l4 preparation into the Desktop education contract", () => {
  const contract = buildEducationContract({
    workspace: {
      students: [],
      timetable: [],
      calendar: [],
      tasks: [],
      continuity: {},
      l4_preparation: projection,
    },
  });
  assert.equal(contract.l4Preparation.opportunities.length, 2);
  assert.equal(contract.l4Preparation.decisions[0].apply, false);
  assert.equal(contract.l4Preparation.externalSend, false);
});
