import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyUpdaterPluginBinary } from "./verify-updater-plugin-binary.mjs";

const publicKey = Buffer.from(
  "untrusted comment: minisign public key 0123456789ABCDEF\nRWRERERERERERERERERERERERERERERERERERERERERERERERERERE\n",
).toString("base64");

test("release binary must contain the exact configured updater public key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edupi-updater-binary-"));
  const binaryPath = join(directory, "EduPi");
  const configPath = join(directory, "tauri.conf.json");
  try {
    await writeFile(configPath, JSON.stringify({ plugins: { updater: { pubkey: publicKey } } }));
    await writeFile(binaryPath, Buffer.concat([Buffer.from("prefix\0"), Buffer.from(publicKey), Buffer.from("\0suffix")]));
    await verifyUpdaterPluginBinary(binaryPath, configPath);

    await writeFile(binaryPath, Buffer.from("binary without updater key"));
    await assert.rejects(verifyUpdaterPluginBinary(binaryPath, configPath), /missing the updater public key/);

    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.plugins.updater.pubkey = "";
    await writeFile(configPath, JSON.stringify(config));
    await assert.rejects(verifyUpdaterPluginBinary(binaryPath, configPath), /TAURI_UPDATER_PUBLIC_KEY is required/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
