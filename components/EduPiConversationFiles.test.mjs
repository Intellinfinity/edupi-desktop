import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiConversationFiles } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiConversationFiles.tsx");

test("conversation file utilities use icons with accessible names", () => {
  const closed = renderToStaticMarkup(React.createElement(EduPiConversationFiles, { sessionId: "session-1", cwd: "/tmp/workspace" }));
  assert.match(closed, /class="[^"]*edupi-conversation-files/);
  assert.match(closed, /aria-label="查看本次产物"/);
  assert.doesNotMatch(closed, />文件 [⌃⌄]</);

  const open = renderToStaticMarkup(React.createElement(EduPiConversationFiles, { sessionId: "session-1", taskId: "task-1", cwd: "/tmp/workspace" }));
  assert.match(open, /aria-label="收起本次产物"/);
  assert.match(open, /role="dialog"/);
  assert.match(open, /class="edupi-chat-utility__panel edupi-conversation-files__panel"/);
  assert.match(open, /aria-label="同步对话文件"/);
  assert.doesNotMatch(open, />同步对话文件</);
});
