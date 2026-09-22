import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

test("mobile session projection omits paths and tool payloads", () => {
  const source = fs.readFileSync(new URL("./mobile-session.ts", import.meta.url), "utf8");
  assert.match(source, /deferThinking: true/);
  assert.match(source, /deferToolResultImages: true/);
  assert.match(source, /id: session\.id/);
  assert.doesNotMatch(source, /return \{[^}]*filePath/);
});

test("mobile sessions include canonical /tmp aliases but reject symlinks outside the data root", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-mobile-cwd-"));
  const dataRoot = path.join(root, "teacher-data");
  const alias = path.join(root, "teacher-alias");
  const outside = path.join(root, "other-data");
  const agentDir = path.join(root, "agent");
  const sessionDir = path.join(agentDir, "sessions", "isolated");
  const savedDataRoot = process.env.EDUPI_DATA_ROOT;
  const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    fs.mkdirSync(dataRoot);
    fs.mkdirSync(outside);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.symlinkSync(dataRoot, alias, process.platform === "win32" ? "junction" : "dir");
    fs.symlinkSync(outside, path.join(dataRoot, "escape"), process.platform === "win32" ? "junction" : "dir");
    const writeSession = (id, cwd) => {
      const entries = [
        { type: "session", version: 3, id, timestamp: "2026-09-22T00:00:00.000Z", cwd },
        { type: "message", id: "a1b2c3d4", parentId: null, timestamp: "2026-09-22T00:01:00.000Z", message: { role: "user", content: "隔离测试会话" } },
      ];
      fs.writeFileSync(path.join(sessionDir, `${id}.jsonl`), `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
    };
    const allowedId = "33333333-3333-4333-8333-333333333333";
    const deniedId = "44444444-4444-4444-8444-444444444444";
    writeSession(allowedId, alias);
    writeSession(deniedId, path.join(dataRoot, "escape"));
    process.env.EDUPI_DATA_ROOT = dataRoot;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const { listMobileSessions, readMobileSession } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./mobile-session.ts");
    assert.deepEqual((await listMobileSessions()).map(session => session.id), [allowedId]);
    assert.equal((await readMobileSession(allowedId))?.messages[0].text, "隔离测试会话");
    assert.equal(await readMobileSession(deniedId), null);
  } finally {
    if (savedDataRoot === undefined) delete process.env.EDUPI_DATA_ROOT;
    else process.env.EDUPI_DATA_ROOT = savedDataRoot;
    if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
