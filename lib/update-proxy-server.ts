import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { getLatestAppRelease, type AppUpdateProject } from "./app-updates";
import type { AppComponentReleaseInfo } from "./app-update-types";
import { parseUpdateProxyInput } from "./update-proxy-url";

const CONFIG_FILE = "updater-proxy.json";

function configurationError(): Error {
  return new Error("更新代理设置不可用");
}

export async function readSavedUpdateProxy(stateDir = process.env.PI_DESKTOP_STATE_DIR): Promise<string | null> {
  if (!stateDir) return null;
  if (!isAbsolute(stateDir)) throw configurationError();
  const file = join(stateDir, CONFIG_FILE);
  let stats;
  try {
    stats = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw configurationError();
  }
  if (!stats.isFile() || stats.isSymbolicLink()) throw configurationError();
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw configurationError();
    const configured = (value as Record<string, unknown>).updateProxy;
    if (configured === undefined) throw configurationError();
    if (typeof configured !== "string") throw configurationError();
    const proxy = parseUpdateProxyInput(configured);
    if (!proxy) throw configurationError();
    return proxy;
  } catch {
    throw configurationError();
  }
}

export async function getLatestAppReleaseWithConfiguredProxy(project: AppUpdateProject, stateDir?: string): Promise<AppComponentReleaseInfo> {
  const proxy = await readSavedUpdateProxy(stateDir);
  if (!proxy) return getLatestAppRelease(project);
  const agent = new ProxyAgent(proxy);
  try {
    return await getLatestAppRelease(project, {
      // Undici's Response implements the four Fetch response members consumed by
      // getLatestAppRelease; its TypeScript Response type is separate from DOM's.
      fetcher: (input, init) => undiciFetch(input, {
        method: "GET",
        headers: init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined,
        signal: init?.signal ?? undefined,
        dispatcher: agent,
      }) as unknown as Promise<Response>,
    });
  } catch (error) {
    if (error instanceof Error && /^GitHub request failed with HTTP \d+\.$/u.test(error.message)) throw error;
    throw new Error("更新代理连接失败");
  } finally {
    await agent.close();
  }
}
