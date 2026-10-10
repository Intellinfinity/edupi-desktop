import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path) {
  return ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
}
const compiled = compile("./[id]/route.ts");

function route(gate, { filePath = null } = {}) {
  const calls = [];
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status ?? 200 }) } },
    "@/lib/session-reader": { resolveSessionPath: async () => { calls.push("resolve"); return filePath; } },
    "@/lib/rpc-manager": { getRpcSession: () => { calls.push("session"); return null; } },
    "@/lib/harness/runtime": { startHarnessSession: async () => { calls.push("start"); return {
      session: { send: async () => { calls.push("send"); } },
    }; } },
    "@/lib/edupi-direct-prompt-gate": { eduPiDirectPromptGate: () => typeof gate === "function" ? gate() : gate },
  };
  const result = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), name); return modules[name];
  }, result, result.exports);
  return { calls, post: body => result.exports.POST(new Request("http://localhost/api/agent/session-1", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "session-1" }) }) };
}

test("an active Core gate refuses every direct Pi message command before opening a session", async () => {
  for (const body of [{ type: "prompt", message: "a" }, { type: "steer", message: "b" },
    { type: "follow_up", message: "c" }, { type: "mobile_prompt", message: "d" }]) {
    const f = route("core_first_required");
    const response = await f.post(body);
    assert.equal(response.status, 409);
    assert.deepEqual(f.calls, []);
  }
});

test("an unavailable installed Core gate fails closed while non-message reads continue", async () => {
  const f = route("unavailable");
  assert.equal((await f.post({ type: "prompt", message: "a" })).status, 503);
  assert.deepEqual(f.calls, []);
  assert.equal((await f.post({ type: "get_state" })).status, 404);
});

test("new-session message commands are gated before a Pi session is created", async () => {
  const calls = [];
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status ?? 200 }) } },
    fs: { existsSync: () => true },
    crypto: { randomUUID: () => "request-1" },
    "@/lib/file-access": { allowFileRoot: () => calls.push("allow") },
    "@/lib/session-reader": { invalidateSessionListCache: () => calls.push("invalidate") },
    "@/lib/harness/runtime": { startHarnessSession: async () => { calls.push("start"); throw new Error("unexpected start"); } },
    "@/lib/edupi-direct-prompt-gate": { eduPiDirectPromptGate: () => "core_first_required" },
  };
  const result = { exports: {} };
  new Function("require", "module", "exports", compile("./new/route.ts"))(name => {
    assert.ok(Object.hasOwn(modules, name), name); return modules[name];
  }, result, result.exports);
  for (const type of ["prompt", "steer", "follow_up", "mobile_prompt"]) {
    const response = await result.exports.POST(new Request("http://localhost/api/agent/new", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp/edupi-test", type, message: "hello" }),
    }));
    assert.equal(response.status, 409);
  }
  assert.deepEqual(calls, []);
});

test("a cold session rechecks activation after asynchronous startup before any Pi send", async () => {
  let checks = 0;
  const f = route(() => ++checks === 1 ? "allowed" : "core_first_required", { filePath: "/synthetic/session.jsonl" });
  assert.equal((await f.post({ type: "prompt", message: "a" })).status, 409);
  assert.deepEqual(f.calls, ["session", "resolve", "start"]);
});

test("a newly created session rechecks activation before its first Pi message", async () => {
  const calls = [];
  let checks = 0;
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status ?? 200 }) } },
    fs: { existsSync: () => true },
    crypto: { randomUUID: () => "request-1" },
    "@/lib/file-access": { allowFileRoot: () => {} },
    "@/lib/session-reader": { invalidateSessionListCache: () => {} },
    "@/lib/harness/runtime": { startHarnessSession: async () => ({ realSessionId: "pi-1", session: {
      send: async command => { calls.push(command.type); return {}; },
    } }) },
    "@/lib/edupi-direct-prompt-gate": { eduPiDirectPromptGate: () => ++checks === 1 ? "allowed" : "core_first_required" },
  };
  const result = { exports: {} };
  new Function("require", "module", "exports", compile("./new/route.ts"))(name => {
    assert.ok(Object.hasOwn(modules, name), name); return modules[name];
  }, result, result.exports);
  const response = await result.exports.POST(new Request("http://localhost/api/agent/new", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: "/tmp/edupi-test", type: "prompt", message: "hello" }),
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(calls, ["get_state"]);
});
