"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require("node:http");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require("node:net");

const MAX_BODY_BYTES = 16_384;
const STATIC_PATHS = new Set([
  "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/offline.html",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
]);
const FORWARDED_HEADERS = [
  "accept", "accept-encoding", "content-type", "content-length", "cookie",
  "if-none-match", "if-modified-since", "user-agent", "rsc",
  "next-router-state-tree", "next-router-prefetch", "next-url", "x-edupi-mobile-token",
];
const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);

function allowedMobilePath(rawUrl, method) {
  if (typeof rawUrl !== "string" || !rawUrl.startsWith("/") || rawUrl.startsWith("//")) return false;
  const pathname = rawUrl.split("?", 1)[0];
  if (/[\\%#\u0000-\u001f]/u.test(pathname) || pathname.split("/").some((part) => part === "." || part === "..")) return false;
  if (method === "GET" || method === "HEAD") {
    if (pathname === "/mobile" || pathname === "/mobile/" || STATIC_PATHS.has(pathname)) return true;
    if (/^\/_next\/static\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u.test(pathname)) return true;
  }
  if (method === "GET") {
    if (pathname === "/api/mobile/summary" || pathname === "/api/mobile/sessions") return true;
    if (/^\/api\/mobile\/sessions\/[A-Za-z0-9_-]{1,128}$/u.test(pathname)) return true;
  }
  if (method === "POST") {
    if (pathname === "/api/mobile/pair" || pathname === "/api/mobile/logout") return true;
    if (/^\/api\/mobile\/sessions\/[A-Za-z0-9_-]{1,128}\/messages$/u.test(pathname)) return true;
  }
  return false;
}

function reject(response, status) {
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
  response.end(status === 413 ? "Request too large" : "Mobile route unavailable");
}

function createMobileGateway({ upstreamPort }) {
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65_535) throw new Error("Invalid desktop server port");
  const upstreamOrigin = `http://127.0.0.1:${upstreamPort}`;
  const server = http.createServer((request, response) => {
    if (!allowedMobilePath(request.url, request.method)) return reject(response, 403);
    const localAddress = request.socket.localAddress;
    const localPort = request.socket.localPort;
    if (!localAddress || !localPort || !isIP(localAddress)) return reject(response, 403);
    const listenerOrigin = `http://${isIP(localAddress) === 6 ? `[${localAddress}]` : localAddress}:${localPort}`;
    const origin = request.headers.origin;
    if ((origin && origin !== listenerOrigin) || request.headers["sec-fetch-site"] === "cross-site") return reject(response, 403);
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES) return reject(response, 413);

    const headers = { host: `127.0.0.1:${upstreamPort}` };
    for (const name of FORWARDED_HEADERS) {
      if (request.headers[name] !== undefined) headers[name] = request.headers[name];
    }
    if (origin) headers.origin = upstreamOrigin;
    if (request.headers["sec-fetch-site"]) headers["sec-fetch-site"] = "same-origin";

    const upstream = http.request({ hostname: "127.0.0.1", port: upstreamPort, path: request.url, method: request.method, headers }, (result) => {
      if (response.headersSent) return result.resume();
      const responseHeaders = Object.fromEntries(Object.entries(result.headers).filter(([name]) => !HOP_BY_HOP_HEADERS.has(name)));
      responseHeaders["x-edupi-mobile-gateway"] = "1";
      response.writeHead(result.statusCode ?? 502, responseHeaders);
      result.pipe(response);
    });
    upstream.setTimeout(30_000, () => upstream.destroy(new Error("Desktop server timed out")));
    upstream.on("error", () => { if (!response.headersSent) reject(response, 502); else response.destroy(); });
    response.on("close", () => upstream.destroy());

    let receivedBytes = 0;
    request.on("data", (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        upstream.destroy();
        if (!response.headersSent) reject(response, 413);
      } else if (!upstream.destroyed) {
        upstream.write(chunk);
      }
    });
    request.on("end", () => { if (!upstream.destroyed) upstream.end(); });
    request.on("error", () => upstream.destroy());
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  return server;
}

module.exports = { allowedMobilePath, createMobileGateway };
