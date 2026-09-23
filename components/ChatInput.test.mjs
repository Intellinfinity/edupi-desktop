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

test("recalled messages stay separate from an unsent draft until the teacher chooses", () => {
  const draftKey = "edupi-queue-recall-test";
  const queued = composeTeacherMessage(createComposerContext("学生档案：李四"), "核对备注");
  setDraft(draftKey, { value: "旧要求", images: [], context: { title: "教学重点", reference: "教学重点" }, pendingQueueMessages: [queued] });
  try {
    const html = renderWithI18n(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: false, draftKey }));
    assert.match(html, /已收回 1 条后续消息，当前草稿未改/);
    assert.match(html, /改用后续消息/);
    assert.match(html, /追加到当前草稿/);
    assert.match(html, /复制待恢复内容/);
    assert.match(html, /旧要求/);
    assert.match(html, /当前事项/);
    assert.doesNotMatch(html, /EduPi 页面参考 v1/);
  } finally {
    clearDraft(draftKey);
  }
});

test("an unacknowledged server queue copy must be checked before the draft can be sent", () => {
  const draftKey = "edupi-server-queue-recovery-test";
  setDraft(draftKey, { value: "旧草稿", images: [], pendingQueueMessages: ["待恢复"],
    pendingQueueRecoveryId: "66666666-6666-4666-8666-666666666666", pendingQueuePrevious: [] });
  try {
    const html = renderWithI18n(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: false, draftKey, onResumeQueueRecovery() {} }));
    assert.match(html, /核对服务端副本/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>改用后续消息<\/button>/);
  } finally { clearDraft(draftKey); }
});

test("a prepared server record offers an explicit manual-review exit", () => {
  const draftKey = "edupi-prepared-queue-recovery-test";
  setDraft(draftKey, { value: "", images: [], pendingQueueMessages: ["待核对"],
    pendingQueueRecoveryId: "ffffffff-ffff-4fff-8fff-ffffffffffff", pendingQueuePrevious: [] });
  try {
    const html = renderWithI18n(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: false, draftKey,
      queueRecoveryRequiresReview: true, onAbandonPreparedQueueRecovery() {} }));
    assert.match(html, /保留副本，转人工核对/);
    assert.match(html, /复制待恢复内容/);
  } finally { clearDraft(draftKey); }
});

test("an uncertain empty queue asks the teacher to verify delivery before reusing the message", () => {
  const draftKey = "edupi-uncertain-queue-test";
  setDraft(draftKey, { value: "", images: [], pendingQueueMessages: ["可能未投递"], pendingQueueUncertain: true, pendingQueuePrevious: [] });
  try {
    const html = renderWithI18n(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: false, draftKey }));
    assert.match(html, /请先查看会话是否已收到，避免重复发送/);
    assert.match(html, /确认未送达，改用消息/);
    assert.match(html, /已送达，移除副本/);
  } finally { clearDraft(draftKey); }
});

test("active queue finalization rolls back the staged draft when local persistence fails", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const finalize = source.slice(source.indexOf("finalizeQueuedMessages(sessionId:"), source.indexOf("refreshQueueRecoveryStatus(key:"));
  assert.match(finalize, /const stagedDraft = getDraft\(sessionId\)/);
  assert.match(finalize, /if \(!flushDraftNow\(sessionId\)\) \{[\s\S]*setDraft\(sessionId, stagedDraft\)/);
  assert.ok(finalize.indexOf("setDraft(sessionId, stagedDraft)") < finalize.indexOf("setQueueReadyToAck(true)"));
});

test("an asynchronous failed prompt remains recoverable in its original draft", () => {
  const draftKey = "edupi-failed-prompt-render-test";
  setDraft(draftKey, { value: "后来写的内容", images: [], pendingFailedMessages: [{
    value: "先核对备注", images: [{ data: "AQID", mimeType: "image/png" }],
    context: { title: "学生档案", reference: "学生档案：李四" },
  }] });
  try {
    const html = renderWithI18n(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: false, draftKey }));
    assert.match(html, /发送未完成 · 1 条待恢复/);
    assert.match(html, /改用未发送内容/);
    assert.match(html, /复制文字与参考/);
    assert.match(html, /后来写的内容/);
    assert.doesNotMatch(html, /AQID/);
  } finally {
    clearDraft(draftKey);
  }
});

test("a pending teacher choice disables streaming queue actions", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(source, /canQueueStreamingMessage = hasInputText && attachedImages\.length === 0 && !pendingTeacherText && !bashMode && !queueSubmitting/);
  const sendQueued = source.slice(source.indexOf("const sendQueued = useCallback"), source.indexOf("const applyPendingQueue"));
  assert.match(sendQueued, /await onFollowUp\(message\)/);
  assert.ok(sendQueued.indexOf("await onFollowUp(message)") < sendQueued.indexOf("clearInput(msg.startsWith"));
  assert.match(sendQueued, /catch \(error\)[\s\S]*草稿已保留/);
  const draftKey = "edupi-streaming-choice-test";
  setDraft(draftKey, { value: "旧要求", images: [], pendingTeacherText: "新要求" });
  try {
    const html = renderWithI18n(React.createElement(ChatInput, { onSend() {}, onAbort() {}, onFollowUp() {}, isStreaming: true, draftKey }));
    assert.match(html, /新要求：新要求/);
    assert.match(html, /aria-label="More message actions"/);
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
