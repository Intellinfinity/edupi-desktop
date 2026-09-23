import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, ModelScopeWarningBanner, canRestoreUserMessage, filterModelOptions, getUserMessageText, getUserMessageDraftImages } = await jiti.import("./ChatInput.tsx");
const { setDraft, clearDraft } = await jiti.import("../lib/draft-store.ts");
const { createComposerContext, composeTeacherMessage } = await jiti.import("../lib/edupi-composer-context.ts");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

/** The banner reads its title through useI18n, so it needs the provider. */
function renderWithI18n(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

test("renders the upstream model error", () => {
  const html = renderWithI18n(
    React.createElement(ModelErrorBanner, {
      error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
    }),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Model error/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(renderWithI18n(React.createElement(ModelErrorBanner, { error: null })), "");
});

test("renders enabledModels scope warnings", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelScopeWarningBanner, {
      warnings: ['No models match pattern "ghost-gateway/*"'],
    }),
  );

  assert.match(html, /Model scope warning/);
  assert.match(html, /ghost-gateway/);
  assert.equal(renderToStaticMarkup(React.createElement(ModelScopeWarningBanner, { warnings: [] })), "");
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        modelError: "Invalid models.json schema",
        modelList: [],
        modelNames: {},
      }),
    ),
  );

  assert.match(html, />No models</);
  assert.match(html, /title="No available models"/);
});

test("the send action is icon-only with an accessible name", () => {
  const html = renderWithI18n(React.createElement(ChatInput, {
    onSend() {},
    onAbort() {},
    isStreaming: false,
  }));

  assert.match(html, /aria-label="Send"/);
  assert.match(html, /title="Send"/);
  assert.doesNotMatch(html, />Send<\/button>/);
});

test("shows a compact removable page reference while leaving the teacher input empty", () => {
  const draftKey = "edupi-context-render-test";
  setDraft(draftKey, { value: "", images: [], context: { title: "第一课备课", reference: "教学任务：第一课备课\n任务 ID：task-1" } });
  try {
    const html = renderWithI18n(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: false, draftKey }));
    assert.match(html, /当前事项/);
    assert.match(html, /<strong title="第一课备课">第一课备课<\/strong>/);
    assert.match(html, /<summary>查看参考<\/summary>/);
    assert.match(html, /aria-label="移除第一课备课参考"/);
    assert.match(html, /placeholder="说说你希望 EduPi 做什么…"/);
    assert.match(html, /composer-send-button[^>]+disabled/);
  } finally {
    clearDraft(draftKey);
  }
});

test("a new teacher request waits for an explicit choice when a draft already exists", () => {
  const draftKey = "edupi-teacher-offer-test";
  setDraft(draftKey, { value: "原草稿", images: [], context: { title: "教学重点", reference: "教学重点" }, pendingTeacherText: "新要求" });
  try {
    const html = renderWithI18n(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: false, draftKey }));
    assert.match(html, /当前草稿未改/);
    assert.match(html, /新要求：新要求/);
    assert.match(html, /改用新要求/);
    assert.match(html, /追加到原草稿/);
    assert.match(html, /不带入/);
    assert.match(html, /composer-send-button[^>]+disabled/);
  } finally {
    clearDraft(draftKey);
  }
});

test("filters model options by name and id", () => {
  const options = [
    { provider: "ollama", modelId: "qwen3:latest", name: "Qwen 3" },
    { provider: "anthropic", modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { provider: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
  ];

  assert.deepEqual(filterModelOptions(options, "QWEN"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "claude-sonnet"), [options[1]]);
  assert.equal(filterModelOptions(options, "OpenAI").length, 0);
  assert.equal(filterModelOptions(options, "anthropic/claude").length, 0);
  assert.equal(filterModelOptions(options, "missing").length, 0);
  assert.equal(filterModelOptions(options, "  "), options);
});

test("restores text and base64 images when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Review this image @src/example.ts " },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
  };

  assert.equal(getUserMessageText(message), "Review this image @src/example.ts ");
  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/png" },
  ]);
});

test("restores legacy flat image entries when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "AQID", mimeType: "image/jpeg" },
    ],
  };

  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/jpeg" },
  ]);
});

test("does not restore a historical message over a pending image attachment", () => {
  assert.equal(canRestoreUserMessage("", 0, 0), true);
  assert.equal(canRestoreUserMessage("", 1, 0), false);
  assert.equal(canRestoreUserMessage("", 0, 1), false);
  assert.equal(canRestoreUserMessage("draft", 0, 0), false);
  assert.equal(canRestoreUserMessage("", 0, 0, true), false);
});

test("renders compact errors above the input as a wrapping alert", () => {
  const error = "Compaction failed: OpenAI API error (403): <html>request forbidden</html>";
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        isStreaming: false,
        compactError: error,
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Compaction failed: OpenAI API error/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
  assert.match(html, /white-space:pre-wrap/);
  assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
});

test("keeps streaming actions behind an accessible more menu", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(source, /queueMenuOpen/);
  assert.match(source, /aria-label=\{t\("chat\.moreStreamingActions"\)\}/);
  assert.match(source, /t\("chat\.steer"\)/);
  assert.match(source, /t\("chat\.followUp"\)/);
  assert.doesNotMatch(source, /\}\s*\{t\("chat\.stop"\)\}/);

  const withActions = renderWithI18n(React.createElement(ChatInput, {
    onSend() {}, onAbort() {}, onSteer() {}, onFollowUp() {}, isStreaming: true,
  }));
  const withoutActions = renderWithI18n(React.createElement(ChatInput, {
    onSend() {}, onAbort() {}, isStreaming: true,
  }));
  assert.match(withActions, /aria-label="More message actions"/);
  assert.match(withActions, /aria-label="Stop agent"/);
  assert.doesNotMatch(withoutActions, /aria-label="More message actions"/);
  assert.match(source, /setQueueMenuOpen\(false\)[\s\S]*setAttachmentMenuOpen\(false\)[\s\S]*\}, \[isStreaming\]\)/);
});

test("queued contextual follow-ups show teacher wording instead of the wire wrapper", () => {
  const queued = composeTeacherMessage(createComposerContext("教学任务：第一课备课"), "先核对材料");
  const html = renderWithI18n(React.createElement(ChatInput, {
    onSend() {}, onAbort() {}, onRecallQueue() {}, isStreaming: true,
    queuedMessages: { steering: [], followUp: [queued] },
  }));
  assert.match(html, /先核对材料/);
  assert.doesNotMatch(html, /EduPi 页面参考 v1/);
});

test("exposes plus attachment actions and a phone control affordance", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(source, /attachmentMenuOpen/);
  assert.match(source, /chat\.addAttachment/);
  assert.match(source, /chat\.addFile/);
  assert.match(source, /chat\.phoneControl/);
  assert.match(source, /edupi-open-settings/);
});
