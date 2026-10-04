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
  assert.match(html, /7 天 · 最多 12 次模型调用/);
  assert.match(html, />启用试用</);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(html, /<select/);
  assert.doesNotMatch(html, /<button[^>]*disabled/);
});

test("active canary view has one stop action", () => {
  const active = { ...base, activation: { ...base.activation, enabled: true, source: "desktop_canary", configurationStatus: "ready", scope: { classId: "class-7-1", subject: "数学" } },
    grant: { status: "active", grantVersion: 1, endsAt: "2026-09-30T08:00:00.000Z",
      modelBudget: { usedCalls: 1, maxCalls: 12, remainingCalls: 11, usageUnverified: false } },
    capabilities: { ambientPlanning: true, ownerIntent: true, attentionDelivery: true, teacherFeedback: true } };
  const html = renderToStaticMarkup(component.EduPiProactivityCanaryView({ state: active, selectedKey: JSON.stringify(["class-7-1", "数学"]), busy: false, message: null, onSelect() {}, onToggle() {} }));
  assert.match(html, />停止主动运行</);
  assert.match(html, /剩余 11 次/);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.doesNotMatch(html, /<select/);
});

test("Windows normal mode leaves G1 off and names the Safe Mode restart boundary", () => {
  const disabled = { ...base, requiresSafeMode: true };
  const disabledHtml = renderToStaticMarkup(component.EduPiProactivityCanaryView({ state: disabled,
    selectedKey: JSON.stringify(["class-7-1", "数学"]), busy: false, message: null, onSelect() {}, onToggle() {} }));
  assert.match(disabledHtml, /安全模式可试用/);
  assert.match(disabledHtml, /Windows 试用需用隔离数据目录以安全模式启动/);
  assert.match(disabledHtml, /<button[^>]*disabled/);

  const persisted = { ...disabled, activation: { ...base.activation, enabled: true, source: "desktop_canary",
    configurationStatus: "ready", scope: { classId: "class-7-1", subject: "数学" } },
  grant: { status: "active", grantVersion: 1, endsAt: "2026-09-30T08:00:00.000Z",
    modelBudget: { usedCalls: 1, maxCalls: 12, remainingCalls: 11, usageUnverified: false } },
  capabilities: { ambientPlanning: false, ownerIntent: false, attentionDelivery: false, teacherFeedback: false } };
  const persistedHtml = renderToStaticMarkup(component.EduPiProactivityCanaryView({ state: persisted,
    selectedKey: JSON.stringify(["class-7-1", "数学"]), busy: false, message: null, onSelect() {}, onToggle() {} }));
  assert.match(persistedHtml, /安全模式待启动/);
  assert.doesNotMatch(persistedHtml, /已启用/);
  assert.match(persistedHtml, />停止主动运行</);
});

