import { stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { EDUPI_ROOT } from "./edupi-runtime";
import { listAllSessions, resolveSessionPath, buildSessionContext } from "./session-reader";
import { openSessionManagerForRead } from "./session-manager-access";

function isEduPiCwd(cwd: string): boolean {
  if (!isAbsolute(cwd)) return false;
  let candidate: string;
  try { candidate = realpathSync(cwd); } catch { return false; }
  const remainder = relative(EDUPI_ROOT, candidate);
  return remainder === "" || (!isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${sep}`));
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => Boolean(block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string"))
    .map((block) => block.text)
    .join("\n");
}

export type MobileMessage = { id: string; role: "user" | "assistant"; text: string; timestamp?: string };

export type MobileSession = {
  id: string;
  name?: string;
  modified: string;
  firstMessage: string;
  messageCount: number;
};

export async function listMobileSessions(): Promise<MobileSession[]> {
  const sessions = await listAllSessions();
  return sessions
    .filter((session) => isEduPiCwd(session.cwd))
    .map((session) => ({
      id: session.id,
      ...(session.name ? { name: session.name } : {}),
      modified: session.modified,
      firstMessage: session.firstMessage,
      messageCount: session.messageCount,
    }))
    .slice(0, 100);
}

export async function readMobileSession(sessionId: string): Promise<{ info: MobileSession; messages: MobileMessage[] } | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;
  const fileInfo = await stat(filePath).catch(() => null);
  if (!fileInfo?.isFile() || fileInfo.size > 20 * 1024 * 1024) return null;
  const manager = openSessionManagerForRead(sessionId, filePath);
  if (!manager || !isEduPiCwd(manager.getCwd())) return null;
  const entries = manager.getEntries() as never;
  const context = buildSessionContext(entries, manager.getLeafId(), { deferThinking: true, deferToolResultImages: true });
  const messages = context.messages.flatMap((message, index) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const text = textContent((message as { content?: unknown }).content).trim();
    if (!text) return [];
    const timestamp = (message as { timestamp?: number }).timestamp;
    return [{ id: context.entryIds[index], role: message.role, text: text.slice(0, 8_000), ...(typeof timestamp === "number" ? { timestamp: new Date(timestamp).toISOString() } : {}) }];
  }).slice(-100);
  const header = manager.getHeader();
  const info: MobileSession = {
    id: sessionId,
    ...(manager.getSessionName() ? { name: manager.getSessionName() } : {}),
    modified: header?.timestamp ?? new Date().toISOString(),
    firstMessage: messages.find((message) => message.role === "user")?.text.slice(0, 240) ?? "",
    messageCount: messages.length,
  };
  return { info, messages };
}
