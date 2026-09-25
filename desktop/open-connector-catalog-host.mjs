import { realpathSync } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = "http://127.0.0.1:32999";
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const ACTION_ID = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/u;

function validRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string" || !ID.test(value.id)) return false;
  const keys = Object.keys(value).sort().join(",");
  if (value.op === "providers") return keys === "id,op";
  if (value.op === "search") return keys === "id,op,query" && typeof value.query === "string" && value.query.length <= 200;
  if (value.op === "inspect") return keys === "actionId,id,op" && ACTION_ID.test(value.actionId);
  return false;
}

export async function* readCatalogLines(input) {
  let parts = [];
  let size = 0;
  let oversized = false;
  for await (const incoming of input) {
    const chunk = Buffer.isBuffer(incoming) ? incoming : Buffer.from(incoming);
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(offset, end);
      if (!oversized) {
        size += part.length;
        if (size > MAX_REQUEST_BYTES) { oversized = true; parts = []; }
        else parts.push(part);
      }
      if (newline < 0) break;
      yield oversized ? null : Buffer.concat(parts).toString("utf8").replace(/\r$/u, "");
      parts = [];
      size = 0;
      oversized = false;
      offset = newline + 1;
    }
  }
  if (size > 0 || oversized) yield oversized ? null : Buffer.concat(parts).toString("utf8");
}

async function readBoundedEnvelope(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing body");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
    return { envelope: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } finally {
    reader.releaseLock();
  }
}

export async function handleCatalogLine(runtime, line, { timeoutMs = 8_000 } = {}) {
  let request;
  try {
    if (typeof line !== "string") throw new Error("invalid");
    if (Buffer.byteLength(line, "utf8") > MAX_REQUEST_BYTES) throw new Error("oversized");
    request = JSON.parse(line);
    if (!validRequest(request)) throw new Error("invalid");
  } catch {
    return { id: null, ok: false, code: "invalid_catalog_request" };
  }

  const url = new URL(request.op === "providers" ? "/v1/providers"
    : request.op === "search" ? "/v1/actions/search" : `/v1/actions/${encodeURIComponent(request.actionId)}`, ORIGIN);
  if (request.op === "search") url.searchParams.set("query", request.query);
  const controller = new AbortController();
  let timer;
  try {
    const work = (async () => {
      try {
        const response = await runtime.fetch(new Request(url, { method: "GET", signal: controller.signal }));
        const body = await readBoundedEnvelope(response);
        if (body.tooLarge) return { id: request.id, ok: false, code: "catalog_response_too_large" };
        if (!response.ok || body.envelope?.success !== true || body.envelope.data === undefined) {
          return { id: request.id, ok: false, code: "catalog_unavailable" };
        }
        const result = { id: request.id, ok: true, data: body.envelope.data };
        return Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RESPONSE_BYTES
          ? { id: request.id, ok: false, code: "catalog_response_too_large" } : result;
      } catch {
        return { id: request.id, ok: false, code: "catalog_unavailable" };
      }
    })();
    return await Promise.race([
      work,
      new Promise((resolveTimeout) => {
        timer = setTimeout(() => {
          controller.abort();
          resolveTimeout({ id: request.id, ok: false, code: "catalog_unavailable" });
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir || !isAbsolute(dataDir)) throw new Error("absolute data directory required");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if (!(await lstat(dataDir)).isDirectory()) throw new Error("invalid data directory");

  const { createConnectorRuntime } = await import("@oomol-lab/open-connector");
  const runtime = await createConnectorRuntime({
    dataDir,
    publicOrigin: ORIGIN,
    actionPolicy: { blockedActions: ["*"], blockedProxies: ["*"] },
  });
  process.stdout.write('{"type":"ready","version":1}\n');
  try {
    for await (const line of readCatalogLines(process.stdin)) {
      process.stdout.write(JSON.stringify(await handleCatalogLine(runtime, line)) + "\n");
    }
  } finally {
    await runtime.close();
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(() => { process.stderr.write("OpenConnector catalog host failed\n"); process.exitCode = 1; });
}
