import type { AgentMessage, UserMessage } from "./types";

export interface MessageHistory {
  messages: AgentMessage[];
  entryIds: string[];
  messageIds: string[];
}

export type MessageHistoryAction =
  | { type: "replace"; messages: AgentMessage[]; entryIds: string[] }
  | { type: "optimistic"; message: UserMessage; requestId: string }
  | { type: "remove_optimistic"; requestId: string }
  | { type: "completed"; message: AgentMessage; entryId?: string; messageId?: string; requestId?: string };

export function emptyMessageHistory(): MessageHistory {
  return { messages: [], entryIds: [], messageIds: [] };
}

const optimisticId = (requestId: string) => `optimistic:${requestId}`;

/** Reconcile one delivery by its persisted entry or transport identity, never its text. */
export function messageHistoryReducer(history: MessageHistory, action: MessageHistoryAction): MessageHistory {
  if (action.type === "replace") {
    const entryIds = action.messages.map((_, index) => action.entryIds[index] ?? "");
    return { messages: action.messages, entryIds, messageIds: [...entryIds] };
  }
  if (action.type === "optimistic") {
    return {
      messages: [...history.messages, action.message],
      entryIds: [...history.entryIds, ""],
      messageIds: [...history.messageIds, optimisticId(action.requestId)],
    };
  }
  if (action.type === "remove_optimistic") {
    const index = history.messageIds.indexOf(optimisticId(action.requestId));
    if (index === -1) return history;
    return {
      messages: history.messages.filter((_, position) => position !== index),
      entryIds: history.entryIds.filter((_, position) => position !== index),
      messageIds: history.messageIds.filter((_, position) => position !== index),
    };
  }

  // Pi 1 emits system loadout declarations before a user prompt. The session
  // reader also omits these context-only messages from the displayed history.
  if ((action.message as { role: string }).role === "system") return history;
  const messageId = action.entryId || action.messageId || "";
  if (messageId && history.messageIds.includes(messageId)) return history;
  const index = action.message.role === "user" && action.requestId
    ? history.messageIds.indexOf(optimisticId(action.requestId))
    : -1;
  if (index !== -1) {
    const messages = [...history.messages];
    const entryIds = [...history.entryIds];
    const messageIds = [...history.messageIds];
    messages[index] = action.message;
    entryIds[index] = action.entryId ?? "";
    messageIds[index] = messageId;
    return { messages, entryIds, messageIds };
  }
  return {
    messages: [...history.messages, action.message],
    entryIds: [...history.entryIds, action.entryId ?? ""],
    messageIds: [...history.messageIds, messageId],
  };
}
