import { spawn, type ChildProcessByStdio } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

type ConsoleChild = ChildProcessByStdio<Writable, Readable, null>;

type ConsoleState = {
  child: ConsoleChild | null;
  url: string | null;
  pending: Promise<string> | null;
};

declare global {
  var __edupiOpenConnectorConsole: ConsoleState | undefined;
}

const state = globalThis.__edupiOpenConnectorConsole ??= { child: null, url: null, pending: null };

function validConsoleUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && /^\d+$/u.test(url.port)
      && Number(url.port) > 0 && Number(url.port) <= 65_535 && url.pathname === "/"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function startConsole(root: string, nodeExecutable: string, sourceLayout: boolean): Promise<string> {
  if (!path.isAbsolute(root) || !path.isAbsolute(nodeExecutable)) throw new Error("console_unavailable");
  const hostPath = path.join(root, sourceLayout ? "open-connector-console-host.mjs" : "console-host.mjs");
  const assetRoot = path.join(root, sourceLayout ? "open-connector-console-assets" : "web");
  try {
    if (!(await lstat(root)).isDirectory() || !(await lstat(hostPath)).isFile()
      || !(await lstat(path.join(assetRoot, "index.html"))).isFile()) throw new Error("invalid resources");
  } catch {
    throw new Error("console_unavailable");
  }
  const child = spawn(nodeExecutable, [hostPath], {
    cwd: root,
    env: { NODE_ENV: "production", PATH: process.env.PATH || "", ...(sourceLayout ? { EDUPI_OPENCONNECTOR_CONSOLE_ASSETS: assetRoot } : {}) },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => fail(), 15_000);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("error", fail);
      child.off("exit", fail);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill("SIGKILL");
      reject(new Error("console_unavailable"));
    };
    const onData = (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > 2_048) { fail(); return; }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      let ready: { type?: unknown; version?: unknown; url?: unknown };
      try { ready = JSON.parse(buffer.slice(0, newline)); } catch { fail(); return; }
      if (ready.type !== "ready" || ready.version !== 1 || !validConsoleUrl(ready.url)) { fail(); return; }
      settled = true;
      cleanup();
      resolve(ready.url);
    };
    child.stdout.on("data", onData);
    child.once("error", fail);
    child.once("exit", fail);
  });
  state.child = child;
  state.url = url;
  child.once("exit", () => {
    if (state.child === child) { state.child = null; state.url = null; }
  });
  return url;
}

export async function ensureOpenConnectorConsole(options: { root?: string; nodeExecutable?: string } = {}): Promise<string> {
  if (state.child && state.child.exitCode === null && state.child.signalCode === null && state.url) return state.url;
  if (state.pending) return state.pending;
  const configuredRoot = options.root || process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  const sourceLayout = !configuredRoot && process.env.NODE_ENV === "development";
  const root = configuredRoot || (sourceLayout ? path.resolve(process.cwd(), "desktop") : "");
  const nodeExecutable = options.nodeExecutable || process.execPath;
  state.pending = startConsole(root, nodeExecutable, sourceLayout).finally(() => { state.pending = null; });
  return state.pending;
}

export async function closeOpenConnectorConsole(): Promise<void> {
  await state.pending?.catch(() => {});
  const child = state.child;
  state.child = null;
  state.url = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  await new Promise<void>((done) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); done(); }, 5_000);
    child.once("exit", () => { clearTimeout(timer); done(); });
  });
}
