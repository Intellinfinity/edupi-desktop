import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { EduPiProactiveHub, proactiveBadgeCount } = await jiti.import("./EduPiProactiveHub.tsx");
const kernelClient = await jiti.import("../lib/edupi-kernel-client.ts");
const kernelDisplay = await jiti.import("../lib/edupi-kernel-display.ts");
const foreground = await jiti.import("../lib/edupi-foreground.ts");
const nativeRequire = createRequire(import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(new URL("./EduPiProactiveHub.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Render the actual Hub and run row with real producer normalization/display.
// Hooks supply loaded synthetic state; no effects, network or native actions run.
function loadedHub(producer) {
  const kernel = kernelClient.normalizeKernelState({ projection: { projection_kind: "proactive_work_kernel", runs: [producer] } });
  const states = [kernel, [], { tasks: [] }, "runs", false, "", null];
  let cursor = 0;
  const exports = {};
  const rows = ({ rows, renderRow }) => React.createElement(React.Fragment, null, ...rows.map(renderRow));
  vm.runInNewContext(compiled, { exports, require(name) {
    if (name === "react") return { ...React, useCallback: fn => fn, useMemo: fn => fn(), useRef: () => ({ current: null }), useEffect() {},
      useState: () => [states[cursor++], () => { throw new Error("Unexpected state write during read-only render"); }] };
    if (name === "react/jsx-runtime") return nativeRequire(name);
    if (name === "@/hooks/useModalDismiss") return { useModalDismiss: () => ({ current: null }) };
    if (name === "@/lib/edupi-kernel-client") return kernelClient;
    if (name === "@/lib/edupi-kernel-display") return kernelDisplay;
    if (name === "@/lib/edupi-foreground") return foreground;
    if (name === "./EduPiForeground") return { EduPiListPreview: rows, EduPiPagedRows: rows,
      useEduPiForegroundPolicy: () => ({ today: "2026-10-08", recentDays: 7, pinnedTaskIds: [], dismissedStaleTaskIds: [] }) };
    throw new Error(`Unexpected Hub import ${name}`);
  } });
  return renderToStaticMarkup(exports.EduPiProactiveHub({ open: true, onOpenChange() {}, onAction() {}, onTarget() {}, onOpenReminders() {} }));
}

test("proactive collaboration counts real Core attention and unread reminders", () => {
  const kernel = { status: "ready", updatedAt: "2026-09-17T00:00:00Z", running: 1, runs: [
    { runId: "running", triggerId: "morning_brief", fireKey: null, status: "running", updatedAt: "2026-09-17T00:00:00Z", resultSummary: null, errorCode: null, errorMessage: null },
    { runId: "failed", triggerId: "g1_prepare_due", fireKey: null, status: "failed", updatedAt: "2026-09-17T00:00:00Z", resultSummary: null, errorCode: "source_unavailable", errorMessage: null },
  ] };
  const reminders = [
    { id: "new", taskId: "task", title: "待处理", kind: "due", identity: "a", createdAt: "2026-09-17T00:00:00Z", read: false, handled: false, snoozedUntil: null },
    { id: "read", taskId: "task-2", title: "已读", kind: "ready", identity: "b", createdAt: "2026-09-17T00:00:00Z", read: true, handled: false, snoozedUntil: null },
  ];
  assert.equal(proactiveBadgeCount(kernel, reminders), 3);
});

test("proactive collaboration is an icon entry with an accessible name", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiProactiveHub, { open: false, onOpenChange() {}, onAction: async () => true, onTarget() {}, onOpenReminders() {} }));
  assert.match(html, /aria-label="主动协作"/);
  assert.match(html, /class="edupi-chat-utility edupi-proactive-hub"/);
  assert.doesNotMatch(html, />主动协作<\/button>/);
});

test("Core attempt two survives normalization and renders as attempt two in the actual Hub row", () => {
  const raw = { run_id: "synthetic-run", trigger_id: "g1_prepare_due", fire_key: "scan:2026-10-08", status: "running",
    updated_at: "2026-10-08T00:00:00.000Z", result_summary: null, attempt_count: 2 };
  const html = loadedHub(raw);
  assert.match(html, /课前准备检查/);
  assert.match(html, /第 2 次执行/);
  assert.doesNotMatch(html, /第 1 次执行|plan|draft|validate|当前步骤|子代理|\d+\/\d+|aria-valuenow|progressbar|%/);
  for (const attempt of [undefined, null, -1, 1.5, "2"]) {
    const unknown = loadedHub({ ...raw, attempt_count: attempt });
    assert.match(unknown, /执行次数未知/);
    assert.doesNotMatch(unknown, /第 \d+ 次执行/);
  }
  assert.match(loadedHub({ ...raw, attempt_count: 0 }), /尚未执行/);
});
