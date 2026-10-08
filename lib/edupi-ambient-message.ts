import { fetchDesktopApi } from "./desktop-native";
import { isTauriDesktop } from "./desktop-updater";
import { clearEduPiAmbientUnconfirmedDurable, readEduPiAmbientUnconfirmedDurable,
  rememberEduPiAmbientUnconfirmedDurable } from "./edupi-ambient-client-pending";

export type EduPiAmbientPendingState = { status: "clear" | "outcome_unknown" | "applied" | "unavailable";
  pending: Array<{ messageId: string; occurredAt: string; unconfirmed?: boolean }>;
  recovered: Array<{ messageId: string; goalId: string; workCaseId: string }
    | { messageId: string; goalId: string; followUpId: string; executionId: string }> };

type CaptureIdentity = { sessionId: string; messageId: string; occurredAt: string };
const armed = new Map<string, string>();
const captureKey = (sessionId: string, messageId: string) => `${sessionId}\0${messageId}`;
const actionBody = (action: "arm" | "cancel" | "ack", input: CaptureIdentity) => JSON.stringify({ action, ...input });

async function postPlanAction(action: "arm" | "cancel" | "ack", input: CaptureIdentity): Promise<string> {
  const response = await fetchDesktopApi("/api/edupi/proactivity/messages", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: actionBody(action, input) });
  const body = await response.json() as unknown;
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)
    || (body as Record<string, unknown>).externalSend !== false) return "unavailable";
  return String((body as Record<string, unknown>).status);
}

export async function armEduPiAmbientMessage(input: CaptureIdentity): Promise<{ status: string }> {
  if (!isTauriDesktop()) return { status: "disabled" };
  const identity = { sessionId: input.sessionId, messageId: input.messageId, occurredAt: input.occurredAt };
  try {
    const existing = await readEduPiAmbientUnconfirmedDurable(identity.sessionId);
    if (existing.some(item => item.messageId === identity.messageId)) return { status: "outcome_unknown" };
    if (!await rememberEduPiAmbientUnconfirmedDurable(identity)) return { status: "unavailable" };
    const status = await postPlanAction("arm", identity);
    if (status === "disabled") {
      return { status: await clearEduPiAmbientUnconfirmedDurable(identity.sessionId, identity.messageId) ? "disabled" : "outcome_unknown" };
    }
    if (status !== "armed") return { status: "outcome_unknown" };
    armed.set(captureKey(identity.sessionId, identity.messageId), identity.occurredAt);
    return { status: "armed" };
  } catch { return { status: "unavailable" }; }
}

export async function cancelEduPiAmbientArm(input: CaptureIdentity): Promise<void> {
  const key = captureKey(input.sessionId, input.messageId);
  if (armed.get(key) !== input.occurredAt) return;
  armed.delete(key);
  if (await clearEduPiAmbientUnconfirmedDurable(input.sessionId, input.messageId)) {
    try { await postPlanAction("cancel", input); } catch { /* An unconfirmed cancellation remains visible server-side. */ }
  }
}

