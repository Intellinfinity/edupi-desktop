import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");

test("teacher feedback route keeps owner-control credentials server-side", () => {
  assert.match(source, /export async function GET\(request: Request\)/);
  assert.match(source, /if \(!isApiRequestAllowed\(request\)\)/);
  assert.match(source, /callOwnerControl/);
  assert.match(source, /owner_control/);
  assert.match(source, /teacher_feedback_target_read/);
  assert.match(source, /teacher_feedback_record/);
  assert.doesNotMatch(source, /ownerControlToken/);
  assert.match(source, /externalSend: false/);
});

test("teacher feedback route rejects non-object JSON before Core dispatch", () => {
  assert.match(source, /function asRecord\(value: unknown\)/);
  assert.match(source, /if \(!body\) return jsonError\("反馈操作无效", 400\)/);
});
