import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const client = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message.ts");
const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const clientSource = await readFile(new URL("./edupi-ambient-message.ts", import.meta.url), "utf8");

test("web mode never submits private chat text to the desktop canary route", async () => {
  assert.deepEqual(await client.captureEduPiAmbientMessage({ sessionId: "session-1", messageId: "prompt-1", text: "帮我备课", occurredAt: "2026-09-23T08:00:00.000Z" }), { status: "disabled" });
});

test("an accepted ordinary prompt is mirrored asynchronously, while slash and bash commands are excluded", () => {
  const send = source.slice(source.indexOf("  const handleSend = useCallback"), source.indexOf("  const executeBash = useCallback"));
  assert.match(send, /captureEduPiAmbientMessage/);
  assert.match(send, /!isSlashCommandPrompt && trimmedMessage && sentSessionId/);
  assert.match(send, /void captureEduPiAmbientMessage/);
  assert.match(send, /sessionId: sentSessionId/);
  assert.match(send, /crypto\.randomUUID\(\)/);
  assert.ok(send.indexOf("await sendAgentCommand") < send.indexOf("void captureEduPiAmbientMessage"));
  assert.ok(send.indexOf("if (isBashCommand)") < send.indexOf("void captureEduPiAmbientMessage"));
});

test("ambient capture uses a bounded keepalive request so accepted chat is not lost on navigation", () => {
  assert.match(clientSource, /keepalive:\s*true/);
  assert.match(clientSource, /JSON\.stringify\(input\)/);
  assert.ok(clientSource.indexOf('method: "GET"') < clientSource.indexOf("JSON.stringify(input)"));
});
