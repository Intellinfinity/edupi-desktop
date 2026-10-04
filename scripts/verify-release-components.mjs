import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertDesktopPiVersion } from "./pi-packages.mjs";
import {
  compareVersions,
  createComponentManifest,
  isReleasePinValid,
  readLocalComponentVersions,
  readRemoteComponentVersions,
  rootDir,
} from "./release-components.mjs";

const local = await readLocalComponentVersions();
const compat = JSON.parse(await readFile(join(rootDir, "contracts/edupi-core-compat.json"), "utf8"));
const desktopPackage = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
assertDesktopPiVersion(desktopPackage, compat.core_sdk?.pi);
if (local.pi !== compat.core_sdk.pi) throw new Error("Installed Pi does not match the paired Core SDK");
const remote = await readRemoteComponentVersions();
const pins = JSON.parse(await readFile(join(rootDir, "scripts", "release-component-pins.json"), "utf8"));
const problems = [];
if (
  compareVersions(local.pi, remote.pi.version) !== 0
  && !isReleasePinValid(pins.pi, local.pi)
) {
  problems.push(`pi is ${local.pi}; latest Release is ${remote.pi.version}`);
}
if (
  compareVersions(local["pi-web"], remote["pi-web"].version) !== 0
  && !isReleasePinValid(pins["pi-web"], local["pi-web"])
) {
  problems.push(`pi-web is ${local["pi-web"]}; latest Release is ${remote["pi-web"].version}`);
}
if (
  remote["pi-agent-desktop"]
  && compareVersions(local["pi-agent-desktop"], remote["pi-agent-desktop"].version) < 0
) {
  problems.push(
    `pi-agent-desktop is ${local["pi-agent-desktop"]}; latest Release is ${remote["pi-agent-desktop"].version}`,
  );
}

const expectedManifest = createComponentManifest(local);
const actualManifest = JSON.parse(await readFile(
  join(rootDir, "src-tauri", "resources", "component-versions.json"),
  "utf8",
));
if (JSON.stringify(actualManifest) !== JSON.stringify(expectedManifest)) {
  problems.push("component-versions.json does not match the bundled package versions");
}

if (problems.length > 0) {
  throw new Error(`Release verification failed:\n- ${problems.join("\n- ")}`);
}
console.log(
  `Verified EduPi Desktop ${local["pi-agent-desktop"]}, pi ${local.pi}${isReleasePinValid(pins.pi, local.pi) ? " (pinned)" : ""}, pi-web ${local["pi-web"]}${isReleasePinValid(pins["pi-web"], local["pi-web"]) ? " (pinned)" : ""}.`,
);
