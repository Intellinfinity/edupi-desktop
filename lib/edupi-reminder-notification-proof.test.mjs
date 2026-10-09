import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildEducationContract } = await jiti.import("./edupi-education-contract.ts");
const { reminderEvents } = await jiti.import("./edupi-reminder-events.ts");
const { updateReminderStore } = await jiti.import("./edupi-reminder-store.ts");
const { notificationClaimsAreCurrent, readCurrentReminderEducation, reminderNotificationSourceFingerprint, validNotificationProofRequest } = await jiti.import("./edupi-reminder-notification-proof.ts");
const fixtureNow = new Date("2026-10-08T01:00:00+08:00");

export async function withNotificationProofFixture(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-native-notification-proof-"));
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = root;
  const data = buildEducationContract({ tasks: [{ id: "teacher-task-10000000-0000-4000-8000-000000000001", title: "合成提醒事务",
    trigger: "teacher_created", due_date: "2026-10-06", status: "planned", content_status: "draft_ready", evidence: { source_revision: "source-v1" } }] });
  data.workspace = root;
  const file = path.join(root, ".edupi", "desktop", "reminders.json");
  const preferences = path.join(root, "foreground-prefs.json");
  const snapshot = () => reminderEvents(data.tasks, root, fixtureNow, [], data.workCases, data.generatedArtifacts);
  try {
    await writeFile(preferences, JSON.stringify({ graceDays: 3, pinnedTaskIds: [] }));
    await updateReminderStore(file, snapshot(), undefined, fixtureNow.getTime());
    const state = await updateReminderStore(file, snapshot(), { id: "*", type: "claim_notifications" }, fixtureNow.getTime(), {
      sourceFingerprint: item => reminderNotificationSourceFingerprint(item, data),
    });
    const item = state.notifications[0];
    await updateReminderStore(file, snapshot(), { id: "*", type: "mark_attention_routes", routes: [{ reminderId: item.id, attemptId: item.notificationAttemptId,
      attemptedAt: item.notificationAttemptedAt, route: "teacher_local" }] }, fixtureNow.getTime());
    const claims = [{ id: item.id, attemptId: item.notificationAttemptId, attemptedAt: item.notificationAttemptedAt }];
    const check = (options = {}) => notificationClaimsAreCurrent(claims, { readData: async () => data, now: () => fixtureNow, ...options });
    await work({ root, data, file, preferences, snapshot, claims, check });
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("notification proof is exact, strict, bounded and never accepts a caller's policy or credentials", () => {
  const value = { version: 1, nonce: "a".repeat(64), claims: [{ id: "synthetic-id", attemptId: "11111111-1111-4111-8111-111111111111", attemptedAt: fixtureNow.toISOString() }] };
  assert.equal(validNotificationProofRequest(value), true);
  for (const changed of [{ ...value, claims: [] }, { ...value, claims: Array(17).fill(value.claims[0]) },
    { ...value, claims: [value.claims[0], value.claims[0]] }, { ...value, nonce: "foreign" }, { ...value, scope: "all" },
    { ...value, graceDays: 365 }, { ...value, token: "forged" }, { ...value, verified: true },
    { ...value, claims: [{ ...value.claims[0], attemptedAt: "2026-10-08" }] },
    { ...value, claims: [{ ...value.claims[0], attemptId: undefined }] },
    { ...value, claims: [{ ...value.claims[0], attemptId: "not-a-uuid" }] }]) assert.equal(validNotificationProofRequest(changed), false);
});

test("a current claim is verified read-only, and source/date/revision changes invalidate even still-recent work", async () => withNotificationProofFixture(async fixture => {
  const before = await readFile(fixture.file);
  assert.equal(await fixture.check(), true);
  for (const mutate of [task => { task.dueDate = "2026-10-07"; }, task => { task.revision += 1; },
    task => { task.evidence.source_revision = "source-v2"; }]) {
    const original = structuredClone(fixture.data.tasks[0]);
    mutate(fixture.data.tasks[0]);
    assert.equal(await fixture.check(), false);
    fixture.data.tasks[0] = original;
  }
  assert.deepEqual(await readFile(fixture.file), before, "proof checks cannot mark read/handled/withdrawn or rewrite history");
}));

test("the last proof uses today's Shanghai date and latest threshold/pin instead of the claim snapshot", async () => withNotificationProofFixture(async fixture => {
  await writeFile(fixture.preferences, JSON.stringify({ graceDays: 0, pinnedTaskIds: [] }));
  assert.equal(await fixture.check(), false);
  await writeFile(fixture.preferences, JSON.stringify({ graceDays: 0, pinnedTaskIds: [fixture.data.tasks[0].id] }));
  assert.equal(await fixture.check(), true);
  await writeFile(fixture.preferences, JSON.stringify({ graceDays: 3, pinnedTaskIds: [] }));
  assert.equal(await fixture.check({ now: () => new Date("2026-10-10T16:01:00Z") }), false);
  let release;
  const delayed = fixture.check({ readData: () => new Promise(resolve => { release = resolve; }) });
  fixture.data.tasks[0].dueDate = "2026-09-01";
  release(fixture.data);
  assert.equal(await delayed, false);
}));

test("old/cancelled proof cannot authorize or release a replacement attempt", async () => withNotificationProofFixture(async fixture => {
  const old = fixture.claims[0];
  await updateReminderStore(fixture.file, fixture.snapshot(), { id: old.id, type: "release_notification", attemptId: old.attemptId, attemptedAt: old.attemptedAt }, fixtureNow.getTime());
  assert.equal(await fixture.check(), false);
  const next = await updateReminderStore(fixture.file, fixture.snapshot(), { id: "*", type: "claim_notifications" }, fixtureNow.getTime() + 1000, {
    sourceFingerprint: item => reminderNotificationSourceFingerprint(item, fixture.data),
  });
  await updateReminderStore(fixture.file, fixture.snapshot(), { id: "*", type: "mark_attention_routes", routes: [{ reminderId: old.id,
    attemptId: next.notifications[0].notificationAttemptId, attemptedAt: next.notifications[0].notificationAttemptedAt, route: "teacher_local" }] }, fixtureNow.getTime() + 1000);
  const before = await readFile(fixture.file);
  assert.equal(await fixture.check(), false);
  await updateReminderStore(fixture.file, fixture.snapshot(), { id: old.id, type: "release_notification", attemptId: old.attemptId, attemptedAt: old.attemptedAt }, fixtureNow.getTime() + 1000);
  assert.deepEqual(await readFile(fixture.file), before);
  const fresh = [{ id: old.id, attemptId: next.notifications[0].notificationAttemptId, attemptedAt: next.notifications[0].notificationAttemptedAt }];
  assert.equal(await notificationClaimsAreCurrent(fresh, { readData: async () => fixture.data, now: () => fixtureNow }), true);
}));

test("a replacement claim or Shanghai midnight while preferences await cannot promote a late proof", async () => withNotificationProofFixture(async fixture => {
  let release;
  const pending = fixture.check({ readPolicy: () => new Promise(resolve => { release = resolve; }) });
  await new Promise(resolve => setImmediate(resolve));
  const old = fixture.claims[0];
  await updateReminderStore(fixture.file, fixture.snapshot(), { id: old.id, type: "release_notification", attemptId: old.attemptId, attemptedAt: old.attemptedAt }, fixtureNow.getTime());
  const replacement = await updateReminderStore(fixture.file, fixture.snapshot(), { id: "*", type: "claim_notifications" }, fixtureNow.getTime() + 1000, { sourceFingerprint: item => reminderNotificationSourceFingerprint(item, fixture.data) });
  release({ today: "2026-10-08", graceDays: 3, pinnedTaskIds: [] });
  assert.equal(await pending, false);
  let reads = 0;
  const before = await readFile(fixture.file);
  const fresh = [{ id: old.id, attemptId: replacement.notifications[0].notificationAttemptId, attemptedAt: replacement.notifications[0].notificationAttemptedAt }];
  assert.equal(await notificationClaimsAreCurrent(fresh, { readData: async () => fixture.data, now: () => fixtureNow }), true);
  assert.equal(await notificationClaimsAreCurrent(fresh, { readData: async () => fixture.data,
    readPolicy: async () => ({ today: "2026-10-08", graceDays: 365, pinnedTaskIds: [] }),
    now: () => ++reads === 1 ? fixtureNow : new Date("2026-10-08T16:01:00Z") }), false);
  assert.deepEqual(await readFile(fixture.file), before);
}));

test("unread corruption or broken preferences fail closed without rewriting either file", async () => withNotificationProofFixture(async fixture => {
  await writeFile(fixture.preferences, "broken synthetic preferences");
  const before = await readFile(fixture.file);
  await assert.rejects(fixture.check());
  assert.deepEqual(await readFile(fixture.file), before);
  assert.equal(await readFile(fixture.preferences, "utf8"), "broken synthetic preferences");
}));

test("an identical reminder/task clone in a different canonical workspace cannot reuse the first root's proof", async () => withNotificationProofFixture(async fixture => {
  const clonedRoot = path.join(fixture.root, "synthetic-cloned-root");
  const clonedFile = path.join(clonedRoot, ".edupi", "desktop", "reminders.json");
  await mkdir(path.dirname(clonedFile), { recursive: true });
  const original = await readFile(fixture.file);
  await writeFile(clonedFile, original);
  const clonedData = { ...fixture.data, workspace: clonedRoot };
  assert.equal(await notificationClaimsAreCurrent(fixture.claims, { readData: async () => clonedData, now: () => fixtureNow }), false);
  assert.deepEqual(await readFile(clonedFile), original);
  assert.deepEqual(await readFile(fixture.file), original);
}));

test("actual pinned one-shot Core proof supports manual tasks with zero runtime/model startup and unchanged business bytes", { skip: !process.env.EDUPI_REMINDER_PROOF_CORE_TEST_ROOT, timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-proof-real-core-"));
  const teacher = path.join(root, "synthetic-teacher"), state = path.join(root, "desktop-state"), agent = path.join(root, "synthetic-agent");
  const keys = ["EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_CORE_VALIDATION_MODE", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "PI_DESKTOP_STATE_DIR", "PI_CODING_AGENT_DIR"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const directory of [teacher, state, agent, path.join(teacher, ".edupi", "memory"), path.join(teacher, ".edupi", "output"), path.join(teacher, ".edupi", "locks")]) await mkdir(directory, { recursive: true });
  process.env.EDUPI_CORE_ROOT = process.env.EDUPI_REMINDER_PROOF_CORE_TEST_ROOT;
  process.env.EDUPI_CORE_ALLOWED_ROOT = path.dirname(process.env.EDUPI_CORE_ROOT);
  process.env.EDUPI_CORE_VALIDATION_MODE = "external";
  process.env.EDUPI_DATA_ROOT = teacher; process.env.EDUPI_DATA_ALLOWED_ROOT = root;
  process.env.PI_DESKTOP_STATE_DIR = state; process.env.PI_CODING_AGENT_DIR = agent;
  try {
    const { resolveEduPiBridgeRoots, readEduPiEducationSnapshot } = await jiti.import("./edupi-core-snapshot.ts");
    const { callEduPiCore } = await jiti.import("./edupi-core-process-client.ts");
    const { getActiveEduPiRuntime, getPendingEduPiRuntime } = await jiti.import("./edupi-runtime-supervisor.ts");
    const { buildTaskBoardCommandEnvelope, taskBoardContentHash } = await jiti.import("./edupi-task-board-command.ts");
    const { activeBridgeIdentity } = await jiti.import("./edupi-bridge-manifest.ts");
    const { shanghaiDate } = await jiti.import("./edupi-foreground.ts");
    const roots = resolveEduPiBridgeRoots();
    assert.equal(roots.runtime.coreCommit, activeBridgeIdentity().runtime.core_commit);
    assert.equal(roots.runtime.coreCommit, "75d6d666ac9910166638c3ec6df2a03f1075bd43");
    assert.equal(getPendingEduPiRuntime(roots.dataRoot.root), null);
    const initial = await readEduPiEducationSnapshot({ roots });
    const task = { task_id: "teacher-task-10000000-0000-4000-8000-000000000001", title: "合成只读原生提醒验收", due_date: shanghaiDate(new Date()), note: "纯合成验收", preparation_source: null };
    const command = { command_type: "create_task", task, source: { source_id: "synthetic-native-proof", source_kind: "teacher_message", source_hash: taskBoardContentHash(task), evidence_ids: ["synthetic-proof-evidence"] } };
    const envelope = buildTaskBoardCommandEnvelope({ snapshotId: initial.payload.snapshot_id, command });
    const created = await callEduPiCore({ operation: "command", requestId: String(envelope.request_id), envelope, ...roots });
    assert.equal(created.receipt.payload.status, "accepted", "only fixture setup uses the official manual-task mutation");
    const data = await readCurrentReminderEducation(AbortSignal.timeout(1500));
    assert.equal(data.tasks.find(item => item.id === task.task_id).title, task.title);
    const events = reminderEvents(data.tasks, teacher, new Date(), data.continuity.documents, data.workCases, data.generatedArtifacts);
    const file = path.join(teacher, ".edupi", "desktop", "reminders.json");
    await writeFile(path.join(state, "foreground-prefs.json"), JSON.stringify({ graceDays: 3, pinnedTaskIds: [] }));
    await updateReminderStore(file, events);
    const claimed = await updateReminderStore(file, events, { id: "*", type: "claim_notifications" }, Date.now(), { sourceFingerprint: item => reminderNotificationSourceFingerprint(item, data) });
    assert.equal(claimed.notifications.length, 1);
    const item = claimed.notifications[0];
    await updateReminderStore(file, events, { id: "*", type: "mark_attention_routes", routes: [{ reminderId: item.id,
      attemptId: item.notificationAttemptId, attemptedAt: item.notificationAttemptedAt, route: "teacher_local" }] });
    const bytes = async () => {
      const entries = [];
      const visit = async directory => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.name === "locks") continue;
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) await visit(file);
          else if (entry.isFile()) entries.push([path.relative(root, file), (await readFile(file)).toString("base64")]);
        }
      };
      await visit(root); return entries.sort((left, right) => left[0].localeCompare(right[0]));
    };
    const before = await bytes();
    assert.equal(await notificationClaimsAreCurrent([{ id: item.id, attemptId: item.notificationAttemptId, attemptedAt: item.notificationAttemptedAt }]), true);
    assert.deepEqual(await bytes(), before);
    const fresh = await readEduPiEducationSnapshot({ roots });
    const projectedTask = fresh.payload.education_workspace.tasks.find(task => task.task_id === item.taskId);
    const move = { command_type: "move_task_stage", task_id: item.taskId, expected_revision: projectedTask.board_revision,
      to_stage: "progress", note: "合成教师更改", source: { source_id: "synthetic-native-proof-move", source_kind: "teacher_message", source_hash: taskBoardContentHash({ task_id: item.taskId, to_stage: "progress" }), evidence_ids: ["synthetic-proof-move"] } };
    const moveEnvelope = buildTaskBoardCommandEnvelope({ snapshotId: fresh.payload.snapshot_id, command: move });
    const changed = await callEduPiCore({ operation: "command", requestId: String(moveEnvelope.request_id), envelope: moveEnvelope, ...roots });
    assert.equal(changed.receipt.payload.status, "modified");
    const afterTeacherMutation = await bytes();
    assert.equal(await notificationClaimsAreCurrent([{ id: item.id, attemptId: item.notificationAttemptId, attemptedAt: item.notificationAttemptedAt }]), false,
      "a real canonical board revision change invalidates the old otherwise-current due claim");
    assert.deepEqual(await bytes(), afterTeacherMutation);
    assert.equal(getActiveEduPiRuntime(roots.dataRoot.root), null);
    assert.equal(getPendingEduPiRuntime(roots.dataRoot.root), null, "no runtime/model host is started by the proof read");
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(root, { recursive: true, force: true });
  }
});
