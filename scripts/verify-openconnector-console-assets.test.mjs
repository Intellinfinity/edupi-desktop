import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { verifyConsoleAssets } from "./verify-openconnector-console-assets.mjs";

test("pinned OpenConnector Console assets and license notices are complete", async () => {
  assert.deepEqual(await verifyConsoleAssets(), { version: "1.6.5", assets: 9 });
});

test("asset verification rejects drift and unexpected vendor files", async () => {
  const root = await mkdtemp(join(tmpdir(), "edupi-console-assets-"));
  try {
    await cp(resolve("desktop/open-connector-console-assets"), root, { recursive: true });
    await writeFile(join(root, "assets", "unexpected.js"), "console.log('unexpected')");
    await assert.rejects(verifyConsoleAssets(root), /console_assets_unexpected/u);
    await rm(join(root, "assets", "unexpected.js"));
    await writeFile(join(root, "index.html"), "<script src=\"https://example.test/a.js\"></script>");
    await assert.rejects(verifyConsoleAssets(root), /console_asset_drift/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
