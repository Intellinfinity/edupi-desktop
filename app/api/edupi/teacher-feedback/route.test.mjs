import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");
const { GET, POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

test("feedback reads and writes require the desktop process token before Core access", async () => {
  const previousToken = process.env.PI_DESKTOP_API_TOKEN;
  const previousCore = process.env.EDUPI_CORE_ROOT;
  process.env.PI_DESKTOP_API_TOKEN = "x".repeat(64);
  process.env.EDUPI_CORE_ROOT = "/definitely/missing/feedback-core";
  try {
    const url = "http://localhost:30141/api/edupi/teacher-feedback";
    const headers = { host: "localhost:30141", origin: "http://localhost:30141" };
    assert.equal((await GET(new Request(url, { headers }))).status, 403);
    assert.equal((await POST(new Request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "null" }))).status, 403);
    assert.equal((await GET(new Request(url, { headers: { ...headers, "x-pi-desktop-token": "wrong" } }))).status, 403);
    assert.equal((await GET(new Request(url, { headers: { ...headers, origin: "https://attacker.example", "x-pi-desktop-token": "x".repeat(64) } }))).status, 403);
  } finally {
    if (previousToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previousToken;
    if (previousCore === undefined) delete process.env.EDUPI_CORE_ROOT;
    else process.env.EDUPI_CORE_ROOT = previousCore;
  }
});

test("teacher feedback route keeps owner-control credentials server-side", () => {
  assert.match(source, /export async function GET\(request: Request\)/);
  assert.match(source, /if \(!isDesktopApiRequestAllowed\(request\)\)/);
  assert.match(source, /callOwnerControl/);
  assert.match(source, /owner_control/);
  assert.match(source, /teacher_feedback_target_read/);
  assert.match(source, /teacher_feedback_record/);
  assert.match(source, /bindFeedbackRecord/);
  assert.match(source, /expected_revision: resolved\.revision/);
  assert.match(source, /expected_fingerprint: resolved\.fingerprint/);
  assert.match(source, /FEEDBACK_RECORD_KEYS/);
  assert.doesNotMatch(source, /ownerControlToken/);
  assert.match(source, /externalSend: false/);
});

test("teacher feedback route rejects non-object JSON before Core dispatch", () => {
  assert.match(source, /function asRecord\(value: unknown\)/);
  assert.match(source, /if \(!body\) return jsonError\("反馈操作无效", 400\)/);
});
