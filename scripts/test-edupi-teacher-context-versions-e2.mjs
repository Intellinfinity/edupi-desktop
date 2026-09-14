#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-context-versions-e2-")));
const memoryDir = path.join(temp, ".edupi", "memory");
const outputDir = path.join(temp, ".edupi", "output");
const lockDir = path.join(temp, ".edupi", "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true });

Object.assign(process.env, {
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_DATA_ROOT: temp,
  EDUPI_DATA_ALLOWED_ROOT: path.dirname(temp),
  EDUPI_PROJECT_ROOT: temp,
  EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir,
  EDUPI_LOCK_DIR: lockDir,
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const onboarding = await jiti.import("../app/api/edupi/onboarding/route.ts");
const versionsRoute = await jiti.import("../app/api/edupi/onboarding/versions/route.ts");

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

async function save(values) {
  const response = await onboarding.POST(jsonRequest("http://localhost/api/edupi/onboarding", "POST", values));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

try {
  const initialValues = { name: "吴老师", subject: "数学", grade: "七年级", class_name: "703" };
  await save(initialValues);
  const changedValues = { ...initialValues, grade: "八年级" };
  const changed = await save(changedValues);
  let candidate = changed.data.teacherContextCandidates.find((item) => item.contextId === "context_teacher");
  assert.ok(candidate);
  assert.equal(candidate.revision, 2);
  assert.deepEqual(candidate.currentValues, changedValues);

  const versionsResponse = await versionsRoute.GET();
  const versionsResult = await versionsResponse.json();
  assert.equal(versionsResponse.status, 200, JSON.stringify(versionsResult));
  assert.equal(versionsResult.versions.length, 2);
  assert.deepEqual(versionsResult.versions[0].beforeValues, {});
  assert.deepEqual(versionsResult.versions[1].changedFields, ["grade"]);

  const restoreBody = {
    targetId: candidate.contextId,
    versionId: versionsResult.versions[0].versionId,
    versionSide: "before",
    fieldKey: "class_name",
    expectedSnapshotId: candidate.snapshotId,
    expectedRevision: candidate.revision,
    expectedSourceId: candidate.sourceIds[0],
  };
  const restoreResponse = await versionsRoute.POST(jsonRequest("http://localhost/api/edupi/onboarding/versions", "POST", restoreBody));
  const restored = await restoreResponse.json();
  assert.equal(restoreResponse.status, 200, JSON.stringify(restored));
  assert.equal(restored.reconciled, false);
  candidate = restored.data.teacherContextCandidates.find((item) => item.contextId === "context_teacher");
  assert.ok(candidate);
  assert.equal(candidate.revision, 3);
  assert.equal(Object.hasOwn(candidate.currentValues, "class_name"), false);
  assert.equal(candidate.currentValues.grade, "八年级");
  assert.equal(candidate.currentValues.name, "吴老师");

  const replayResponse = await versionsRoute.POST(jsonRequest("http://localhost/api/edupi/onboarding/versions", "POST", restoreBody));
  const replayed = await replayResponse.json();
  assert.equal(replayResponse.status, 200, JSON.stringify(replayed));
  assert.equal(replayed.reconciled, true);
  assert.equal(replayed.data.teacherContextCandidates.find((item) => item.contextId === "context_teacher").revision, 3);

  const staleResponse = await versionsRoute.POST(jsonRequest("http://localhost/api/edupi/onboarding/versions", "POST", { ...restoreBody, versionId: versionsResult.versions[1].versionId }));
  assert.equal(staleResponse.status, 409, JSON.stringify(await staleResponse.clone().json()));

  const finalVersions = await (await versionsRoute.GET()).json();
  assert.equal(finalVersions.versions.length, 3);
  assert.deepEqual(finalVersions.versions[2].changedFields, ["class_name"]);
  assert.equal(Object.hasOwn(finalVersions.versions[2].afterValues, "class_name"), false);
  assert.match(finalVersions.versions[2].note, /恢复班级/);
  assert.doesNotMatch(finalVersions.versions[2].note, /class_name/);

  const contextResponse = await onboarding.GET();
  const context = await contextResponse.json();
  assert.equal(contextResponse.status, 200, JSON.stringify(context));
  assert.equal(context.grade, "八年级");
  assert.deepEqual(context.classes, []);
  assert.equal(context.name, "吴老师");

  const { createEduPiTeacherContextAppendSystemPromptOverride } = await jiti.import("../lib/edupi-teacher-context-prompt.ts");
  const promptOverride = await createEduPiTeacherContextAppendSystemPromptOverride(temp);
  const prompt = promptOverride?.([]).join("\n") || "";
  assert.match(prompt, /八年级/);
  assert.doesNotMatch(prompt, /七年级/);

  console.log(JSON.stringify({ status: "passed", versions: finalVersions.versions.length, restored_field: "class_name", revision: candidate.revision, replay_reconciled: true, other_fields_preserved: true, prompt_context_updated: true }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
