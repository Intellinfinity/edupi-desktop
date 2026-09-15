import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { normalizeTeachingSkillLifecycle } = await createJiti(import.meta.url).import("./edupi-platform-client.ts");

test("normalizes the real teaching skill lifecycle and distinguishes empty from unavailable", () => {
  assert.deepEqual(normalizeTeachingSkillLifecycle(null), { status: "unavailable", generatedAt: null, mutationEnabled: false, skills: [], teacherGrowth: [], mutationReceipts: [] });
  assert.equal(normalizeTeachingSkillLifecycle({ projection_kind: "teaching_skill_lifecycle", external_send: false, generated_at: "2026-09-06T00:00:00.000Z", skills: [] }).status, "empty");
  const ready = normalizeTeachingSkillLifecycle({ projection_kind: "teaching_skill_lifecycle", external_send: false, generated_at: "2026-09-06T10:00:00.000Z", skills: [{ skill_id: "skill-1", title: "错因追问", lifecycle_state: "trial", trial_count: 3, can_reuse: false, evidence_ids: ["evidence-1"], updated_at: "2026-09-06T09:00:00.000Z" }] });
  assert.deepEqual(ready, { status: "ready", generatedAt: "2026-09-06T10:00:00.000Z", mutationEnabled: false, skills: [{ skillId: "skill-1", title: "错因追问", lifecycleState: "trial", trialCount: 3, canReuse: false, evidenceIds: ["evidence-1"], updatedAt: "2026-09-06T09:00:00.000Z", origin: null, revision: null, contentRevision: null, availableActions: [] }], teacherGrowth: [], mutationReceipts: [] });
});

test("only an explicit mutation capability enables editing", () => {
  for (const flag of [undefined, false, "true", true]) {
    const projection = normalizeTeachingSkillLifecycle({ projection_kind: "teaching_skill_lifecycle", external_send: false, mutation_enabled: flag, skills: [{skill_id:"published",can_reuse:true}] });
    assert.equal(projection.mutationEnabled, flag === true);
    assert.equal(projection.skills[0].canReuse, true);
  }
});

test("method details retain evidence and only workspace-relative preview files", () => {
  const result = normalizeTeachingSkillLifecycle({ projection_kind: "teaching_skill_lifecycle", external_send: false, skills: [{ skill_id: "detail", details: { content: "方法正文", approval: { status: "accepted", feedback: "已审核" }, evaluation: { baseline: 0.5, candidate: 0.8, heldout: 0.7, eligible: true }, trials: [{ outcome: "routed", prompt: "真实请求", evidence: ["session:1"] }], files: [{ label: "产物", relative_path: ".edupi/output/trial.md" }, { relative_path: "/private/secret" }, { relative_path: "../outside" }, { relative_path: "C:\\private" }] } }] });
  const details = result.skills[0].details;
  assert.equal(details.content, "方法正文");
  assert.equal(details.evaluation.heldout, 0.7);
  assert.equal(details.trials[0].outcome, "routed");
  assert.deepEqual(details.files, [{ label: "产物", relativePath: ".edupi/output/trial.md" }]);
});

test("managed methods expose bounded actions, task-linked trials, growth and mutation receipts", () => {
  const result = normalizeTeachingSkillLifecycle({ projection_kind: "teaching_skill_lifecycle", projection_version: 2, external_send: false, mutation_enabled: true, skills: [{ skill_id: "method-1", title: "错因分组", lifecycle_state: "trial", trial_count: 1, can_reuse: false, evidence_ids: ["e-1"], origin: "managed", revision: 2, content_revision: 1, available_actions: ["update", "record_trial", "unknown"], details: { content: "方法正文", retirement_reason: null, trials: [{ trial_id: "trial-1", content_revision: 1, task_id: "task-1", task_title: "单元检测", at: "2026-09-15T01:00:00.000Z", outcome: "helpful", prompt: "反馈", evidence: ["e-1"], artifact_ids: ["artifact-1"] }], files: [] } }], teacher_growth: [{ growth_id: "growth-1", method_id: "method-1", method_title: "错因分组", content_revision: 1, task_id: "task-1", task_title: "单元检测", outcome: "helpful", feedback: "反馈", evidence_ids: ["e-1"], artifact_ids: ["artifact-1"], recorded_at: "2026-09-15T01:00:00.000Z" }], mutation_receipts: [{ request_id: "request-1", action: "record_trial", method_id: "method-1", revision: 2, content_revision: 1, status: "trial", trial_id: "trial-1" }] });
  assert.deepEqual(result.skills[0].availableActions, ["update", "record_trial"]);
  assert.equal(result.skills[0].details.trials[0].taskId, "task-1");
  assert.equal(result.teacherGrowth[0].feedback, "反馈");
  assert.equal(result.mutationReceipts[0].requestId, "request-1");
});