test("an exhausted active grant is not shown as running", () => {
  const exhausted = { ...base, activation: { ...base.activation, enabled: true, source: "desktop_canary", configurationStatus: "ready",
    scope: { classId: "class-7-1", subject: "数学" } },
  grant: { status: "active", grantVersion: 2, endsAt: "2026-09-30T08:00:00.000Z",
    modelBudget: { usedCalls: 12, maxCalls: 12, remainingCalls: 0, usageUnverified: false } },
  capabilities: { ambientPlanning: true, ownerIntent: true, attentionDelivery: true, teacherFeedback: true } };
  const html = renderToStaticMarkup(component.EduPiProactivityCanaryView({ state: exhausted,
    selectedKey: JSON.stringify(["class-7-1", "数学"]), busy: false, message: null, onSelect() {}, onToggle() {} }));
  assert.match(html, /额度已用完/);
  assert.doesNotMatch(html, /运行中/);
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

test("a legacy grant remains visible until the teacher explicitly stops it", () => {
  const legacy = { ...base, activation: { ...base.activation, source: "desktop_canary",
    configurationStatus: "legacy", scope: { classId: "class-7-1", subject: "数学" },
    updatedAt: "2026-09-23T08:00:00.000Z" } };
  const html = renderToStaticMarkup(component.EduPiProactivityCanaryView({ state: legacy,
    selectedKey: JSON.stringify(["class-7-1", "数学"]), busy: false, message: null,
    onSelect() {}, onToggle() {} }));
  assert.match(html, /旧授权待停止/);
  assert.match(html, />停止旧授权</);
  assert.doesNotMatch(html, /启用试用/);
});

test("missed-opportunity feedback covers every L4 domain with one scoped report action", () => {
  const html = renderToStaticMarkup(component.EduPiMissedOpportunityFeedbackView({
    scopes: [scope],
    selectedKey: JSON.stringify([scope.classId, scope.subject]),
    domain: "calendar_administration",
    note: "系统没有提醒本周五前提交材料。",
    busy: false,
    message: null,
    onSelect() {},
    onDomain() {},
    onNote() {},
    onSubmit() {},
  }));
  for (const label of ["报告漏掉的事项", "教学准备", "学生跟进", "课后复盘", "校历与行政", "家长沟通", "安全与隐私", "七一班 · 数学", "记录漏报"]) {
    assert.match(html, new RegExp(label));
  }
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.doesNotMatch(html, /<button[^>]*disabled/);
});

const g2Base = { ...base, scopes: [{ ...scope, materialCount: 0 }],
  limits: { durationDays: 7, maxModelCalls: 4, domain: "student_followup" }, activationBlocked: null };
const view = state => renderToStaticMarkup(component.EduPiProactivityCanaryView({ state,
  selectedKey: JSON.stringify([scope.classId, scope.subject]), busy: false, message: null, onSelect() {}, onToggle() {} }));

test("independent G2 row offers the four-call scope without requiring materials", () => {
  const html = view(g2Base);
  assert.match(html, /学生跟进试用/);
  assert.match(html, /7 天 · 最多 4 次模型调用/);
  assert.match(html, /edupi-student-followup-canary-title/);
  assert.doesNotMatch(html, /<button[^>]*disabled|课前准备|同范围材料/);
  assert.equal((html.match(/<button/g) || []).length, 1);
});

test("G2 active state requires its processor but never invents a remaining-call count", () => {
  const active = { ...g2Base, activation: { ...base.activation, enabled: true, source: "desktop_canary", configurationStatus: "ready",
    scope: { classId: scope.classId, subject: scope.subject } },
  grant: { status: "active", grantVersion: 1, endsAt: "2026-10-11T00:00:00.000Z", modelBudget: null },
  capabilities: { ambientPlanning: true, ownerIntent: true, attentionDelivery: true, teacherFeedback: true, studentFollowup: true } };
  const html = view(active);
  assert.match(html, /最多 4 次 · 剩余未知/);
  assert.match(html, />已启用</);
  assert.match(html, />停止主动运行</);
  assert.doesNotMatch(html, /剩余 \d+ 次|额度已用完/);
  const pending = view({ ...active, capabilities: { ...active.capabilities, studentFollowup: false } });
  assert.match(pending, /需要恢复/);
  assert.doesNotMatch(pending, />已启用</);
});

test("G2 enable is blocked outside isolated canary and on Windows while stop remains available", () => {
  for (const activationBlocked of ["isolated_canary_required", "windows_unavailable"]) {
    const disabled = view({ ...g2Base, activationBlocked });
    assert.match(disabled, /<button[^>]*disabled/);
    assert.match(disabled, activationBlocked === "windows_unavailable" ? /Windows 暂不可用/ : /仅隔离试用/);
    const recovery = view({ ...g2Base, activationBlocked,
      activation: { ...g2Base.activation, scope: { classId: scope.classId, subject: scope.subject }, configurationStatus: "stop_pending" } });
    assert.match(recovery, /重试停止/);
    assert.doesNotMatch(recovery, /<button[^>]*disabled/);
  }
});

test("known G2 budget can be exhausted while unverified usage is never presented as zero", () => {
  const active = { ...g2Base, activation: { ...g2Base.activation, enabled: true, scope },
    grant: { status: "active", grantVersion: 1, endsAt: "2026-10-11T00:00:00.000Z",
      modelBudget: { usedCalls: 2, maxCalls: 4, remainingCalls: 2, usageUnverified: false } },
    capabilities: { ambientPlanning: true, ownerIntent: true, attentionDelivery: true, teacherFeedback: true, studentFollowup: true } };
  assert.match(view(active), /剩余 2 次/);
  const exhausted = view({ ...active, grant: { ...active.grant, modelBudget: { ...active.grant.modelBudget, usedCalls: 4, remainingCalls: 0 } } });
  assert.match(exhausted, /额度已用完/);
  assert.doesNotMatch(exhausted, />已启用</);
  for (const domain of ["student_followup", "teaching_preparation"]) {
    const unknown = view({ ...active, limits: { ...active.limits, domain }, grant: { ...active.grant,
      modelBudget: { usedCalls: 0, maxCalls: 4, remainingCalls: 0, usageUnverified: true } } });
    assert.match(unknown, /剩余未知/);
    assert.doesNotMatch(unknown, /剩余 0 次|额度已用完|>已启用</);
  }
});

test("G2 execution disclosure separates unknown, empty and stale results", () => {
  assert.match(view(g2Base), /执行记录暂不可用/);
  const execution = { version: 1, available: true, revision: 0, records: [], externalSend: false };
  assert.match(view({ ...g2Base, execution }), /暂无执行记录/);
  const unavailable = view({ ...g2Base, execution: { ...execution, available: false, revision: null } });
  assert.match(unavailable, /执行记录暂不可用/);
  assert.doesNotMatch(unavailable, /暂无执行记录/);
  const record = { executionId: "execution-1", followUpId: "follow-up-1", grantId: "grant-1", status: "completed",
    attempt: 1, errorCode: null, updatedAt: "2026-10-05T00:00:00.000Z", sourceStatus: "current" };
  const html = view({ ...g2Base, execution: { ...execution, revision: 1, records: [record] } });
  assert.match(html, /<details[^>]*><summary>执行记录<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, /草稿已生成/);
  for (const sourceStatus of ["historical", "unverified"]) {
    const stale = view({ ...g2Base, execution: { ...execution, records: [{ ...record, sourceStatus }] } });
    assert.match(stale, sourceStatus === "historical" ? /历史记录/ : /来源待核实/);
    assert.doesNotMatch(stale, /草稿已生成/);
  }
  const claimed = view({ ...g2Base, execution: { ...execution, records: [{ ...record, status: "claimed" }] } });
  assert.match(claimed, /已领取/);
  assert.doesNotMatch(claimed, /正在运行|运行中/);
});
