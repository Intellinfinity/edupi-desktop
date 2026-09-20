import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  OpenConnectorProvider,
  actionAllowed,
  classifyExternalAction,
  createActionAuthorization,
  resolveOpenConnectorConfig,
} = await jiti.import("./open-connector.ts");

function envelope(data, meta = {}) {
  return new Response(JSON.stringify({ success: true, message: "OK", data, meta }), { status: 200 });
}

function provider(fetchImpl, overrides = {}) {
  return new OpenConnectorProvider({
    baseUrl: "http://127.0.0.1:32123",
    runtimeToken: "runtime-secret",
    adminToken: "admin-secret",
    capabilities: {
      email: ["gmail.*"],
      github: ["github.*"],
      data: ["supabase.*", "airtable.*"],
    },
    fetchImpl,
    ...overrides,
  });
}

test("open connector is disabled by default and never enabled without a runtime token", () => {
  assert.equal(resolveOpenConnectorConfig({}).enabled, false);
  assert.equal(resolveOpenConnectorConfig({
    EDUPI_OPENCONNECTOR_ENABLED: "1",
    EDUPI_OPENCONNECTOR_BASE_URL: "http://127.0.0.1:32123",
  }).enabled, false);
  assert.equal(resolveOpenConnectorConfig({
    EDUPI_OPENCONNECTOR_CAPABILITY_ACTIONS: "{invalid",
  }).enabled, false);
  assert.equal(resolveOpenConnectorConfig({
    EDUPI_OPENCONNECTOR_ENABLED: "1",
    EDUPI_OPENCONNECTOR_BASE_URL: "http://connector.example.test",
    EDUPI_OPENCONNECTOR_RUNTIME_TOKEN: "runtime-secret-123456",
  }).enabled, false);
});

test("capability policy exposes only its provider subset", () => {
  assert.equal(actionAllowed("gmail.search_messages", "email", { email: ["gmail.*"], github: ["github.*"] }), true);
  assert.equal(actionAllowed("gmail.search_messages", "github", { email: ["gmail.*"], github: ["github.*"] }), false);
  assert.equal(actionAllowed("unknown.delete", "email", { email: ["gmail.*"] }), false);
});

test("provider catalog is normalized to the adapter contract", async () => {
  const open = provider(async () => envelope([{ service: "gmail", displayName: "Gmail" }]));
  assert.deepEqual(await open.listProviders(), [{ id: "gmail", name: "Gmail" }]);
});

test("risk classification defaults writes and external messages to confirmation", () => {
  assert.equal(classifyExternalAction("gmail.search_messages").risk, "low");
  assert.equal(classifyExternalAction("github.create_issue").risk, "high");
  assert.equal(classifyExternalAction("slack.post_message").risk, "high");
  assert.equal(classifyExternalAction("airtable.update_record").risk, "high");
  assert.equal(classifyExternalAction("supabase.query_table").risk, "low");
  assert.equal(classifyExternalAction("github.merge_pull_request").risk, "high");
  assert.equal(classifyExternalAction("gmail.archive_thread").risk, "high");
  assert.equal(classifyExternalAction("drive.upload_file").risk, "high");
  assert.equal(classifyExternalAction("custom.unknown_action").risk, "high");
  assert.equal(classifyExternalAction("custom.get_but_writes", "write").risk, "high");
  assert.equal(classifyExternalAction("custom.archive_snapshot", "read").risk, "low");
});

test("search filters the full action catalog by capability", async () => {
  const calls = [];
  const open = provider(async (url, init) => {
    calls.push([String(url), init]);
    return envelope([
      { id: "gmail.search_messages", name: "Search messages", inputSchema: { type: "object" } },
      { id: "github.create_issue", name: "Create issue" },
      { id: "airtable.list_records", name: "List records" },
    ]);
  });
  const actions = await open.searchActions({ capability: "email", query: "messages" });
  assert.deepEqual(actions.map((action) => action.id), ["gmail.search_messages"]);
  assert.equal("inputSchema" in actions[0], false);
  assert.equal(calls[0][0], "http://127.0.0.1:32123/v1/actions/search?query=messages");
  assert.equal(calls[0][1].headers.authorization, "Bearer runtime-secret");
});

test("runtime URLs preserve a configured mount prefix", async () => {
  const calls = [];
  const open = provider(async (url) => {
    calls.push(String(url));
    return envelope([{ id: "gmail.search_messages" }]);
  }, { baseUrl: "http://127.0.0.1:32123/connector" });

  await open.searchActions({ capability: "email", query: "messages" });

  assert.deepEqual(calls, ["http://127.0.0.1:32123/connector/v1/actions/search?query=messages"]);
});

