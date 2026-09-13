import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
test("the desktop cold start ensures the DingTalk Stream runtime without blocking web mode", () => {
  assert.match(source, /if \(!desktopMode\) return/);
  assert.match(source, /\/api\/edupi\/connectors\/dingtalk\/runtime/);
  assert.match(source, /JSON\.stringify\(\{ action: "ensure" \}\)/);
});

test("desktop startup, reconnect, visibility, and native resume share one Core catch-up", () => {
  assert.match(source, /createDesktopCatchUpCoordinator/);
  assert.match(source, /listenDesktopResumeNative\(\(\) => catchUp\.trigger\(true\)\)/);
  assert.match(source, /window\.addEventListener\("online", recoverOnline\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", refreshVisible\)/);
  assert.match(source, /catchUp\.dispose\(\)/);
  assert.match(source, /\/api\/edupi\/preparation/);
});
