import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const route = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

test("proactivity control rejects browser and malformed requests before Core", async () => {
  const get = await route.GET(new Request("http://localhost/api/edupi/proactivity", { headers: { host: "localhost" } }));
  assert.equal(get.status, 403);
  const post = await route.POST(new Request("http://localhost/api/edupi/proactivity", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ enabled: true }),
  }));
  assert.equal(post.status, 403);
});

test("proactivity route is desktop-token protected, bounded, restart-backed, and never enables external send", () => {
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /isDesktopApiRequestAllowed\(request\)/);
  assert.match(source, /parseJsonWithinLimit\(request, MAX_BODY_BYTES\)/);
  assert.match(source, /writeEduPiProactivityConfig/);
  assert.match(source, /restartEduPiRuntime/);
  assert.match(source, /ensureProactivityGrant/);
  assert.match(source, /pauseProactivityGrant/);
  assert.match(source, /withMutationLock\(roots\.dataRoot\.root/);
  assert.match(source, /activation\.updatedAt !== body\.expectedUpdatedAt/);
  assert.match(source, /proactivity_scope_conflict/);
  assert.match(source, /allowDegraded/);
  assert.match(source, /externalSend: false/);
  assert.doesNotMatch(source, /externalSend:\s*true|external_send:\s*true/);
});
