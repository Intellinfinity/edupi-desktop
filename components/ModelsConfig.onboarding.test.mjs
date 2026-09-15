import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("models settings gives first-time users one tested setup path", async () => {
  const source = await read("./ModelsConfig.tsx");

  for (const label of ["选择厂商", "获取 API Key", "测试并保存"]) {
    assert.match(source, new RegExp(label));
  }
  for (const endpoint of ["/api/models-config/discover", "/api/models-config/test", "/api/models-config"]) {
    assert.match(source, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.match(source, /\/api\/auth\/api-key\/\$\{encodeURIComponent\(preset\.id\)\}/);
  assert.match(source, /hasUsableModelSetup/);
  assert.match(source, /handleExternalLinkClick/);
  assert.match(source, /rel="noreferrer"/);
  assert.match(source, /onSetupSaved/);
  assert.match(source, /availableProviderIds\.includes\(entry\.id\)/);
});

test("official first-run keys stay in AuthStorage instead of models.json", async () => {
  const source = await read("./ModelsConfig.tsx");
  const setupSource = source.slice(
    source.indexOf("function FirstModelSetup"),
    source.indexOf("// ── Add provider picker"),
  );

  assert.match(setupSource, /\/api\/auth\/api-key\//);
  const savedDefinition = setupSource.slice(setupSource.indexOf("const updated ="), setupSource.indexOf("const defaultResponse ="));
  assert.match(savedDefinition, /models: savedModels/);
  assert.doesNotMatch(savedDefinition, /apiKey|transientProvider/);
  assert.doesNotMatch(setupSource, /nextConfig|setConfig\(/);
  assert.match(setupSource, /transientProvider/);
  assert.match(setupSource, /onUseAdvanced/);
  assert.match(setupSource, /mergeModelEntries\(\[model\], previous\.models \|\| \[\], discoveredModels\)/);
  assert.match(setupSource, /onSetupSaved\(preset\.id, updated\)/);
  assert.match(source, /setConfig\(nextConfig\)/);
  assert.match(source, /savedSnapshotRef\.current = JSON\.stringify\(nextConfig\)/);
});

test("existing users keep the current provider tree and advanced editor", async () => {
  const source = await read("./ModelsConfig.tsx");

  assert.match(source, /models-settings-sidebar/);
  assert.match(source, /<ProviderDetail/);
  assert.match(source, /<ModelDetail/);
  assert.match(source, /<AddProviderPicker/);
});

test("saving a managed API key automatically loads models into the same provider panel", async () => {
  const source = await read("./ModelsConfig.tsx");
  assert.match(source, /\/api\/models-config\/provider-models\?provider=/);
  assert.match(source, /模型自动加载失败/);
  assert.match(source, /fetchWithRetry/);
  assert.match(source, /\/api\/models-config\/default/);
  assert.match(source, /loadModels\(true, true\)/);
  assert.match(source, /\+ 自定义模型/);
  assert.doesNotMatch(source, /配置模型名称与连接测试/);
  assert.match(source, /onConfigureProvider=\{configureApiKeyProvider\}/);
  assert.match(source, /onAddModel=\{\(\) => addModel\(p\.id, true\)\}/);
  assert.match(source, /onRemoveModel=\{\(index\) => removeModel\(p\.id, index, true\)\}/);
});
