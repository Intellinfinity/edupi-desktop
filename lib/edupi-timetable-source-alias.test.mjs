import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { projectTimetableSourceOptions, resolveSelectedTimetableSource, resolveTimetableSourceAlias } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./edupi-timetable-source-alias.ts");

const sourceHash = `sha256:${"a".repeat(64)}`;
const evidenceId = `schedule-evidence-${"a".repeat(32)}`;
const sourceId = `document-source-${"b".repeat(32)}`;
const descriptor = { source_hash: sourceHash };
const slot = { slot_id: "model-slot", day_of_week: 1, period: 2, subject: "数学", class_name: "七年级二班", kind: "class", notes: null };
const canonical = { slot_id: "core-slot", day_of_week: 1, period: 2, subject: "数学", class_name: "七年级二班", kind: "class",
  notes: "材料识别待确认：", source_ids: [sourceId], evidence_ids: [evidenceId] };
const materialTarget = { projection_kind: "material_intake", source_hash: sourceHash, status: "accepted", intake_state: "accepted",
  target: { target_kind: "material_intake", target_id: "material-target" } };
const slotTarget = { projection_kind: "timetable_import", source_hash: sourceHash, status: "accepted",
  source_ids: [sourceId], evidence_ids: [evidenceId], item_count: 1, conflict_count: 0, held_count: 0 };

function read(slots = [canonical], targets = [materialTarget, slotTarget]) {
  return { snapshot: { payload: { education_workspace: { timetable: slots }, review_targets: targets } } };
}

test("exact current Core slot evidence recovers one document source alias", () => {
  assert.equal(resolveTimetableSourceAlias(descriptor, [slot], read()), sourceId);
  assert.equal(resolveTimetableSourceAlias(descriptor, [slot], read([{ ...canonical,
    evidence_ids: [`schedule-evidence-${"c".repeat(32)}`, evidenceId] }])), sourceId,
  "an exact-copy upload may retain another material's identical evidence");
  assert.equal(resolveTimetableSourceAlias(descriptor, [slot], read([canonical],
    [materialTarget, slotTarget, { ...slotTarget, target: { target_kind: "timetable_import", target_id: "repeat" } }])), sourceId);
  const legacySourceId = `desktop-file-schedule-${"d".repeat(24)}`;
  assert.equal(resolveTimetableSourceAlias(descriptor, [slot], read([{ ...canonical, source_ids: [legacySourceId] }],
    [materialTarget, { ...slotTarget, source_ids: [legacySourceId] }])), legacySourceId);
  assert.equal(resolveTimetableSourceAlias(descriptor, [slot], read([], [])), null);
});

test("prior source evidence without current slot/material proof fails closed", () => {
  for (const candidate of [
    read([{ ...canonical, source_ids: undefined }]),
    read([{ ...canonical, evidence_ids: undefined }]),
    read([{ ...canonical, notes: "teacher-edited" }]),
    read([], [materialTarget, slotTarget]),
    read([canonical], [slotTarget]),
  ]) {
    assert.throws(() => resolveTimetableSourceAlias(descriptor, [slot], candidate), /来源|证据|核对/u);
  }
});

test("multiple sources or omitted sibling slots never bind an alias silently", () => {
  const anotherSource = `document-source-${"c".repeat(32)}`;
  assert.throws(() => resolveTimetableSourceAlias(descriptor, [slot], read([canonical], [materialTarget, slotTarget,
    { ...slotTarget, source_ids: [anotherSource] }])), /来源|核对/u);
  const other = { ...canonical, slot_id: "other-slot", period: 3, subject: "语文" };
  assert.throws(() => resolveTimetableSourceAlias(descriptor, [slot], read([canonical, other], [materialTarget, slotTarget])), /来源|核对/u);
});

test("teacher-selected timetable source uses a current per-source fingerprint", () => {
  const current = read([canonical]);
  const options = projectTimetableSourceOptions(current);
  assert.equal(options.length, 1);
  assert.equal(options[0].selectionKey, `timetable:${sourceId}`);
  assert.equal(resolveSelectedTimetableSource(current, sourceId, options[0].fingerprint, [slot]), sourceId);
  assert.throws(() => resolveSelectedTimetableSource(read([{ ...canonical, notes: "教师已更正" }]),
    sourceId, options[0].fingerprint, [slot]), /课表来源已变化/u);
  assert.throws(() => resolveSelectedTimetableSource(read([]), sourceId, options[0].fingerprint, [slot]), /课表来源已变化/u);
  assert.throws(() => resolveSelectedTimetableSource(current, sourceId, options[0].fingerprint,
    [{ ...slot, class_name: "完全无关的班级", subject: "语文", day_of_week: 5, period: 8 }]), /不对应/u);
  assert.equal(resolveSelectedTimetableSource(current, sourceId, options[0].fingerprint,
    [slot, { ...slot, slot_id: "new-science", day_of_week: 3, period: 4, subject: "科学" }]), sourceId,
  "one proven retained lesson can anchor an incremental addition when no other source also fits");
  const otherSource = `document-source-${"e".repeat(32)}`;
  const mathCopy = { ...canonical, slot_id: "other-math", source_ids: [otherSource] };
  const distinctA = { ...canonical, slot_id: "a-chinese", day_of_week: 2, period: 3, subject: "语文" };
  const distinctB = { ...canonical, slot_id: "b-english", day_of_week: 3, period: 4,
    subject: "英语", source_ids: [otherSource] };
  const ambiguous = read([canonical, distinctA, mathCopy, distinctB]);
  const candidates = projectTimetableSourceOptions(ambiguous);
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].label, candidates[1].label);
  const selectedCandidate = candidates.find((item) => item.sourceId === sourceId);
  assert.throws(() => resolveSelectedTimetableSource(ambiguous, sourceId, selectedCandidate.fingerprint, [slot]), /不对应/u,
    "one shared lesson cannot decide between two otherwise different source schedules");
  assert.equal(resolveSelectedTimetableSource(ambiguous, sourceId, selectedCandidate.fingerprint,
    [slot, { ...slot, slot_id: "new-chinese", day_of_week: 2, period: 3, subject: "语文" }]), sourceId);
  assert.throws(() => resolveSelectedTimetableSource(read([canonical, { ...canonical, slot_id: "manual-slot",
    evidence_ids: ["teacher-note"] }]), sourceId, options[0].fingerprint, [slot]), /课表来源已变化/u);
  assert.deepEqual(projectTimetableSourceOptions(read([{ ...canonical,
    source_ids: [sourceId, `document-source-${"c".repeat(32)}`] }])), []);
});
