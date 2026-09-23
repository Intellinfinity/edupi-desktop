import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const flow = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-material-intake-flow.ts");

const descriptor = {
  staging_id: "stg_00000000000000000000000000000001",
  staging_path: "/desktop-state/material-staging/stg_00000000000000000000000000000001/material.pdf",
  original_name: "校历和课表.pdf",
  expected_size_bytes: 128,
  source_hash: `sha256:${"a".repeat(64)}`,
  kind: "pdf",
  source_scope: "desktop_staging",
};

test("intakes the material first, then recognized calendar and timetable facts through the same Core command client", async () => {
  const commands = [];
  const result = await flow.intakeRecognizedMaterial({
    descriptor,
    title: "七年级校历与课表",
    materialKind: "other",
    subject: "数学",
    classId: "class-7-2",
  }, {
    recognize: async () => ({
      events: [{ event_id: "event-1", date: "2026-09-01", end_date: null, name: "开学", type: "teaching", confidence: "inferred", notes: null }],
      slots: [{ slot_id: "slot-1", day_of_week: 1, period: 1, subject: "数学", class_name: "七年级二班", kind: "class", notes: null }],
    }),
    issue: async (command) => {
      commands.push(command);
      return { receipt: { command_type: command.command_type, status: "accepted" }, data: { snapshot_id: `snapshot-${commands.length}` } };
    },
  });
  assert.deepEqual(commands.map((command) => command.command_type), ["intake_material", "import_calendar", "import_timetable"]);
  assert.equal(commands[0].material.title, "七年级校历与课表");
  assert.equal(commands[1].source.source_hash, descriptor.source_hash);
  assert.equal(commands[2].source.source_hash, descriptor.source_hash);
  assert.deepEqual(commands[1].source.evidence_ids, commands[2].source.evidence_ids);
  assert.doesNotMatch(commands[1].source.evidence_ids[0], /^stg_/u);
  assert.match(commands[2].slots[0].notes, /^材料识别待确认：/);
  assert.equal(commands[2].slots[0].notes.length <= 1000, true);
  assert.equal(JSON.stringify(commands.slice(1)).includes(descriptor.staging_path), false);
  assert.deepEqual(result.recognition, { eventCount: 1, slotCount: 1 });
  assert.equal(result.receipts.length, 3);
  assert.equal(result.data.snapshot_id, "snapshot-3");
});

test("recognized timetable provenance stays inside the Core note bound", async () => {
  const commands = [];
  await flow.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: null, classId: null }, {
    recognize: async () => ({
      events: [],
      slots: [{ slot_id: "slot-long-note", day_of_week: 1, period: 1, subject: "数学", class_name: null, kind: "class", notes: "注".repeat(1000) }],
    }),
    issue: async (command) => {
      commands.push(command);
      return { receipt: { command_type: command.command_type, status: "accepted" }, data: {} };
    },
  });
  assert.equal(commands[1].slots[0].notes.length, 1000);
  assert.match(commands[1].slots[0].notes, /^材料识别待确认：/);
});

test("a material without schedule facts creates only the material receipt", async () => {
  const commands = [];
  const result = await flow.intakeRecognizedMaterial({ descriptor, materialKind: "lesson_note", subject: null, classId: null }, {
    recognize: async () => ({ events: [], slots: [] }),
    issue: async (command) => {
      commands.push(command);
      return { receipt: { command_type: command.command_type, status: "accepted" }, data: { snapshot_id: "snapshot-material" } };
    },
  });
  assert.deepEqual(commands.map((command) => command.command_type), ["intake_material"]);
  assert.deepEqual(result.recognition, { eventCount: 0, slotCount: 0 });
});

