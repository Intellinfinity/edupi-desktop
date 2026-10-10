import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiPromptOutboxRecoveryView } = await createJiti(import.meta.url,
  { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiPromptOutboxRecovery.tsx");
const row = stage => ({ sessionId: "session-1", clientRequestId: `request-${stage}`,
  occurredAt: "2026-10-10T08:00:00.000Z", stage });
const render = pending => renderToStaticMarkup(React.createElement(EduPiPromptOutboxRecoveryView,
  { pending, total: pending.length, busy: null, message: "", onAction() {}, onCancel() {}, onMore() {}, onRefresh() {} }));

test("no recovery block occupies the automatic-run page without pending messages", () => {
  assert.equal(render([]), "");
});

test("older unresolved messages remain reachable through progressive disclosure", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiPromptOutboxRecoveryView,
    { pending: [row("pi_unknown")], total: 21, busy: null, message: "", onAction() {}, onCancel() {}, onMore() {}, onRefresh() {} }));
  assert.match(html, /待核对消息 21/);
  assert.match(html, /查看更多/);
});

test("only pre-Pi stages offer manual continuation; uncertain Pi stays review-only", () => {
  const html = render([row("captured"), row("pi_unknown")]);
  assert.match(html, /<summary>待核对消息 2<\/summary>/);
  assert.match(html, /未发送/);
  assert.match(html, /继续发送/);
  assert.match(html, /取消/);
  assert.match(html, /发送结果待核对/);
  assert.match(html, /核对会话/);
  assert.doesNotMatch(html, /API Key|Bearer|自动重发|一键/);
});

test("an unknown Pi outcome can withdraw Core processing without claiming delivery failed", () => {
  const uncertain = render([row("pi_unknown")]);
  assert.match(uncertain, /撤回主动处理/);
  assert.doesNotMatch(uncertain, /继续发送/);
  const withdrawn = render([row("pi_unverified_withdrawn")]);
  assert.match(withdrawn, /主动处理已撤回，Pi 结果未核实/);
  assert.match(withdrawn, /核对会话/);
  assert.doesNotMatch(withdrawn, /继续发送|撤回主动处理/);
});

test("private teacher text appears only after an explicit detail read", () => {
  const summary = render([row("pi_unknown")]);
  assert.doesNotMatch(summary, /合成教师原文/);
  const expanded = renderToStaticMarkup(React.createElement(EduPiPromptOutboxRecoveryView,
    { pending: [row("pi_unknown")], total: 1, busy: null, message: "",
      detail: { key: "session-1:request-pi_unknown", text: "合成教师原文" },
      onShow() {}, onAction() {}, onCancel() {}, onMore() {}, onRefresh() {} }));
  assert.match(expanded, /合成教师原文/);
  assert.match(expanded, /复制原文/);
});

test("a pre-Core intent remains recoverable and can only be discarded explicitly", () => {
  const html = render([row("intent_saved")]);
  assert.match(html, /发送前已保存/);
  assert.match(html, /确认会话已收到/);
  assert.match(html, /确认放弃/);
  assert.doesNotMatch(html, /继续发送|Pi 已接收/);
});
