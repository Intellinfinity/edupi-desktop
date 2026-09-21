import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("mobile session projection omits paths and tool payloads", () => {
  const source = fs.readFileSync(new URL("./mobile-session.ts", import.meta.url), "utf8");
  assert.match(source, /deferThinking: true/);
  assert.match(source, /deferToolResultImages: true/);
  assert.match(source, /id: session\.id/);
  assert.doesNotMatch(source, /return \{[^}]*filePath/);
});
