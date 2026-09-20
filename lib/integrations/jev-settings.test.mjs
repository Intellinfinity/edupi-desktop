import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  clearJevApiKey,
  loadJevRuntimeEnvironment,
  readJevSettingsStatus,
  saveJevSettings,
} = await jiti.import("./jev-settings.ts");

async function withSettings(run) {
  const root = await mkdtemp(join(tmpdir(), "edupi-jev-settings-"));
  const configPath = join(root, "edupi-desktop", "jev.json");
  const authPath = join(root, "auth.json");
  await mkdir(root, { recursive: true });
  try {
    await run({ configPath, authPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("JEV settings keep the API key out of public config and persist private files", async () => {
  await withSettings(async (paths) => {
    const saved = await saveJevSettings({
      enabled: true,
      endpoint: "https://api.typesafe.ai/v1/systemone",
      model: "jev-latest",
      timeoutMs: 3_000,
      minConfidence: 0.65,
      maxConsecutiveFailures: 3,
      apiKey: "jev-secret-value-123456",
    }, paths);

    assert.equal(saved.enabled, true);
    assert.equal(saved.keyConfigured, true);
    assert.equal("apiKey" in saved, false);
    assert.equal((await readFile(paths.configPath, "utf8")).includes("jev-secret-value"), false);
    assert.equal((await stat(paths.configPath)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.authPath)).mode & 0o777, 0o600);

    const runtimeEnv = loadJevRuntimeEnvironment({}, paths);
    assert.equal(runtimeEnv.EDUPI_JEV_API_KEY, "jev-secret-value-123456");
    assert.equal(runtimeEnv.EDUPI_JEV_ENDPOINT, "https://api.typesafe.ai/v1/systemone");
    assert.equal((await readJevSettingsStatus({}, paths)).active, true);
  });
});

test("environment values override saved JEV settings without exposing the key", async () => {
  await withSettings(async (paths) => {
    await saveJevSettings({
      enabled: false,
      endpoint: "https://saved.example.test/v1/systemone",
      model: "saved-model",
      timeoutMs: 4_000,
      minConfidence: 0.7,
      maxConsecutiveFailures: 2,
      apiKey: "saved-secret-value-123456",
    }, paths);
    const status = await readJevSettingsStatus({
      EDUPI_JEV_ENABLED: "1",
      EDUPI_JEV_ENDPOINT: "https://env.example.test/v1/systemone",
      EDUPI_JEV_API_KEY: "env-secret-value-123456",
    }, paths);

    assert.equal(status.environmentManaged, true);
    assert.equal(status.endpoint, "https://env.example.test/v1/systemone");
    assert.equal(status.keyConfigured, true);
    assert.equal("apiKey" in status, false);
  });
});

test("clearing the JEV key preserves non-secret settings and disables the effective adapter", async () => {
  await withSettings(async (paths) => {
    await saveJevSettings({
      enabled: true,
      endpoint: "https://api.typesafe.ai/v1/systemone",
      model: "jev-latest",
      timeoutMs: 3_000,
      minConfidence: 0.6,
      maxConsecutiveFailures: 3,
      apiKey: "jev-secret-value-123456",
    }, paths);
    await clearJevApiKey(paths);

    const status = await readJevSettingsStatus({}, paths);
    assert.equal(status.enabled, true);
    assert.equal(status.keyConfigured, false);
    assert.equal(status.active, false);
  });
});

test("JEV settings reject insecure remote HTTP endpoints", async () => {
  await withSettings(async (paths) => {
    await assert.rejects(
      saveJevSettings({
        enabled: true,
        endpoint: "http://typesafe.example.test/v1/systemone",
        model: "jev-latest",
        timeoutMs: 3_000,
        minConfidence: 0.6,
        maxConsecutiveFailures: 3,
      }, paths),
      /HTTPS|loopback/,
    );
  });
});
