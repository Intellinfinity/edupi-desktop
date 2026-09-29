#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preparePinnedWindowsNativeAsset, verifyStagedWindowsNativeAsset } from "./windows-native-asset.mjs";

const action = process.argv[2];
if (action !== "stage" && action !== "verify") {
  console.error("Expected stage or verify");
  process.exitCode = 1;
} else if (process.platform !== "win32") {
  console.log(JSON.stringify({ status: "skipped", platform: process.platform }));
} else {
  try {
    const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const compatibility = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
    const input = {
      coreRoot: process.env.EDUPI_CORE_ROOT,
      coreCommit: compatibility.core_runtime.core_commit,
      destinationRoot: path.join(desktopRoot, "src-tauri/resources/edupi-core"),
    };
    const result = action === "stage" ? preparePinnedWindowsNativeAsset(input) : verifyStagedWindowsNativeAsset(input);
    console.log(JSON.stringify(result
      ? { status: "passed", action, size: result.size, digest: result.digest }
      : { status: "pending", action }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Windows native asset operation failed");
    process.exitCode = 1;
  }
}
