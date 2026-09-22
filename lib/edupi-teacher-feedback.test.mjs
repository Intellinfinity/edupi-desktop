import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const feedback = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-teacher-feedback.ts");

const input = {
  commandId: "feedback-command-1",
  sessionId: "teacher-trial-1",
  domain: "teaching_preparation",
  scope: { classId: "class-7b", subject: "math" },
  target: { kind: "work_candidate", targetId: "candidate-1", expectedRevision: 2, expectedFingerprint: `sha256:${"a".repeat(64)}` },
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
  assert.deepEqual(record.target, { kind: "work_candidate", target_id: "candidate-1", expected_revision: 2, expected_fingerprint: `sha256:${"a".repeat(64)}` });
  assert.equal("root_ref" in record, false);
  assert.equal("expected_owner_id" in record, false);
});

test("bootstraps an inactive owner before binding the target and recording", async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ ok: false, errorCode: "owner_uninitialized" }), { status: 409 }),
    new Response(JSON.stringify({ ok: true, result: { owner_id: "owner-1" } }), { status: 200 }),
    new Response(JSON.stringify({ ok: true, result: { kind: "work_candidate", target_id: "candidate-1", revision: 2, fingerprint: `sha256:${"a".repeat(64)}`, domain: "teaching_preparation", scope: { class_id: "class-7b", subject: "math" }, evidence_ids: ["evidence-1"] } }), { status: 200 }),
    new Response(JSON.stringify({ ok: true, result: { feedback_id: `sha256:${"a".repeat(64)}`, replayed: false, current: true } }), { status: 200 }),
  ];
  const fetcher = async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    assert.equal(new Headers(init?.headers).get("x-pi-desktop-token"), "trusted-desktop-token");
    return responses.shift();
  };
  const headersProvider = async () => new Headers({ "x-pi-desktop-token": "trusted-desktop-token" });
  const bound = await feedback.prepareTeacherFeedbackCapture({ ...input, scope: null, target: { kind: "work_candidate", targetId: "candidate-1" } }, fetcher, headersProvider);
  const result = await feedback.recordTeacherFeedback(bound, fetcher, headersProvider);
  assert.equal(result.replayed, false);
  assert.deepEqual(calls.map((item) => item.action), ["target_read", "bootstrap", "target_read", "record"]);
  assert.deepEqual(calls[3].record.target, { kind: "work_candidate", target_id: "candidate-1", expected_revision: 2, expected_fingerprint: `sha256:${"a".repeat(64)}` });
  assert.deepEqual(calls[3].record.scope, { class_id: "class-7b", subject: "math" });
});

test("unverified and mismatched Core scopes never become teacher metrics", async () => {
  const target = { kind: "work_candidate", target_id: "candidate-1", revision: 2, fingerprint: `sha256:${"a".repeat(64)}`, evidence_ids: ["evidence-1"], domain: "teaching_preparation", scope: { class_id: "class-7b", subject: "math" } };
  for (const [capture, resolved] of [
    [{ ...input, scope: null }, { ...target, scope: null }],
    [{ ...input, scope: null }, { ...target, domain: "student_followup" }],
    [{ ...input, scope: { classId: "class-wrong", subject: "math" } }, target],
    [{ ...input, scope: null }, { kind: target.kind, target_id: target.target_id, revision: target.revision, fingerprint: target.fingerprint, evidence_ids: target.evidence_ids }],
  ]) {
    await assert.rejects(() => feedback.prepareTeacherFeedbackCapture(capture, async () => new Response(JSON.stringify({ ok: true, result: resolved })), async () => new Headers()), (error) => error?.code === "teacher_feedback_target_stale");
  }
  assert.throws(() => feedback.buildTeacherFeedbackRecord({ ...input, scope: null }), (error) => error?.code === "invalid_feedback");
});

test("does not attribute a rating to a candidate revised after review", async () => {
  const targetRead = new Response(JSON.stringify({ ok: true, result: { kind: "work_candidate", target_id: "candidate-1", revision: 3, fingerprint: `sha256:${"a".repeat(64)}`, domain: "teaching_preparation", scope: { class_id: "class-7b", subject: "math" }, evidence_ids: ["evidence-1"] } }), { status: 200 });
  await assert.rejects(() => feedback.prepareTeacherFeedbackCapture({ ...input, reviewedRevision: 2 }, async () => targetRead, async () => new Headers()), (error) => error?.code === "teacher_feedback_target_stale");
});

