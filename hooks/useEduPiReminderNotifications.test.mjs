import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useEduPiReminderNotifications.ts", import.meta.url), "utf8");

test("notification lifecycle records delivery, failure, and opened targets", () => {
  assert.match(source, /notification_delivered[\s\S]*notification_failed/);
  assert.match(source, /notification_opened/);
  assert.match(source, /id: "\*"/);
  assert.match(source, /taskId: target\.taskId/);
});
