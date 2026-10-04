import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
const tick = () => new Promise(resolve => setImmediate(resolve));
function editorHarness({ read, revise, props = {} } = {}) {
  const slots = [], effects = new Map(), reads = [], writes = [], saved = [], previews = [], updatesAfterUnmount = [];
  let cursor = 0, dirty, mounted = true, tree;
  const sameDependencies = (a, b) => a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = next => {
          if (!mounted) { updatesAfterUnmount.push(index); return; }
          const value = typeof next === "function" ? next(slot.value) : next;
          if (!Object.is(slot.value, value)) { slot.value = value; dirty = true; }
        };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDependencies(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDependencies(slots[index].deps, deps)) effects.set(index, { callback, deps });
      else effects.delete(index);
    },
  };
  const client = {
    readPreparationArtifact: async (id, revision, signal) => { reads.push({ id, revision, signal }); return read ? read(id, revision, signal) : artifact(); },
    revisePreparationArtifact: async (id, revision, content) => { writes.push({ id, revision, content }); return revise ? revise(id, revision, content) : artifact({ content }); },
  };
  const exports = {}, jsx = (type, props) => ({ type, props });
  const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiPreparationArtifactEditor.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, TextEncoder, AbortController, Error,
    require(name) {
      if (name === "react") return react;
      if (name.includes("jsx-runtime")) return { jsx, jsxs: jsx };
      if (name.includes("artifact-client")) return client;
      throw new Error(`Unexpected component import: ${name}`);
    },
  });
  let currentProps = {
    artifactId: "synthetic-a",
    preview(value) { previews.push(value); return jsx("article", { "aria-label": "合成预览", "data-path": value.relative_path, children: value.content }); },
    onSaved: value => saved.push(value), onAgent() {}, ...props,
  };
  const render = () => {
    assert.ok(mounted, "Cannot render an unmounted editor");
    let attempts = 0;
    do {
      assert.ok(attempts++ < 50, "Editor did not settle after effects");
      dirty = false; cursor = 0;
      tree = exports.EduPiPreparationArtifactEditor(currentProps);
      if (dirty) continue;
      const pending = [...effects]; effects.clear();
      for (const [index] of pending) slots[index]?.cleanup?.();
      for (const [index, effect] of pending) slots[index] = { deps: effect.deps, cleanup: effect.callback() };
    } while (dirty);
    return tree;
  };
  const find = (type, label) => nodes(render()).find(node => node.type === type && (textOf(node.props.children) === label || node.props["aria-label"] === label));
  const get = (type, label) => { const node = find(type, label); assert.ok(node, `Missing ${type}: ${label}`); return node; };
  return {
    reads, writes, saved, previews, updatesAfterUnmount, render, find, get,
    click(label) { const button = get("button", label); assert.ok(!button.props.disabled, `Button is disabled: ${label}`); button.props.onClick(); return render(); },
    change(type, label, value) { const field = get(type, label); assert.ok(!field.props.disabled, `Field is disabled: ${label}`); field.props.onChange({ target: { value } }); return render(); },
    update(nextProps) { currentProps = { ...currentProps, ...nextProps }; return render(); },
    async settle() { await tick(); return mounted ? render() : null; },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); effects.clear(); tree = null; },
  };
}

