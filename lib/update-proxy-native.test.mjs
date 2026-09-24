import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { getUpdateProxyNative, setUpdateProxyNative } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./update-proxy-native.ts");

test("native update proxy reads and writes the same persisted command", async () => {
  const previous = globalThis.window;
  const calls = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    calls.push([command, args]);
    return command === "get_update_proxy" ? "http://127.0.0.1:7897" : args.proxy;
  } } };
  try {
    assert.equal(await getUpdateProxyNative(), "http://127.0.0.1:7897");
    assert.equal(await setUpdateProxyNative("http://127.0.0.1:7897"), "http://127.0.0.1:7897");
    assert.deepEqual(calls, [["get_update_proxy", {}], ["set_update_proxy", { proxy: "http://127.0.0.1:7897" }]]);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test("both proxy commands are scoped to the trusted desktop WebView", async () => {
  const [permissions, capabilities, native, shell] = await Promise.all([
    readFile(new URL("../src-tauri/permissions/desktop-shell.toml", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/capabilities/desktop-dialog.json", import.meta.url), "utf8"),
    readFile(new URL("./update-proxy-native.ts", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
  ]);
  for (const name of ["get_update_proxy", "set_update_proxy"]) {
    assert.match(permissions, new RegExp(`commands\\.allow = \\["${name}"\\]`));
    assert.match(native, new RegExp(`invoke(?:<[^>]+>)?\\("${name}"`));
    assert.match(shell, new RegExp(`fn ${name}\\(`));
  }
  for (const id of ["allow-get-update-proxy", "allow-set-update-proxy"]) assert.ok(JSON.parse(capabilities).permissions.includes(id));
  assert.match(shell, /fn update_proxy_path\([\s\S]*?updater-proxy\.json/);
  assert.match(shell, /fn get_update_proxy\([\s\S]*?read_update_proxy_from_path\(&update_proxy_path\(&app\)\?\)/);
  assert.match(shell, /fn set_update_proxy\([\s\S]*?write_update_proxy_file\(&update_proxy_path\(&app\)\?, &proxy\)/);
  assert.match(shell, /file\.sync_all\(\)[\s\S]*fs::rename\(&temporary, path\)/);
});
