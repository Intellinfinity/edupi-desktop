import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildStudentProfileUpdateRequest, studentProfileUpdateRequestId } = await jiti.import("./edupi-student-roster-server.ts");
const { parseStudentProfileList } = await jiti.import("./edupi-student-profile-edit.ts");

test("profile changes carry explicit identity and class", () => {
  const request = buildStudentProfileUpdateRequest({name:"张三",studentId:"student-b",className:"C",traits:[],parentNotes:[],expectedUpdatedAt:"2026-09-01T00:00:00Z",expectedRevision:2},"update-b");
  assert.equal(request.student.student_id,"student-b");
  assert.equal(request.student.class_name,"C");
  assert.equal(request.student.name,"张三");
});

test("builds one bounded Core student-profile replacement request", () => {
  assert.deepEqual(buildStudentProfileUpdateRequest({
    name: "李四",
    studentId: "student-1",
    traits: ["耐心", "主动提问"],
    parentNotes: [],
    expectedUpdatedAt: "2026-09-01T07:00:00.000Z",
    expectedRevision: 0,
  }, "student-update-1"), {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "students",
    request_id: "student-update-1",
    action: "update",
    expected_updated_at: "2026-09-01T07:00:00.000Z",
    expected_revision: 0,
    student: { name: "李四", student_id: "student-1", traits: ["耐心", "主动提问"], parent_notes: [] },
  });
});

test("parses editable profile lists with removal, deduplication and Chinese separators", () => {
  assert.deepEqual(parseStudentProfileList("耐心、主动提问\n耐心；愿意表达"), ["耐心", "主动提问", "愿意表达"]);
  assert.deepEqual(parseStudentProfileList(""), []);
});

test("derives one stable update request id from the complete edit intent", () => {
  const input = { name: "李四", studentId: "student-1", className: "704", traits: ["主动提问"], parentNotes: ["本周已沟通"], expectedUpdatedAt: "2026-09-01T07:00:00.000Z", expectedRevision: 2 };
  const requestId = studentProfileUpdateRequestId(input);
  assert.equal(studentProfileUpdateRequestId({ ...input, traits: [...input.traits] }), requestId);
  for (const changed of [
    { ...input, studentId: "student-2" },
    { ...input, className: "703" },
    { ...input, traits: ["认真"] },
    { ...input, parentNotes: [] },
    { ...input, expectedUpdatedAt: "2026-09-02T07:00:00.000Z" },
    { ...input, expectedRevision: 3 },
  ]) assert.notEqual(studentProfileUpdateRequestId(changed), requestId);
});