// Synthetic client responses in a hook VM: not real Core, browser, or installed-app evidence.
function artifact(overrides = {}) {
  return {
    artifact_id: "synthetic-a", task_id: "synthetic-task", title: "合成教案", content: "Core 已保存正文",
    revision: 2, current_revision: 2, relative_path: ".edupi/output/synthetic-a-v2.md", access: "editable",
    history: [
      { revision: 2, actor: "teacher", updated_at: "2026-10-04T00:00:00.000Z" },
      { revision: 1, actor: "agent", updated_at: "2026-10-03T00:00:00.000Z" },
    ], ...overrides,
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
function nodes(node) { return !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
function textOf(node) { return typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(textOf).join("") : node && typeof node === "object" ? textOf(node.props?.children) : ""; }

test("held drafts and their history are readable without edit, restore or AI actions", async () => {
  let agentCalls = 0;
  const app = editorHarness({ read: async (_id, revision) => artifact({ access: "read_only", revision: revision ?? 2,
    content: revision === 1 ? "保留的历史正文" : "保留的最新正文" }), props: { onAgent() { agentCalls++; } } });
  app.render(); await app.settle();
  assert.match(textOf(app.render()), /只读/);
  assert.equal(app.get("article", "合成预览").props.children, "保留的最新正文");
  for (const label of ["编辑正文", "AI 协作", "保存草稿", "恢复此版本"]) assert.equal(app.find("button", label), undefined);
  app.change("select", "产物历史版本", "1"); await app.settle();
  assert.equal(app.get("article", "合成预览").props.children, "保留的历史正文");
  assert.equal(app.find("button", "恢复此版本"), undefined);
  assert.equal(app.writes.length, 0); assert.equal(agentCalls, 0);
});

test("a newly held draft preserves unsaved input and cannot be submitted again", async () => {
  for (const code of ["artifact_read_only", "stale_revision"]) {
  const app = editorHarness({ revise: async () => { throw Object.assign(new Error("产物已更新"), { code }); },
    read: async () => artifact({ access: app?.writes.length ? "read_only" : "editable" }) });
  app.render(); await app.settle();
  app.click("编辑正文"); app.change("textarea", "产物正文", "尚未保存的教师修改");
  app.click("保存草稿"); await app.settle();
  assert.equal(app.get("textarea", "产物正文").props.value, "尚未保存的教师修改");
  if (code === "artifact_read_only") {
    assert.equal(app.get("textarea", "产物正文").props.readOnly, true);
    assert.equal(app.find("button", "保存草稿"), undefined);
  }
  assert.equal(app.saved.length, 0);
  app.click("重新读取版本"); await app.settle();
  assert.equal(app.get("textarea", "产物正文").props.value, "尚未保存的教师修改");
  assert.equal(app.get("textarea", "产物正文").props.readOnly, true);
  assert.equal(app.find("button", "保存草稿"), undefined);
  assert.equal(app.writes.length, 1);
  app.click("放弃修改"); await app.settle();
  assert.equal(app.get("article", "合成预览").props.children, "Core 已保存正文");
  assert.equal(app.writes.length, 1);
  }
});

test("initial read failure offers a read retry without previewing an unconfirmed parent snapshot", async () => {
  let unavailable = true;
  const confirmed = artifact({ revision: 3, current_revision: 3, relative_path: ".edupi/output/synthetic-a-v3.md" });
  const app = editorHarness({ read: async () => { if (unavailable) throw new Error("Core 读取失败"); return confirmed; } });
  app.render(); await app.settle();
  assert.match(textOf(app.render()), /Core 读取失败/);
  assert.equal(app.previews.length, 0);
  assert.ok(app.get("button", "编辑正文").props.disabled);
  assert.ok(!app.get("button", "重试读取").props.disabled);
  assert.equal(app.reads.length, 1, "Failed reads must wait for an explicit retry");
  unavailable = false;
  app.click("重试读取"); await app.settle();
  assert.equal(app.reads.length, 2);
  assert.equal(app.get("article", "合成预览").props["data-path"], confirmed.relative_path);
  assert.equal(app.writes.length, 0, "A read retry must never submit a revision");
  app.click("编辑正文");
  assert.equal(app.get("textarea", "产物正文").props.value, confirmed.content);
});

test("editor retains a conflicting draft and restores history through versioned Core submission", async () => {
  let current = artifact(), rejectSave = true;
  const app = editorHarness({
    read: async (_id, revision) => revision === 1 ? { ...current, revision: 1, content: "历史正文" } : { ...current },
    revise: async (_id, _revision, content) => {
      if (rejectSave) throw Object.assign(new Error("版本冲突"), { code: "stale_revision" });
      current = { ...current, content, revision: 4, current_revision: 4, relative_path: ".edupi/output/synthetic-revised.md" };
      return { ...current };
    },
  });
  app.render(); await app.settle();
  app.click("编辑正文");
  app.change("textarea", "产物正文", "保留的草稿");
  app.click("保存草稿"); await app.settle();
  assert.equal(app.get("textarea", "产物正文").props.value, "保留的草稿");
  assert.equal(app.saved.length, 0);
  assert.equal(app.writes.length, 1);
  current = { ...current, revision: 3, current_revision: 3, content: "他人修订" };
  app.click("重新读取版本"); await app.settle();
  assert.equal(app.get("textarea", "产物正文").props.value, "保留的草稿");
  app.change("select", "产物历史版本", "1"); await app.settle();
  assert.equal(app.get("textarea", "产物正文").props.value, "历史正文");
  rejectSave = false;
  app.click("恢复此版本"); await app.settle();
  assert.deepEqual(app.writes.at(-1), { id: "synthetic-a", revision: 3, content: "历史正文" });
  assert.equal(app.saved[0].relative_path, ".edupi/output/synthetic-revised.md");
  app.click("编辑正文");
  app.change("textarea", "产物正文", "未保存");
  app.click("取消"); await app.settle();
  assert.equal(app.find("textarea", "产物正文"), undefined);
  assert.equal(app.writes.length, 2);
});

test("pending initial reads show reading state and do not invoke preview", async () => {
  const pending = deferred();
  const app = editorHarness({ read: () => pending.promise });
  assert.match(textOf(app.render()), /读取/);
  assert.equal(app.previews.length, 0);
  assert.ok(app.get("button", "编辑正文").props.disabled);
  pending.resolve(artifact()); await app.settle();
  assert.equal(app.get("article", "合成预览").props.children, "Core 已保存正文");
});

test("cancelled text cannot return after the cancel refresh fails and the teacher retries", async () => {
  const refresh = deferred();
  let reads = 0;
  const app = editorHarness({ read: () => ++reads === 2 ? refresh.promise : Promise.resolve(artifact()) });
  app.render(); await app.settle();
  app.click("编辑正文");
  app.change("textarea", "产物正文", "已取消的未保存输入");
  app.click("取消");
  assert.equal(app.find("textarea", "产物正文"), undefined, "Cancel must leave editing immediately");
  refresh.reject(new Error("取消后的刷新失败")); await app.settle();
  assert.match(textOf(app.render()), /取消后的刷新失败/);
  const editButton = app.get("button", "编辑正文");
  if (!editButton.props.disabled) {
    app.click("编辑正文");
    assert.notEqual(app.get("textarea", "产物正文").props.value, "已取消的未保存输入", "Reopening after failure must not revive cancelled text");
  }
  app.click("重试读取"); await app.settle();
  if (!app.find("textarea", "产物正文")) app.click("编辑正文");
  assert.equal(app.get("textarea", "产物正文").props.value, "Core 已保存正文");
  assert.equal(app.writes.length, 0);
  assert.equal(app.saved.length, 0);
});

test("preview receives the latest Core artifact path on initial read and after cancelling a historical version", async () => {
  let current = artifact({ content: "最新正文", revision: 3, current_revision: 3, relative_path: ".edupi/output/synthetic-current-v3.md" });
  const app = editorHarness({ read: async (_id, revision) => revision === 1 ? { ...current, revision: 1, content: "历史正文", relative_path: ".edupi/output/synthetic-history-v1.md" } : { ...current } });
  app.render(); await app.settle();
  assert.equal(app.get("article", "合成预览").props["data-path"], current.relative_path);
  assert.equal(app.previews.at(-1).revision, 3);
  app.click("编辑正文");
  app.change("select", "产物历史版本", "1"); await app.settle();
  assert.equal(app.get("textarea", "产物正文").props.value, "历史正文");
  current = { ...current, content: "Core 最新保存正文", revision: 4, current_revision: 4, relative_path: ".edupi/output/synthetic-current-v4.md" };
  app.click("取消"); await app.settle();
  assert.equal(app.get("article", "合成预览").props["data-path"], current.relative_path);
  assert.equal(app.get("article", "合成预览").props.children, current.content);
  assert.equal(app.previews.at(-1).revision, 4);
  assert.equal(app.writes.length, 0);
});

test("a failed save preserves input and is never automatically resubmitted", async () => {
  const app = editorHarness({ revise: async () => { throw new Error("保存结果未确认"); } });
  app.render(); await app.settle();
  app.click("编辑正文");
  app.change("textarea", "产物正文", "待老师决定的草稿");
  app.click("保存草稿"); await app.settle(); await app.settle();
  assert.match(textOf(app.render()), /保存结果未确认/);
  assert.equal(app.get("textarea", "产物正文").props.value, "待老师决定的草稿");
  assert.deepEqual(app.writes, [{ id: "synthetic-a", revision: 2, content: "待老师决定的草稿" }]);
  assert.equal(app.saved.length, 0);
});

test("a late read from the previous artifact cannot overwrite the selected artifact", async () => {
  const previous = deferred(), selected = artifact({ artifact_id: "synthetic-b", content: "第二份正文", relative_path: ".edupi/output/synthetic-b.md" });
  const app = editorHarness({ read: id => id === "synthetic-a" ? previous.promise : Promise.resolve(selected) });
  app.render();
  app.update({ artifactId: "synthetic-b" }); await app.settle();
  previous.resolve(artifact()); await app.settle();
  assert.equal(app.get("article", "合成预览").props["data-path"], selected.relative_path);
  app.click("编辑正文");
  assert.equal(app.get("textarea", "产物正文").props.value, selected.content);
  assert.equal(app.reads.length, 2);
  assert.equal(app.saved.length, 0);
});

test("a late save from the previous artifact does not call onSaved or replace the selected artifact", async () => {
  const pending = deferred(), selected = artifact({ artifact_id: "synthetic-b", content: "第二份正文", relative_path: ".edupi/output/synthetic-b.md" });
  const app = editorHarness({ read: async id => id === "synthetic-a" ? artifact() : selected, revise: () => pending.promise });
  app.render(); await app.settle();
  app.click("编辑正文");
  app.change("textarea", "产物正文", "旧产物修订");
  app.click("保存草稿");
  app.update({ artifactId: "synthetic-b" }); await app.settle();
  pending.resolve(artifact({ content: "旧产物修订", revision: 3, current_revision: 3 })); await app.settle();
  assert.equal(app.saved.length, 0);
  assert.equal(app.get("article", "合成预览").props["data-path"], selected.relative_path);
  assert.equal(app.writes.length, 1);
});

test("unmount ignores pending history reads and save completions", async () => {
  const history = deferred();
  const reader = editorHarness({ read: (_id, revision) => revision === 1 ? history.promise : Promise.resolve(artifact()) });
  reader.render(); await reader.settle();
  reader.click("编辑正文");
  reader.change("select", "产物历史版本", "1");
  reader.unmount();
  history.resolve(artifact({ revision: 1, content: "延迟历史正文" })); await reader.settle();
  assert.equal(reader.updatesAfterUnmount.length, 0);
  assert.equal(reader.saved.length, 0);

  const pending = deferred();
  const writer = editorHarness({ revise: () => pending.promise });
  writer.render(); await writer.settle();
  writer.click("编辑正文");
  writer.change("textarea", "产物正文", "延迟保存正文");
  writer.click("保存草稿");
  writer.unmount();
  pending.resolve(artifact({ content: "延迟保存正文", revision: 3, current_revision: 3 })); await writer.settle();
  assert.equal(writer.saved.length, 0);
  assert.equal(writer.updatesAfterUnmount.length, 0);
  assert.equal(writer.writes.length, 1);
});