test("repeated file uploads keep one schedule identity without sharing material provenance", async () => {
  const commands = [];
  const secondDescriptor = {
    ...descriptor,
    staging_id: "stg_00000000000000000000000000000002",
    staging_path: "/desktop-state/material-staging/stg_00000000000000000000000000000002/material.pdf",
  };
  const dependencies = {
    recognize: async (staged) => ({
      events: [{ event_id: `event-${staged.staging_id}`, date: "2026-10-01", end_date: null, name: "运动会", type: "activity", confidence: "inferred", notes: "原通知" }],
      slots: [{ slot_id: `slot-${staged.staging_id}`, day_of_week: 1, period: 2, subject: "数学", class_name: "七年级二班", kind: "class", notes: null }],
    }),
    issue: async (command) => {
      commands.push(structuredClone(command));
      return { receipt: { status: "accepted" }, data: {} };
    },
  };
  for (const staged of [descriptor, secondDescriptor]) {
    await flow.intakeRecognizedMaterial({ descriptor: staged, materialKind: "other", subject: null, classId: null }, dependencies);
  }
  assert.notEqual(commands[0].material.material_id, commands[3].material.material_id);
  assert.equal(commands[1].events[0].event_id, commands[4].events[0].event_id);
  assert.equal(commands[2].slots[0].slot_id, commands[5].slots[0].slot_id);
  assert.equal(commands[1].source.source_id, commands[4].source.source_id,
    "the same logical file keeps a stable schedule issuer across staging IDs");
  assert.deepEqual(commands[1].source.evidence_ids, commands[4].source.evidence_ids,
    "an exact reupload keeps stable schedule evidence instead of staging identity");
  assert.notEqual(commands[0].source.source_id, commands[3].source.source_id,
    "material intake still preserves each staged file identity");
});

test("ICS occurrence references survive repeated staging with one stable Core identity", async () => {
  const commands = [];
  const occurrence = {
    event_id: "parsed-ics-event", date: "2026-10-01", end_date: null, name: "教研会", type: "meeting",
    confidence: "teacher_confirmed", notes: null, source_occurrence_ref: "calendar-uid-1",
    time_interval: { start: "2026-10-01T09:00+08:00", end: "2026-10-01T10:00+08:00", time_zone: "Asia/Shanghai" },
    location: "东楼 203",
  };
  for (const stagingId of ["stg_00000000000000000000000000000001", "stg_00000000000000000000000000000002"]) {
    await flow.intakeRecognizedMaterial({ descriptor: { ...descriptor, staging_id: stagingId, original_name: "calendar.ics", kind: "calendar" }, materialKind: "other", subject: null, classId: null }, {
      recognize: async () => ({ events: [occurrence], slots: [] }),
      issue: async (command) => { commands.push(structuredClone(command)); return { receipt: { status: "accepted" }, data: {} }; },
    });
  }
  const imports = commands.filter((command) => command.command_type === "import_calendar");
  assert.equal(imports.length, 2);
  assert.equal(imports[0].events[0].event_id, imports[1].events[0].event_id);
  assert.match(imports[0].events[0].event_id, /^calendar-occurrence-/);
  assert.equal(imports[0].events[0].source_occurrence_ref, "calendar-uid-1");
  assert.deepEqual(imports[0].events[0].time_interval, occurrence.time_interval);
});

test("ambiguous same-day recognized events do not silently merge or write the material", async () => {
  let writes = 0;
  await assert.rejects(flow.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: null, classId: null }, {
    recognize: async () => ({
      events: [
        { event_id: "morning", date: "2026-10-20", end_date: null, name: "教研会", type: "meeting", confidence: "inferred", notes: "09:00 教学楼" },
        { event_id: "afternoon", date: "2026-10-20", end_date: null, name: "教研会", type: "meeting", confidence: "inferred", notes: "14:00 教学楼" },
      ],
      slots: [],
    }),
    issue: async () => { writes += 1; throw new Error("must not write ambiguous schedule"); },
  }), (error) => error?.code === "ambiguous_schedule");
  assert.equal(writes, 0);
});

