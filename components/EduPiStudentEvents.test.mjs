import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("student event history restores an old version through the current revision", async () => {
  const source = await readFile(new URL("./EduPiStudentEvents.tsx", import.meta.url), "utf8");
  assert.match(source, /修改历史/);
  assert.match(source, /version\.topic/);
  assert.match(source, /version\.observed_on/);
  assert.match(source, /恢复此版本/);
  assert.match(source, /save\(\{\.\.\.item,summary:version\.summary,topic:version\.topic,observed_on:version\.observed_on\},"update_event"\)/);
});
