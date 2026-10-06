import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { taskPreparedArtifacts } = await jiti.import("./edupi-task-artifacts.ts");
const task = { id: "task-1", title: "课堂准备", contentStatus: "draft_ready", status: "planned", deliverables: ["教案", "练习", "答案"], evidence: {}, revision: 12 };
const file = (overrides = {}) => ({ artifact_id: "file-1", task_id: "task-1", title: "真实教案", relative_path: ".edupi/output/lesson.md", available: true, access: "editable", session_id: "session-1", updated_at: "2026-10-06T08:00:00Z", size_bytes: 120, ...overrides });
const workCase = (artifacts = [], taskId = "task-1") => ({ taskId, artifacts, artifactRevision: 99, executionRevision: 100 });
const caseFile = (overrides = {}) => ({ id: "file-1", title: "旧标题", relativePath: ".edupi/output/lesson.md", revision: 2, ...overrides });

test("planned deliverable names and source files never become generated files", () => {
  for (const contentStatus of ["not_generated", "candidate_only", "draft_ready", "confirmed"]) {
    assert.deepEqual(taskPreparedArtifacts({ ...task, contentStatus }, null, [], "/workspace"), []);
  }
  assert.deepEqual(taskPreparedArtifacts({ ...task, contentStatus: "candidate_only", evidence: { file_path: "source.md" } }, null, [], "/workspace"), []);
});

test("resource files are scoped to the exact task id, including tasks without an id", () => {
  const files = [file(), file({ artifact_id: "other", task_id: "task-2", relative_path: "other.md" }), file({ artifact_id: "unbound", task_id: null, relative_path: "unbound.md" })];
  assert.deepEqual(taskPreparedArtifacts(task, null, files, "/workspace").map(item => item.id), ["file-1"]);
  assert.deepEqual(taskPreparedArtifacts({ ...task, id: null }, workCase([caseFile()], null), files, "/workspace"), []);
});

test("current files win over work-case fallbacks and keep unavailable and read-only state", () => {
  const current = Object.freeze(file({ available: false, access: "read_only" }));
  const result = taskPreparedArtifacts({ ...task, status: "rejected", contentStatus: "generation_failed" }, workCase([caseFile()]), Object.freeze([current]), "/workspace/");
  assert.deepEqual(result, [{ id: "file-1", title: "真实教案", path: "/workspace/.edupi/output/lesson.md", available: false, readOnly: true, revision: 2 }]);
  assert.equal(current.available, false);
  assert.equal(current.access, "read_only");
});

test("deduplicates file ids and normalized paths across resources, work cases and legacy evidence", () => {
  const files = [file(), file({ relative_path: ".edupi/output/renamed.md" }), file({ artifact_id: "path-alias", relative_path: "./.edupi//output/./lesson.md" }), file({ artifact_id: "windows-alias", relative_path: ".edupi\\output\\lesson.md" })];
  const matching = workCase([caseFile(), caseFile({ id: "path-alias", relativePath: "should-not-duplicate.md" }), caseFile({ id: "answers", relativePath: ".edupi/output/answers.md", title: "真实答案" })]);
  const result = taskPreparedArtifacts({ ...task, evidence: { artifact_file_path: ".edupi/output/lesson.md" } }, matching, files, "/workspace");
  assert.deepEqual(result.map(item => [item.id, item.path]), [["file-1", "/workspace/.edupi/output/lesson.md"], ["answers", "/workspace/.edupi/output/answers.md"]]);
  assert.equal(result[0].revision, 2);
});

test("work-case files belong only to the same task and only file revisions are projected", () => {
  assert.deepEqual(taskPreparedArtifacts(task, workCase([caseFile()], "task-2"), [], "/workspace"), []);
  const matching = workCase([caseFile({ revision: 0 }), caseFile({ id: "second", relativePath: "second.md", revision: 3.5 }), caseFile({ id: "third", relativePath: "third.md", revision: 4 })]);
  const result = taskPreparedArtifacts(task, matching, [], "/workspace");
  assert.equal(result[0].revision, undefined);
  assert.equal(result[1].revision, undefined);
  assert.equal(result[2].revision, 4);
  const changedPath = taskPreparedArtifacts(task, workCase([caseFile({ relativePath: "old.md", revision: 4 })]), [file()], "/workspace");
  assert.equal(changedPath[0].revision, undefined);
  assert.deepEqual(Object.keys(result[0]).sort(), ["available", "id", "path", "readOnly", "title"]);
});

test("relative resource paths stay inside the workspace and normalize Windows separators", () => {
  for (const relative_path of ["", "   ", ".", "folder/", "/outside.md", "C:\\outside.md", "C:outside.md", "\\\\server\\share.md", "../outside.md", "output/../outside.md", "output\\..\\outside.md", "https://example.com/file.md", "output/\0file.md"]) {
    assert.deepEqual(taskPreparedArtifacts(task, workCase([caseFile({ relativePath: relative_path })]), [file({ relative_path })], "/workspace"), [], relative_path);
  }
  assert.equal(taskPreparedArtifacts(task, null, [file()], "C:\\Teacher\\")[0].path, "C:/Teacher/.edupi/output/lesson.md");
  assert.deepEqual(taskPreparedArtifacts(task, null, [file()], ""), []);
});

test("legacy paths require ready content and an actual file reference inside the workspace", () => {
  const legacy = { ...task, evidence: { artifact_file_path: "./.edupi//output/legacy.md" } };
  const result = taskPreparedArtifacts(legacy, null, [], "/workspace");
  assert.equal(result[0].title, "legacy.md");
  assert.equal(result[0].path, "/workspace/.edupi/output/legacy.md");
  assert.equal(result[0].revision, undefined);
  for (const contentStatus of ["not_generated", "running", "generation_failed", "unavailable"]) {
    assert.deepEqual(taskPreparedArtifacts({ ...legacy, contentStatus }, null, [], "/workspace"), []);
  }
  for (const artifact_file_path of ["/outside.md", "/workspace-other/file.md", "/workspace/../outside.md", "../outside.md", "C:\\outside.md"]) {
    assert.deepEqual(taskPreparedArtifacts({ ...legacy, evidence: { artifact_file_path } }, null, [], "/workspace"), []);
  }
  assert.equal(taskPreparedArtifacts({ ...task, evidence: { file_path: ".edupi/output/draft.md" } }, null, [], "/workspace")[0].path, "/workspace/.edupi/output/draft.md");
});

test("duplicate current resource restrictions cannot be loosened by another alias", () => {
  const result = taskPreparedArtifacts(task, null, [file(), file({ artifact_id: "alias", available: false, access: "read_only" })], "/workspace");
  assert.equal(result.length, 1);
  assert.equal(result[0].available, false);
  assert.equal(result[0].readOnly, true);
});
