import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const input = { sessionId: "session-1", clientRequestId: "66666666-6666-4666-8666-666666666666",
  occurredAt: "2026-10-10T00:00:00.000Z", message: "合成私有消息", draftValue: "合成私有消息", cwd: "/synthetic/cwd" };

function fixture(authorized) {
  const calls = [];
  let status = "pending";
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body,
      { status: options.status ?? 200, headers: options.headers }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => { calls.push("body"); return request.json(); } },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => authorized },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/isolated" } }) },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_id, action) => action() },
    "@/lib/edupi-prompt-outbox": { readEduPiPromptOutbox: () => null },
    "@/lib/edupi-prompt-intent": {
      listEduPiPromptIntents: () => [{ ...input, status }],
      prepareEduPiPromptIntent: () => { calls.push("persist"); return { ...input, status }; },
      readEduPiPromptIntent: () => ({ ...input, status }),
      resolveEduPiPromptIntent: () => { calls.push("resolve"); status = "resolved"; return { ...input, status }; },
      discardEduPiPromptIntent: () => { calls.push("discard"); status = "discarded"; return { ...input, status }; },
    },
  };
  const result = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), name); return modules[name];
  }, result, result.exports);
  const request = (method, body) => new Request("http://localhost/api/edupi/proactivity/prompt/intent", {
    method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  return { calls, get: () => result.exports.GET(request("GET")),
    post: body => result.exports.POST(request("POST", body)),
    put: body => result.exports.PUT(request("PUT", body)),
    patch: body => result.exports.PATCH(request("PATCH", body)),
    delete: body => result.exports.DELETE(request("DELETE", body)) };
}

test("the private intent journal is inaccessible without the desktop token", async () => {
  const f = fixture(false);
  assert.equal((await f.post(input)).status, 403);
  assert.equal((await f.get()).status, 403);
  assert.deepEqual(f.calls, []);
});

test("intent list is text-free; exact readback and resolution remain explicit", async () => {
  const f = fixture(true);
  assert.equal((await f.post(input)).status, 200);
  const list = await (await f.get()).json();
  assert.equal(list.entries.length, 1);
  assert.equal(JSON.stringify(list).includes(input.message), false);
  assert.equal((await (await f.put({ sessionId: input.sessionId, clientRequestId: input.clientRequestId })).json()).message, input.message);
  assert.equal((await f.patch({ sessionId: input.sessionId, clientRequestId: input.clientRequestId,
    confirmedPiPersistence: true })).status, 200);
  assert.equal((await (await f.get()).json()).entries.length, 0);
  assert.deepEqual(f.calls, ["body", "persist", "body", "body", "resolve"]);
});

test("discarding an unbound intent requires a separate explicit teacher decision", async () => {
  const f = fixture(true);
  const id = { sessionId: input.sessionId, clientRequestId: input.clientRequestId };
  assert.equal((await f.delete(id)).status, 400);
  assert.equal((await f.delete({ ...id, confirmedManualDiscard: true })).status, 200);
  assert.equal((await (await f.get()).json()).entries.length, 0);
  assert.equal(f.calls.includes("discard"), true);
});
