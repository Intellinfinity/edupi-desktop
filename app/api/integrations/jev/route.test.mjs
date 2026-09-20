import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "edupi-jev-route-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = root;
const route = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

function request(method, body, headers = {}) {
  return new Request("http://localhost:30141/api/integrations/jev", {
    method,
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "sec-fetch-site": "same-origin",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("JEV settings API never returns the stored key", async () => {
  const response = await route.PUT(request("PUT", {
    enabled: true,
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    timeoutMs: 3_000,
    minConfidence: 0.6,
    maxConsecutiveFailures: 3,
    apiKey: "route-secret-value-123456",
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes("route-secret-value"), false);

  const getResponse = await route.GET(request("GET"));
  const status = await getResponse.json();
  assert.equal(status.keyConfigured, true);
  assert.equal("apiKey" in status, false);
});

test("JEV settings API rejects cross-site, non-JSON, unknown and oversized input", async () => {
  assert.equal((await route.PUT(request("PUT", {}, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await route.PUT(request("PUT", {}, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await route.PUT(request("PUT", { enabled: false, unknown: true }))).status, 400);
  assert.equal((await route.PUT(request("PUT", {
    enabled: false,
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "x".repeat(300),
    timeoutMs: 3_000,
    minConfidence: 0.6,
    maxConsecutiveFailures: 3,
  }))).status, 400);
});

test("JEV credential settings reject otherwise-valid LAN requests", async () => {
  const lanRequest = new Request("http://localhost:30141/api/integrations/jev", {
    headers: {
      host: "192.168.31.99:30141",
      origin: "http://192.168.31.99:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal((await route.GET(lanRequest)).status, 403);
});

test("JEV key removal is same-origin and leaves the public config", async () => {
  const response = await route.DELETE(request("DELETE"));
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.keyConfigured, false);
  assert.equal(status.enabled, true);
});

test("JEV connection test uses the saved server-side key and validates a real decision response", async () => {
  const server = http.createServer(async (incoming, outgoing) => {
    let body = "";
    for await (const chunk of incoming) body += chunk;
    assert.equal(incoming.headers.authorization, "Bearer route-local-secret-123456");
    const parsed = JSON.parse(body);
    const choices = Object.keys(parsed.questions.operation.criteria);
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.end(JSON.stringify({
      answers: {
        operation: {
          choice: "WAIT",
          confidence: 1,
          probabilities: Object.fromEntries(choices.map((choice) => [choice, choice === "WAIT" ? 1 : 0])),
        },
      },
      model: "jev-local-test",
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    assert.equal((await route.PUT(request("PUT", {
      enabled: true,
      endpoint: `http://127.0.0.1:${port}/v1/systemone`,
      model: "jev-local-test",
      timeoutMs: 3_000,
      minConfidence: 0.6,
      maxConsecutiveFailures: 3,
      apiKey: "route-local-secret-123456",
    }))).status, 200);

    const response = await route.POST(request("POST", {}));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.provider, "jev");
    assert.equal(body.model, "jev-local-test");
    assert.equal("apiKey" in body, false);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
