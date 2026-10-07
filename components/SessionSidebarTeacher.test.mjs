import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { SessionSidebar, EduPiChatSidebarActions } = await jiti.import("./SessionSidebar.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const render = element => renderToStaticMarkup(React.createElement(I18nProvider, null, element));
const labels = ["连接器", "插件", "Skills", "知识库", "自动化"];
const props = { selectedSessionId: null, selectedCwd: "/tmp/synthetic-sidebar", onSelectSession() {}, onNewSession() {}, resourceActions: labels.map((label, index) => ({ id: `resource-${index}`, label, onClick() {} })) };

test("teacher collaboration places named management entries before conversation history", () => {
  const html = render(React.createElement(SessionSidebar, { ...props, presentation: "embedded-chat" }));
  assert.match(html, /edupi-chat-resources/);
  for (const label of ["新建对话", ...labels]) assert.match(html, new RegExp(label));
  assert.ok(html.indexOf("连接器") < html.indexOf("sidebar-view-switcher"));
  assert.match(html, /<details[^>]*class="edupi-chat-advanced"[^>]*>/);
  assert.doesNotMatch(html, /<details[^>]*class="edupi-chat-advanced"[^>]*\bopen/);
});

test("default sidebar retains its project and task controls without teacher resource navigation", () => {
  const html = render(React.createElement(SessionSidebar, { ...props, presentation: "default" }));
  assert.match(html, /新建教学任务/);
  assert.match(html, /sidebar-folder-row/);
  assert.doesNotMatch(html, /edupi-chat-resources|edupi-chat-advanced/);
});

test("teacher resource controls dispatch supplied actions and expose unavailable entries as disabled", () => {
  const called = [];
  const actions = labels.map((label, index) => ({ id: `resource-${index}`, label, onClick: () => called.push(label), disabled: index === 4 }));
  const tree = EduPiChatSidebarActions({ resourceActions: actions, onNewChat: () => called.push("新建对话"), disabled: false });
  const [newChat, resources] = tree.props.children;
  newChat.props.onClick();
  resources[0].props.onClick();
  assert.deepEqual(called, ["新建对话", "连接器"]);
  assert.equal(resources[4].props.disabled, true);
  assert.equal(resources[3].props.disabled, false);
});
