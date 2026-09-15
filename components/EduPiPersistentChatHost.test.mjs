import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the persistent chat host renders one stable child for every presentation mode", async () => {
  const host = await read("./EduPiPersistentChatHost.tsx");
  const panel = await read("./EduPiEducationPanel.tsx");
  const appShell = await read("./AppShell.tsx");

  assert.match(host, /mode: EduPiPersistentChatMode/);
  assert.match(host, /className=\{`edupi-persistent-chat-host is-\$\{mode\}`\}/);
  assert.equal((host.match(/\{children\}/g) || []).length, 1);
  assert.doesNotMatch(host, /mode === "main" \? children|mode === "drawer" \? children/);
  assert.equal((panel.match(/\{chatPanel\}/g) || []).length, 1);
  assert.match(panel, /<EduPiPersistentChatHost/);
  assert.doesNotMatch(panel, /agentPanel/);
  assert.doesNotMatch(panel, /activeView === "chat" \? <div className="edupi-chat-surface">\{chatPanel\}/);
  assert.match(panel, /mode=\{showingReminders \? "hidden" : drawer === "agent" \? "drawer" : activeView === "chat" \? "main" : "hidden"\}/);
  assert.match(panel, /reminderPanel/);
  assert.match(appShell, /reminderPanel=\{edupiReminderPanel\}/);
  assert.match(appShell, /chatPanel=\{edupiChatWindow\}/);
  assert.doesNotMatch(appShell, /agentPanel=\{edupiChatWindow\}/);
});

test("modal focus containment recovers outside and empty focus states", async () => {
  const panel = await read("./EduPiEducationPanel.tsx");
  const modal = await read("../hooks/useModalDismiss.ts");
  assert.match(panel, /tabIndex=\{-1\}/);
  assert.match(panel, /useModalDismiss<HTMLDivElement>/);
  assert.match(modal, /const activeInside = active !== null && panel\.contains\(active\)/);
  assert.match(modal, /if \(!activeInside \|\| active === first\)/);
  assert.match(modal, /if \(!activeInside \|\| active === last\)/);
  assert.match(modal, /focusables\.length === 0[\s\S]*event\.preventDefault\(\)/);
  assert.doesNotMatch(panel, /handleContextModalKeyDown/);
});

test("the host contract keeps task and Chat drawer presentation in the same DOM parent", async () => {
  const host = await read("./EduPiPersistentChatHost.tsx");
  const css = await read("../app/edupi-workbench.css");
  assert.match(host, /edupi-persistent-chat-host__header/);
  assert.match(host, /edupi-persistent-chat-host__body/);
  assert.match(host, /task/);
  assert.match(host, /onClose/);
  assert.match(css, /\.edupi-persistent-chat-host\.is-main/);
  assert.match(css, /\.edupi-persistent-chat-host\.is-main > \.edupi-persistent-chat-host__body \{ height: 100%; \}/);
  assert.match(css, /\.edupi-persistent-chat-host\.is-hidden/);
  assert.match(css, /\.edupi-persistent-chat-host\.is-drawer/);
  assert.match(css, /\.edupi-persistent-chat-host__body/);
  assert.match(css, /grid-template-rows: 58px minmax\(0, 1fr\)/);
});
