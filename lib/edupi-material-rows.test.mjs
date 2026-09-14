import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const {buildMaterialRows,defaultMaterialIntakeMetadata} = await jiti.import("./edupi-material-rows.ts");
const {buildEducationContract} = await jiti.import("./edupi-education-contract.ts");

test("preparation materials reflect the shared task decision", () => {
  const data = buildEducationContract({workspace:"/tmp/test",tasks:[{id:"task-a",title:"备课",status:"accepted",content_status:"draft_ready",deliverables:["教案"]}]});
  data.generatedArtifacts=[{artifact_id:"file-a",title:"教案",relative_path:".edupi/output/a.md",task_id:"task-a",origin:"preparation",available:true,updated_at:"2026-09-08"}];
  assert.equal(buildMaterialRows(data)[0].status,"已确认");
  data.tasks[0].status="planned";
  assert.equal(buildMaterialRows(data)[0].status,"候选");
  data.generatedArtifacts[0].available=false;
  assert.equal(buildMaterialRows(data)[0].status,"文件已移动或删除");
});

test("generated preparation rows use canonical work kind and linked timetable scope", () => {
  const data = buildEducationContract({ workspace: "/tmp/test", tasks: [
    { id: "lesson", title: "数学703课程", trigger: "teaching_before_class", source_event_id: "slot-703", status: "planned" },
    { id: "meeting", title: "教研会议", trigger: "meeting_preparation", source_event_id: "event-meeting", status: "planned" },
    { id: "unknown", title: "数学703标题不能推断范围", status: "planned" },
  ] });
  data.timetable = [{ slot_id: "slot-703", subject: "数学", class_name: "703" }, { slot_id: "slot-704", subject: "数学", class_name: "704" }];
  data.workCases = [{ taskId: "lesson", kind: "teaching_before_class", triggerId: "slot-703", sourceIds: ["slot-703"] }, { taskId: "meeting", kind: "calendar_preparation", triggerId: "event-meeting", sourceIds: ["event-meeting"] }];
  data.generatedArtifacts = ["lesson", "meeting", "unknown"].map(id => ({ artifact_id: `artifact-${id}`, task_id: id, title: id === "meeting" ? "行动项模板" : "教案", relative_path: `.edupi/output/${id}.md`, origin: "preparation", available: true, updated_at: "2026-09-09" }));
  const rows = buildMaterialRows(data);
  const lesson = rows.find(row => row.id === "artifact-lesson"), meeting = rows.find(row => row.id === "artifact-meeting");
  assert.equal(lesson.type, "课前准备"); assert.equal(lesson.source, "EduPi 备课"); assert.equal(lesson.subject, "数学 · 703");
  assert.equal(meeting.type, "会议准备"); assert.equal(meeting.source, "EduPi 日程准备"); assert.equal(meeting.subject, "—");
  assert.equal(rows.find(row => row.id === "artifact-unknown").subject, "—");
  assert.equal(buildMaterialRows(data, "703").filter(row => row.id === "artifact-lesson").length, 1);
  data.tasks.find(task => task.id === "lesson").sourceEventId = "timetable:slot-703:2026-09-09";
  data.workCases[0].triggerId = "timetable:slot-703:2026-09-09";
  data.workCases[0].sourceIds = ["timetable:slot-703:2026-09-09"];
  assert.equal(buildMaterialRows(data).find(row => row.id === "artifact-lesson").subject, "数学 · 703", "dated timetable occurrences retain their slot scope");
  data.timetable.push({ slot_id: "slot-703", subject: "语文", class_name: "705" });
  assert.equal(buildMaterialRows(data).find(row => row.id === "artifact-lesson").subject, "—", "ambiguous source IDs must not select a class");
});

test("uploaded material uses its persisted ID, not its intake review target", () => {
  const data=buildEducationContract({workspace:"/tmp/test",tasks:[]});
  data.teacherMaterials=[{material_id:"material-real",title:"lesson.docx",kind:"other",subject:"数学",class_id:"703",relative_path:".edupi/inbox/teacher-materials/lesson.docx",available:true}];
  data.intakeTargets=[{targetId:"material_intake_review",projectionKind:"material_intake",title:"lesson.docx",summary:"已接收材料",status:"accepted",reviewedAt:"2026-09-09"}];
  data.intakeReceipts=[{commandType:"intake_material",appliedIds:["material-real"],target:{targetId:"material_intake_review"},createdAt:"2026-09-09"}];
  const row=buildMaterialRows(data)[0];
  assert.equal(row.id,"material-real");
  assert.equal(row.subject,"数学 · 703");
  assert.equal(row.filePath,"/tmp/test/.edupi/inbox/teacher-materials/lesson.docx");
  assert.equal(row.date,"2026-09-09");
  assert.equal(row.summary,"已接收材料");
  data.teacherMaterials[0].title="renamed.docx";
  assert.equal(buildMaterialRows(data)[0].summary,"renamed.docx","stale intake copy must not replace current metadata");
  data.teacherMaterials=[];
  assert.deepEqual(buildMaterialRows(data),[],"a historical accepted receipt must not revive a deleted material");
});

test("upload carries a known teacher scope without guessing among multiple classes", () => {
  assert.deepEqual(defaultMaterialIntakeMetadata("学案.pdf",{subject:"数学",classes:["703"]}),{title:"学案.pdf",materialKind:"other",subject:"数学",classId:"703"});
  assert.equal(defaultMaterialIntakeMetadata("学案.pdf",{subject:"数学",classes:["703","704"]}).classId,"");
  assert.deepEqual(defaultMaterialIntakeMetadata("学案.pdf",null),{title:"学案.pdf",materialKind:"other",subject:"",classId:""});
});
