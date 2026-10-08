import { APP_PREF_KEYS, getPref, trySetPrefJson } from "./app-prefs";
import { clearAmbientCaptureNative, readAmbientCaptureOutboxNative, rememberAmbientCaptureNative } from "./desktop-native";

type Entry = { sessionId: string; messageId: string; occurredAt: string };
type Store = { version: 1; entries: Entry[] };
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u;
const MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,127}$/u;
const MAX_ENTRIES = 100;
type NativeOutbox = { readAmbientCaptureOutboxNative: typeof readAmbientCaptureOutboxNative;
  rememberAmbientCaptureNative: typeof rememberAmbientCaptureNative;
  clearAmbientCaptureNative: typeof clearAmbientCaptureNative };
const nativeOutbox: NativeOutbox = { readAmbientCaptureOutboxNative, rememberAmbientCaptureNative, clearAmbientCaptureNative };

function validTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function validEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 3 && ["sessionId", "messageId", "occurredAt"].every(key => Object.hasOwn(item, key))
    && SESSION_ID.test(String(item.sessionId || "")) && MESSAGE_ID.test(String(item.messageId || ""))
    && validTime(item.occurredAt);
}

function readStore(): Store {
  const raw = getPref(APP_PREF_KEYS.edupiAmbientUnconfirmed);
  if (raw === null) return { version: 1, entries: [] };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("ambient_client_pending_invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ambient_client_pending_invalid");
  const store = value as Record<string, unknown>;
  if (Object.keys(store).length !== 2 || store.version !== 1 || !Array.isArray(store.entries)
    || store.entries.length > MAX_ENTRIES || !store.entries.every(validEntry)
    || new Set((store.entries as Entry[]).map(item => `${item.sessionId}\0${item.messageId}`)).size !== store.entries.length) {
    throw new Error("ambient_client_pending_invalid");
  }
  return store as Store;
}

export function readEduPiAmbientUnconfirmed(sessionId: string): Entry[] {
  if (!SESSION_ID.test(sessionId)) throw new Error("ambient_client_pending_invalid");
  return readStore().entries.filter(item => item.sessionId === sessionId);
}

export function rememberEduPiAmbientUnconfirmed(input: Entry): boolean {
  if (!validEntry(input)) return false;
  let current: Store;
  try { current = readStore(); } catch { return false; }
  const prior = current.entries.find(item => item.sessionId === input.sessionId && item.messageId === input.messageId);
  if (prior) return prior.occurredAt === input.occurredAt;
  if (current.entries.length >= MAX_ENTRIES) return false;
  return trySetPrefJson(APP_PREF_KEYS.edupiAmbientUnconfirmed, { version: 1, entries: [...current.entries, input] });
}

export function clearEduPiAmbientUnconfirmed(sessionId: string, messageId: string): boolean {
  if (!SESSION_ID.test(sessionId) || !MESSAGE_ID.test(messageId)) return false;
  let current: Store;
  try { current = readStore(); } catch { return false; }
  const entries = current.entries.filter(item => item.sessionId !== sessionId || item.messageId !== messageId);
  return entries.length === current.entries.length || trySetPrefJson(APP_PREF_KEYS.edupiAmbientUnconfirmed, { version: 1, entries });
}

export async function rememberEduPiAmbientUnconfirmedDurable(input: Entry, native: NativeOutbox = nativeOutbox): Promise<boolean> {
  if (!validEntry(input)) return false;
  try { await native.rememberAmbientCaptureNative(input); }
  catch { return false; }
  rememberEduPiAmbientUnconfirmed(input);
  return true;
}

export async function readEduPiAmbientUnconfirmedDurable(sessionId: string, native: NativeOutbox = nativeOutbox): Promise<Entry[]> {
  if (!SESSION_ID.test(sessionId)) throw new Error("ambient_client_pending_invalid");
  let local: Entry[] = [];
  let localInvalid = false;
  try { local = readEduPiAmbientUnconfirmed(sessionId); }
  catch { localInvalid = true; }
  let nativeEntries: Entry[];
  try { nativeEntries = await native.readAmbientCaptureOutboxNative(); }
  catch {
    if (localInvalid) throw new Error("ambient_client_pending_invalid");
    return local;
  }
  if (!Array.isArray(nativeEntries) || nativeEntries.length > MAX_ENTRIES || !nativeEntries.every(validEntry)) {
    throw new Error("ambient_client_pending_invalid");
  }
  if (localInvalid && !nativeEntries.some(item => item.sessionId === sessionId)) throw new Error("ambient_client_pending_invalid");
  const combined = new Map(local.map(item => [`${item.sessionId}\0${item.messageId}`, item]));
  for (const item of nativeEntries.filter(item => item.sessionId === sessionId)) {
    const key = `${item.sessionId}\0${item.messageId}`;
    const prior = combined.get(key);
    if (prior && prior.occurredAt !== item.occurredAt) throw new Error("ambient_client_pending_invalid");
    combined.set(key, item);
  }
  return [...combined.values()];
}

export async function clearEduPiAmbientUnconfirmedDurable(sessionId: string, messageId: string,
  native: NativeOutbox = nativeOutbox): Promise<boolean> {
  clearEduPiAmbientUnconfirmed(sessionId, messageId);
  try { await native.clearAmbientCaptureNative(sessionId, messageId); return true; }
  catch { return false; }
}
