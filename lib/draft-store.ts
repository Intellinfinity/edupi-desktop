import { APP_PREF_KEYS, getPrefJson, setPrefJson } from "@/lib/app-prefs";
import type { EduPiComposerContext } from "@/lib/edupi-composer-context";

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  context?: EduPiComposerContext;
}

const drafts = new Map<string, ChatDraft>();
const MAX_PERSISTED_IMAGE_BYTES = 400_000; // approx decoded size via base64 length
const MAX_PERSISTED_DRAFTS = 40;

let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
    ...(draft.context ? { context: { ...draft.context } } : {}),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0 && !draft.context;
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
    };
    if (!isEmptyDraft(normalized)) drafts.set(key, normalized);
  }
}

function schedulePersist(): void {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const entries = [...drafts.entries()]
      .slice(-MAX_PERSISTED_DRAFTS)
      .map(([key, draft]) => [
        key,
        {
          value: draft.value,
          images: draft.images.filter(imagePersistable),
          ...(draft.context ? { context: draft.context } : {}),
        },
      ] as const);
    setPrefJson(APP_PREF_KEYS.chatDrafts, Object.fromEntries(entries));
  }, 250);
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
    schedulePersist();
    return;
  }
  // Map.set() does not refresh insertion order for an existing key. Delete it
  // first so the persistence cap below keeps the most recently edited drafts.
  drafts.delete(key);
  drafts.set(key, cloneDraft(draft));
  schedulePersist();
}

export function clearDraft(key: string): void {
  hydrateFromStorage();
  drafts.delete(key);
  schedulePersist();
}
