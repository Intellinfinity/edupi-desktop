import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const route = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

test("ambient message intake rejects an ordinary browser before reading private text", async () => {
  const read = await route.GET(new Request("http://localhost/api/edupi/proactivity/messages", { headers: { host: "localhost" } }));
  assert.equal(read.status, 403);
  const response = await route.POST(new Request("http://localhost/api/edupi/proactivity/messages", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ messageId: "prompt-1", text: "私密内容" }),
  }));
  assert.equal(response.status, 403);
});

test("ambient message intake is bounded, owner-controlled, and external-send-free", () => {
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /isDesktopApiRequestAllowed\(request\)/);
  assert.match(source, /if \(!activation\.enabled\) return NextResponse\.json/);
  assert.ok(source.indexOf("if (!activation.enabled)") < source.indexOf("parseJsonWithinLimit(request"));
  assert.match(source, /export async function GET/);
  assert.match(source, /captureAndApplyAmbientMessage/);
  assert.match(source, /prepareEduPiAmbientMessageBinding/);
  assert.match(source, /confirmEduPiAmbientMessageBinding/);
  assert.match(source, /sessionId/);
  assert.match(source, /readProactivityOwnerContext/);
  assert.match(source, /withEduPiAmbientSessionLock/);
  assert.match(source, /resolveSessionPath/);
  assert.match(source, /externalSend: false/);
  assert.doesNotMatch(source, /externalSend:\s*true|external_send:\s*true/);
});
