import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("./route.ts");
const { asRecord, bindFeedbackRecord } = await jiti.import("../../../../lib/edupi-teacher-feedback-binding.ts");

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

test("a prebound target survives an uncertain response and source revision change", async () => {
  const target = { kind: "work_candidate", target_id: "candidate-1", expected_revision: 2, expected_fingerprint: `sha256:${"a".repeat(64)}` };
  const input = { command_id: "feedback-1", signal: "surfaced", target, evidence_ids: ["evidence-1"] };
  const host = { callOwnerControl: async () => { throw new Error("target must not be rebound on replay"); } };
  const result = await bindFeedbackRecord(host, { ownerId: "owner-1", rootRef: `sha256:${"b".repeat(64)}` }, input);
  assert.deepEqual(result.target, target);
  assert.deepEqual(result.evidence_ids, ["evidence-1"]);
  assert.equal(result.expected_owner_id, "owner-1");
  await assert.rejects(() => bindFeedbackRecord(host, { ownerId: "owner-1", rootRef: `sha256:${"b".repeat(64)}` }, { ...input, target: { ...target, expected_fingerprint: "wrong" } }), (error) => error?.code === "invalid_feedback");
});

test("teacher feedback route keeps owner-control credentials server-side", () => {
  assert.match(source, /export async function GET\(request: Request\)/);
  assert.match(source, /if \(!isDesktopApiRequestAllowed\(request\)\)/);
  assert.match(source, /callOwnerControl/);
  assert.match(source, /callOwnerControl\("owner_read", \{\}\)/);
  assert.doesNotMatch(source, /\.call\("owner_read", \{\}\)/);
  assert.match(source, /owner_control/);
  assert.match(source, /teacher_feedback_target_read/);
  assert.match(source, /teacher_feedback_record/);
  assert.match(source, /bindFeedbackRecord/);
  assert.doesNotMatch(source, /ownerControlToken/);
  assert.match(source, /externalSend: false/);
});

test("teacher feedback route rejects non-object JSON before Core dispatch", () => {
  assert.equal(asRecord(null), null);
  assert.equal(asRecord([]), null);
  assert.equal(asRecord("string"), null);
  assert.match(source, /if \(!body\) return jsonError\("反馈操作无效", 400\)/);
});
