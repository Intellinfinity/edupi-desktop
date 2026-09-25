import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppSettings.tsx", import.meta.url), "utf8");

test("settings exposes manual update checks and the signed installer action", () => {
  assert.match(source, /appSettings\.checkUpdates/);
  assert.match(source, /fetch\("\/api\/updates\?refresh=1"/);
  assert.match(source, /hasAppUpdateCheckError\(data, "edupi-desktop"\)/);
  assert.match(source, /installLatestDesktopRelease/);
  assert.match(source, /desktopUpgradeErrorKind\(error\)/);
  assert.match(source, /desktopUpgradeErrorDetails\(error\)/);
  assert.match(source, /appSettings\.updateDiagnostics/);
  assert.match(source, /MobileBridgeSettingsCard/);
  assert.match(source, /initialSection !== "mobile"/);
  assert.match(source, /mobile-bridge-settings/);
  assert.match(source, /appSettings\.update/);
});

test("an older release check cannot overwrite a newer proxy-backed refresh", () => {
  const check = source.slice(source.indexOf("const checkForUpdates = useCallback"), source.indexOf("useEffect(() => {", source.indexOf("const checkForUpdates = useCallback")));
  assert.match(source, /const updateCheckSequenceRef = useRef\(0\)/);
  assert.match(check, /const requestId = \+\+updateCheckSequenceRef\.current/);
  assert.match(check, /const isCurrent = \(\) => requestId === updateCheckSequenceRef\.current && !signal\?\.aborted/);
  assert.match(check, /if \(!isCurrent\(\)\) return;[\s\S]*setComponents/);
  assert.match(check, /finally \{\s*if \(isCurrent\(\)\) setLoading\(false\)/);
});

test("settings keeps its header separate from the scrollable content", () => {
  assert.match(source, /height: "auto"/);
  assert.match(source, /maxHeight: "min\(720px, calc\(100vh - 36px\)\)"/);
  assert.match(source, /className="native-modal-header" style=\{\{ display: "flex", flexShrink: 0/);
  assert.match(source, /<div style=\{\{ minHeight: 0, flex: 1, overflowY: "auto"/);
  assert.doesNotMatch(source, /appSettings\.taglineDetails/);
  assert.doesNotMatch(source, /<MetaChip/);
});

test("computer-use permissions are driven by one primary action", () => {
  assert.match(source, /computerUsePrimaryAction\(\{ status, flow \}\)/);
  assert.match(source, /computerUsePrimaryActionLabel\(primaryAction\)/);
  assert.match(source, /requestComputerUsePermissionNative\("screen_recording"\)/);
  assert.match(source, /setInterval\(\(\) => \{/);
  assert.match(source, /aria-label="重新检测权限"/);
  assert.match(source, /aria-label="停止控制"/);
  assert.match(source, /setPrefBool\(APP_PREF_KEYS\.computerUseEnabled, true\)/);
  assert.match(source, /await relaunchAppNative\(\)/);
  assert.doesNotMatch(source, />打开辅助功能设置<\/button>/);
  assert.doesNotMatch(source, />打开屏幕录制设置<\/button>/);
  assert.match(source, /title=\{t\("appSettings\.updateNote", \{ name: APP_DISTRIBUTION_NAME \}\)\}/);
});
