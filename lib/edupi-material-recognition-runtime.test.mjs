import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const recognition = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./edupi-material-recognition.ts");

const model = { provider: "fixture-provider", id: "fixture-model", name: "Fixture model" };
const runtime = {
  getModel(provider, modelId) {
    return provider === model.provider && modelId === model.id ? model : undefined;
  },
  getProvider(provider) {
    return provider === model.provider ? { id: provider } : undefined;
  },
  hasConfiguredAuth() {
    return true;
  },
};
const registry = {
  find: runtime.getModel,
  hasConfiguredAuth: () => true,
};
const settings = {
  getDefaultProvider: () => "fixture-provider",
  getDefaultModel: () => "fixture-model",
};

test("resolves explicit provider/model overrides before the configured default", async () => {
  const resolved = await recognition.resolveRecognitionRuntime({
    env: {
      EDUPI_RECOGNITION_PROVIDER: model.provider,
      EDUPI_RECOGNITION_MODEL: model.id,
    },
    modelRuntime: runtime,
    modelRegistry: registry,
    settingsManager: settings,
    cwd: "/tmp/edupi-recognition-cwd",
    agentDir: "/tmp/edupi-recognition-agent",
  });
  assert.equal(resolved.model, model);
  assert.equal(resolved.provider, model.provider);
  assert.equal(resolved.modelId, model.id);
  assert.equal(resolved.source, "override");
});

test("uses the configured Pi default when recognition overrides are absent", async () => {
  const resolved = await recognition.resolveRecognitionRuntime({
    env: {},
    modelRuntime: runtime,
    modelRegistry: registry,
    settingsManager: settings,
    cwd: "/tmp/edupi-recognition-cwd",
    agentDir: "/tmp/edupi-recognition-agent",
  });
  assert.equal(resolved.model, model);
  assert.equal(resolved.source, "default");
});

test("runs with the selected model and an isolated no-resource, no-tools session", async () => {
  const sessionOptions = [];
  const loaderOptions = [];
  const promptCalls = [];
  let disposeCalls = 0;
  const loader = {
    async reload() {},
    getExtensions: () => ({ extensions: [] }),
    getSkills: () => ({ skills: [] }),
    getPrompts: () => ({ prompts: [] }),
    getThemes: () => ({ themes: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "fixture system prompt",
    getAppendSystemPrompt: () => [],
  };
  const output = await recognition.runRecognitionModel({
    originalName: "校历.png",
    text: "正文",
    images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
  }, {
    modelRuntime: runtime,
    modelRegistry: registry,
    settingsManager: settings,
    cwd: "/tmp/edupi-recognition-cwd",
    agentDir: "/tmp/edupi-recognition-agent",
    createResourceLoader: (options) => {
      loaderOptions.push(options);
      return loader;
    },
    createSession: async (options) => {
      sessionOptions.push(options);
      return {
        session: {
          messages: [{
            role: "assistant",
            stopReason: "stop",
            content: [{ type: "text", text: '{"events":[],"slots":[]}' }],
          }],
          async prompt(prompt, options) {
            promptCalls.push({ prompt, options });
          },
          dispose() {
            disposeCalls += 1;
          },
        },
      };
    },
  });

  assert.equal(output, '{"events":[],"slots":[]}');
  assert.equal(sessionOptions.length, 1);
  assert.equal(sessionOptions[0].model, model);
  assert.equal(sessionOptions[0].thinkingLevel, "off");
  assert.deepEqual(sessionOptions[0].tools, []);
  assert.equal(sessionOptions[0].noTools, "all");
  assert.deepEqual(sessionOptions[0].sessionManager.getEntries(), []);
  assert.equal(loaderOptions.length, 1);
  assert.equal(loaderOptions[0].noExtensions, true);
  assert.equal(loaderOptions[0].noSkills, true);
  assert.equal(loaderOptions[0].noPromptTemplates, true);
  assert.equal(loaderOptions[0].noThemes, true);
  assert.equal(loaderOptions[0].noContextFiles, true);
  assert.equal(typeof loaderOptions[0].systemPrompt, "string");
  assert.deepEqual(loaderOptions[0].appendSystemPrompt, []);
  assert.equal(promptCalls.length, 1);
  assert.match(promptCalls[0].prompt, /文件名：校历\.png/);
  assert.match(promptCalls[0].prompt, /材料正文：\n正文/);
  assert.deepEqual(promptCalls[0].options.images, [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }]);
  assert.equal(promptCalls[0].options.expandPromptTemplates, false);
  assert.equal(promptCalls[0].options.source, "rpc");
  assert.equal(disposeCalls, 1);
});

test("a trusted OCR page is labelled as OCR and forbids typed or unquoted schedule fields", async () => {
  let capturedPrompt = "";
  const ocrLoader = {
    async reload() {},
    getExtensions: () => ({ extensions: [] }),
    getSkills: () => ({ skills: [] }),
    getPrompts: () => ({ prompts: [] }),
    getThemes: () => ({ themes: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "fixture system prompt",
    getAppendSystemPrompt: () => [],
  };
  await recognition.runRecognitionModel({
    originalName: "扫描日程.png", text: "会议 2026年9月24日", images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
    sourceTextKind: "trusted_ocr",
  }, {
    modelRuntime: runtime, modelRegistry: registry, settingsManager: settings,
    cwd: "/tmp/edupi-recognition-cwd", agentDir: "/tmp/edupi-recognition-agent",
    createResourceLoader: () => ocrLoader,
    createSession: async () => ({ session: {
      messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: '{"events":[],"slots":[]}' }] }],
      async prompt(prompt) { capturedPrompt = prompt; },
    } }),
  });
  assert.match(capturedPrompt, /本地 OCR 高置信文字/);
  assert.match(capturedPrompt, /evidence_quote/);
  assert.match(capturedPrompt, /不得输出 time_interval、location 或 slots/);
});

