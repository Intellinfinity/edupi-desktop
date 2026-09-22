import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const feedback = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-teacher-feedback.ts");

const input = {
  commandId: "feedback-command-1",
  sessionId: "teacher-trial-1",
  domain: "teaching_preparation",
  scope: { classId: "class-7b", subject: "math" },
  target: { kind: "work_candidate", targetId: "candidate-1" },
  decision: "accept",
  usefulness: "useful",
  used: true,
  wouldUseAgain: true,
  evidenceIds: ["evidence-1"],
};

test("builds a surfaced feedback record without accepting Core identity fields", () => {
  const record = feedback.buildTeacherFeedbackRecord(input);
  assert.equal(record.signal, "surfaced");
  assert.equal(record.evidence_level, "real_teacher");
  assert.deepEqual(record.target, { kind: "work_candidate", target_id: "candidate-1" });
  assert.equal("root_ref" in record, false);
  assert.equal("expected_owner_id" in record, false);
});

test("bootstraps an inactive owner once and replays the same command safely", async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ ok: false, errorCode: "owner_uninitialized" }), { status: 409 }),
    new Response(JSON.stringify({ ok: true, result: { owner_id: "owner-1" } }), { status: 200 }),
    new Response(JSON.stringify({ ok: true, result: { feedback_id: `sha256:${"a".repeat(64)}`, replayed: false, current: true } }), { status: 200 }),
  ];
  const result = await feedback.recordTeacherFeedback(input, async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return responses.shift();
  });
  assert.equal(result.replayed, false);
  assert.deepEqual(calls.map((item) => item.action), ["record", "bootstrap", "record"]);
  assert.equal(calls[0].record.target.target_id, "candidate-1");
});

test("rejects empty evidence before making a request", () => {
  assert.throws(() => feedback.buildTeacherFeedbackRecord({ ...input, evidenceIds: [] }), (error) => error?.code === "invalid_feedback");
});
