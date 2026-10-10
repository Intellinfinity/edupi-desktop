import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;

function fixture(authorized) {
  const calls = [];
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body,
      { status: options.status ?? 200, headers: options.headers }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: async request => { calls.push("body"); return request.json(); } },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => authorized },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/isolated" } }) },
    "@/lib/edupi-prompt-outbox": { readEduPiPromptOutbox: () => { calls.push("outbox"); return {
      stage: "pi_unknown", command: { message: "合成教师原文" },
    }; } },
  };
  const result = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), name); return modules[name];
  }, result, result.exports);
  return { calls, post: body => result.exports.POST(new Request("http://localhost/api/edupi/proactivity/prompt/detail", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })) };
}

test("unauthorized detail read never opens the private outbox", async () => {
  const f = fixture(false);
  assert.equal((await f.post({ sessionId: "session-1", clientRequestId: "request-1" })).status, 403);
  assert.deepEqual(f.calls, []);
});

test("authenticated exact lookup returns only the requested teacher text without caching", async () => {
  const f = fixture(true);
  const response = await f.post({ sessionId: "session-1", clientRequestId: "request-1" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "pi_unknown", message: "合成教师原文", externalSend: false });
  assert.deepEqual(f.calls, ["body", "outbox"]);
  const invalid = await f.post({ sessionId: "session-1", clientRequestId: "request-1", extra: true });
  assert.equal(invalid.status, 400);
  assert.deepEqual(f.calls, ["body", "outbox", "body"]);
});
