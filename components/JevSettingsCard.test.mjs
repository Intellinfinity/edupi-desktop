import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const card = await readFile(new URL("./JevSettingsCard.tsx", import.meta.url), "utf8");
const admin = await readFile(new URL("./EduPiAdminPanel.tsx", import.meta.url), "utf8");

test("JEV settings are separate from chat models and keep the key server-side", () => {
  assert.match(card, /只用于浏览器下一步判断，不参与对话/);
  assert.match(card, /type="password"/);
  assert.match(card, /\/api\/integrations\/jev/);
  assert.match(card, /keyConfigured/);
  assert.doesNotMatch(card, /localStorage/);
  assert.doesNotMatch(card, /ModelsConfig/);
  assert.match(admin, /<JevSettingsCard \/>/);
});

test("JEV settings expose one save action and an explicit connection test", () => {
  assert.match(card, /保存设置/);
  assert.match(card, /测试连接/);
  assert.match(card, /移除密钥/);
  assert.match(card, /autoComplete="off"/);
});