test("rejects errored assistant output and sanitizes prompt failures while disposing", async () => {
  let disposeCalls = 0;
  await assert.rejects(
    recognition.runRecognitionModel({ originalName: "通知.pdf", text: "正文", images: [] }, {
      modelRuntime: runtime,
      modelRegistry: registry,
      settingsManager: settings,
      cwd: "/tmp/edupi-recognition-cwd",
      agentDir: "/tmp/edupi-recognition-agent",
      createSession: async () => ({
        session: {
          messages: [{
            role: "assistant",
            stopReason: "error",
            errorMessage: "secret-token=should-not-leak",
            content: [{ type: "text", text: "secret-token=should-not-leak" }],
          }],
          async prompt() {
            throw new Error("secret-token=should-not-leak /private/config/path");
          },
          dispose() {
            disposeCalls += 1;
          },
        },
      }),
    }),
    (error) => error?.code === "model_unavailable"
      && error?.diagnosticCategory === "prompt_failed"
      && !String(error.message).includes("secret-token")
      && !String(error.message).includes("/private/config/path"),
  );
  assert.equal(disposeCalls, 1);
});

test("rejects an aborted assistant response as unavailable", async () => {
  await assert.rejects(
    recognition.runRecognitionModel({ originalName: "通知.pdf", text: "正文", images: [] }, {
      modelRuntime: runtime,
      modelRegistry: registry,
      settingsManager: settings,
      cwd: "/tmp/edupi-recognition-cwd",
      agentDir: "/tmp/edupi-recognition-agent",
      createSession: async () => ({
        session: {
          messages: [{ role: "assistant", stopReason: "aborted", content: [] }],
          async prompt() {},
        },
      }),
    }),
    (error) => error?.code === "model_unavailable" && error?.diagnosticCategory === "prompt_aborted",
  );
});

test("reports a sanitized category when no configured model exists", async () => {
  await assert.rejects(
    recognition.resolveRecognitionRuntime({
      env: {},
      modelRuntime: { getModel: () => undefined, getProvider: () => undefined },
      modelRegistry: { find: () => undefined },
      settingsManager: { getDefaultProvider: () => undefined, getDefaultModel: () => undefined },
      cwd: "/tmp/edupi-recognition-cwd",
      agentDir: "/tmp/edupi-recognition-agent",
    }),
    (error) => error?.code === "model_unavailable"
      && error?.diagnosticCategory === "config_missing"
      && !String(error.message).includes("/tmp/edupi-recognition-agent"),
  );
});
