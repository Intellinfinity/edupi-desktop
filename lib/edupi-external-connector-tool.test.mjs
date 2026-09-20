import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createEduPiExternalConnectorTool } = await jiti.import("./edupi-external-connector-tool.ts");

function context(confirm = async () => true) {
  return { cwd: "/tmp/edupi", hasUI: true, ui: { confirm }, sessionManager: {} };
}

function provider() {
  return {
    searches: [],
    executions: [],
    async searchActions(input) {
      this.searches.push(input);
      return [{ id: "gmail.search_messages", name: "Search messages" }];
    },
    async inspectAction(input) {
      return {
        id: input.actionId,
        operationType: input.actionId === "custom.get_but_writes" ? "write" : input.actionId.includes("search") ? "read" : "destructive",
        inputSchema: { type: "object" },
      };
    },
    async executeAction(input) {
      this.executions.push(input);
      return {
        executionId: "run-1",
        actionId: input.actionId,
        connectionName: input.connectionName || "default",
        idempotencyKey: input.idempotencyKey,
        risk: input.actionId === "gmail.search_messages" ? "low" : "high",
        status: "succeeded",
        at: "2026-09-19T00:00:00.000Z",
        auditPersisted: true,
      };
    },
    async getExecutionReceipt(executionId, capability) {
      return {
        executionId,
        actionId: capability === "email" ? "gmail.search_messages" : "github.get_issue",
        risk: "low",
        status: "succeeded",
        at: "2026-09-19T00:00:00.000Z",
        auditPersisted: true,
      };
    },
  };
}

test("search returns only the capability-filtered connector subset", async () => {
  const open = provider();
  const tool = createEduPiExternalConnectorTool({ projectRoot: "/tmp/edupi", provider: open });
  const result = await tool.execute("search", { action: "search", capability: "email", query: "messages" }, undefined, undefined, context());
  assert.deepEqual(open.searches, [{ capability: "email", query: "messages" }]);
  assert.match(result.content[0].text, /gmail.search_messages/);
});

test("high-risk execution requires a visible teacher confirmation and exact authorization", async () => {
  const open = provider();
  const confirmations = [];
  const tool = createEduPiExternalConnectorTool({
    projectRoot: "/tmp/edupi",
    provider: open,
    confirmationId: () => "confirmation-1",
  });
  const denied = await tool.execute("execute-denied", {
    action: "execute",
    capability: "email",
    action_id: "gmail.send_message",
    input: { to: "teacher@example.test" },
    idempotency_key: "same-key",
  }, undefined, undefined, context(async (title, message) => {
    confirmations.push([title, message]);
    return false;
  }));
  assert.match(denied.content[0].text, /teacher_confirmation_denied/);
  assert.equal(open.executions.length, 0);

  const receipt = await tool.execute("execute-approved", {
    action: "execute",
    capability: "email",
    action_id: "gmail.send_message",
    input: { to: "teacher@example.test" },
    idempotency_key: "same-key",
  }, undefined, undefined, context(async () => true));
  assert.match(receipt.content[0].text, /run-1/);
  assert.equal(open.executions[0].authorization.confirmationId, "confirmation-1");
  assert.equal(confirmations.length, 1);
});

test("low-risk read actions execute without a confirmation dialog", async () => {
  const open = provider();
  let confirmed = false;
  const tool = createEduPiExternalConnectorTool({ projectRoot: "/tmp/edupi", provider: open });
  const result = await tool.execute("read", {
    action: "execute",
    capability: "email",
    action_id: "gmail.search_messages",
    input: { query: "report" },
  }, undefined, undefined, context(async () => {
    confirmed = true;
    return true;
  }));
  assert.match(result.content[0].text, /run-1/);
  assert.equal(confirmed, false);
});

test("completed connector failures remain failed receipts and are not retried", async () => {
  const open = provider();
  open.executeAction = async function (input) {
    this.executions.push(input);
    return {
      executionId: "run-failed",
      actionId: input.actionId,
      risk: "low",
      status: "failed",
      error: { code: "provider_error" },
      at: "2026-09-19T00:00:00.000Z",
      auditPersisted: true,
    };
  };
  const tool = createEduPiExternalConnectorTool({ projectRoot: "/tmp/edupi", provider: open });

  const result = await tool.execute("failed", {
    action: "execute",
    capability: "email",
    action_id: "gmail.search_messages",
    input: { query: "report" },
  }, undefined, undefined, context());

  assert.match(result.content[0].text, /"ok": false/);
  assert.match(result.content[0].text, /run-failed/);
  assert.equal(open.executions.length, 1);
});

test("runtime operation metadata overrides a misleading read-like action name", async () => {
  const open = provider();
  const tool = createEduPiExternalConnectorTool({ projectRoot: "/tmp/edupi", provider: open });
  let confirmed = false;

  await tool.execute("metadata-risk", {
    action: "execute",
    capability: "email",
    action_id: "custom.get_but_writes",
    input: {},
  }, undefined, undefined, context(async () => {
    confirmed = true;
    return false;
  }));

  assert.equal(confirmed, true);
  assert.equal(open.executions.length, 0);
});

test("tool stays scoped to the EduPi workspace", async () => {
  const tool = createEduPiExternalConnectorTool({ projectRoot: "/tmp/edupi", provider: provider() });
  await assert.rejects(() => tool.execute("outside", { action: "search", capability: "email" }, undefined, undefined, { ...context(), cwd: "/tmp/other" }), /EduPi 工作区/);
});

test("the agent tool is registered only through the env-gated OpenConnector provider", () => {
  const source = fs.readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /createOpenConnectorProviderFromEnv/);
  assert.match(source, /createEduPiExternalConnectorTool/);
  assert.match(source, /openConnectorProvider ?/);
});
