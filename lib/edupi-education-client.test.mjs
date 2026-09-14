import assert from "node:assert/strict";
import test from "node:test";
import { preserveUnavailableWorkspaceResources, readEduPiEducation, readEduPiWorkspace, resetEduPiEducationRequestForTest } from "./edupi-education-client.ts";

test("preserves last-known resource rows while a committed refresh reports resources unavailable", () => {
  const previous = { students: [{ student_id: "student-1", class_name: "703" }], studentNameCounts: { 李四: 1 }, teacherMaterials: [{ material_id: "material-old" }], generatedArtifacts: [{ artifact_id: "artifact-old" }] };
  const next = { students: [{ student_id: "student-1", class_name: null }], studentNameCounts: {}, teacherMaterials: [], generatedArtifacts: [], workspaceResourcesUnavailable: true, generatedArtifactsUnavailable: true };
  const preserved = preserveUnavailableWorkspaceResources(previous, next);
  assert.equal(preserved.students[0].class_name, "703");
  assert.deepEqual(preserved.teacherMaterials, previous.teacherMaterials);
  assert.deepEqual(preserved.generatedArtifacts, previous.generatedArtifacts);
  assert.equal(preserved.workspaceResourcesUnavailable, true);
  assert.deepEqual(preserveUnavailableWorkspaceResources(previous, next, { removedMaterialId: "material-old" }).teacherMaterials, []);
  const available = { ...next, workspaceResourcesUnavailable: false };
  assert.equal(preserveUnavailableWorkspaceResources(previous, available), available);
});

test("concurrent education readers share one in-flight request and release it after completion", async () => {
  resetEduPiEducationRequestForTest();
  let calls = 0;
  let finish;
  const fetcher = async (url) => {
    calls += 1;
    assert.equal(url, "/api/edupi/workspace");
    await new Promise((resolve) => { finish = resolve; });
    return { ok: true, json: async () => ({ context: { name: "吴老师" }, data: { workspace: "/tmp/edupi", tasks: [] } }) };
  };

  const first = readEduPiWorkspace({ fetcher });
  const second = readEduPiEducation({ fetcher });
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await first, { context: { name: "吴老师" }, data: { workspace: "/tmp/edupi", tasks: [] } });
  assert.deepEqual(await second, { workspace: "/tmp/edupi", tasks: [] });

  const third = readEduPiEducation({ fetcher: async () => {
    calls += 1;
    return { ok: true, json: async () => ({ context: { name: "吴老师" }, data: { workspace: "/tmp/edupi", tasks: ["next"] } }) };
  } });
  assert.deepEqual(await third, { workspace: "/tmp/edupi", tasks: ["next"] });
  assert.equal(calls, 2);
});

test("one aborted reader does not cancel the shared education request", async () => {
  resetEduPiEducationRequestForTest();
  const controller = new AbortController();
  let finish;
  const fetcher = async () => {
    await new Promise((resolve) => { finish = resolve; });
    return { ok: true, json: async () => ({ context: { name: "吴老师" }, data: { workspace: "/tmp/edupi", tasks: [] } }) };
  };
  const aborted = readEduPiEducation({ fetcher, signal: controller.signal });
  const active = readEduPiEducation({ fetcher });
  controller.abort();
  finish();
  await assert.rejects(aborted, (error) => error?.name === "AbortError");
  assert.equal((await active).workspace, "/tmp/edupi");
});
