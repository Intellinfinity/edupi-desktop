import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { refreshEducationContractAfterMutation } = await jiti.import("./edupi-education-server.ts");

test("mutation refresh keeps the authoritative occurrence overlay", async () => {
  const initial = {
    runtime: { root: "/core" },
    dataRoot: { root: "/data" },
  };
  const projectedSnapshot = {
    ...initial,
    payload: { snapshot_id: "snapshot-after", education_workspace: { calendar: [] } },
    workspace: { calendar: [] },
    occurrenceProjection: {
      contract_version: "1.2",
      schema_hash: "sha256:test",
      snapshot_id: "snapshot-after",
      events: [{
        occurrence_ref: "meeting-42",
        starts_at: "2026-10-01T09:00+08:00",
        ends_at: "2026-10-01T10:00+08:00",
        time_zone: "Asia/Shanghai",
        location: "东楼 203",
      }],
      external_send: false,
    },
  };
  const reads = [];

  const data = await refreshEducationContractAfterMutation(
    initial,
    { snapshot_id: "snapshot-after", education_workspace: { calendar: [] } },
    {
      readSnapshot: async (options) => {
        reads.push(options);
        return projectedSnapshot;
      },
      projectContract: async (snapshot) => ({
        calendar: snapshot.occurrenceProjection.events.map((event) => ({
          occurrenceRef: event.occurrence_ref,
          startsAt: event.starts_at,
          endsAt: event.ends_at,
          timeZone: event.time_zone,
          location: event.location,
        })),
      }),
    },
  );

  assert.deepEqual(reads, [{
    requestId: reads[0].requestId,
    roots: { runtime: initial.runtime, dataRoot: initial.dataRoot },
    scheduleOccurrenceVersion: "1.2",
  }]);
  assert.match(reads[0].requestId, /^desktop-education-mutation-refresh-/);
  assert.deepEqual(data.calendar, [{
    occurrenceRef: "meeting-42",
    startsAt: "2026-10-01T09:00+08:00",
    endsAt: "2026-10-01T10:00+08:00",
    timeZone: "Asia/Shanghai",
    location: "东楼 203",
  }]);
});

test("mutation refresh rejects a malformed receipt payload before rereading", async () => {
  let reads = 0;
  await assert.rejects(
    refreshEducationContractAfterMutation(
      { runtime: { root: "/core" }, dataRoot: { root: "/data" } },
      { snapshot_id: "snapshot-after" },
      {
        readSnapshot: async () => { reads += 1; },
        projectContract: async () => ({}),
      },
    ),
    /Core education workspace refresh is unavailable/,
  );
  assert.equal(reads, 0);
});
