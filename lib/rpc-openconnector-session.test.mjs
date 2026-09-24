import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const ENV_KEYS = [
  "EDUPI_DATA_ROOT",
  "EDUPI_CORE_ROOT",
  "EDUPI_OPENCONNECTOR_ENABLED",
  "EDUPI_OPENCONNECTOR_BASE_URL",
  "EDUPI_OPENCONNECTOR_RUNTIME_TOKEN",
  "EDUPI_OPENCONNECTOR_ADMIN_TOKEN",
  "PI_CODING_AGENT_DIR",
  "PI_OFFLINE",
];

test("EduPi AgentSession never registers unmanaged OpenConnector actions from environment credentials", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-openconnector-session-"));
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    EDUPI_DATA_ROOT: root,
    EDUPI_CORE_ROOT: root,
    EDUPI_OPENCONNECTOR_ENABLED: "1",
    EDUPI_OPENCONNECTOR_BASE_URL: "http://127.0.0.1:32123/connector",
    EDUPI_OPENCONNECTOR_RUNTIME_TOKEN: "runtime-test-token-123456789",
    EDUPI_OPENCONNECTOR_ADMIN_TOKEN: "admin-test-token-123456789",
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
  });

  let enabledSession;
  let disabledSession;
  try {
    const { startRpcSession } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./rpc-manager.ts");
    assert.equal(process.env.EDUPI_OPENCONNECTOR_RUNTIME_TOKEN, undefined);
    assert.equal(process.env.EDUPI_OPENCONNECTOR_ADMIN_TOKEN, undefined);
    ({ session: enabledSession } = await startRpcSession("__openconnector_enabled__", "", root));
    assert.equal(
      enabledSession.inner.getAllTools().some((tool) => tool.name === "edupi_external_connector"),
      false,
      "environment credentials cannot become Agent execution authority",
    );

    delete process.env.EDUPI_OPENCONNECTOR_ENABLED;
    ({ session: disabledSession } = await startRpcSession("__openconnector_disabled__", "", root));
    assert.equal(disabledSession.inner.getAllTools().some((tool) => tool.name === "edupi_external_connector"), false);
  } finally {
    enabledSession?.destroy();
    disabledSession?.destroy();
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
