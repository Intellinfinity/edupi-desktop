import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import ts from "typescript";

const { EduPiMaterialScheduleProposal } = await createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true }).import("./EduPiMaterialScheduleProposal.tsx");
const flags = { read_only: true, automatic_import: false, external_send: false };
const proposal = status => ({ status, material_id: "material-synthetic", read_result: status === "unavailable" ? null
  : { status: status === "proposed" ? "ready" : "unresolved", events: [{ event_id: "synthetic-event", date: "2026-10-15", name: "合成教研" }],
    issues: status === "held" ? [{ code: "missing_time_zone", message: "缺少时区" }] : [] },
  reason_code: status === "proposed" ? null : status === "held" ? "material_schedule_unresolved" : "owner_control_disabled", ...flags });

test("upload proposal states are separate from file intake, adoption and preparation completion", () => {
  for (const [status, label] of [["proposed", "待确认"], ["held", "待核对"], ["unavailable", "暂不可用"]]) {
    const html = renderToStaticMarkup(React.createElement(EduPiMaterialScheduleProposal, { materialId: "material-synthetic", initialProposal: proposal(status) }));
    assert.match(html, /安排提案/); assert.match(html, new RegExp(label));
    assert.match(html, /disabled=""[^>]*>确认采用/);
    assert.doesNotMatch(html, /已导入|准备完成|已完成|ready/);
  }
});

test("reopened material has no cached current claim and rereads on disclosure", async () => {
  const html = renderToStaticMarkup(React.createElement(EduPiMaterialScheduleProposal, { materialId: "material-synthetic" }));
  assert.match(html, /未读取/);
  assert.doesNotMatch(html, /待确认|已采用/);
  const source = await fs.readFile(new URL("./EduPiMaterialScheduleProposal.tsx", import.meta.url), "utf8");
  assert.match(source, /readMaterialSchedule\(materialId/);
  assert.match(source, /onToggle/);
  assert.match(source, /captureMaterialScheduleApply\(current/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /controller\.current\?\.abort/);
});

async function behaviorFixture() {
  const require = createRequire(import.meta.url);
  const model = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../lib/edupi-material-schedule.ts");
  const source = await fs.readFile(new URL("./EduPiMaterialScheduleProposal.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const slots = [], effects = [], reads = [], applies = [];
  let cursor = 0, dirty = false, confirms = false, holdApply = false;
  const pending = [];
  const hash = value => `sha256:${value.repeat(64)}`;
  let current = { version: 1, root_ref: hash("a"), owner_id: `owner_${"b".repeat(32)}`,
    source: { material_id: "material-synthetic", source_hash: hash("c"), metadata_revision: 2, relative_path: "synthetic.ics" },
    options: { default_time_zone: null, window_start: null, window_end: null, max_occurrences: 200 }, status: "ready",
    events: [{ event_id: "synthetic-event", date: "2026-10-15", name: "合成教研" }], issues: [], evidence: [], parse_fingerprint: hash("d"), ...flags };
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, value => { const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useCallback(fn, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: fn, deps }; return slots[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) {
      const previous = slots[index]; slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); });
    } },
  };
  const client = { ...model,
    readMaterialSchedule: async (materialId, _fetch, _headers, signal) => { reads.push({ materialId, signal }); return structuredClone(current); },
    applyMaterialSchedule: async capture => { applies.push(capture);
      if (holdApply) return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      return { status: "accepted", applied_ids: ["synthetic-event"], rejected_ids: [], automatic_import: false, external_send: false }; },
  };
  const dependencies = { react, "@/lib/edupi-material-schedule": client, "./EduPiActionIcon": { EduPiPagination: () => null } };
  const componentModule = { exports: {} };
  new Function("require", "module", "exports", "window", compiled)(name => dependencies[name] || require(name), componentModule, componentModule.exports, { confirm: () => confirms });
  let props = { materialId: "material-synthetic", initialProposal: proposal("proposed") };
  const render = () => { let tree, attempts = 0; do { cursor = 0; dirty = false; tree = componentModule.exports.EduPiMaterialScheduleProposal(props); effects.splice(0).forEach(run => run());
    assert.ok(++attempts < 10, "effects must settle"); } while (dirty); return tree; };
  const text = node => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : String(node ?? "");
  const button = (tree, label) => { if (Array.isArray(tree)) return tree.map(node => button(node, label)).find(Boolean);
    if (!tree || typeof tree !== "object") return null;
    if (tree.type === "button" && text(tree) === label) return tree;
    return button(tree.props?.children, label); };
  return { render, button, reads, applies, text, confirm: value => { confirms = value; },
    holdApply: () => { holdApply = true; }, finishApply: error => error ? pending.shift().reject(error)
      : pending.shift().resolve({ status: "accepted", applied_ids: ["synthetic-event"], rejected_ids: [], automatic_import: false, external_send: false }),
    update: patch => { current = { ...current, ...patch }; }, setProps: value => { props = value; },
    flush: () => new Promise(resolve => setImmediate(resolve)), cleanup: () => slots.forEach(slot => slot?.cleanup?.()) };
}

