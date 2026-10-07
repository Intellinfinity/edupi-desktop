import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { emptyMessageHistory, messageHistoryReducer: reduce } = await createJiti(import.meta.url).import("./agent-message-history.ts");
const user = text => ({ role: "user", content: text, timestamp: 1000 });
const assistant = { role: "assistant", content: [{ type: "text", text: "synthetic answer" }] };
const complete = (history, message, entryId, requestId) => reduce(history, { type: "completed", message, entryId, requestId });

test("system declarations never occupy a chat row or displace an optimistic prompt", () => {
  let history = reduce(emptyMessageHistory(), { type: "optimistic", message: user("same minute"), requestId: "send-1" });
  const before = history;
  history = complete(history, { role: "system", content: "loadout" }, "system-1", "send-1");
  assert.equal(history, before);
  history = complete(history, { ...user("same minute"), content: [{ type: "text", text: "same minute" }] }, "user-1", "send-1");
  assert.equal(history.messages.length, 1);
  assert.deepEqual(history.entryIds, ["user-1"]);
});

test("a transformed prompt replaces its own optimistic row after interleaved messages", () => {
  let history = reduce(emptyMessageHistory(), { type: "optimistic", message: user("/synthetic"), requestId: "send-1" });
  history = complete(history, assistant, "assistant-1");
  history = complete(history, user("expanded template"), "user-1", "send-1");
  assert.deepEqual(history.messages.map(message => message.role), ["user", "assistant"]);
  assert.equal(history.messages[0].content, "expanded template");
  assert.deepEqual(history.entryIds, ["user-1", "assistant-1"]);
});

test("replayed SSE entries do not duplicate users, assistant replies or tool results", () => {
  let history = emptyMessageHistory();
  for (const [message, id] of [[user("synthetic prompt"), "user-1"], [assistant, "assistant-1"], [{ role: "toolResult", toolCallId: "call-1", content: [] }, "tool-1"]]) {
    history = complete(history, message, id);
    const before = history;
    history = complete(history, structuredClone(message), id);
    assert.equal(history, before, "the persisted identity survives JSON replay");
  }
  assert.equal(history.messages.length, 3);
  assert.deepEqual(history.entryIds, ["user-1", "assistant-1", "tool-1"]);
});

test("reload and reconcile snapshots consume deliveries already present on disk", () => {
  let history = reduce(emptyMessageHistory(), { type: "optimistic", message: user("synthetic prompt"), requestId: "send-1" });
  history = reduce(history, { type: "replace", messages: [user("synthetic prompt"), assistant], entryIds: ["user-1", "assistant-1"] });
  history = complete(history, user("synthetic prompt"), "user-1", "send-1");
  history = complete(history, assistant, "assistant-1", "send-1");
  assert.equal(history.messages.length, 2);
  assert.deepEqual(history.entryIds, ["user-1", "assistant-1"]);
});

test("an intentional repeated prompt and same-text queue delivery keep their own identities", () => {
  let history = emptyMessageHistory();
  for (const id of ["1", "2"]) {
    history = reduce(history, { type: "optimistic", message: user("identical text"), requestId: `send-${id}` });
    history = complete(history, user("identical text"), `user-${id}`, `send-${id}`);
  }
  history = complete(history, user("identical text"), "user-queued", "send-2");
  assert.equal(history.messages.length, 3, "even identical text and timestamps do not merge different deliveries");
  assert.deepEqual(history.entryIds, ["user-1", "user-2", "user-queued"]);
});

test("startup failure removes only the submitted optimistic row", () => {
  let history = complete(emptyMessageHistory(), user("identical text"), "old-user");
  history = reduce(history, { type: "optimistic", message: user("identical text"), requestId: "failed-send" });
  history = complete(history, assistant, "assistant-1");
  history = reduce(history, { type: "remove_optimistic", requestId: "failed-send" });
  assert.deepEqual(history.entryIds, ["old-user", "assistant-1"]);
});