test("high-risk execution is refused before network without exact teacher authorization", async () => {
  let networkCalled = false;
  const open = provider(async () => {
    networkCalled = true;
    return envelope({});
  });
  await assert.rejects(
    open.executeAction({ actionId: "gmail.send_message", input: { to: "a@b.c" }, capability: "email", idempotencyKey: "same-key" }),
    (error) => error.code === "authorization_required",
  );
  assert.equal(networkCalled, false);
});

test("teacher authorization rejects future timestamps and invalid connection names", () => {
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  assert.throws(
    () => createActionAuthorization("gmail.send_message", {}, "default", "confirmation-1", future),
    (error) => error.code === "invalid_authorization",
  );
  assert.throws(
    () => createActionAuthorization("gmail.send_message", {}, "bad\nname", "confirmation-1"),
    (error) => error.code === "invalid_input",
  );
});

test("confirmed execution sends idempotency and returns a redacted receipt", async () => {
  const calls = [];
  const open = provider(async (url, init) => {
    calls.push([String(url), init.method, init.headers]);
    return envelope({ messageId: 123, apiKey: "must-not-leak" }, { executionId: "run-1", actionId: "gmail.send_message", auditPersisted: true });
  });
  const input = { to: "teacher@example.test", body: "Hello" };
  const authorization = createActionAuthorization("gmail.send_message", input, "default", "teacher-confirm-1");
  const receipt = await open.executeAction({ actionId: "gmail.send_message", input, capability: "email", idempotencyKey: "same-key", authorization });
  assert.equal(receipt.executionId, "run-1");
  assert.equal(receipt.idempotencyKey, "same-key");
  assert.equal(receipt.result.apiKey, "[redacted]");
  assert.equal(calls[0][0], "http://127.0.0.1:32123/v1/actions/gmail.send_message");
  assert.equal(calls[0][1], "POST");
  assert.equal(calls[0][2]["Idempotency-Key"], "same-key");
  assert.equal(calls[0][2]["x-oo-connector-alias"], "default");
});

test("completed provider failures return a failed execution receipt", async () => {
  const open = provider(async (url, init) => init.method === "GET"
    ? envelope({ id: "gmail.search_messages", operationType: "read" })
    : new Response(JSON.stringify({
      success: false,
      message: "Provider rejected the request",
      data: { upstreamStatus: 409 },
      errorCode: "provider_error",
      meta: { executionId: "run-failed", actionId: "gmail.search_messages", auditPersisted: true },
    }), { status: 500 }));

  const receipt = await open.executeAction({
    actionId: "gmail.search_messages",
    input: { query: "report" },
    capability: "email",
    idempotencyKey: "failed-key",
  });

  assert.equal(receipt.executionId, "run-failed");
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.error.code, "provider_error");
  assert.equal(receipt.error.details.upstreamStatus, 409);
});

test("completed failure messages redact bearer credentials", async () => {
  const open = provider(async (url, init) => init.method === "GET"
    ? envelope({ id: "gmail.search_messages", operationType: "read" })
    : new Response(JSON.stringify({
      success: false,
      message: "upstream rejected Bearer provider-secret-value",
      data: null,
      errorCode: "provider_error",
      meta: { executionId: "run-redacted", actionId: "gmail.search_messages", auditPersisted: true },
    }), { status: 500 }));

  const receipt = await open.executeAction({ actionId: "gmail.search_messages", input: {}, capability: "email" });

  assert.equal(JSON.stringify(receipt).includes("provider-secret-value"), false);
});

test("overly deep action input is rejected before any network call", async () => {
  let networkCalled = false;
  const open = provider(async () => {
    networkCalled = true;
    return envelope({});
  });
  const input = {};
  let cursor = input;
  for (let index = 0; index < 101; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }

  await assert.rejects(
    open.executeAction({ actionId: "gmail.search_messages", input, capability: "email" }),
    (error) => error.code === "invalid_input",
  );
  assert.equal(networkCalled, false);
});

