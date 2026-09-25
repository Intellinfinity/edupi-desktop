import { createServer } from "node:http";
import { readFile, lstat, mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOOPBACK = "127.0.0.1";
const MAX_API_BYTES = 16 * 1024 * 1024;
const MAX_STATIC_BYTES = 2 * 1024 * 1024;
const READ_PATHS = [
  /^\/api\/auth\/session$/u,
  /^\/api\/(?:providers|connections|oauth\/configs|runtime-tokens|runtime-policy|runs|marketplace|provider-preferences)$/u,
  /^\/api\/actions\/[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+(?:\/agent\.md)?$/u,
];
const PAGE_PATH = /^\/(?:overview|providers(?:\/[a-z0-9_-]+)?|actions(?:\/[A-Za-z0-9_.-]+)?|runs)?\/?$/u;
const ASSET_PATH = /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|png|svg|woff2?)$/u;
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const CONSOLE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";

function extension(pathname) {
  return pathname.slice(pathname.lastIndexOf("."));
}

function respond(response, status, body = "", contentType = "text/plain; charset=utf-8", extra = {}) {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  });
  response.end(body);
}

async function boundedBody(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks);
      size += value.byteLength;
      if (size > maxBytes) throw new Error("response_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function createConsoleHttpServer({ assetRoot, runtime }) {
  if (!isAbsolute(assetRoot) || typeof runtime?.fetch !== "function") throw new Error("invalid_console_configuration");
  if (!(await lstat(join(assetRoot, "index.html"))).isFile()) throw new Error("console_assets_unavailable");
  let origin = "";
  const server = createServer(async (request, response) => {
    try {
      if (!origin || request.headers.host !== new URL(origin).host || request.method !== "GET"
        || request.headers.origin && request.headers.origin !== origin) {
        respond(response, 403);
        return;
      }
      if (!request.url || !request.url.startsWith("/") || request.url.length > 4_096) {
        respond(response, 400);
        return;
      }
      const target = new URL(request.url, origin);
      if (target.origin !== origin) { respond(response, 403); return; }
      if (READ_PATHS.some((pattern) => pattern.test(target.pathname))) {
        const upstream = await runtime.fetch(new Request(target));
        const body = await boundedBody(upstream, MAX_API_BYTES);
        const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
        respond(response, upstream.status, body, contentType);
        return;
      }
      const staticPath = PAGE_PATH.test(target.pathname) ? "index.html"
        : ASSET_PATH.test(target.pathname) ? target.pathname.slice(1) : null;
      if (!staticPath || target.search) { respond(response, 404); return; }
      const fullPath = join(assetRoot, staticPath);
      const stat = await lstat(fullPath).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_STATIC_BYTES) { respond(response, 404); return; }
      const body = await readFile(fullPath);
      respond(response, 200, body, CONTENT_TYPES[extension(fullPath)] || "application/octet-stream",
        staticPath === "index.html" ? { "content-security-policy": CONSOLE_CSP } : {});
    } catch {
      respond(response, 503);
    }
  });
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, LOOPBACK, done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("console_listen_failed");
  origin = `http://${LOOPBACK}:${address.port}`;
  return {
    url: `${origin}/`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}

async function main() {
  const packageRoot = dirname(fileURLToPath(import.meta.url));
  const assetRoot = process.env.EDUPI_OPENCONNECTOR_CONSOLE_ASSETS || join(packageRoot, "web");
  const dataDir = await mkdtemp(join(tmpdir(), "edupi-openconnector-console-"));
  let connector;
  let server;
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server?.close();
    await connector?.close();
    await rm(dataDir, { recursive: true, force: true });
  };
  try {
    const { createConnectorRuntime } = await import("@oomol-lab/open-connector");
    server = await createConsoleHttpServer({
      assetRoot,
      runtime: { fetch: (request) => connector ? connector.fetch(request) : new Response(null, { status: 503 }) },
    });
    connector = await createConnectorRuntime({
      dataDir,
      publicOrigin: server.url.slice(0, -1),
      actionPolicy: { blockedActions: ["*"], blockedProxies: ["*"] },
    });
    process.stdout.write(JSON.stringify({ type: "ready", version: 1, url: server.url }) + "\n");
    process.stdin.resume();
    process.stdin.once("end", () => { void shutdown(); });
    process.once("SIGTERM", () => { void shutdown(); });
  } catch {
    await shutdown();
    process.stderr.write("OpenConnector console host failed\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  void main();
}
