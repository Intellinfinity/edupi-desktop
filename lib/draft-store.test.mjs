import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  },
};

const { getDraft, setDraft } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./draft-store.ts");

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
