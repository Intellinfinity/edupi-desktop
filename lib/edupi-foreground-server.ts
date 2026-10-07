import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_FOREGROUND_GRACE_DAYS, shanghaiDate, type ForegroundPolicy } from "./edupi-foreground";

const MAX_FILE_BYTES = 2_100_000;

function sameFile(left: Stats, right: Stats): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

/** Read the same native preference file that Tauri writes. No HOME fallback or cache. */
export async function readServerForegroundPolicy(now = new Date()): Promise<ForegroundPolicy> {
  const today = shanghaiDate(now);
  if (!today) throw new Error("提醒日期无法读取");
  const fallback = { today, graceDays: DEFAULT_FOREGROUND_GRACE_DAYS, pinnedTaskIds: [] };
  const stateDir = process.env.PI_DESKTOP_STATE_DIR;
  if (!stateDir) return fallback;
  if (!path.isAbsolute(stateDir)) throw new Error("提醒显示配置路径无效");
  const file = path.join(stateDir, "foreground-prefs.json");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!handle) return fallback;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_FILE_BYTES) throw new Error("提醒显示配置无法读取");
    const buffer = Buffer.alloc(before.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(file);
    if (bytesRead !== before.size || !sameFile(before, after) || !sameFile(after, current)) throw new Error("提醒显示配置已变化");
    const raw = buffer.subarray(0, bytesRead);
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
    const value: unknown = JSON.parse(decoded);
    // serde rejects duplicate struct fields; JSON.parse alone keeps the last
    // value and could turn a damaged preference into a permissive threshold.
    const keys = new Set<string>();
    for (const token of decoded.matchAll(/"(?:\\.|[^"\\])*"/gu)) {
      let cursor = token.index + token[0].length;
      while (/[\t\r\n ]/.test(decoded[cursor] || "")) cursor += 1;
      if (decoded[cursor] !== ":") continue;
      const key: string = JSON.parse(token[0]);
      if (keys.has(key)) throw new Error("提醒显示配置无效");
      keys.add(key);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("提醒显示配置无效");
    const settings = value as Record<string, unknown>;
    const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 1000
      && ids.every(id => typeof id === "string" && id.length > 0 && [...id].length <= 256 && !/[\uD800-\uDFFF]/u.test(id));
    if (Object.keys(settings).some(key => !["graceDays", "pinnedTaskIds", "dismissedStaleTaskIds"].includes(key))
      || !Number.isInteger(settings.graceDays) || (settings.graceDays as number) < 0 || (settings.graceDays as number) > 365
      || !validIds(settings.pinnedTaskIds) || settings.dismissedStaleTaskIds !== undefined && !validIds(settings.dismissedStaleTaskIds)) {
      throw new Error("提醒显示配置无效");
    }
    return { today, graceDays: settings.graceDays as number, pinnedTaskIds: settings.pinnedTaskIds };
  } finally { await handle.close(); }
}
