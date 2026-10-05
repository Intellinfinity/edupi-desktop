import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const helper = await jiti.import("./edupi-today-work.ts");
const { buildEducationContract } = await jiti.import("./edupi-education-contract.ts");

const candidate = {
  candidateId: "today-candidate",
  taskId: "today-candidate",
  snapshotId: "snapshot-today",
  stateHash: "sha256:today-state",
  revision: 2,
  title: "准备课堂反馈",
  summary: "整理课堂反馈并保留来源",
  dueAt: "2026-09-03",
  reason: "校历节奏规则 fixture 触发",
  sourceIds: ["today-candidate"],
  evidenceIds: ["today-evidence"],
  status: "pending_review",
  snoozeUntil: null,
  suppressionScope: null,
  nextCycleState: "awaiting_teacher",
  teacherReview: { state: "pending_review", reviewerId: null, reviewedAt: null, note: null, revision: 2 },
  externalSend: false,
};

const refreshedData = { ...buildEducationContract({ workspace: "/tmp/edupi-today-work" }), refreshed: true };

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function reviewInput(overrides = {}) {
  return { candidate, decision: "accept", ...overrides };
}

test("builds the exact Today POST body and trusts only a valid receipt/data response", async () => {
  const calls = [];
  const data = { ...refreshedData, marker: "trusted" };
  const result = await helper.submitTodayWorkReview(reviewInput({ note: "确认" }), async (url, init) => {
    calls.push({ url, init });
    return response({ receipt: { receipt_id: "receipt-today" }, data });
  });
  assert.deepEqual(result.data, data);
  assert.equal(result.receiptId, "receipt-today");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/edupi/education");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    commandType: "review_work_candidate",
    candidateId: "today-candidate",
    expectedSnapshotId: "snapshot-today",
    expectedRevision: 2,
    decision: "accept",
    note: "确认",
  });
  assert.equal(helper.getTodayWorkMutationSnapshot(), false);
});

test("malformed and failed responses release the shared lock and ignore raw reason text", async () => {
  for (const body of [
    { code: "unavailable", reason: "DO NOT DISPLAY THIS" },
    { code: "invalid_envelope", reason: "DO NOT DISPLAY THIS" },
    { receipt: { receipt_id: "" }, data: refreshedData },
    { receipt: { receipt_id: "receipt-only" }, data: null },
    { receipt: { receipt_id: "receipt-empty-work" }, data: { workCandidates: [] } },
  ]) {
    await assert.rejects(helper.submitTodayWorkReview(reviewInput(), async () => response(body, body.code ? 503 : 200)), (error) => {
      assert.notEqual(error.code, "busy");
      assert.doesNotMatch(error.message, /DO NOT DISPLAY THIS/);
      assert.doesNotMatch(error.message, /没有写入/);
      return true;
    });
    assert.equal(helper.getTodayWorkMutationSnapshot(), false);
  }
  assert.equal(helper.todayWorkErrorMessage("unavailable"), "审核结果未能确认，请刷新任务后核对。");
  assert.equal(helper.todayWorkErrorMessage("malformed"), "审核结果未能确认，请刷新任务后核对。");
});

test("a delayed request exposes one module-level busy lock across a simulated remount", async () => {
  const gate = deferred();
  const calls = [];
  const first = helper.submitTodayWorkReview(reviewInput(), async (url) => {
    calls.push(url);
    return gate.promise;
  });
  await Promise.resolve();
  assert.equal(helper.getTodayWorkMutationSnapshot(), true);
  let notifications = 0;
  const unsubscribe = helper.subscribeTodayWorkMutation(() => { notifications += 1; });
  assert.equal(helper.getTodayWorkMutationSnapshot(), true);
  await assert.rejects(helper.submitTodayWorkReview(reviewInput({ decision: "hold" }), async () => {
    calls.push("unexpected-second-fetch");
    return response({ receipt: { receipt_id: "never" }, data: refreshedData });
  }), (error) => error.code === "busy");
  assert.deepEqual(calls, ["/api/edupi/education"]);
  gate.resolve(response({ receipt: { receipt_id: "receipt-delayed" }, data: refreshedData }));
  await first;
  unsubscribe();
  assert.equal(helper.getTodayWorkMutationSnapshot(), false);
  assert.equal(notifications > 0, true);
});

test("stale responses refresh exactly once while locked and carry the refreshed contract", async () => {
  const calls = [];
  await assert.rejects(helper.submitTodayWorkReview(reviewInput(), async (url, init) => {
    calls.push({ url, init, busy: helper.getTodayWorkMutationSnapshot() });
    if (init?.method === "GET") return response({ ...refreshedData, refreshed: "stale-reconciliation" });
    return response({ code: "stale_snapshot", reason: "RAW BACKEND REASON" }, 409);
  }), (error) => {
    assert.equal(error.code, "stale_snapshot");
  assert.equal(error.data.refreshed, "stale-reconciliation");
  assert.equal(error.message, helper.todayWorkErrorMessage("stale_snapshot"));
    return true;
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[1].init.cache, "no-store");
  assert.equal(calls.every((call) => call.busy), true);
  assert.equal(helper.getTodayWorkMutationSnapshot(), false);
});

test("editor identity accepts only the exact actionable candidate and enabled capability", () => {
  const editor = { candidateId: candidate.candidateId, snapshotId: candidate.snapshotId, revision: candidate.revision, mode: "modify" };
  assert.equal(helper.isTodayWorkEditorCurrent(editor, [candidate], true), true);
  assert.equal(helper.isTodayWorkEditorCurrent(editor, [{ ...candidate, snapshotId: "snapshot-new" }], true), false);
  assert.equal(helper.isTodayWorkEditorCurrent(editor, [{ ...candidate, revision: 3 }], true), false);
  assert.equal(helper.isTodayWorkEditorCurrent(editor, [{ ...candidate, status: "accepted" }], true), false);
  assert.equal(helper.isTodayWorkEditorCurrent(editor, [], true), false);
  assert.equal(helper.isTodayWorkEditorCurrent(editor, [candidate], false), false);
  assert.equal(helper.isTodayWorkEditorCurrent(editor, [{ ...candidate, status: "held" }], true), true);
  assert.equal(helper.isTodayWorkEditorCurrent(editor, [{ ...candidate, status: "snoozed" }], true), true);
});

test("failure disposition closes stale editors but preserves ordinary-failure editors", () => {
  assert.equal(helper.todayWorkFailureDisposition("stale_snapshot"), "close");
  assert.equal(helper.todayWorkFailureDisposition("stale_revision"), "close");
  assert.equal(helper.todayWorkFailureDisposition("invalid_envelope"), "preserve");
  assert.equal(helper.todayWorkFailureDisposition("unavailable"), "preserve");
  assert.equal(helper.todayWorkFailureDisposition("malformed"), "preserve");
});
