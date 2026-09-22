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
  occurredAt: "2026-09-22T01:02:03.000Z",
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
    assert.equal(new Headers(init?.headers).get("x-pi-desktop-token"), "trusted-desktop-token");
    return responses.shift();
  }, async () => new Headers({ "x-pi-desktop-token": "trusted-desktop-token" }));
  assert.equal(result.replayed, false);
  assert.deepEqual(calls.map((item) => item.action), ["record", "bootstrap", "record"]);
  assert.equal(calls[0].record.target.target_id, "candidate-1");
  assert.deepEqual(calls[0].record, calls[2].record, "owner bootstrap replays exact feedback bytes");
});

test("the same captured decision keeps its wire identity after an uncertain response", () => {
  assert.deepEqual(feedback.buildTeacherFeedbackRecord(input), feedback.buildTeacherFeedbackRecord(input));
  assert.throws(() => feedback.buildTeacherFeedbackRecord({ ...input, occurredAt: undefined }), (error) => error?.code === "invalid_feedback");
});

test("rejects empty evidence before making a request", () => {
  assert.throws(() => feedback.buildTeacherFeedbackRecord({ ...input, evidenceIds: [] }), (error) => error?.code === "invalid_feedback");
  assert.throws(() => feedback.buildTeacherFeedbackRecord({ ...input, scope: { classId: "class-7b", subject: "x".repeat(129) } }), (error) => error?.code === "invalid_feedback");
});
