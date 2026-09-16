import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppSettings.tsx", import.meta.url), "utf8");

test("settings exposes manual update checks and the signed installer action", () => {
  assert.match(source, /appSettings\.checkUpdates/);
  assert.match(source, /fetch\("\/api\/updates\?refresh=1"/);
  assert.match(source, /hasAppUpdateCheckError\(data, "edupi-desktop"\)/);
  assert.match(source, /installLatestDesktopRelease/);
  assert.match(source, /desktopUpgradeErrorMessage\(error\)/);
  assert.match(source, /appSettings\.update/);
});

test("settings keeps its header separate from the scrollable content", () => {
  assert.match(source, /height: "min\(720px, calc\(100vh - 36px\)\)"/);
  assert.match(source, /className="native-modal-header" style=\{\{ display: "flex", flexShrink: 0/);
  assert.match(source, /<div style=\{\{ minHeight: 0, flex: 1, overflowY: "auto"/);
  assert.doesNotMatch(source, /appSettings\.taglineDetails/);
  assert.doesNotMatch(source, /<MetaChip/);
});

test("computer-use permissions can be rechecked and recovered after a system grant", () => {
  assert.match(source, /getComputerUseStatusNative\(\)/);
  assert.match(source, />重新检测<\/button>/);
  assert.match(source, />打开辅助功能设置<\/button>/);
  assert.match(source, />打开屏幕录制设置<\/button>/);
  assert.match(source, />重启 EduPi<\/button>/);
  assert.match(source, /value \? "已授权" : "当前未生效"/);
  assert.match(source, /await relaunchAppNative\(\)/);
  assert.match(source, /window\.addEventListener\("focus", refreshAfterSystemSettings\)/);
  assert.match(source, /title=\{t\("appSettings\.updateNote", \{ name: APP_DISTRIBUTION_NAME \}\)\}/);
});
