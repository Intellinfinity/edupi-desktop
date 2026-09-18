import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  // Deleting without Shift must always route through the confirmation step.
  // The handler moved inline into the row's menu item, so match the guard
  // itself rather than a named function, and tolerate either brace style.
  assert.match(
    sessionItemSource,
    /if \(e\.shiftKey\)\s*\{?\s*void performDelete\(\);\s*\}?\s*else\s*\{?\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("streams running sessions and reconnects after visibility or network changes", () => {
  assert.match(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisible\)/);
  assert.match(source, /window\.addEventListener\("online", connect\)/);
  assert.match(source, /source\?\.close\(\)/);
});

test("groups sessions into collapsible time buckets", () => {
  assert.match(source, /groupSessionTreeByAge/);
  assert.match(source, /今天/);
  assert.match(source, /近三天/);
  assert.match(source, /近七天/);
  assert.match(source, /更早/);
  assert.match(source, /session-time-group__header/);
});

test("exposes EduPi education modules in the sidebar", () => {
  assert.match(source, /edupi-sidebar-modules/);
  assert.match(source, /材料/);
  assert.match(source, /审核/);
});

test("embedded chat uses named icon controls for new chat and view switching", () => {
  assert.match(source, /sidebar-new-row\$\{embeddedChat \? " is-icon-only" : ""\}/);
  assert.match(source, /aria-label=\{embeddedChat \? "新建对话" : undefined\}/);
  assert.match(source, /\{embeddedChat \? null : "新建教学任务"\}/);
  assert.match(source, /aria-label=\{embeddedChat \? "对话" : undefined\}/);
  assert.match(source, /aria-label=\{embeddedChat \? "文件" : undefined\}/);
});

test("Escape closes the worktree dropdown from any focused child", () => {
  const start = source.indexOf("ref={wtDropdownRef}");
  const block = source.slice(start, source.indexOf("<button", start));
  assert.match(block, /onKeyDown=\{event => \{/);
  assert.match(block, /event\.key === "Escape"/);
  assert.match(block, /setWtDropdownOpen\(false\)/);
});
