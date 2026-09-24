import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { desktopUpgradeErrorDetails, desktopUpgradeErrorKind, downloadVerifiedUpdate, installLatestDesktopRelease, updaterCheckOptions, DesktopUpgradeError } = await jiti.import("./desktop-updater.ts");

test("one saved loopback proxy applies to manifest check and its download", () => {
  assert.deepEqual(updaterCheckOptions(null), { timeout: 30_000 });
  assert.deepEqual(updaterCheckOptions("http://127.0.0.1:7897"), { timeout: 30_000, proxy: "http://127.0.0.1:7897" });
});

test("the signed updater reads native proxy settings before checking the manifest", async () => {
  const source = await readFile(new URL("./desktop-updater.ts", import.meta.url), "utf8");
  const install = source.slice(source.indexOf("export async function installLatestDesktopRelease"));
  assert.match(install, /proxy = await getUpdateProxyNative\(\)/);
  assert.match(install, /update = await check\(updaterCheckOptions\(proxy\)\)/);
  assert.doesNotMatch(install, /check\(\{ timeout: 30_000 \}\)/);
});

test("the packaged updater forwards the saved proxy into the real Tauri check call", async () => {
  const previous = globalThis.window;
  const calls = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    calls.push([command, args]);
    return command === "get_update_proxy" ? "http://127.0.0.1:7897" : null;
  } } };
  try {
    assert.deepEqual(await installLatestDesktopRelease(() => {}), { installed: false });
    assert.deepEqual(calls.slice(0, 2), [["get_update_proxy", {}], ["plugin:updater|check", { timeout: 30_000, proxy: "http://127.0.0.1:7897" }]]);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test("unreadable proxy settings stop before any updater network call", async () => {
  const previous = globalThis.window;
  const calls = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command) => {
    calls.push(command);
    throw new Error("private/path/should-not-appear");
  } } };
  try {
    await assert.rejects(installLatestDesktopRelease(() => {}), (error) => {
      assert.equal(error.stage, "manifest");
      assert.doesNotMatch(error.message, /private\/path/);
      return true;
    });
    assert.deepEqual(calls, ["get_update_proxy"]);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test("an interrupted signed update download retries before any install step", async () => {
  let downloads = 0;
  let resets = 0;
  const delays = [];
  await downloadVerifiedUpdate(
    async () => {
      downloads += 1;
      if (downloads < 3) throw "error decoding response body";
    },
    () => { resets += 1; },
    async (milliseconds) => { delays.push(milliseconds); },
  );
  assert.equal(downloads, 3);
  assert.equal(resets, 2);
  assert.deepEqual(delays, [750, 1500]);
});

test("signature failures do not retry a different download", async () => {
  let downloads = 0;
  await assert.rejects(
    downloadVerifiedUpdate(async () => { downloads += 1; throw new Error("Invalid signature"); }, () => { throw new Error("must not retry"); }),
    /Invalid signature/,
  );
  assert.equal(downloads, 1);
});

test("persistent network interruption returns the final failure without installing", async () => {
  let downloads = 0;
  await assert.rejects(
    downloadVerifiedUpdate(async () => { downloads += 1; throw new Error("error decoding response body"); }, () => {}, async () => {}),
    /error decoding response body/,
  );
  assert.equal(downloads, 3);
  assert.equal(desktopUpgradeErrorKind("error decoding response body"), "download");
  assert.equal(desktopUpgradeErrorKind(new Error("Invalid signature")), "signature");
});

test("stage details expose only safe updater diagnostics", () => {
  const error = new DesktopUpgradeError("request included a secret=do-not-show", {
    stage: "download",
    phase: "downloading",
    host: "api.github.com",
    retryCount: 2,
  });
  const details = desktopUpgradeErrorDetails(error);
  assert.deepEqual(details, {
    stage: "download",
    phase: "downloading",
    host: "api.github.com",
    retryCount: 2,
    errorCode: details.errorCode,
  });
  assert.match(details.errorCode, /^UPD-[0-9a-f]{8}$/);
  assert.doesNotMatch(details.errorCode, /secret|do-not-show/);
});
