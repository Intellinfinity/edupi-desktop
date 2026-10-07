import type { AgentMessage } from "./types";

const CALENDAR_TOOLS = new Set(["calendar_add", "calendar_import"]);
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Only tool receipts with verified Core readback count as saved calendar facts. */
export function calendarResultSummary(messages: readonly AgentMessage[]): { text: string; uncertain: boolean } | null {
  const names = new Map<string, string>();
  const states = new Map<string, string>();
  let attempted = false, uncertain = false;
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) if (block.type === "toolCall") names.set(block.toolCallId, block.toolName);
      continue;
    }
    if (message.role !== "toolResult" || !CALENDAR_TOOLS.has(message.toolName || names.get(message.toolCallId) || "")) continue;
    attempted = true;
    const details = record(message.details), receipt = record(details?.receipt);
    const events = Array.isArray(details?.events) ? details.events.map(record) : [];
    if (message.isError || details?.ok !== true || details.verified !== true || details.external_send !== false
      || !["accepted", "modified", "held"].includes(String(receipt?.status)) || !events.length
      || events.some(event => !event || typeof event.id !== "string" || !event.id || !["confirmed", "pending_review", "held"].includes(String(event.state)))) {
      uncertain = true;
      continue;
    }
    events.forEach(event => states.set(String(event!.id), String(event!.state)));
  }
  if (!attempted) return null;
  const confirmed = [...states.values()].filter(state => state === "confirmed").length;
  const pending = states.size - confirmed;
  return { text: [confirmed ? `${confirmed} 条日程已确认` : "", pending ? `${pending} 条日程待确认` : "", uncertain ? "日程写入未确认" : ""].filter(Boolean).join(" · "), uncertain };
}
