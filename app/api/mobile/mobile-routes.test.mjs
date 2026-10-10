import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";

test("mobile routes keep the first phase read-only except scoped continuation", () => {
  const files = [
    "pairing/route.ts",
    "pair/route.ts",
    "sessions/route.ts",
    "sessions/[id]/route.ts",
    "sessions/[id]/messages/route.ts",
    "summary/route.ts",
    "logout/route.ts",
  ];
  for (const file of files) assert.ok(fs.existsSync(new URL(`./${file}`, import.meta.url)), file);
  const message = fs.readFileSync(new URL("./sessions/[id]/messages/route.ts", import.meta.url), "utf8");
  assert.match(message, /mobile_prompt/);
  assert.match(message, /accessMode: "approval"/);
  assert.doesNotMatch(message, /edupi_.*create|edupi_.*update|openconnector/i);
  const mobilePage = fs.readFileSync(new URL("../../mobile/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(mobilePage, /localStorage/);
});

test("mobile continuation rechecks Core activation after cold session awaits", async () => {
  const source = fs.readFileSync(new URL("./sessions/[id]/messages/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  let checks = 0, sent = 0;
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status ?? 200 }) } },
    "@/lib/mobile-bridge": { authorizeMobileRequest: () => true },
    "@/lib/mobile-session": { readMobileSession: async () => ({ id: "session-1" }) },
    "@/lib/session-reader": { resolveSessionPath: async () => "/synthetic/session.jsonl" },
    "@/lib/harness/runtime": { startHarnessSession: async () => ({ session: {
      send: async command => { if (command.type === "mobile_prompt") sent++; return {}; },
    } }) },
    "@/lib/edupi-direct-prompt-gate": { eduPiDirectPromptGate: () => ++checks === 1 ? "allowed" : "core_first_required" },
  };
  const result = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), name); return modules[name];
  }, result, result.exports);
  const response = await result.exports.POST(new Request("http://localhost/api/mobile/sessions/session-1/messages", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "合成消息" }),
  }), { params: Promise.resolve({ id: "session-1" }) });
  assert.equal(response.status, 409);
  assert.equal(sent, 0);
});
