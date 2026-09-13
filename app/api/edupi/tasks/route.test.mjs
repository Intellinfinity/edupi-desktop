import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const clientRequestId = "11111111-1111-4111-8111-111111111111";

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/tasks", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("rejects cross-site, non-JSON, malformed and unknown task creation fields", async () => {
  const crossSite = await POST(request({ title: "任务" }, { origin: "http://evil.test", "sec-fetch-site": "cross-site" }));
  assert.equal(crossSite.status, 403);
  const nonJson = await POST(request({ title: "任务" }, { "content-type": "text/plain" }));
  assert.equal(nonJson.status, 415);
  for (const body of ["{", {}, { clientRequestId, title: "" }, { clientRequestId: "bad", title: "任务" }, { clientRequestId, title: "任务", dueDate: "2026-02-31" }, { clientRequestId, title: "任务", note: "x".repeat(1001) }, { clientRequestId, title: "任务", admin: true }]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
  }
  const source = { kind: "teaching_before_class", timetableSlotId: "slot-1", lessonDate: "2026-09-11", materialIds: ["material-1"], deliverables: ["检测卷"] };
  for (const preparationSource of [{ ...source, lessonDate: "2026-02-31" }, { ...source, materialIds: [] }, { ...source, deliverables: [] }, { ...source, materialIds: ["material-1", "material-1"] }, { ...source, admin: true }]) {
    assert.equal((await POST(request({ clientRequestId, title: "准备检测", preparationSource }))).status, 400);
  }
});

test("a valid task creation request reaches the Core boundary", async () => {
  const response = await POST(request({ clientRequestId, title: "准备第一次单元检测", dueDate: "2026-09-10", note: "先整理范围" }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "unavailable");

  const managed = await POST(request({ clientRequestId, title: "准备第一次单元检测", dueDate: "2026-09-10", note: "先整理范围", preparationSource: { kind: "teaching_before_class", timetableSlotId: "slot-1", lessonDate: "2026-09-11", materialIds: ["material-1"], deliverables: ["检测卷", "参考答案"] } }));
  assert.equal(managed.status, 503);
  assert.equal((await managed.json()).code, "unavailable");
});
