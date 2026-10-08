import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiAmbientPendingBanner } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } })
  .import("./EduPiAmbientPendingBanner.tsx");

test("a durable unknown outcome remains visible in the chat until exact verification", () => {
  assert.equal(renderToStaticMarkup(React.createElement(EduPiAmbientPendingBanner, { count: 0, onVerify() {} })), "");
  const html = renderToStaticMarkup(React.createElement(EduPiAmbientPendingBanner, { count: 1, onVerify() {} }));
  assert.match(html, /请求结果待核对/);
  assert.match(html, /请勿重复发送/);
  assert.match(html, /核对/);
  assert.match(html, /role="status"/);
  const unconfirmed = renderToStaticMarkup(React.createElement(EduPiAmbientPendingBanner,
    { count: 1, unconfirmedCount: 1, onVerify() {} }));
  assert.match(unconfirmed, /未证实已捕获/);
});
