import assert from "node:assert/strict";
import test from "node:test";
import {createJiti} from "jiti";
const {foregroundNotificationPolicyMatchesNative, normalizeForegroundSettings, restoreForegroundSettings, writeForegroundSettings} = await createJiti(import.meta.url).import("./edupi-foreground-settings.ts");
test("display preferences default to three days and preserve only bounded task identities",()=>{
  assert.deepEqual(normalizeForegroundSettings(null),{graceDays:3,pinnedTaskIds:[],dismissedStaleTaskIds:[]});
  assert.deepEqual(normalizeForegroundSettings({graceDays:0,pinnedTaskIds:["task-a","task-a",false,"","task-b"],dismissedStaleTaskIds:["old-festival","old-festival"]}),{graceDays:0,pinnedTaskIds:["task-a","task-b"],dismissedStaleTaskIds:["old-festival"]});
  for(const graceDays of [-1,1.2,"3",NaN,366])assert.equal(normalizeForegroundSettings({graceDays}).graceDays,3);
  assert.equal(normalizeForegroundSettings({graceDays:365}).graceDays,365);
});
test("a late native read never overwrites a preference changed while it was loading", async () => {
  let resolve;
  const restore = restoreForegroundSettings(() => new Promise(done => { resolve = done; }));
  await writeForegroundSettings({graceDays:7,pinnedTaskIds:[]});
  resolve({graceDays:1,pinnedTaskIds:[]});
  assert.equal(await restore, false);
  assert.equal(await restoreForegroundSettings(async () => null), false);
});
test("a late native read cannot replace a newer selection written by another browser realm", async () => {
  const previous = globalThis.window;
  const storage = new Map([["edupi-foreground-grace-days", "3"], ["edupi-pinned-task-ids", "[]"]]);
  globalThis.window = {localStorage:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)},dispatchEvent(){}};
  try {
    let resolve;
    const restore = restoreForegroundSettings(() => new Promise(done => {resolve=done;}));
    storage.set("edupi-foreground-grace-days", "7");
    storage.set("edupi-pinned-task-ids", JSON.stringify(["synthetic-peer-pin"]));
    resolve({graceDays:3,pinnedTaskIds:[],dismissedStaleTaskIds:[]});
    assert.equal(await restore, false);
    assert.equal(storage.get("edupi-foreground-grace-days"), "7");
    assert.equal(storage.get("edupi-pinned-task-ids"), '["synthetic-peer-pin"]');
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});

test("notification policy refuses pending, failed, and mismatched native saves", async () => {
  const previous = globalThis.window;
  const storage = new Map([["edupi-foreground-grace-days", "0"], ["edupi-pinned-task-ids", "[]"]]);
  globalThis.window = {localStorage:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)},dispatchEvent(){}};
  try {
    assert.equal(await foregroundNotificationPolicyMatchesNative(async () => ({graceDays:3,pinnedTaskIds:[]})), false);
    assert.equal(await foregroundNotificationPolicyMatchesNative(async () => { throw new Error("native save failed"); }), false);
    assert.equal(await foregroundNotificationPolicyMatchesNative(() => new Promise(() => {})), false, "a stalled native read cannot hold a claimed reminder forever");
    let finish;
    const pending = foregroundNotificationPolicyMatchesNative(() => new Promise(resolve => { finish = resolve; }));
    storage.set("edupi-foreground-grace-days", "7");
    finish({graceDays:0,pinnedTaskIds:[]});
    assert.equal(await pending, false, "a local change during the native read invalidates the proof");
    assert.equal(await foregroundNotificationPolicyMatchesNative(async () => ({graceDays:7,pinnedTaskIds:[]})), true);
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});
