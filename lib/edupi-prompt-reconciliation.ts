import { createHash } from "node:crypto";
import { getSessionEntries } from "./session-reader";
import type { EduPiPromptOutboxEntry } from "./edupi-prompt-outbox";

type Row = { type?: unknown; id?: unknown; parentId?: unknown; customType?: unknown; data?: unknown;
  message?: { role?: unknown; content?: unknown } };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sameText(content: unknown, text: string): boolean {
  if (typeof content === "string") return content === text;
  if (!Array.isArray(content) || content.length !== 1) return false;
  const block = record(content[0]);
  return block?.type === "text" && block.text === text;
}

/** Read-only proof from a Pi custom dispatch marker to its first user entry. */
export function inspectEduPiPromptSession(entry: EduPiPromptOutboxEntry, filePath: string):
  "confirmed" | "marker_only" | "mismatch" | "unknown" {
  if (entry.command.images?.length) return "unknown";
  const commandHash = `sha256:${createHash("sha256").update(JSON.stringify(entry.command)).digest("hex")}`;
  let rows: Row[];
  try { rows = getSessionEntries(filePath) as Row[]; } catch { return "unknown"; }
  if (rows.length > 100_000) return "unknown";
  const markers = rows.filter(row => row.type === "custom" && row.customType === "edupi_prompt_dispatch_v1"
    && record(row.data)?.clientRequestId === entry.clientRequestId && record(row.data)?.commandHash === commandHash);
  if (markers.length !== 1 || typeof markers[0].id !== "string") return "unknown";
  const markerId = markers[0].id;
  const byId = new Map(rows.filter(row => typeof row.id === "string").map(row => [row.id as string, row]));
  const candidates = rows.filter(row => {
    if (row.type !== "message" || row.message?.role !== "user") return false;
    let parent = typeof row.parentId === "string" ? row.parentId : null;
    const seen = new Set<string>();
    while (parent && !seen.has(parent) && seen.size <= rows.length) {
      if (parent === markerId) return true;
      seen.add(parent);
      const ancestor = byId.get(parent);
      if (ancestor?.type === "message" && ancestor.message?.role === "user") return false;
      parent = typeof ancestor?.parentId === "string" ? ancestor.parentId : null;
    }
    return false;
  });
  if (candidates.length === 0) return "marker_only";
  if (candidates.length !== 1 || !sameText(candidates[0].message?.content, entry.command.message)) return "mismatch";
  return "confirmed";
}
