import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("startup reminder bypasses an old release cache once, then returns to scheduled checks", async () => {
  const source = await readFile(new URL("./UpdateReminder.tsx", import.meta.url), "utf8");
  assert.match(source, /let forceRefresh = true/);
  assert.match(source, /fetch\(appUpdateRequestUrl\(forceRefresh\)/);
  const parsed = source.indexOf("await response.json()");
  const reset = source.indexOf('if (!hasAppUpdateCheckError(data, "edupi-desktop")) forceRefresh = false');
  assert.ok(parsed >= 0 && reset > parsed, "the startup force flag must clear only after a successful response");
});
