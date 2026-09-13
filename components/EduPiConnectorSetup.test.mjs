import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./EduPiConnectorSetup.tsx", import.meta.url), "utf8");
test("Feishu maximum scopes and DingTalk QR onboarding remain actionable and secret-safe", () => {
  for (const label of ["最大权限一键接入", "一键创建并授权", "复制最大权限", "199 项应用权限", "打开开放平台", "App ID", "App Secret", "验证并保存", "钉钉扫码一键接入", "扫码创建并授权", "复制运行时命令", "Client ID", "Client Secret"]) assert.match(source, new RegExp(label));
  assert.match(source, /\/api\/edupi\/connectors\/feishu/);
  assert.match(source, /\/api\/edupi\/connectors\/dingtalk\/register/);
  assert.match(source, /credentials_verified/);
  assert.match(source, /0\.8\.25/);
  assert.match(source, /type="password"/);
  assert.match(source, /setAppSecret\(""\)/);
  assert.doesNotMatch(source, /localStorage/);
});

test("configured and connected remain distinct connector states", () => {
  assert.match(source, /status === "connected" \? "已连接" : status === "configured" \? "已配置"/);
  assert.match(source, /飞书应用配置已保存/);
  assert.doesNotMatch(source, /status === "configured" \|\| status === "connected" \? "已连接"/);
});
