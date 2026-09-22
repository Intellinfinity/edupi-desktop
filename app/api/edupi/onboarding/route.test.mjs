import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { GET, PUT, POST } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./route.ts");
const coreRoot = process.env.EDUPI_CORE_ROOT;
const dataRoot = process.env.EDUPI_DATA_ROOT;

test("manual save refuses a real newer capture before it can accept the other values", { skip: !coreRoot }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-context-race-"));
  const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.EDUPI_PROJECT_ROOT = root;
  process.env.EDUPI_DATA_ROOT = root;
  process.env.EDUPI_DATA_ALLOWED_ROOT = path.dirname(root);
  process.env.EDUPI_HOME = path.join(root, ".edupi");
  process.env.EDUPI_MEMORY_DIR = path.join(root, ".edupi", "memory");
  process.env.EDUPI_OUTPUT_DIR = path.join(root, ".edupi", "output");
  process.env.EDUPI_LOCK_DIR = path.join(root, ".edupi", "locks");
  await mkdir(process.env.EDUPI_OUTPUT_DIR, { recursive: true });
  await mkdir(process.env.EDUPI_MEMORY_DIR, { recursive: true });
  await mkdir(process.env.EDUPI_LOCK_DIR, { recursive: true });
  try {
    const store = await import(pathToFileURL(path.join(coreRoot, "scripts/teacher_review_store.mjs")).href);
    const runtimeRoot = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_root.mjs")).href);
    const admission = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs")).href);
    const prepared = runtimeRoot.prepareCoreRuntimeRoot(root);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    let latest;
    let reviews = 0;
    let race = true;
    let sequence = 0;
    let captureFailure;
    const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const routeModule = { exports: {} };
    const dependencies = {
      "next/server": { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
      "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({}) },
      "@/lib/edupi-teacher-context-review": { TeacherContextReviewError: class extends Error {} },
      "@/lib/request-security": { isApiRequestAllowed: () => true, hasJsonContentType: () => true },
      "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json() },
      "@/lib/edupi-context-editor-model": { normalizeTeacherContextValues: values => values },
      "@/lib/edupi-core-process-client": { runCoreProcess: async ({ request }) => {
        const lease = await admission.acquireCoreRuntimeWriterAdmission({ root: prepared, kind: "legacy_onboarding_test", busyTimeoutMs: 250 });
        try {
          const a = store.captureTeacherContextProposal({ source_message_id: `manual-a-${sequence++}`, source_text: "手动填写", values: request.values });
          latest = race ? store.captureTeacherContextProposal({ source_message_id: `chat-b-${sequence++}`, source_text: "对话更新", values: { name: "另一份资料" } }) : a;
          return { ok: true, context_id: a.context_id, revision: a.context.teacher_review.revision, proposed_values: a.context.proposed_values };
        } catch (error) {
          captureFailure = error instanceof Error ? error.message : String(error);
          throw error;
        } finally { await lease.release(); }
      } },
      "@/lib/edupi-education-server": { readEducationContract: async () => ({ teacherContextCandidates: [{ contextId: latest.context_id, revision: latest.context.teacher_review.revision, proposedValues: latest.context.proposed_values, snapshotId: "test-snapshot" }] }), reviewTeacherContextCandidate: async () => { reviews++; return { receipt: {}, data: {} }; } },
    };
    new Function("require", "module", "exports", output)(name => dependencies[name] || {}, routeModule, routeModule.exports);
    const request = () => new Request("http://localhost/api/edupi/onboarding", { method: "POST", body: JSON.stringify({ name: "本次填写" }) });
    assert.equal((await routeModule.exports.POST(request())).status, 409, captureFailure);
    assert.equal(reviews, 0);
    race = false;
    assert.equal((await routeModule.exports.POST(request())).status, 200);
    assert.equal(reviews, 1);
  } finally {
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    await rm(root, { recursive: true, force: true });
  }
});

test("manual input rejects empty, unknown and oversized fields before Core", async () => {
  for (const values of [{}, { api_key: "secret" }, { name: " " }, { name: "x".repeat(121) }]) {
    const response = await POST(new Request("http://localhost/api/edupi/onboarding", { method: "POST", headers: { "Content-Type": "application/json", host: "localhost" }, body: JSON.stringify(values) }));
    assert.equal(response.status, 400);
  }
  const blocked = await POST(new Request("http://localhost/api/edupi/onboarding", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://untrusted.example" }, body: JSON.stringify({name:"测试老师"}) }));
  assert.equal(blocked.status, 403);
});

test("returns the read-only teacher context from Core", { skip: !coreRoot || !dataRoot }, async () => {
  const response = await GET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.name, "吴老师");
  assert.equal(body.subject, "数学");
  assert.equal(body.grade, "七年级");
  assert.equal(body.editable, false);
  assert.equal(body.memoryDirectory, ".edupi/memory");
});

test("fails closed when the Core snapshot is missing", async () => {
  const previous = process.env.EDUPI_DATA_ROOT;
  process.env.EDUPI_DATA_ROOT = "/definitely/missing/edupi-data";
  try {
    const response = await GET();
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.match(body.error, /不可用/);
  } finally {
    if (previous === undefined) delete process.env.EDUPI_DATA_ROOT;
    else process.env.EDUPI_DATA_ROOT = previous;
  }
});

test("PUT rejects unknown fields before reaching Core", async () => {
  const response = await PUT(new Request("http://localhost/api/edupi/onboarding", { method: "PUT", body: JSON.stringify({ name: "不应写入", provider: "secret" }) }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_envelope");
});

test("PUT rejects credential and malformed patch fields", async () => {
  for (const value of [
    { targetId: "context-1", expectedSnapshotId: "snapshot-1", expectedRevision: 0, decision: "modify", patch: { api_key: "secret" }, reviewerId: "teacher" },
    { targetId: "context-1", expectedSnapshotId: "snapshot-1", expectedRevision: 0, decision: "modify", patch: { name: "x".repeat(121) }, reviewerId: "teacher" },
    { targetId: "context-1", expectedSnapshotId: "snapshot-1", expectedRevision: 0, decision: "hold", patch: null, reviewerId: "teacher", external_send: false },
  ]) {
    const response = await PUT(new Request("http://localhost/api/edupi/onboarding", { method: "PUT", body: JSON.stringify(value) }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_envelope");
  }
});

test("PUT maps a valid review request to Core availability", async () => {
  const response = await PUT(new Request("http://localhost/api/edupi/onboarding", {
    method: "PUT",
    body: JSON.stringify({ targetId: "context-1", expectedSnapshotId: "snapshot-1", expectedRevision: 0, decision: "hold", patch: null, reviewerId: "teacher" }),
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "unavailable");
});

test("onboarding route has no parser, direct file access, or save import", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /readTeacherContext/);
  assert.match(source, /reviewTeacherContextCandidate/);
  assert.doesNotMatch(source, /saveTeacherContext|readFile|writeFile|copyFile|rename|mkdir|preferences\.json|calendar\.json|timetable\.json|student_profiles\.json|teaching\.json/);
  assert.match(source, /invalid_teacher_context_review/);
});
