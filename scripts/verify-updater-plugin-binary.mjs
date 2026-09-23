import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { validateUpdaterPublicKey } from "./configure-updater-public-key.mjs";

export async function verifyUpdaterPluginBinary(binaryPath, configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const publicKey = validateUpdaterPublicKey(config.plugins?.updater?.pubkey);
  const binary = await readFile(binaryPath);
  if (!binary.includes(Buffer.from(publicKey, "utf8"))) {
    throw new Error("The packaged desktop executable is missing the updater public key");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [binaryPath, configPath] = process.argv.slice(2);
  if (!binaryPath || !configPath) throw new Error("Usage: verify-updater-plugin-binary <binary> <tauri-config>");
  await verifyUpdaterPluginBinary(binaryPath, configPath);
  console.log("Verified updater public key in the packaged desktop executable.");
}
