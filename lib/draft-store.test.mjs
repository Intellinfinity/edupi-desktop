import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createJiti } from "jiti";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const storage = new Map();
const exitHandlers = new Map();
let quotaLimit = Infinity;
globalThis.window = {
  addEventListener(type, handler) { exitHandlers.set(type, handler); },
  localStorage: {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { if (value.length > quotaLimit) throw new Error("QuotaExceededError"); storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  },
};

const { acknowledgeLocalQueueRecovery, acknowledgePendingPrompt, clearDraft, completeStagedQueueRecovery, flushDraftNow, getDraft, markQueueRecoveryUncertain, releasePendingPromptForNewMessage, resetNewSessionDraft, restoreFailedMessageDraft, setDraft, stagePendingPrompt, subscribeDraftPersistence } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./draft-store.ts");
const composer = await createJiti(import.meta.url).import("./edupi-composer-context.ts");
const { appendComposerResource, composeTeacherMessage, createComposerContext } = composer;

after(() => {
  delete globalThis.window;
});

test("page exit flushes the last typed text and reference without waiting for debounce", () => {
  const context = appendComposerResource(null, {id:"synthetic-pagehide",kind:"material",title:"合成材料",reference:"Core材料引用"});
  setDraft("pagehide-flush", {value:"离开前刚输入的老师要求",images:[],context});
  exitHandlers.get("pagehide")?.();
  const saved = JSON.parse(storage.get("pi-chat-drafts-v1") || "{}")["pagehide-flush"];
  assert.equal(saved?.value, "离开前刚输入的老师要求");
  assert.deepEqual(saved.context, context);
});

test("a lost-response retry keeps its exact request identity across autosave and draft clear", () => {
  const key = "pending-prompt-identity";
  const pending = { sessionId: "session-1", clientRequestId: "66666666-6666-4666-8666-666666666666",
    occurredAt: "2026-10-10T00:00:00.000Z", message: "合成测试消息", draftValue: "合成测试消息" };
  setDraft(key, { value: pending.message, images: [] });
  assert.equal(stagePendingPrompt(key, pending), true);
  setDraft("pending-prompt-session-copy", { value: pending.message, images: [], pendingPrompt: pending });
  assert.equal(flushDraftNow("pending-prompt-session-copy"), true);
  assert.deepEqual(JSON.parse(storage.get("pi-chat-drafts-v1"))[key].pendingPrompt, pending);
  setDraft(key, { value: "已编辑内容", images: [] });
  assert.deepEqual(getDraft(key)?.pendingPrompt, pending);
  clearDraft(key);
  assert.deepEqual(getDraft(key)?.pendingPrompt, pending);
  assert.equal(stagePendingPrompt(key, { ...pending, clientRequestId: "77777777-7777-4777-8777-777777777777" }), false);
  acknowledgePendingPrompt(key, pending.clientRequestId);
  assert.equal(getDraft(key), null);
  assert.equal(getDraft("pending-prompt-session-copy")?.pendingPrompt, undefined);
  assert.equal(getDraft("pending-prompt-session-copy"), null);
  clearDraft("pending-prompt-session-copy");
});

test("explicit new-message override retains teacher text while removing the old identity", () => {
  const key = "pending-prompt-manual-override";
  const pending = { sessionId: "session-override", clientRequestId: "99999999-9999-4999-8999-999999999999",
    occurredAt: "2026-10-10T00:00:00.000Z", message: "原消息", draftValue: "原消息" };
  setDraft(key, { value: "原消息", images: [], pendingPrompt: pending });
  releasePendingPromptForNewMessage(key, pending.clientRequestId);
  assert.equal(getDraft(key)?.value, "原消息");
  assert.equal(getDraft(key)?.pendingPrompt, undefined);
  clearDraft(key);
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

test("unresolved send identities are pinned when newer drafts reach the storage cap", () => {
  const key = "pending-cap-pinned";
  const pending = { sessionId: "session-cap", clientRequestId: "88888888-8888-4888-8888-888888888888",
    occurredAt: "2026-10-10T00:00:00.000Z", message: "待核对", draftValue: "待核对" };
  setDraft(key, { value: pending.message, images: [] });
  assert.equal(stagePendingPrompt(key, pending), true);
  for (let index = 0; index < 50; index++) setDraft(`later-${index}`, { value: `内容-${index}`, images: [] });
  flushDraftNow("later-49");
  assert.deepEqual(JSON.parse(storage.get("pi-chat-drafts-v1"))[key]?.pendingPrompt, pending);
  acknowledgePendingPrompt(key, pending.clientRequestId);
  clearDraft(key);
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

const selectedResource = id => ({ id, kind: "material", title: id, reference: `定位：${id}\n仅供参考` });

function coldDraftStore() {
  const exports = {};
  const source = fs.readFileSync(new URL("./draft-store.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, {
    exports, window: globalThis.window, setTimeout, clearTimeout,
    require: name => name === "@/lib/edupi-composer-context" ? composer : {
      APP_PREF_KEYS: { chatDrafts: "pi-chat-drafts-v1" },
      getPrefJson: key => { const value = storage.get(key); return value ? JSON.parse(value) : null; },
      trySetPrefJson: (key, value) => { storage.set(key, JSON.stringify(value)); return true; },
    },
  });
  return exports;
}

test("resources-only new chats persist and cold-reload without leaking to another session", () => {
  let context = appendComposerResource(null, selectedResource("resource-a"));
  context = appendComposerResource(context, { ...selectedResource("resource-b"), kind: "knowledge" });
  setDraft("new:resource-chat", { value: "老师尚未发送的要求", images: [], context });
  setDraft("another-resource-session", { value: "另一个会话草稿", images: [], context: createComposerContext("另一个页面") });
  assert.equal(flushDraftNow("new:resource-chat"), true);
  const cold = coldDraftStore();
  assert.deepEqual(JSON.parse(JSON.stringify(cold.getDraft("new:resource-chat"))), { value: "老师尚未发送的要求", images: [], context });
  assert.equal(cold.getDraft("another-resource-session").context.resources, undefined);
  assert.equal(cold.getDraft("another-resource-session").value, "另一个会话草稿");
});

test("draft resource lists are cloned on input, retrieval, offers and failed-message recovery", () => {
  const context = appendComposerResource(createComposerContext("当前页面"), selectedResource("shared-resource"));
  setDraft("resource-clone-a", { value: "草稿甲", images: [], context, offeredContext: context, pendingFailedMessages: [{ value: "失败要求", images: [], context }] });
  setDraft("resource-clone-b", { value: "草稿乙", images: [], context });
  context.resources[0].reference = "外部对象变更";
  const retrieved = getDraft("resource-clone-a");
  retrieved.context.resources[0].reference = "读取结果变更";
  retrieved.offeredContext.resources[0].title = "offer变更";
  retrieved.pendingFailedMessages[0].context.resources.pop();
  const fresh = getDraft("resource-clone-a");
  assert.equal(fresh.context.resources[0].reference, "定位：shared-resource\n仅供参考");
  assert.equal(fresh.offeredContext.resources[0].title, "shared-resource");
  assert.equal(fresh.pendingFailedMessages[0].context.resources.length, 1);
  assert.equal(getDraft("resource-clone-b").context.resources[0].reference, "定位：shared-resource\n仅供参考");
});

test("queued and failed resource messages retain full selections during durable recovery", () => {
  const context = appendComposerResource(createComposerContext("当前材料页面"), selectedResource("queued-resource"));
  const queued = composeTeacherMessage(context, "排队要求");
  const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  setDraft("resource-recovery", { value: "保留的老师草稿", images: [], context, offeredContext: appendComposerResource(null, selectedResource("offer-resource")),
    pendingQueueMessages: [queued], pendingQueueRecoveryId: id, pendingQueuePrevious: [] });
  assert.equal(flushDraftNow("resource-recovery"), true);
  assert.equal(completeStagedQueueRecovery("resource-recovery", [], [queued], id), true);
  assert.equal(restoreFailedMessageDraft("resource-recovery", { role: "user", content: queued }), true);
  const cold = coldDraftStore().getDraft("resource-recovery");
  assert.equal(cold.value, "保留的老师草稿");
  assert.deepEqual(JSON.parse(JSON.stringify(cold.context)), context);
  assert.deepEqual(JSON.parse(JSON.stringify(cold.pendingFailedMessages[0].context)), context);
  assert.deepEqual([...cold.pendingQueueMessages], [queued]);
  assert.equal(cold.offeredContext.resources[0].id, "offer-resource");
});

test("invalid resource persistence is unsaved and cannot drop only the references while claiming success", () => {
  const previous = appendComposerResource(null, selectedResource("saved-resource"));
  setDraft("invalid-resource-draft", { value: "保留老师草稿", images: [], context: previous });
  assert.equal(flushDraftNow("invalid-resource-draft"), true);
  const oversized = { ...previous, resources: Array.from({ length: 21 }, (_, index) => selectedResource(`invalid-${index}`)) };
  setDraft("invalid-resource-draft", { value: "更新中的草稿", images: [], context: oversized });
  assert.equal(flushDraftNow("invalid-resource-draft"), false);
  assert.equal(getDraft("invalid-resource-draft").value, "更新中的草稿");
  assert.equal(getDraft("invalid-resource-draft").context.resources.length, 21);
  assert.equal(JSON.parse(storage.get("pi-chat-drafts-v1"))["invalid-resource-draft"].context.resources[0].id, "saved-resource");
});
