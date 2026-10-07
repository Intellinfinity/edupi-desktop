import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const require = createRequire(import.meta.url);
const proof = await jiti.import("../../../../../lib/edupi-reminder-notification-proof.ts");
const native = await jiti.import("../../../../../lib/desktop-api-auth.ts");
const security = await jiti.import("../../../../../lib/request-security.ts");
const bounded = await jiti.import("../../../../../lib/bounded-form-data.ts");
const desktopApi = await jiti.import("../../../../../lib/desktop-api.ts");
const { buildEducationContract } = await jiti.import("../../../../../lib/edupi-education-contract.ts");
const { reminderEvents } = await jiti.import("../../../../../lib/edupi-reminder-events.ts");
const { updateReminderStore } = await jiti.import("../../../../../lib/edupi-reminder-store.ts");
const compiled = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const token = "synthetic-native-proof-token-123456789";
const nonce = "a".repeat(64), instance = "b".repeat(64), now = new Date("2026-10-08T01:00:00+08:00");

async function fixture(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-native-proof-route-"));
  const previous = Object.fromEntries(["PI_DESKTOP_STATE_DIR", "PI_DESKTOP_API_TOKEN", "PI_DESKTOP_INSTANCE_ID"].map(key => [key, process.env[key]]));
  process.env.PI_DESKTOP_STATE_DIR = root; process.env.PI_DESKTOP_API_TOKEN = token; process.env.PI_DESKTOP_INSTANCE_ID = instance;
  const data = buildEducationContract({ tasks: [{ id: "teacher-task-10000000-0000-4000-8000-000000000001", title: "合成原生提醒",
    trigger: "teacher_created", status: "planned", content_status: "draft_ready", due_date: "2026-10-06", evidence: { source_revision: "v1" } }] });
  data.workspace = root;
  const file = path.join(root, ".edupi", "desktop", "reminders.json"), preferences = path.join(root, "foreground-prefs.json");
  const events = reminderEvents(data.tasks, root, now, [], data.workCases, data.generatedArtifacts);
  let reads = 0;
  const dependencies = { "@/lib/desktop-api-auth": native, "@/lib/desktop-api": desktopApi, "@/lib/request-security": security,
    "@/lib/bounded-form-data": bounded, "@/lib/edupi-reminder-notification-proof": { ...proof,
      notificationClaimsAreCurrent: (claims, options) => proof.notificationClaimsAreCurrent(claims, { ...options, now: () => now, readData: async () => { reads += 1; return data; } }) } };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => dependencies[name] || require(name), routeModule, routeModule.exports);
  try {
    await writeFile(preferences, JSON.stringify({ graceDays: 3, pinnedTaskIds: [] }));
    await updateReminderStore(file, events, undefined, now.getTime());
    const state = await updateReminderStore(file, events, { id: "*", type: "claim_notifications" }, now.getTime(), { sourceFingerprint: item => proof.reminderNotificationSourceFingerprint(item, data) });
    const item = state.notifications[0], claims = [{ id: item.id, attemptedAt: item.notificationAttemptedAt }];
    await updateReminderStore(file, events, { id: "*", type: "mark_attention_routes", routes: [{ reminderId: item.id, attemptedAt: item.notificationAttemptedAt, route: "teacher_local" }] });
    const body = () => ({ version: 1, nonce, claims });
    const post = (value = body(), extraHeaders = {}) => routeModule.exports.POST(new Request("http://127.0.0.1:30373/api/edupi/reminders/notification-proof", {
      method: "POST", headers: { host: "127.0.0.1:30373", origin: "http://127.0.0.1:30373", "content-type": "application/json", "x-pi-desktop-token": token, ...extraHeaders }, body: JSON.stringify(value),
    }));
    await work({ data, file, preferences, events, claims, body, post, reads: () => reads });
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(root, { recursive: true, force: true });
  }
}

test("proof endpoint keeps native/origin/strict body gates ahead of any teacher source read", async () => fixture(async fixture => {
  assert.equal((await fixture.post(undefined, { "x-pi-desktop-token": "" })).status, 403);
  assert.equal((await fixture.post(undefined, { origin: "https://foreign.example" })).status, 403);
  for (const extra of [{ graceDays: 365 }, { verified: true }, { token }, { serverPort: 9999 }, { scope: "all" }]) assert.equal((await fixture.post({ ...fixture.body(), ...extra })).status, 400);
  assert.equal(fixture.reads(), 0);
}));

test("only exact current attempts receive a no-store 204 proof bound to nonce and this process", async () => fixture(async fixture => {
  const before = await readFile(fixture.file);
  const response = await fixture.post();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("x-pi-reminder-proof-nonce"), nonce);
  assert.equal(response.headers.get("x-pi-desktop-instance"), instance);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
  assert.deepEqual(await readFile(fixture.file), before);
  assert.equal((await fixture.post({ ...fixture.body(), claims: [{ ...fixture.claims[0], attemptedAt: new Date(now.getTime() + 1).toISOString() }] })).status, 409);
  await updateReminderStore(fixture.file, fixture.events, { id: fixture.claims[0].id, attemptedAt: fixture.claims[0].attemptedAt, type: "release_notification" });
  assert.equal((await fixture.post()).status, 409, "replaying an old proof request after cancellation cannot restore authority");
}));

test("fresh preference and source revisions veto delivery, broken reads remain unavailable, and no history is changed", async () => fixture(async fixture => {
  const before = await readFile(fixture.file);
  fixture.data.tasks[0].evidence.source_revision = "v2";
  assert.equal((await fixture.post()).status, 409);
  fixture.data.tasks[0].evidence.source_revision = "v1";
  await writeFile(fixture.preferences, JSON.stringify({ graceDays: 0, pinnedTaskIds: [] }));
  assert.equal((await fixture.post()).status, 409);
  await writeFile(fixture.preferences, "broken synthetic preferences");
  assert.equal((await fixture.post()).status, 503);
  assert.deepEqual(await readFile(fixture.file), before);
}));
