import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EDUPI_RELEASE_REPOSITORY = "PIGU-PPPgu/edupi-desktop";
export const EDUPI_RELEASE_WRITE_REPOSITORY = "Intellinfinity/edupi-desktop";
export const EDUPI_UPDATER_ENDPOINTS = [
  "https://raw.githubusercontent.com/PIGU-PPPgu/edupi-desktop/updater-feed/latest.json",
  "https://github.com/PIGU-PPPgu/edupi-desktop/releases/latest/download/latest.json",
];
// Kept as a named compatibility export for older sentinel tests and scripts.
export const EDUPI_UPDATER_ENDPOINT = EDUPI_UPDATER_ENDPOINTS[0];

export const RELEASE_DESTINATION_FILES = [
  ".github/workflows/release.yml",
  "src-tauri/tauri.conf.json",
  "src-tauri/resources/component-versions.json",
  "scripts/release-components.mjs",
  "scripts/bump-pi-agent-desktop-version.mjs",
  "lib/app-updates.ts",
  "lib/branding.ts",
];

const scriptRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export async function readReleaseDestinationFiles(root = scriptRoot) {
  return Object.fromEntries(
    await Promise.all(
      RELEASE_DESTINATION_FILES.map(async (path) => [
        path,
        await readFile(join(root, path), "utf8"),
      ]),
    ),
  );
}

function requireText(errors, source, expected, message) {
  if (!source.includes(expected)) errors.push(message);
}

function exactYamlValues(source, key) {
  return [...source.matchAll(new RegExp(`^\\s+${key}:\\s*([^#\\s]+)\\s*$`, "gm"))].map(
    (match) => match[1],
  );
}

export function releaseDestinationErrors(files) {
  const errors = [];
  const releaseWorkflow = files[".github/workflows/release.yml"];
  const tauriConfigSource = files["src-tauri/tauri.conf.json"];
  const componentManifestSource = files["src-tauri/resources/component-versions.json"];

  for (const path of RELEASE_DESTINATION_FILES) {
    if (typeof files[path] !== "string") errors.push(`missing sentinel input: ${path}`);
  }
  if (errors.length > 0) return errors;

  if (releaseWorkflow.includes("EDUPI_RELEASE_TOKEN")) {
    errors.push("release workflow must use the current repository token");
  }
  requireText(
    errors,
    releaseWorkflow,
    "GITHUB_TOKEN: ${{ github.token }}",
    "release workflow must publish with the current repository token",
  );
  requireText(
    errors,
    releaseWorkflow,
    "owner: Intellinfinity",
    "release workflow must target the EduPi release owner",
  );
  requireText(
    errors,
    releaseWorkflow,
    "repo: edupi-desktop",
    "release workflow must target the EduPi release repository",
  );
  requireText(
    errors,
    releaseWorkflow,
    `RELEASE_REPOSITORY: ${EDUPI_RELEASE_WRITE_REPOSITORY}`,
    "release manifest must publish to the EduPi release repository",
  );
  if (JSON.stringify(exactYamlValues(releaseWorkflow, "owner")) !== '["Intellinfinity"]') {
    errors.push("release workflow must have exactly one EduPi release owner");
  }
  if (JSON.stringify(exactYamlValues(releaseWorkflow, "repo")) !== '["edupi-desktop"]') {
    errors.push("release workflow must have exactly one EduPi release repository");
  }
  for (const line of releaseWorkflow.split("\n").filter((line) => line.includes("gh release "))) {
    if (!line.includes('--repo "$RELEASE_REPOSITORY"')) {
      errors.push("every gh release command must use the guarded release repository");
    }
  }

  let tauriConfig;
  try {
    tauriConfig = JSON.parse(tauriConfigSource);
  } catch {
    errors.push("Tauri configuration must remain valid JSON");
  }
  if (
    tauriConfig &&
    JSON.stringify(tauriConfig.plugins?.updater?.endpoints) !==
      JSON.stringify(EDUPI_UPDATER_ENDPOINTS)
  ) {
    errors.push("Tauri updater must list the raw EduPi feed before the migration fallback endpoint");
  }

  let componentManifest;
  try {
    componentManifest = JSON.parse(componentManifestSource);
  } catch {
    errors.push("component version manifest must remain valid JSON");
  }
  const desktopComponent = componentManifest?.components?.find(
    (component) => component.id === "pi-agent-desktop",
  );
  if (desktopComponent?.repository !== EDUPI_RELEASE_REPOSITORY) {
    errors.push("desktop component metadata must use the EduPi release repository");
  }

  const sourceExpectations = [
    [
      "scripts/release-components.mjs",
      `"pi-agent-desktop": "${EDUPI_RELEASE_REPOSITORY}"`,
      "release component lookup must use the EduPi release repository",
    ],
    [
      "scripts/bump-pi-agent-desktop-version.mjs",
      `fetchLatestRelease("${EDUPI_RELEASE_REPOSITORY}"`,
      "desktop version bump must read the EduPi release repository",
    ],
    [
      "lib/app-updates.ts",
      `repository: "${EDUPI_RELEASE_REPOSITORY}"`,
      "update checks must read the EduPi release repository",
    ],
    [
      "lib/branding.ts",
      `APP_REPOSITORY = "${EDUPI_RELEASE_REPOSITORY}"`,
      "application branding must link to the EduPi release repository",
    ],
  ];
  for (const [path, expected, message] of sourceExpectations) {
    requireText(errors, files[path], expected, message);
  }

  const activeDestinations = RELEASE_DESTINATION_FILES.map((path) => files[path]).join("\n");
  if (activeDestinations.includes("abcwyc/pi-agent-desktop")) {
    errors.push("the desktop upstream may not be an active release or update destination");
  }

  return errors;
}

export function verifyReleaseDestinations(files) {
  const errors = releaseDestinationErrors(files);
  if (errors.length > 0) {
    throw new Error(`Release destination verification failed:\n- ${errors.join("\n- ")}`);
  }
}

export async function main() {
  verifyReleaseDestinations(await readReleaseDestinationFiles());
  console.log(
    `Release destinations verified: ${EDUPI_RELEASE_WRITE_REPOSITORY} (write), ${EDUPI_RELEASE_REPOSITORY} (legacy read) and ${EDUPI_UPDATER_ENDPOINTS.join(", ")}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
