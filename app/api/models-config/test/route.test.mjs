import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-model-test-agent-"));
process.env.PI_CODING_AGENT_DIR = agentRoot;
const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

function request(body) {
  return new Request("http://localhost/api/models-config/test", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

test("loopback models with a catalog cost missing cacheWrite can still be tested", async () => {
  let calls = 0;
  const server = http.createServer(async (_req, res) => {
    calls += 1;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end([
      `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const response = await POST(request({
      providerName: "local-e2",
      provider: { api: "openai-completions", baseUrl: `http://127.0.0.1:${port}/v1` },
      model: { id: "local", name: "local", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0 }, contextWindow: 1000, maxTokens: 16 },
    }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(agentRoot, { recursive: true, force: true });
  }
});

test("external custom models still require credentials", async () => {
  const response = await POST(request({
    providerName: "external-e2",
    provider: { api: "openai-completions", baseUrl: "https://example.invalid/v1" },
    model: { id: "external", name: "external", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 16 },
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.match(body.error, /No API key/);
});

test("IPv6 loopback custom models can be tested without an API key", async () => {
  let calls = 0;
  const server = http.createServer(async (_req, res) => {
    calls += 1;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end([
      `data: ${JSON.stringify({ id: "local-v6", object: "chat.completion.chunk", created: 1, model: "local-v6", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "local-v6", object: "chat.completion.chunk", created: 1, model: "local-v6", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "::1", resolve); });
  try {
    const port = server.address().port;
    const response = await POST(request({
      providerName: "local-v6-e2",
      provider: { api: "openai-completions", baseUrl: `http://[::1]:${port}/v1` },
      model: { id: "local-v6", name: "local-v6", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 16 },
    }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
