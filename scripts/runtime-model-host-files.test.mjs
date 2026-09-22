import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";
import { copyRuntimeModelHostFiles, RUNTIME_MODEL_HOST_FILES } from "./runtime-model-host-files.mjs";
import { piPackageDirNames } from "./pi-packages.mjs";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const stagedServer = path.join(process.env.EDUPI_STAGED_RESOURCES || path.join(desktopRoot, "src-tauri/resources"), "server");
test("model host files copy as regular files and reject symlinked sources", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-host-files-"));
  try {
    const source = path.join(root, "core"), destination = path.join(root, "server");
    fs.mkdirSync(path.join(source, "scripts"), { recursive: true });
    for (const name of RUNTIME_MODEL_HOST_FILES) fs.writeFileSync(path.join(source, "scripts", name), `// ${name}`);
    await copyRuntimeModelHostFiles(source, destination);
    for (const name of RUNTIME_MODEL_HOST_FILES) assert.equal(fs.lstatSync(path.join(destination, "scripts", name)).isFile(), true);
    const file = path.join(source, "scripts", RUNTIME_MODEL_HOST_FILES[0]);
    fs.unlinkSync(file); fs.symlinkSync(path.join(destination, "scripts", RUNTIME_MODEL_HOST_FILES[0]), file);
    await assert.rejects(copyRuntimeModelHostFiles(source, destination), /regular file/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("copied host SDK runs a real isolated localhost model without Core node_modules or symlinks", { skip: !process.env.EDUPI_CORE_ROOT || !fs.existsSync(path.join(stagedServer, "node_modules")) }, async () => {
  for (const name of await piPackageDirNames()) {
    assert.equal(fs.statSync(path.join(stagedServer, "node_modules/@earendil-works", name, "package.json")).isFile(), true, `${name} package metadata missing`);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-host-copy-live-"));
  const priorCwd = process.cwd();
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    const request = JSON.parse(text); calls++;
    assert.equal(request.tools, undefined);
    const output = JSON.stringify({ artifacts: [{ title: "Outline", content: "Fold the supplied cube net.", source_ids: ["material"] }] });
    const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: "copied", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" }); res.write(chunk({ role: "assistant", content: output }, null)); res.write(chunk({}, "stop")); res.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let host;
  try {
    await copyRuntimeModelHostFiles(process.env.EDUPI_CORE_ROOT, root);
    fs.cpSync(path.join(stagedServer, "node_modules"), path.join(root, "node_modules"), { recursive: true, dereference: true });
    fs.copyFileSync(path.join(stagedServer, "package.json"), path.join(root, "package.json"));
    const inspect = directory => { for (const item of fs.readdirSync(directory, { withFileTypes: true })) { assert.equal(item.isSymbolicLink(), false); if (item.isDirectory()) inspect(path.join(directory, item.name)); } };
    inspect(root);
    const agentDir = path.join(root, "agent"); fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "local" }));
    fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify({ local: { type: "api_key", key: "copied-host-test-key" } }));
    fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { local: { api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: "local", name: "local", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 }] } } }));
    const { createRuntimeModelHost } = await createJiti(import.meta.url).import("../lib/edupi-runtime-model-host.ts");
    process.chdir(root);
    host = createRuntimeModelHost({ coreRoot: path.join(root, "missing-core"), projectRoot: root, agentDir, allowLoopback: true });
    const { buildHarnessLeaseRequest } = await import(pathToFileURL(path.join(root, "scripts/core_runtime_harness.mjs")).href);
    const { buildG1LiveRequest } = await import(pathToFileURL(path.join(root, "scripts/core_runtime_model_adapter.mjs")).href);
    const hash = value => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
    const request = buildG1LiveRequest({ lease: buildHarnessLeaseRequest({ lease_id: "lease", work_case_id: "work", execution_fingerprint: hash("e"), attempt: 1, claim_token_hash: hash("c"), fencing_generation: 1, source_revision: "r1", deadline_at: new Date(Date.now() + 30000).toISOString(), input: { work_case_id: "work", task_id: "task", title: "Cube", summary: "Synthetic", reason: "confirmed", due_at: "2026-09-09", source_semantic_fingerprint: hash("s"), source_revision: "r1", deliverables: ["Outline"] } }), materials: [{ source_id: "material", revision: "r1", content: "Cube net", sha256: hash("Cube net") }] });
    const result = await host.run(request, { signal: new AbortController().signal });
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(calls, 1);
    assert.equal(result.output.artifacts[0].content, "Fold the supplied cube net.");
    assert.equal(JSON.stringify(result).includes("copied-host-test-key"), false);
  } finally { await host?.close(); process.chdir(priorCwd); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});
