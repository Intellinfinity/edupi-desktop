import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const routeUrl = new URL("./route.ts", import.meta.url);
const routeSource = fs.existsSync(routeUrl) ? fs.readFileSync(routeUrl, "utf8") : "";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function loadRoute() {
  return jiti.import("./route.ts");
}

test("POST /api/edupi/reviews rejects an invalid review payload with HTTP 400", async () => {
  const { POST } = await loadRoute();
  const response = await POST(new Request("http://localhost/api/edupi/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetKind: "memory_candidate", targetId: "candidate-1", decision: "approve" }),
  }));
  assert.equal(response.status, 400);
});

test("the review route accepts C1 targets and the pinned student follow-up target", () => {
  assert.match(routeSource, /issueC1Review/);
  assert.match(routeSource, /targetKind/);
  assert.match(routeSource, /targetId/);
  assert.match(routeSource, /decision/);
  assert.match(routeSource, /patch/);
  assert.match(routeSource, /note/);
  assert.match(routeSource, /C1_REVIEW_DECISIONS/);
  assert.match(routeSource, /reviewEducationCandidate/);
  assert.match(routeSource, /FOLLOW_UP_REVIEW_DECISIONS/);
  assert.match(routeSource, /expectedSnapshotId/);
  assert.match(routeSource, /expectedRevision/);
  assert.doesNotMatch(routeSource, /review_task|review_teacher_context|import_calendar|import_timetable|intake_material/);
});

test("the review route exposes the frozen failure statuses and receipt-backed success shape", () => {
  assert.match(routeSource, /status\s*:\s*400/);
  assert.match(routeSource, /status\s*:\s*409/);
  assert.match(routeSource, /status\s*:\s*503/);
  assert.match(routeSource, /status\s*:\s*200/);
  assert.match(routeSource, /unsupported_command/);
  assert.match(routeSource, /stale_snapshot|revision/);
  assert.match(routeSource, /\{\s*receipt\s*,\s*data\s*\}/);
});

test("the review route has no direct .edupi writer, import fallback, or second canonical store", () => {
  assert.doesNotMatch(routeSource, /readEducationContract|writeFile|appendFile|mkdir|unlink|rmSync|teacher_task_review|\.edupi\/(?:memory|output|inbox)/);
  assert.match(routeSource, /issueC1Review/);
  assert.doesNotMatch(routeSource, /fallback|local\s+(?:write|store)|JSON\.stringify\([^)]*memory/i);
});
