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
        risk: "high",
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

test("read-like actions also require visible teacher confirmation", async () => {
  const open = provider();
  let confirmations = 0;
  const tool = createEduPiExternalConnectorTool({ projectRoot: "/tmp/edupi", provider: open });
  const params = {
    action: "execute",
    capability: "email",
    action_id: "gmail.search_messages",
    input: { query: "report" },
  };
  const denied = await tool.execute("read-denied", params, undefined, undefined, context(async () => {
    confirmations += 1;
    return false;
  }));
  assert.match(denied.content[0].text, /teacher_confirmation_denied/);
  assert.equal(open.executions.length, 0);
  const result = await tool.execute("read-confirmed", params, undefined, undefined, context(async () => {
    confirmations += 1;
    return true;
  }));
  assert.match(result.content[0].text, /run-1/);
  assert.equal(confirmations, 2);
  assert.equal(open.executions[0].authorization.actionId, "gmail.search_messages");
  assert.equal(result.details.risk, "high");
});

test("an external Action cannot execute without a visible confirmation UI", async () => {
  const open = provider();
  const tool = createEduPiExternalConnectorTool({ projectRoot: "/tmp/edupi", provider: open });
  const result = await tool.execute("headless", {
    action: "execute", capability: "email", action_id: "gmail.search_messages", input: {},
  }, undefined, undefined, { ...context(), hasUI: false });
  assert.match(result.content[0].text, /teacher_confirmation_required/);
  assert.equal(open.executions.length, 0);
});

test("confirmation refuses inputs that cannot be shown completely", async () => {
  const open = provider();
  let confirmed = false;
  const tool = createEduPiExternalConnectorTool({ projectRoot: "/tmp/edupi", provider: open });
  for (const input of [{ body: "x".repeat(17_000) }, { password: "hidden" }]) {
    const result = await tool.execute("unpreviewable", {
      action: "execute", capability: "email", action_id: "gmail.send_message", input,
    }, undefined, undefined, context(async () => {
      confirmed = true;
      return true;
    }));
    assert.match(result.content[0].text, /input_cannot_be_confirmed/);
  }
  assert.equal(confirmed, false);
  assert.equal(open.executions.length, 0);
});

test("confirmation executes the exact input snapshot shown before the dialog", async () => {
  const open = provider();
  const tool = createEduPiExternalConnectorTool({ projectRoot: "/tmp/edupi", provider: open });
  const input = { to: "first@example.test" };
  let displayed = "";
  await tool.execute("mutable-input", {
    action: "execute", capability: "email", action_id: "gmail.send_message", input,
  }, undefined, undefined, context(async (_title, message) => {
    displayed = message;
    input.to = "second@example.test";
    return true;
  }));
  assert.match(displayed, /first@example\.test/);
  assert.equal(open.executions[0].input.to, "first@example.test");
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

test("the unmanaged connector prototype is not registered in the production Agent session", () => {
  const source = fs.readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createOpenConnectorProviderFromEnv/);
  assert.doesNotMatch(source, /createEduPiExternalConnectorTool/);
});
