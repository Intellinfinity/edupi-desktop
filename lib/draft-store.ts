import { APP_PREF_KEYS, getPrefJson, trySetPrefJson } from "@/lib/app-prefs";
import { parseTeacherMessage, type EduPiComposerContext } from "@/lib/edupi-composer-context";
import type { ImageContent, UserMessage } from "@/lib/types";

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

export interface FailedDraftMessage {
  value: string;
  images: ChatDraftImage[];
  context?: EduPiComposerContext;
  sourceLabel?: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  context?: EduPiComposerContext;
  offeredContext?: EduPiComposerContext;
  pendingTeacherText?: string;
  pendingQueueMessages?: string[];
  pendingQueueRecoveryId?: string;
  pendingQueuePrevious?: string[];
  pendingQueueReadyToAck?: boolean;
  pendingQueueUncertain?: boolean;
  pendingFailedMessages?: FailedDraftMessage[];
}

const drafts = new Map<string, ChatDraft>();
const MAX_PERSISTED_IMAGE_BYTES = 400_000; // approx decoded size via base64 length
const MAX_PERSISTED_DRAFTS = 40;
const MAX_PERSISTED_DRAFT_CHARS = 1_500_000; // reserve room for other local preferences
const persistListeners = new Map<string, Set<(saved: boolean) => void>>();
const dirtyKeys = new Set<string>();

let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
    ...(draft.context ? { context: { ...draft.context } } : {}),
    ...(draft.offeredContext ? { offeredContext: { ...draft.offeredContext } } : {}),
    ...(draft.pendingTeacherText ? { pendingTeacherText: draft.pendingTeacherText } : {}),
    ...(draft.pendingQueueMessages?.length ? { pendingQueueMessages: [...draft.pendingQueueMessages] } : {}),
    ...(draft.pendingQueueRecoveryId ? { pendingQueueRecoveryId: draft.pendingQueueRecoveryId } : {}),
    ...(draft.pendingQueuePrevious ? { pendingQueuePrevious: [...draft.pendingQueuePrevious] } : {}),
    ...(draft.pendingQueueReadyToAck ? { pendingQueueReadyToAck: true } : {}),
    ...(draft.pendingQueueUncertain ? { pendingQueueUncertain: true } : {}),
    ...(draft.pendingFailedMessages?.length ? { pendingFailedMessages: draft.pendingFailedMessages.map(item => ({
      value: item.value,
      images: item.images.map(image => ({ ...image })),
      ...(item.context ? { context: { ...item.context } } : {}),
      ...(item.sourceLabel ? { sourceLabel: item.sourceLabel } : {}),
    })) } : {}),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0 && !draft.context && !draft.offeredContext && !draft.pendingTeacherText && !draft.pendingQueueMessages?.length && !draft.pendingQueueRecoveryId && !draft.pendingFailedMessages?.length;
}

function validContext(value: unknown): value is EduPiComposerContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<EduPiComposerContext>;
  return typeof context.title === "string" && context.title.length > 0 && context.title.length <= 60
    && typeof context.reference === "string" && context.reference.length > 0 && context.reference.length <= 500_000;
}

function imagePersistable(image: ChatDraftImage): boolean {
  // base64 length ≈ 4/3 of bytes; keep a conservative cap so localStorage stays usable.
  return image.data.length * 0.75 <= MAX_PERSISTED_IMAGE_BYTES;
}

function persistableDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.filter(imagePersistable),
    ...(draft.context ? { context: draft.context } : {}),
    ...(draft.offeredContext ? { offeredContext: draft.offeredContext } : {}),
    ...(draft.pendingTeacherText ? { pendingTeacherText: draft.pendingTeacherText } : {}),
    ...(draft.pendingQueueMessages?.length ? { pendingQueueMessages: draft.pendingQueueMessages } : {}),
    ...(draft.pendingQueueRecoveryId ? { pendingQueueRecoveryId: draft.pendingQueueRecoveryId } : {}),
    ...(draft.pendingQueuePrevious ? { pendingQueuePrevious: draft.pendingQueuePrevious } : {}),
    ...(draft.pendingQueueReadyToAck ? { pendingQueueReadyToAck: true } : {}),
    ...(draft.pendingQueueUncertain ? { pendingQueueUncertain: true } : {}),
    ...(draft.pendingFailedMessages?.length ? { pendingFailedMessages: draft.pendingFailedMessages } : {}),
  };
}