export async function readEduPiAmbientPending(sessionId: string, verify = false): Promise<EduPiAmbientPendingState> {
  const unavailable: EduPiAmbientPendingState = { status: "unavailable", pending: [], recovered: [] };
  if (!isTauriDesktop()) return { status: "clear", pending: [], recovered: [] };
  let local: Awaited<ReturnType<typeof readEduPiAmbientUnconfirmedDurable>>;
  try { local = await readEduPiAmbientUnconfirmedDurable(sessionId); } catch { return unavailable; }
  const localOnly = (): EduPiAmbientPendingState => local.length
    ? { status: "outcome_unknown", pending: local.map(item => ({ ...item, unconfirmed: true })), recovered: [] }
    : unavailable;
  try {
    const query = new URLSearchParams({ sessionId, ...(verify ? { verify: "1" } : {}) });
    const response = await fetchDesktopApi(`/api/edupi/proactivity/messages?${query}`, { method: "GET", cache: "no-store" });
    const body = await response.json() as unknown;
    if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) return localOnly();
    const item = body as Record<string, unknown>;
    if (!["clear", "outcome_unknown", "applied"].includes(String(item.status)) || item.externalSend !== false
      || !Array.isArray(item.pending) || item.pending.length > 4096 || !Array.isArray(item.recovered) || item.recovered.length > 20
      || item.settled !== undefined && (!Array.isArray(item.settled) || item.settled.length > 4096)) return localOnly();
    const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u.test(value);
    const pending = item.pending.every(value => value && typeof value === "object" && id((value as Record<string, unknown>).messageId)
      && typeof (value as Record<string, unknown>).occurredAt === "string"
      && Number.isFinite(Date.parse((value as Record<string, unknown>).occurredAt as string)));
    const recovered = item.recovered.every(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const row = value as Record<string, unknown>;
      const keys = Object.keys(row).sort().join(",");
      return id(row.messageId) && id(row.goalId)
        && (keys === "goalId,messageId,workCaseId" && id(row.workCaseId)
          || keys === "executionId,followUpId,goalId,messageId" && id(row.followUpId) && id(row.executionId));
    });
    const settled = item.settled === undefined ? [] : item.settled as unknown[];
    const validSettled = settled.every(value => value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length === 2 && id((value as Record<string, unknown>).messageId)
      && typeof (value as Record<string, unknown>).occurredAt === "string"
      && Number.isFinite(Date.parse((value as Record<string, unknown>).occurredAt as string)));
    if (!pending || !recovered || !validSettled || item.status === "clear" && item.pending.length !== 0
      || item.status === "outcome_unknown" && item.pending.length === 0) return localOnly();
    const server = item as EduPiAmbientPendingState;
    const localById = new Map(local.map(entry => [entry.messageId, entry.occurredAt]));
    for (const entry of [...server.pending, ...settled as Array<{ messageId: string; occurredAt: string }>]) {
      const localTime = localById.get(entry.messageId);
      if (localTime !== undefined && localTime !== entry.occurredAt) return localOnly();
    }
    for (const entry of settled as Array<{ messageId: string; occurredAt: string }>) {
      if (await clearEduPiAmbientUnconfirmedDurable(sessionId, entry.messageId)) {
        try { await postPlanAction("ack", { sessionId, messageId: entry.messageId, occurredAt: entry.occurredAt }); }
        catch { /* A completed, unacknowledged plan remains available for a later read. */ }
      }
    }
    local = await readEduPiAmbientUnconfirmedDurable(sessionId);
    const seen = new Set(server.pending.map(entry => entry.messageId));
    const pendingEntries = [...server.pending,
      ...local.filter(entry => !seen.has(entry.messageId)).map(entry => ({ ...entry, unconfirmed: true }))];
    return { status: pendingEntries.length ? "outcome_unknown" : server.status, pending: pendingEntries, recovered: server.recovered };
  } catch { return localOnly(); }
}

export async function captureEduPiAmbientMessage(input: { sessionId: string; messageId: string; text: string; occurredAt: string }): Promise<{ status: string }> {
  if (!isTauriDesktop()) return { status: "disabled" };
  const key = captureKey(input.sessionId, input.messageId);
  const prepared = armed.get(key) === input.occurredAt;
  if (prepared) armed.delete(key);
  let existing: Awaited<ReturnType<typeof readEduPiAmbientUnconfirmedDurable>>;
  try { existing = await readEduPiAmbientUnconfirmedDurable(input.sessionId); } catch { return { status: "unavailable" }; }
  const same = existing.some(item => item.messageId === input.messageId);
  if (same && !prepared) return { status: "outcome_unknown" };
  if (!prepared || !same) return { status: "unavailable" };
  if (existing.some(item => item.messageId !== input.messageId)) return { status: "verification_pending" };
  let response: Response;
  try {
    response = await fetchDesktopApi("/api/edupi/proactivity/messages", {
      method: "POST",
      cache: "no-store",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch { return { status: "outcome_unknown" }; }
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)
    || typeof (body as Record<string, unknown>).status !== "string"
    || (body as Record<string, unknown>).externalSend !== false) {
    return { status: "outcome_unknown" };
  }
  const result = body as Record<string, unknown>;
  const status = String(result.status);
  if (result.messageComplete !== true || result.messageId !== input.messageId || result.occurredAt !== input.occurredAt) {
    return { status: "outcome_unknown" };
  }
  if (!await clearEduPiAmbientUnconfirmedDurable(input.sessionId, input.messageId)) return { status: "outcome_unknown" };
  try { await postPlanAction("ack", input); } catch { /* Completion remains durable until it can be acknowledged. */ }
  return { status };
}
