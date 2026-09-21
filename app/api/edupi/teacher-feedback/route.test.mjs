import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");

test("teacher feedback route keeps owner-control credentials server-side", () => {
  assert.match(source, /callOwnerControl/);
  assert.match(source, /owner_control/);
  assert.match(source, /teacher_feedback_target_read/);
  assert.match(source, /teacher_feedback_record/);
  assert.doesNotMatch(source, /ownerControlToken/);
  assert.match(source, /externalSend: false/);
});
