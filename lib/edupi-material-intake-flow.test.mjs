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
