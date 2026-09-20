import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("desktop runtime route exposes safe mode and diagnostics without secrets", () => {
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /isSafeModeEnabled/);
  assert.match(source, /readStartupDiagnostics/);
  assert.doesNotMatch(source, /process\.env\.PI_DESKTOP_API_TOKEN/);
});