test("G6 refuses feedback outside the target's verified domain or scope", async () => {
  for (const change of [
    { domain: null },
    { domain: "student_followup" },
    { scope: null },
    { scope: { class_id: "class-8a", subject: "math" } },
    { scope: { class_id: "class-7b", subject: "science" } },
  ]) {
    const result = { kind: "work_candidate", target_id: "candidate-1", revision: 2, fingerprint: `sha256:${"a".repeat(64)}`, domain: "teaching_preparation", scope: { class_id: "class-7b", subject: "math" }, evidence_ids: ["evidence-1"], ...change };
    await assert.rejects(
      () => feedback.prepareTeacherFeedbackCapture(input, async () => new Response(JSON.stringify({ ok: true, result })), async () => new Headers()),
      (error) => error?.code === "teacher_feedback_target_stale",
    );
  }
});

test("a temporary target-read failure remains retryable without accepting an unverified target", async () => {
  const capture = { ...input, scope: null, target: { kind: "work_candidate", targetId: "candidate-1" } };
  const headers = async () => new Headers({ "x-pi-desktop-token": "trusted-desktop-token" });
  await assert.rejects(() => feedback.prepareTeacherFeedbackCapture(capture,
    async () => new Response(JSON.stringify({ ok: false }), { status: 503 }), headers),
  (error) => error?.code === "feedback_runtime_unavailable");
  const verified = await feedback.prepareTeacherFeedbackCapture(capture,
    async () => new Response(JSON.stringify({ ok: true, result: {
      kind: "work_candidate", target_id: "candidate-1", revision: 2, fingerprint: `sha256:${"a".repeat(64)}`,
      evidence_ids: ["evidence-1"], domain: "teaching_preparation", scope: { class_id: "class-7b", subject: "math" },
    } })), headers);
  assert.deepEqual(verified.scope, { classId: "class-7b", subject: "math" });
  assert.equal(feedback.canRetryFeedbackEligibility(new feedback.TeacherFeedbackError("feedback_runtime_unavailable", "temporarily unavailable")), true);
  assert.equal(feedback.canRetryFeedbackEligibility(new feedback.TeacherFeedbackError("owner_control_credential_unavailable", "credential unavailable")), true);
  assert.equal(feedback.canRetryFeedbackEligibility(new feedback.TeacherFeedbackError("teacher_feedback_target_stale", "stale")), false);
  assert.equal(feedback.canRetryFeedbackEligibility(new Error("network failed")), true);
});

test("feedback requests have a deadline, while leaving retries to the teacher", async () => {
  const headers = async () => new Headers({ "x-pi-desktop-token": "trusted-desktop-token" });
  const pending = (_url, init) => new Promise((_resolve, reject) => {
    assert.ok(init.signal, "the request must carry an abort signal");
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  await assert.rejects(() => feedback.prepareTeacherFeedbackCapture(input, pending, headers, 15), { name: "AbortError" });
  await assert.rejects(() => feedback.recordTeacherFeedback(input, pending, headers, 15), { name: "AbortError" });
  const never = () => new Promise(() => {});
  const stalledToken = await Promise.race([
    feedback.prepareTeacherFeedbackCapture(input, pending, never, 15).then(() => "resolved", (error) => error.name),
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 50)),
  ]);
  assert.equal(stalledToken, "AbortError", "a hung native token read must not hide the retry indefinitely");
});

test("the same bound command survives an uncertain response without a second target read", async () => {
  assert.deepEqual(feedback.buildTeacherFeedbackRecord(input), feedback.buildTeacherFeedbackRecord(input));
  assert.throws(() => feedback.buildTeacherFeedbackRecord({ ...input, occurredAt: undefined }), (error) => error?.code === "invalid_feedback");
  const calls = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    return calls.length === 1 ? new Response(JSON.stringify({ ok: false, errorCode: "feedback_runtime_unavailable" }), { status: 503 })
      : new Response(JSON.stringify({ ok: true, result: { feedback_id: `sha256:${"b".repeat(64)}`, replayed: true, current: true } }), { status: 200 });
  };
  const headers = async () => new Headers({ "x-pi-desktop-token": "trusted-desktop-token" });
  await assert.rejects(() => feedback.recordTeacherFeedback(input, fetcher, headers));
  assert.equal((await feedback.recordTeacherFeedback(input, fetcher, headers)).replayed, true);
  assert.deepEqual(calls.map((item) => item.action), ["record", "record"]);
  assert.deepEqual(calls[0], calls[1]);
});

test("rejects empty evidence before making a request", () => {
  assert.throws(() => feedback.buildTeacherFeedbackRecord({ ...input, target: { kind: "work_candidate", targetId: "candidate-1" } }), (error) => error?.code === "invalid_feedback");
  assert.throws(() => feedback.buildTeacherFeedbackRecord({ ...input, evidenceIds: [] }), (error) => error?.code === "invalid_feedback");
  assert.throws(() => feedback.buildTeacherFeedbackRecord({ ...input, scope: { classId: "class-7b", subject: "x".repeat(129) } }), (error) => error?.code === "invalid_feedback");
});
