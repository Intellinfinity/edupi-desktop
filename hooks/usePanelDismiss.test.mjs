import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(await readFile(new URL("./usePanelDismiss.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function mount({ docked = true, enabled = true } = {}) {
  const effects = [], handlers = new Map(), modal = [];
  let closed = 0;
  const document = { body: {}, activeElement: null, addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: (name, fn) => { if (handlers.get(name) === fn) handlers.delete(name); } };
  const node = () => ({ isConnected: true, closest: () => null, focus() { document.activeElement = this; } });
  const opener = node(), close = node(), outside = node();
  const panel = { contains: value => value === close, querySelector: () => close };
  document.activeElement = opener;
  const ref = { current: panel }, exports = {};
  vm.runInNewContext(source, { exports, document, require: name => name === "react" ? { useRef: value => ({ current: value }), useEffect: effect => effects.push(effect) } : { useModalDismiss: (_onClose, active) => { modal.push(active); return ref; } } });
  exports.usePanelDismiss(() => closed++, docked, enabled);
  const cleanups = effects.map(effect => effect()).filter(Boolean);
  return {
    modal, document, opener, close, outside, handlers,
    get closed() { return closed; },
    key(key, extra = {}) { const event = { key, defaultPrevented: false, isComposing: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; handlers.get("keydown")?.(event); return event; },
    cleanup() { cleanups.forEach(cleanup => cleanup()); },
  };
}

test("docked details do not trap Tab or consume Escape from the chat", () => {
  const view = mount();
  assert.deepEqual(view.modal, [false]);
  assert.equal(view.document.activeElement, view.close);
  assert.equal(view.key("Tab").defaultPrevented, false);
  view.outside.focus();
  assert.equal(view.key("Escape").defaultPrevented, false);
  assert.equal(view.closed, 0);
  view.cleanup();
  assert.equal(view.document.activeElement, view.outside);
});

test("Escape inside the docked pane dismisses once and restores its connected opener", () => {
  const view = mount();
  assert.equal(view.key("Escape").defaultPrevented, true);
  assert.equal(view.closed, 1);
  view.cleanup();
  assert.equal(view.document.activeElement, view.opener);
  assert.equal(view.handlers.size, 0);
});

test("nested dialogs and IME composition do not dismiss their parent pane", () => {
  const view = mount();
  view.key("Escape", { isComposing: true });
  view.key("Escape", { defaultPrevented: true });
  view.close.closest = () => ({});
  view.key("Escape");
  assert.equal(view.closed, 0);
});

test("narrow drawers delegate to the existing modal hook and hidden drawers do not register", () => {
  const modal = mount({ docked: false });
  assert.deepEqual(modal.modal, [true]);
  assert.equal(modal.handlers.size, 0);
  const hidden = mount({ docked: false, enabled: false });
  assert.deepEqual(hidden.modal, [false]);
  assert.equal(hidden.handlers.size, 0);
});