function persistableWithoutLoss(draft: ChatDraft): boolean {
  return draft.images.every(imagePersistable)
    && (!draft.context || validContext(draft.context))
    && (!draft.offeredContext || validContext(draft.offeredContext))
    && (!draft.pendingTeacherText || draft.pendingTeacherText.length <= 500_000)
    && (!draft.pendingQueueMessages || (draft.pendingQueueMessages.length <= 50
      && draft.pendingQueueMessages.every(item => item.length > 0 && item.length <= 500_000)))
    && (!draft.pendingQueueRecoveryId || /^[0-9a-f-]{36}$/iu.test(draft.pendingQueueRecoveryId))
    && (!draft.pendingQueuePrevious || (draft.pendingQueuePrevious.length <= 50
      && draft.pendingQueuePrevious.every(item => item.length > 0 && item.length <= 500_000)))
    && (!draft.pendingQueueReadyToAck || Boolean(draft.pendingQueueRecoveryId))
    && (!draft.pendingQueueUncertain || Boolean(draft.pendingQueueMessages?.length))
    && (!draft.pendingFailedMessages || (draft.pendingFailedMessages.length <= 20
      && draft.pendingFailedMessages.every(item => item.value.length <= 500_000
        && item.images.every(imagePersistable) && (!item.context || validContext(item.context))
        && (!item.sourceLabel || item.sourceLabel.length <= 60))));
}

function hydrateFromStorage(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const stored = getPrefJson<Record<string, ChatDraft>>(APP_PREF_KEYS.chatDrafts);
  if (!stored || typeof stored !== "object") return;
  for (const [key, draft] of Object.entries(stored)) {
    if (!draft || typeof draft.value !== "string" || !Array.isArray(draft.images)) continue;
    const normalized: ChatDraft = {
      value: draft.value,
      images: draft.images
        .filter((image) => image && typeof image.data === "string" && typeof image.mimeType === "string")
        .filter(imagePersistable)
        .map((image) => ({ data: image.data, mimeType: image.mimeType })),
      ...(validContext(draft.context) ? { context: { ...draft.context } } : {}),
      ...(validContext(draft.offeredContext) ? { offeredContext: { ...draft.offeredContext } } : {}),
      ...(typeof draft.pendingTeacherText === "string" && draft.pendingTeacherText.length > 0 && draft.pendingTeacherText.length <= 500_000
        ? { pendingTeacherText: draft.pendingTeacherText } : {}),
      ...(Array.isArray(draft.pendingQueueMessages) ? {
        pendingQueueMessages: draft.pendingQueueMessages.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 500_000).slice(0, 50),
      } : {}),
      ...(typeof draft.pendingQueueRecoveryId === "string" && /^[0-9a-f-]{36}$/iu.test(draft.pendingQueueRecoveryId)
        ? { pendingQueueRecoveryId: draft.pendingQueueRecoveryId } : {}),
      ...(Array.isArray(draft.pendingQueuePrevious) ? {
        pendingQueuePrevious: draft.pendingQueuePrevious.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 500_000).slice(0, 50),
      } : {}),
      ...(draft.pendingQueueReadyToAck === true ? { pendingQueueReadyToAck: true } : {}),
      ...(draft.pendingQueueUncertain === true ? { pendingQueueUncertain: true } : {}),
      ...(Array.isArray(draft.pendingFailedMessages) ? {
        pendingFailedMessages: draft.pendingFailedMessages.filter((item) => item && typeof item.value === "string" && Array.isArray(item.images))
          .slice(0, 20).map(item => ({
          value: item.value,
          images: item.images.filter(image => image && typeof image.data === "string" && typeof image.mimeType === "string" && imagePersistable(image)),
          ...(validContext(item.context) ? { context: item.context } : {}),
          ...(typeof item.sourceLabel === "string" && item.sourceLabel.length <= 60 ? { sourceLabel: item.sourceLabel } : {}),
          })),
      } : {}),
    };
    if (!isEmptyDraft(normalized)) drafts.set(key, normalized);
  }
}

function persistDirtyDrafts(): Map<string, boolean> {
  const results = new Map<string, boolean>();
  const changed = [...dirtyKeys];
  dirtyKeys.clear();
  const eligible = new Set([...drafts.keys()].slice(-MAX_PERSISTED_DRAFTS));
  const previous = getPrefJson<Record<string, ChatDraft>>(APP_PREF_KEYS.chatDrafts) ?? {};
  let retained = Object.fromEntries(Object.entries(previous)
    .filter(([key]) => eligible.has(key) && drafts.has(key)));
  const saved = trySetPrefJson(APP_PREF_KEYS.chatDrafts, retained);
  if (saved) {
    for (const key of changed) {
      const draft = drafts.get(key);
      if (!draft || !eligible.has(key)) continue;
      const candidate = { ...retained };
      delete candidate[key];
      candidate[key] = persistableDraft(draft);
      if (JSON.stringify(candidate).length > MAX_PERSISTED_DRAFT_CHARS) continue;
      if (trySetPrefJson(APP_PREF_KEYS.chatDrafts, candidate)) retained = candidate;
    }
  }
  for (const key of changed) {
    const draft = drafts.get(key);
    const keySaved = saved && (!draft || (eligible.has(key) && persistableWithoutLoss(draft)
      && JSON.stringify(retained[key]) === JSON.stringify(persistableDraft(draft))));
    results.set(key, keySaved);
    for (const listener of persistListeners.get(key) ?? []) listener(keySaved);
  }
  return results;
}

