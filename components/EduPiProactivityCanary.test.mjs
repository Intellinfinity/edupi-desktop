import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const component = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiProactivityCanary.tsx");
const scope = { classId: "class-7-1", className: "七一班", subject: "数学", slotCount: 2, materialCount: 1, ready: true };
const base = { ok: true, activation: { enabled: false, source: "default", configurationStatus: "missing", scope: null, updatedAt: null }, scopes: [scope], grant: null, capabilities: null,
  limits: { durationDays: 7, maxModelCalls: 12, domain: "teaching_preparation" }, externalSend: false };

test("canary view exposes one scoped primary action and the hard limits", () => {
  const html = renderToStaticMarkup(component.EduPiProactivityCanaryView({ state: base, selectedKey: JSON.stringify(["class-7-1", "数学"]), busy: false, message: null, onSelect() {}, onToggle() {} }));
  assert.match(html, /课前准备试用/);
  assert.match(html, /七一班 · 数学/);
  assert.match(html, /7 天 · 最多 12 次模型调用 · 不外发/);
  assert.match(html, />启用试用</);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(html, /<select/);
  assert.doesNotMatch(html, /<button[^>]*disabled/);
});

test("active canary view has one stop action", () => {
  const active = { ...base, activation: { ...base.activation, enabled: true, source: "desktop_canary", configurationStatus: "ready", scope: { classId: "class-7-1", subject: "数学" } },
    grant: { status: "active", grantVersion: 1, endsAt: "2026-09-30T08:00:00.000Z" }, capabilities: { ambientPlanning: true, ownerIntent: true, attentionDelivery: true, teacherFeedback: true } };
  const html = renderToStaticMarkup(component.EduPiProactivityCanaryView({ state: active, selectedKey: JSON.stringify(["class-7-1", "数学"]), busy: false, message: null, onSelect() {}, onToggle() {} }));
  assert.match(html, />停止主动运行</);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.doesNotMatch(html, /<select/);
});

test("a fenced stop failure keeps one recovery action instead of permitting another scope", () => {
  const recovery = { ...base, degraded: true,
    activation: { ...base.activation, source: "desktop_canary", configurationStatus: "ready",
      scope: { classId: "class-7-1", subject: "数学" }, updatedAt: "2026-09-24T00:00:00.000Z" } };
  const html = renderToStaticMarkup(component.EduPiProactivityCanaryView({ state: recovery,
    selectedKey: JSON.stringify(["class-7-1", "数学"]), busy: false, message: null, onSelect() {}, onToggle() {} }));
  assert.match(html, /停止待恢复/);
  assert.match(html, />重试停止</);
  assert.doesNotMatch(html, /<select/);
  assert.equal((html.match(/<button/g) || []).length, 1);
});