test("execution receipts use admin auth and are redacted", async () => {
  const calls = [];
  const open = provider(async (url, init) => {
    calls.push([String(url), init.headers.authorization]);
    if (String(url).includes("/v1/actions/")) return envelope({ id: "gmail.send_message", operationType: "write" });
    return new Response(JSON.stringify({
      id: "run-1",
      actionId: "gmail.send_message",
      connectionId: "connection-1",
      inputSummary: { password: "secret" },
      outputSummary: { token: "secret" },
      ok: true,
      completedAt: "2026-09-19T01:00:00.000Z",
    }), { status: 200 });
  });
  const receipt = await open.getExecutionReceipt("run-1", "email");
  assert.equal(receipt.executionId, "run-1");
  assert.equal(receipt.input.password, "[redacted]");
  assert.equal(receipt.output.token, "[redacted]");
  assert.equal(receipt.connectionId, "connection-1");
  assert.equal(receipt.at, "2026-09-19T01:00:00.000Z");
  assert.deepEqual(calls, [
    ["http://127.0.0.1:32123/api/runs/run-1", "Bearer admin-secret"],
    ["http://127.0.0.1:32123/v1/actions/gmail.send_message", "Bearer runtime-secret"],
  ]);
});

test("connection management stays on admin endpoints and never returns credentials", async () => {
  const calls = [];
  const open = provider(async (url, init) => {
    calls.push([String(url), init.method, init.headers.authorization]);
    return envelope({ service: "github", alias: "default", status: "active" });
  });
  const connection = await open.connect({ service: "github", authType: "api_key", values: { apiKey: "github-secret" } });
  assert.equal(connection.service, "github");
  assert.equal("apiKey" in connection, false);
  assert.deepEqual(calls, [["http://127.0.0.1:32123/v1/connections/github/connect/api-key", "POST", "Bearer admin-secret"]]);
});

test("connection creation follows the v1 programmatic connection paths", async () => {
  const calls = [];
  const open = provider(async (url, init) => {
    calls.push([String(url), init.method, JSON.parse(String(init.body))]);
    return envelope({ service: "github", alias: "generated-alias", status: "active" });
  });

  await open.connect({ service: "github", authType: "api_key", values: { apiKey: "github-secret" } });

  assert.deepEqual(calls, [[
    "http://127.0.0.1:32123/v1/connections/github/connect/api-key",
    "POST",
    { apiKey: "github-secret" },
  ]]);
});

test("disconnect accepts raw admin responses", async () => {
  const calls = [];
  const open = provider(async (url, init) => {
    calls.push([String(url), init.method, init.headers.authorization]);
    return new Response(JSON.stringify({ service: "github", configured: false }), { status: 200 });
  });

  const result = await open.disconnect({ service: "github", connectionName: "work" });

  assert.deepEqual(result, { disconnected: true });
  assert.deepEqual(calls, [["http://127.0.0.1:32123/api/connections/github?alias=work", "DELETE", "Bearer admin-secret"]]);
});

test("idempotency keys use the runtime UTF-8 byte limit", async () => {
  const open = provider(async () => envelope({}, { executionId: "run-1", actionId: "gmail.search_messages" }));
  await assert.rejects(
    open.executeAction({
      actionId: "gmail.search_messages",
      input: {},
      capability: "email",
      idempotencyKey: "好".repeat(86),
    }),
    (error) => error.code === "invalid_input",
  );
});

test("unknown capability actions cannot be inspected or executed", async () => {
  const open = provider(async () => envelope({ id: "slack.post_message" }));
  await assert.rejects(open.inspectAction({ actionId: "slack.post_message", capability: "email" }), (error) => error.code === "action_not_allowed");
});

test("action inspection rejects a mismatched runtime response", async () => {
  const open = provider(async () => envelope({ id: "slack.post_message" }));
  await assert.rejects(
    open.inspectAction({ actionId: "gmail.search_messages", capability: "email" }),
    (error) => error.code === "invalid_action",
  );
});

test("missing runtime operation metadata defaults the inspected action to high risk", async () => {
  const open = provider(async () => envelope({ id: "gmail.search_messages" }));
  const inspection = await open.inspectAction({ actionId: "gmail.search_messages", capability: "email" });
  assert.equal(inspection.risk, "high");
});

test("execution receipts stay capability-scoped", async () => {
  const open = provider(async () => new Response(JSON.stringify({
    id: "run-1",
    actionId: "github.get_issue",
    ok: true,
    completedAt: "2026-09-19T01:00:00.000Z",
  }), { status: 200 }));

  await assert.rejects(
    open.getExecutionReceipt("run-1", "email"),
    (error) => error.code === "action_not_allowed",
  );
});