function schedulePersist(): void {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistDirtyDrafts();
  }, 250);
}

export function flushDraftNow(key: string): boolean {
  if (typeof window === "undefined") return false;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  return persistDirtyDrafts().get(key) ?? false;
}

export function subscribeDraftPersistence(key: string, listener: (saved: boolean) => void): () => void {
  const listeners = persistListeners.get(key) ?? new Set<(saved: boolean) => void>();
  listeners.add(listener);
  persistListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) persistListeners.delete(key);
  };
}

export function getDraft(key: string): ChatDraft | null {
  hydrateFromStorage();
  const draft = drafts.get(key);
  return draft ? cloneDraft(draft) : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  hydrateFromStorage();
  if (isEmptyDraft(draft)) {
    drafts.delete(key);
    dirtyKeys.add(key);
    schedulePersist();
    return;
  }
  // Map.set() does not refresh insertion order for an existing key. Delete it
  // first so the persistence cap below keeps the most recently edited drafts.
  drafts.delete(key);
  drafts.set(key, cloneDraft(draft));
  dirtyKeys.add(key);
  schedulePersist();
}

export function clearDraft(key: string): void {
  hydrateFromStorage();
  drafts.delete(key);
  dirtyKeys.add(key);
  schedulePersist();
}

export function resetNewSessionDraft(key: string): void {
  const recovery = getDraft(key)?.pendingFailedMessages;
  if (recovery?.length) setDraft(key, { value: "", images: [], pendingFailedMessages: recovery });
  else clearDraft(key);
}

export function completeStagedQueueRecovery(key: string, previous: string[], messages: string[], recoveryId: string): boolean {
  const draft = getDraft(key);
  if (!draft || draft.pendingQueueRecoveryId !== recoveryId) return false;
  setDraft(key, {
    ...draft,
    pendingQueueMessages: [...previous, ...messages],
    pendingQueueRecoveryId: recoveryId,
    pendingQueuePrevious: previous,
    pendingQueueReadyToAck: true,
  });
  if (flushDraftNow(key)) return true;
  setDraft(key, draft);
  flushDraftNow(key);
  return false;
}

export function acknowledgeLocalQueueRecovery(key: string, recoveryId: string): boolean {
  const draft = getDraft(key);
  if (!draft || draft.pendingQueueRecoveryId !== recoveryId || !draft.pendingQueueReadyToAck) return false;
  const completed = { ...draft };
  delete completed.pendingQueueRecoveryId;
  delete completed.pendingQueuePrevious;
  delete completed.pendingQueueReadyToAck;
  setDraft(key, completed);
  if (flushDraftNow(key)) return true;
  setDraft(key, draft);
  flushDraftNow(key);
  return false;
}

export function markQueueRecoveryUncertain(key: string, recoveryId: string): boolean {
  const draft = getDraft(key);
  if (!draft || draft.pendingQueueRecoveryId !== recoveryId || !draft.pendingQueueMessages?.length) return false;
  const next = { ...draft, pendingQueueUncertain: true };
  delete next.pendingQueueRecoveryId;
  delete next.pendingQueueReadyToAck;
  setDraft(key, next);
  if (flushDraftNow(key)) return true;
  setDraft(key, draft);
  flushDraftNow(key);
  return false;
}

export function restoreFailedMessageDraft(key: string, message: UserMessage, options: { forcePending?: boolean; sourceLabel?: string } = {}): boolean {
  const rawText = typeof message.content === "string" ? message.content
    : message.content.filter((item): item is { type: "text"; text: string } => item.type === "text").map(item => item.text).join("\n");
  const parsed = parseTeacherMessage(rawText);
  const recovered: FailedDraftMessage = {
    value: parsed?.teacherText ?? rawText,
    images: typeof message.content === "string" ? [] : message.content
      .filter((item): item is ImageContent => item.type === "image" && item.source.type === "base64" && typeof item.source.data === "string")
      .map(item => ({ data: item.source.data!, mimeType: item.source.media_type ?? "image/png" })),
    ...(parsed ? { context: parsed.context } : {}),
    ...(options.sourceLabel ? { sourceLabel: options.sourceLabel } : {}),
  };
  const existing = getDraft(key) ?? { value: "", images: [] };
  const occupied = Boolean(options.forcePending || existing.value.trim() || existing.images.length || existing.context || existing.offeredContext || existing.pendingTeacherText);
  setDraft(key, occupied
    ? { ...existing, pendingFailedMessages: [...(existing.pendingFailedMessages ?? []), recovered] }
    : { ...existing, value: recovered.value, images: recovered.images, ...(recovered.context ? { context: recovered.context } : {}) });
  return flushDraftNow(key);
}
