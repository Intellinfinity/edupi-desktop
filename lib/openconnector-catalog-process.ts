import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCatalogQuery, projectCatalogData, type CatalogQuery, type CatalogResult } from "./openconnector-catalog-contract";

const MAX_OUTPUT_BYTES = 512 * 1024 + 1024;
const HOST_FILE = /^[a-z0-9-]+\.mjs$/u;

export class CatalogProcessError extends Error {
  constructor(public readonly code: "invalid_catalog_request" | "catalog_unavailable" | "catalog_timeout" | "catalog_invalid_response" | "catalog_busy") {
    super(code);
    this.name = "CatalogProcessError";
  }
}

type CatalogProcessOptions = { root?: string; hostFile?: string; nodeExecutable?: string; timeoutMs?: number };

declare global {
  var __edupiOpenConnectorCatalogActive: boolean | undefined;
}

function acquireCatalogProcess(): () => void {
  // A catalog process loads the full packaged connector directory. Reject
  // overlap instead of building an unbounded in-memory queue of heavy runtimes.
  if (globalThis.__edupiOpenConnectorCatalogActive) throw new CatalogProcessError("catalog_busy");
  globalThis.__edupiOpenConnectorCatalogActive = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    globalThis.__edupiOpenConnectorCatalogActive = false;
  };
}

export async function runCatalogQuery(query: CatalogQuery, options: CatalogProcessOptions = {}): Promise<CatalogResult> {
  if (!parseCatalogQuery(query)) throw new CatalogProcessError("invalid_catalog_request");
  const release = acquireCatalogProcess();
  try {
    return await runCatalogQueryOnce(query, options);
  } finally {
    release();
  }
}

async function runCatalogQueryOnce(
  query: CatalogQuery,
  { root = process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT, hostFile = "host.mjs", nodeExecutable = process.execPath, timeoutMs = 12_000 }: CatalogProcessOptions = {},
): Promise<CatalogResult> {
  const normalized = parseCatalogQuery(query);
  if (!normalized) throw new CatalogProcessError("invalid_catalog_request");
  if (!root || !path.isAbsolute(root) || !HOST_FILE.test(hostFile) || !path.isAbsolute(nodeExecutable) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) {
    throw new CatalogProcessError("catalog_unavailable");
  }
  const hostPath = path.join(root, hostFile);
  try {
    if (!(await lstat(root)).isDirectory() || !(await lstat(hostPath)).isFile()) throw new Error("invalid catalog files");
  } catch {
    throw new CatalogProcessError("catalog_unavailable");
  }

  const dataDir = await mkdtemp(path.join(tmpdir(), "edupi-openconnector-catalog-"));
  const id = randomUUID();
  const child = spawn(nodeExecutable, [hostPath, dataDir], {
    cwd: root,
    env: { NODE_ENV: "production", PATH: process.env.PATH || "" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  child.stdin.on("error", () => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  let frames = 0;
  let result: CatalogResult | null = null;
  let buffer = Buffer.alloc(0);
  let outputBytes = 0;
  let closed = false;
  const closedPromise = new Promise<void>((resolveClosed) => child.once("close", () => { closed = true; resolveClosed(); }));
  const response = new Promise<CatalogResult>((resolveResponse, rejectResponse) => {
    let settled = false;
    const fail = (code: CatalogProcessError["code"]) => {
      if (settled) return;
      settled = true;
      rejectResponse(new CatalogProcessError(code));
    };
    child.once("error", () => fail("catalog_unavailable"));
    child.stdout.on("error", () => fail("catalog_unavailable"));
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) { fail("catalog_invalid_response"); child.kill("SIGKILL"); return; }
      buffer = Buffer.concat([buffer, chunk]);
      let newline = buffer.indexOf(10);
      while (newline >= 0) {
        let frame: unknown;
        try {
          frame = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, newline)));
        } catch {
          fail("catalog_invalid_response");
          child.kill("SIGKILL");
          return;
        }
        buffer = buffer.subarray(newline + 1);
        frames += 1;
        if (frames === 1) {
          if (!frame || typeof frame !== "object" || (frame as { type?: unknown }).type !== "ready" || (frame as { version?: unknown }).version !== 1) fail("catalog_invalid_response");
        } else if (frames === 2) {
          const reply = frame && typeof frame === "object" && !Array.isArray(frame) ? frame as Record<string, unknown> : null;
          if (reply?.id !== id || reply.ok !== true) fail("catalog_unavailable");
          else result = projectCatalogData(normalized, reply.data);
          if (!result) fail("catalog_invalid_response");
        } else {
          fail("catalog_invalid_response");
        }
        if (settled) { child.kill("SIGKILL"); return; }
        newline = buffer.indexOf(10);
      }
    });
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0 || frames !== 2 || !result || buffer.length > 0) fail("catalog_unavailable");
      else { settled = true; resolveResponse(result); }
    });
    timer = setTimeout(() => { fail("catalog_timeout"); child.kill("SIGKILL"); }, timeoutMs);
  });

  try {
    child.stdin.end(JSON.stringify({ id, ...normalized }) + "\n");
    return await response;
  } finally {
    if (timer) clearTimeout(timer);
    if (!closed) {
      child.kill("SIGKILL");
      let waitTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([closedPromise, new Promise<void>((resolveWait) => { waitTimer = setTimeout(resolveWait, 1_000); })]);
      } finally {
        if (waitTimer) clearTimeout(waitTimer);
      }
    }
    await rm(dataDir, { recursive: true, force: true });
  }
}
