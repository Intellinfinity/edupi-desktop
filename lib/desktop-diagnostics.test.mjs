import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "edupi-diagnostics-"));
process.env.PI_DESKTOP_STATE_DIR = root;
const jiti = createJiti(import.meta.url);
const { readStartupDiagnostics, recordStartupDiagnostic } = await jiti.import("./desktop-diagnostics.ts");

test("startup diagnostics persist only a hashed safe record", () => {
  const record = recordStartupDiagnostic({
    stage: "resource_loader",
    component: "third-party/plugin.ts",
    error: new Error("Bearer super-secret-token at /Users/teacher/private"),
    logPath: "/tmp/edupi/server.log",
  });
  assert.equal(record.stage, "resource_loader");
  assert.match(record.errorCode, /^START-[0-9a-f]{12}$/);
  assert.doesNotMatch(JSON.stringify(record), /super-secret|Bearer|private/);
  assert.equal(readStartupDiagnostics(1).length, 1);
  assert.match(readFileSync(join(root, "startup-diagnostics.jsonl"), "utf8"), /resource_loader/);
});