test("separate files retain distinct identity for same-day events with different details", async () => {
  const eventIds = [];
  for (const [stagingId, notes] of [["stg_00000000000000000000000000000001", "09:00 教学楼"], ["stg_00000000000000000000000000000002", "14:00 教学楼"]]) {
    await flow.intakeRecognizedMaterial({ descriptor: { ...descriptor, staging_id: stagingId }, materialKind: "other", subject: null, classId: null }, {
      recognize: async () => ({ events: [{ event_id: stagingId, date: "2026-10-20", end_date: null, name: "教研会", type: "meeting", confidence: "inferred", notes }], slots: [] }),
      issue: async (command) => {
        if (command.command_type === "import_calendar") eventIds.push(command.events[0].event_id);
        return { receipt: { status: "accepted" }, data: {} };
      },
    });
  }
  assert.equal(eventIds.length, 2);
  assert.notEqual(eventIds[0], eventIds[1], "Core must see a cross-file ambiguity, not an update to one ID");
});

test("identical duplicated recognition rows become one schedule candidate", async () => {
  const commands = [];
  const event = { event_id: "recognized-one", date: "2026-10-20", end_date: null, name: "教研会", type: "meeting", confidence: "inferred", notes: "09:00 教学楼" };
  const result = await flow.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: null, classId: null }, {
    recognize: async () => ({ events: [event, { ...event, event_id: "recognized-two" }], slots: [] }),
    issue: async (command) => { commands.push(command); return { receipt: { status: "accepted" }, data: {} }; },
  });
  assert.equal(commands.length, 2);
  assert.equal(commands[1].events.length, 1);
  assert.deepEqual(result.recognition, { eventCount: 1, slotCount: 0 });
});

test("a held schedule receipt is reported separately from accepted material", async () => {
  const result = await flow.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: null, classId: null }, {
    recognize: async () => ({
      events: [{ event_id: "calendar-held", date: "2026-10-20", end_date: null, name: "教研会", type: "meeting", confidence: "inferred", notes: null }],
      slots: [],
    }),
    issue: async (command) => ({ receipt: { command_type: command.command_type, status: command.command_type === "import_calendar" ? "held" : "accepted", rejected_ids: command.command_type === "import_calendar" ? ["calendar-held"] : [] }, data: {} }),
  });
  assert.equal(result.receipts[0].status, "accepted");
  assert.equal(result.scheduleNeedsReview, true);
});

test("recognition failure never writes the material or schedule", async () => {
  let issueCount = 0;
  await assert.rejects(flow.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: null, classId: null }, {
    recognize: async () => { throw Object.assign(new Error("unavailable"), { code: "model_unavailable" }); },
    issue: async () => { issueCount += 1; throw new Error("must not run"); },
  }), (error) => error?.code === "model_unavailable");
  assert.equal(issueCount, 0);
});

test("a failed final phase can retry the same source-bound commands without changing recognized identities", async () => {
  const recognized = {
    events: [{ event_id: "event-retry", date: "2026-09-01", end_date: null, name: "开学", type: "teaching", confidence: "inferred", notes: null }],
    slots: [{ slot_id: "slot-retry", day_of_week: 1, period: 1, subject: "数学", class_name: "七年级二班", kind: "class", notes: null }],
  };
  const firstCommands = [];
  await assert.rejects(flow.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: "数学", classId: "class-7-2" }, {
    recognize: async () => recognized,
    issue: async (command) => {
      firstCommands.push(structuredClone(command));
      if (command.command_type === "import_timetable") throw new Error("simulated final-phase outage");
      return { receipt: { command_type: command.command_type, status: "accepted" }, data: {} };
    },
  }), /simulated final-phase outage/);

  const retryCommands = [];
  const retry = await flow.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: "数学", classId: "class-7-2" }, {
    recognize: async () => recognized,
    issue: async (command) => {
      retryCommands.push(structuredClone(command));
      return {
        receipt: {
          command_type: command.command_type,
          status: "accepted",
          reason_code: command.command_type === "import_timetable" ? null : "already_applied",
        },
        data: {},
      };
    },
  });

  assert.deepEqual(firstCommands, retryCommands);
  assert.deepEqual(retry.receipts.map((receipt) => receipt.reason_code), ["already_applied", "already_applied", null]);
});
