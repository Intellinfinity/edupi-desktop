import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const client = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-material-schedule.ts");
const hash = character => `sha256:${character.repeat(64)}`;
const read = () => ({ version: 1, root_ref: hash("a"), owner_id: `owner_${"b".repeat(32)}`,
  source: { material_id: "material-synthetic", source_hash: hash("c"), metadata_revision: 2,
    relative_path: ".edupi/inbox/teacher-materials/synthetic.ics", metadata: { title: "合成校历" } },
  options: { default_time_zone: null, window_start: null, window_end: null, max_occurrences: 200 },
  status: "ready", events: [{ event_id: "event-synthetic", date: "2026-10-15", end_date: null,
    name: "合成教研", type: "meeting", confidence: "inferred", notes: null, location: null }],
  issues: [], evidence: [], parse_fingerprint: hash("d"), read_only: true, automatic_import: false, external_send: false });
const response = result => new Response(JSON.stringify({ ok: true, result, externalSend: false }), { status: 200 });
const headers = async extra => ({ ...extra, "x-pi-desktop-token": "synthetic-test-token" });

test("expanded material schedule reads current proof without a cached upload proposal", async () => {
  const calls = [];
  const observed = read();
  const result = await client.readMaterialSchedule("material-synthetic", async (url, init) => {
    calls.push({ url, init }); return response(observed);
  }, headers);
  assert.deepEqual(result, observed);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/edupi/material-schedule?materialId=material-synthetic");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.headers["x-pi-desktop-token"], "synthetic-test-token");
  assert.equal(calls[0].init.body, undefined);
});

test("only an explicitly captured current ready proof can be applied", async () => {
  const current = read();
  const capture = client.captureMaterialScheduleApply(current, "teacher-confirm-synthetic");
  assert.deepEqual(capture, { materialId: current.source.material_id, expectedSourceHash: current.source.source_hash,
    expectedMetadataRevision: 2, expectedParseFingerprint: current.parse_fingerprint, commandId: "teacher-confirm-synthetic", confirm: true });
  let sent;
  const result = await client.applyMaterialSchedule(capture, async (_url, init) => {
    sent = JSON.parse(init.body);
    return response({ version: 1, material_id: current.source.material_id, parse_fingerprint: current.parse_fingerprint,
      command_id: capture.commandId, receipt_id: "receipt-synthetic", status: "accepted", reason_code: null,
      applied_ids: ["event-synthetic"], rejected_ids: [], replayed: false, automatic_import: false, external_send: false });
  }, headers);
  assert.deepEqual(sent, { action: "apply", ...capture });
  assert.equal(result.status, "accepted");
  assert.equal(result.applied_ids.length, 1);
});

test("held, empty, changed identity, unsafe flags and PDF ready claims cannot supply apply authority", async () => {
  for (const transform of [value => ({ ...value, status: "unresolved" }), value => ({ ...value, events: [] }),
    value => ({ ...value, issues: [{ code: "missing_time_zone", path: "event.time_zone", message: "缺少时区" }] }),
    value => ({ ...value, automatic_import: true }), value => ({ ...value, read_only: false }),
    value => ({ ...value, external_send: true }), value => ({ ...value, source: { ...value.source, relative_path: "source.pdf" } })]) {
    assert.throws(() => client.captureMaterialScheduleApply(transform(read())), error => error.code.startsWith("material_schedule_"));
  }
  await assert.rejects(client.readMaterialSchedule("different-material", async () => response(read()), headers), error => error.code === "material_schedule_invalid_response");
  await assert.rejects(client.readMaterialSchedule("material-synthetic", async () => new Response(JSON.stringify({ ok: false, errorCode: "forbidden", externalSend: false }), { status: 403 }), headers), error => error.code === "forbidden");
});

test("default non-desktop authorization fails as forbidden before any HTTP request", async () => {
  let requests = 0;
  const fetcher = async () => { requests += 1; throw new Error("must not fetch without native authorization"); };
  const capture = client.captureMaterialScheduleApply(read(), "teacher-confirm-synthetic");
  for (const invoke of [() => client.readMaterialSchedule("material-synthetic", fetcher), () => client.applyMaterialSchedule(capture, fetcher)]) {
    await assert.rejects(invoke(), error => {
      assert.equal(error instanceof client.MaterialScheduleError, true);
      assert.equal(error.code, "forbidden");
      assert.equal(client.materialScheduleErrorMessage(error), "请在桌面应用中核对安排");
      return true;
    });
  }
  assert.equal(requests, 0);
});

test("custom header-provider failure is not relabeled as non-desktop authorization", async () => {
  const unavailable = new Error("custom authorization provider failed");
  let requests = 0;
  await assert.rejects(client.readMaterialSchedule("material-synthetic", async () => { requests += 1; throw new Error("must not fetch"); }, async () => { throw unavailable; }), error => error === unavailable);
  assert.equal(requests, 0);
});
