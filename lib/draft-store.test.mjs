import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const storage = new Map();
let quotaLimit = Infinity;
globalThis.window = {
  localStorage: {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { if (value.length > quotaLimit) throw new Error("QuotaExceededError"); storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  },
};

const { acknowledgeLocalQueueRecovery, completeStagedQueueRecovery, flushDraftNow, getDraft, markQueueRecoveryUncertain, resetNewSessionDraft, restoreFailedMessageDraft, setDraft, subscribeDraftPersistence } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./draft-store.ts");
const { composeTeacherMessage, createComposerContext } = await createJiti(import.meta.url).import("./edupi-composer-context.ts");

after(() => {
  delete globalThis.window;
});

test("the persistence cap keeps the most recently edited drafts", async () => {
  for (let index = 0; index < 41; index++) {
    setDraft(`session-${index}`, { value: `draft-${index}`, images: [] });
  }
  setDraft("session-0", { value: "edited-most-recently", images: [] });

  await new Promise((resolve) => setTimeout(resolve, 300));
  const persisted = JSON.parse(storage.get("pi-chat-drafts-v1"));
  assert.equal(Object.keys(persisted).length, 40);
  assert.equal(persisted["session-0"].value, "edited-most-recently");
  assert.equal(persisted["session-1"], undefined);
});

test("a page reference persists independently of teacher text and can be removed", async () => {
  const context = { title: "第一课备课", reference: "教学任务：第一课备课" };
  setDraft("context-only", { value: "", images: [], context });
  assert.deepEqual(getDraft("context-only")?.context, context);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(JSON.parse(storage.get("pi-chat-drafts-v1"))["context-only"].context, context);

  setDraft("context-only", { value: "老师自己的要求", images: [] });
  assert.equal(getDraft("context-only")?.context, undefined);
});

test("a pending teacher request survives reload without overwriting the current draft", async () => {
  setDraft("teacher-offer", { value: "原草稿", images: [], context: { title: "教学重点", reference: "教学重点" }, pendingTeacherText: "新要求" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const stored = JSON.parse(storage.get("pi-chat-drafts-v1"))["teacher-offer"];
  assert.equal(stored.value, "原草稿");
  assert.equal(stored.context.title, "教学重点");
  assert.equal(stored.pendingTeacherText, "新要求");
});

test("recalled queue and offered reference persist separately from the active draft", async () => {
  const offeredContext = { title: "学生档案", reference: "学生档案：李四" };
  setDraft("queue-offer", { value: "旧要求", images: [], offeredContext, pendingQueueMessages: ["后续消息甲", "后续消息乙"] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const saved = JSON.parse(storage.get("pi-chat-drafts-v1"))["queue-offer"];
  assert.deepEqual(saved.offeredContext, offeredContext);
  assert.deepEqual(saved.pendingQueueMessages, ["后续消息甲", "后续消息乙"]);
  assert.deepEqual(getDraft("queue-offer")?.pendingQueueMessages, ["后续消息甲", "后续消息乙"]);
});

test("storage quota keeps the newest fitting draft and reports an unsaved large draft", async () => {
  storage.clear();
  quotaLimit = 600;
  const results = [];
  const stop = subscribeDraftPersistence("quota-current", (saved) => results.push(saved));
  setDraft("quota-older", { value: "旧草稿必须保留", images: [] });
  setDraft("quota-current", { value: "最新的小草稿", images: [] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(JSON.parse(storage.get("pi-chat-drafts-v1"))["quota-current"].value, "最新的小草稿");
  assert.equal(results.at(-1), true);

  setDraft("quota-current", { value: "x".repeat(2_000), images: [] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(results.at(-1), false);
  assert.equal(getDraft("quota-current")?.value.length, 2_000);
  assert.equal(JSON.parse(storage.get("pi-chat-drafts-v1"))["quota-older"].value, "旧草稿必须保留");
  stop();
  quotaLimit = Infinity;
});

test("incomplete attachment or queue persistence is reported instead of marked saved", async () => {
  const results = [];
  const stop = subscribeDraftPersistence("partial-draft", (saved) => results.push(saved));
  setDraft("partial-draft", { value: "", images: [{ data: "x".repeat(540_000), mimeType: "image/png" }] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(results.at(-1), false);

  setDraft("partial-draft", { value: "", images: [], pendingQueueMessages: Array.from({ length: 51 }, (_, index) => `消息 ${index}`) });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(results.at(-1), false);
  stop();
});

test("a queue recovery draft is durable before a delayed write or immediate reload", () => {
  setDraft("immediate-queue", { value: "原草稿", images: [], pendingQueueMessages: ["未发送的后续消息"] });
  assert.equal(flushDraftNow("immediate-queue"), true);
  assert.deepEqual(JSON.parse(storage.get("pi-chat-drafts-v1"))["immediate-queue"].pendingQueueMessages, ["未发送的后续消息"]);
});

test("an idempotent server result completes the original draft before acknowledgment", () => {
  const id = "55555555-5555-4555-8555-555555555555";
  setDraft("server-recovery", { value: "原草稿", images: [], pendingQueueMessages: ["原消息"], pendingQueueRecoveryId: id, pendingQueuePrevious: [] });
  assert.equal(flushDraftNow("server-recovery"), true);
  assert.equal(completeStagedQueueRecovery("server-recovery", [], ["原消息", "新消息"], id), true);
  const saved = JSON.parse(storage.get("pi-chat-drafts-v1"))["server-recovery"];
  assert.deepEqual(saved.pendingQueueMessages, ["原消息", "新消息"]);
  assert.equal(saved.pendingQueueRecoveryId, id);
  assert.equal(saved.pendingQueueReadyToAck, true);
  assert.equal(saved.value, "原草稿");
  assert.equal(acknowledgeLocalQueueRecovery("server-recovery", id), true);
  assert.equal(getDraft("server-recovery")?.pendingQueueRecoveryId, undefined);
});

test("quota failure keeps the server recovery id and pre-clear backup for retry", () => {
  const id = "77777777-7777-4777-8777-777777777777";
  setDraft("quota-recovery", { value: "", images: [], pendingQueueMessages: ["原消息"], pendingQueueRecoveryId: id, pendingQueuePrevious: [] });
  assert.equal(flushDraftNow("quota-recovery"), true);
  const currentSize = storage.get("pi-chat-drafts-v1").length;
  quotaLimit = currentSize + 100;
  assert.equal(completeStagedQueueRecovery("quota-recovery", [], ["原消息", "新增".repeat(1_000)], id), false);
  const saved = JSON.parse(storage.get("pi-chat-drafts-v1"))["quota-recovery"];
  assert.deepEqual(saved.pendingQueueMessages, ["原消息"]);
  assert.equal(saved.pendingQueueRecoveryId, id);
  assert.equal(getDraft("quota-recovery")?.pendingQueueReadyToAck, undefined);
  assert.equal(getDraft("quota-recovery")?.pendingQueueRecoveryId, id);
  quotaLimit = Infinity;
});

test("a failed local ACK keeps the retry id in memory and on disk", () => {
  const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  setDraft("ack-rollback", { value: "", images: [], pendingQueueMessages: ["已保存"], pendingQueueRecoveryId: id, pendingQueuePrevious: [], pendingQueueReadyToAck: true });
  assert.equal(flushDraftNow("ack-rollback"), true);
  quotaLimit = 0;
  assert.equal(acknowledgeLocalQueueRecovery("ack-rollback", id), false);
  assert.equal(getDraft("ack-rollback")?.pendingQueueRecoveryId, id);
  assert.equal(getDraft("ack-rollback")?.pendingQueueReadyToAck, true);
  quotaLimit = Infinity;
});

test("an empty server queue preserves its staged message as an uncertain local copy", () => {
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  setDraft("uncertain-queue", { value: "", images: [], pendingQueueMessages: ["可能未投递"], pendingQueueRecoveryId: id, pendingQueuePrevious: [] });
  assert.equal(flushDraftNow("uncertain-queue"), true);
  assert.equal(markQueueRecoveryUncertain("uncertain-queue", id), true);
  const draft = getDraft("uncertain-queue");
  assert.deepEqual(draft?.pendingQueueMessages, ["可能未投递"]);
  assert.equal(draft?.pendingQueueUncertain, true);
  assert.equal(draft?.pendingQueueRecoveryId, undefined);
});

test("uncertain-state storage failure keeps its recovery id for retry", () => {
  const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  setDraft("uncertain-rollback", { value: "", images: [], pendingQueueMessages: ["待核对"], pendingQueueRecoveryId: id, pendingQueuePrevious: [] });
  assert.equal(flushDraftNow("uncertain-rollback"), true);
  quotaLimit = 0;
  assert.equal(markQueueRecoveryUncertain("uncertain-rollback", id), false);
  assert.equal(getDraft("uncertain-rollback")?.pendingQueueRecoveryId, id);
  quotaLimit = Infinity;
});

test("a failed prompt returns to its original draft without overwriting newer work", () => {
  const context = createComposerContext("学生档案：李四");
  const message = { role: "user", content: [
    { type: "text", text: composeTeacherMessage(context, "核对备注") },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
  ] };
  setDraft("failed-origin", { value: "后来写的草稿", images: [], pendingQueueMessages: ["已收回消息"] });
  assert.equal(restoreFailedMessageDraft("failed-origin", message), true);
  const draft = getDraft("failed-origin");
  assert.equal(draft?.value, "后来写的草稿");
  assert.deepEqual(draft?.pendingQueueMessages, ["已收回消息"]);
  assert.equal(draft?.pendingFailedMessages?.[0]?.value, "核对备注");
  assert.deepEqual(draft?.pendingFailedMessages?.[0]?.context, context);
  assert.equal(draft?.pendingFailedMessages?.[0]?.images[0]?.data, "AQID");
  assert.deepEqual(JSON.parse(storage.get("pi-chat-drafts-v1"))["failed-origin"].pendingFailedMessages[0].context, context);
});

test("a new-task reset keeps only visibly pending recovery, never the stale draft", () => {
  setDraft("new:teacher", { value: "旧草稿", images: [], pendingFailedMessages: [{ value: "先前新对话未发送", images: [], sourceLabel: "先前新对话" }] });
  resetNewSessionDraft("new:teacher");
  assert.equal(getDraft("new:teacher")?.value, "");
  assert.equal(getDraft("new:teacher")?.pendingFailedMessages?.[0]?.sourceLabel, "先前新对话");
});

test("a failed earlier new chat remains a separate pending item in the current blank chat", () => {
  setDraft("new:other", { value: "", images: [] });
  assert.equal(restoreFailedMessageDraft("new:other", { role: "user", content: "先前要求" }, { forcePending: true, sourceLabel: "先前新对话" }), true);
  assert.equal(getDraft("new:other")?.value, "");
  assert.equal(getDraft("new:other")?.pendingFailedMessages?.[0]?.value, "先前要求");
  assert.equal(getDraft("new:other")?.pendingFailedMessages?.[0]?.sourceLabel, "先前新对话");
});