test("disclosure reads current proof, cancel performs no apply and reopening cannot reuse cached authority", async () => {
  const fixture = await behaviorFixture();
  try {
    let tree = fixture.render();
    assert.equal(fixture.reads.length, 0);
    assert.equal(fixture.button(tree, "确认采用").props.disabled, true);
    tree.props.onToggle({ currentTarget: { open: true } }); await fixture.flush(); tree = fixture.render();
    assert.equal(fixture.reads.length, 1);
    assert.equal(fixture.button(tree, "确认采用").props.disabled, false);
    fixture.button(tree, "确认采用").props.onClick(); await fixture.flush();
    assert.equal(fixture.applies.length, 0, "declining explicit confirmation leaves the accepted material untouched");
    fixture.confirm(true); fixture.button(tree, "确认采用").props.onClick(); await fixture.flush(); tree = fixture.render();
    assert.equal(fixture.applies.length, 1);
    assert.equal(fixture.applies[0].expectedMetadataRevision, 2);
    assert.equal(fixture.applies[0].confirm, true);
    tree.props.onToggle({ currentTarget: { open: false } }); tree = fixture.render();
    assert.equal(fixture.reads[0].signal.aborted, true);
    assert.equal(fixture.button(tree, "确认采用").props.disabled, true);
    fixture.update({ source: { material_id: "material-synthetic", source_hash: `sha256:${"e".repeat(64)}`, metadata_revision: 3, relative_path: "synthetic.ics" }, parse_fingerprint: `sha256:${"f".repeat(64)}` });
    tree.props.onToggle({ currentTarget: { open: true } }); await fixture.flush(); tree = fixture.render();
    assert.equal(fixture.reads.length, 2);
    fixture.button(tree, "确认采用").props.onClick(); await fixture.flush();
    assert.equal(fixture.applies.length, 2);
    assert.equal(fixture.applies[1].expectedMetadataRevision, 3);
    assert.equal(fixture.applies[1].expectedSourceHash, `sha256:${"e".repeat(64)}`);
    assert.equal(fixture.applies[1].expectedParseFingerprint, `sha256:${"f".repeat(64)}`);
  } finally { fixture.cleanup(); }
});

test("late apply success and failure cannot replace the current proof after metadata refresh or disclosure reopen", async () => {
  for (const [change, oldError] of [["metadata", null], ["metadata", new Error("old apply failed")], ["reopen", null]]) {
    const fixture = await behaviorFixture();
    try {
      let tree = fixture.render(); tree.props.onToggle({ currentTarget: { open: true } }); await fixture.flush(); tree = fixture.render();
      fixture.confirm(true); fixture.holdApply(); fixture.button(tree, "确认采用").props.onClick(); await fixture.flush();
      assert.equal(fixture.applies.length, 1);
      fixture.update({ source: { material_id: "material-synthetic", source_hash: `sha256:${"e".repeat(64)}`, metadata_revision: 3, relative_path: "synthetic.ics" },
        parse_fingerprint: `sha256:${"f".repeat(64)}`, events: [{ event_id: "new-event", date: "2026-10-16", name: "新来源 revision 3" }] });
      if (change === "metadata") { fixture.setProps({ materialId: "material-synthetic", metadataRevision: 3 }); tree = fixture.render(); }
      else { tree.props.onToggle({ currentTarget: { open: false } }); tree = fixture.render(); tree.props.onToggle({ currentTarget: { open: true } }); }
      await fixture.flush(); tree = fixture.render();
      assert.match(fixture.text(tree), /新来源 revision 3/);
      fixture.finishApply(oldError); await fixture.flush(); tree = fixture.render();
      assert.match(fixture.text(tree), /新来源 revision 3/, "old failure must not clear the newly read source");
      assert.doesNotMatch(fixture.text(tree), /已采用/, "old receipt must not be promoted as adoption of the new proof");
      assert.equal(fixture.button(tree, "确认采用").props.disabled, false);
    } finally { fixture.cleanup(); }
  }
});
