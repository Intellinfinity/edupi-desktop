import { fetchDesktopApi } from "./desktop-native";
import { isTauriDesktop } from "./desktop-updater";
import { clearEduPiAmbientUnconfirmedDurable, readEduPiAmbientUnconfirmedDurable,
  rememberEduPiAmbientUnconfirmedDurable } from "./edupi-ambient-client-pending";

export type EduPiAmbientPendingState = { status: "clear" | "outcome_unknown" | "applied" | "unavailable";
  pending: Array<{ messageId: string; occurredAt: string; unconfirmed?: boolean }>;
  recovered: Array<{ messageId: string; goalId: string; workCaseId: string }> };

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
      || !Array.isArray(item.pending) || item.pending.length > 4096 || !Array.isArray(item.recovered) || item.recovered.length > 20) return localOnly();
    const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u.test(value);
    const pending = item.pending.every(value => value && typeof value === "object" && id((value as Record<string, unknown>).messageId)
      && typeof (value as Record<string, unknown>).occurredAt === "string"
      && Number.isFinite(Date.parse((value as Record<string, unknown>).occurredAt as string)));
    const recovered = item.recovered.every(value => value && typeof value === "object"
      && ["messageId", "goalId", "workCaseId"].every(key => id((value as Record<string, unknown>)[key])));
    if (!pending || !recovered || item.status === "clear" && item.pending.length !== 0
      || item.status === "outcome_unknown" && item.pending.length === 0) return localOnly();
    const server = item as EduPiAmbientPendingState;
    for (const entry of [...server.pending, ...server.recovered]) await clearEduPiAmbientUnconfirmedDurable(sessionId, entry.messageId);
    local = await readEduPiAmbientUnconfirmedDurable(sessionId);
    const seen = new Set(server.pending.map(entry => entry.messageId));
    const pendingEntries = [...server.pending,
      ...local.filter(entry => !seen.has(entry.messageId)).map(entry => ({ ...entry, unconfirmed: true }))];
    return { status: pendingEntries.length ? "outcome_unknown" : server.status, pending: pendingEntries, recovered: server.recovered };
  } catch { return localOnly(); }
}

export async function captureEduPiAmbientMessage(input: { sessionId: string; messageId: string; text: string; occurredAt: string }): Promise<{ status: string }> {
  if (!isTauriDesktop()) return { status: "disabled" };
  let availability: Response;
  try { availability = await fetchDesktopApi("/api/edupi/proactivity/messages", { method: "GET", cache: "no-store" }); }
  catch { return { status: "unavailable" }; }
  const availabilityBody = await availability.json().catch(() => null) as unknown;
  if (!availability.ok || !availabilityBody || typeof availabilityBody !== "object" || Array.isArray(availabilityBody)
    || (availabilityBody as Record<string, unknown>).status !== "enabled"
    || (availabilityBody as Record<string, unknown>).externalSend !== false) {
    return { status: availability.ok ? "disabled" : "unavailable" };
  }
  let existing: Awaited<ReturnType<typeof readEduPiAmbientUnconfirmedDurable>>;
  try { existing = await readEduPiAmbientUnconfirmedDurable(input.sessionId); } catch { return { status: "unavailable" }; }
  if (existing.some(item => item.messageId === input.messageId)) return { status: "outcome_unknown" };
  if (existing.length) return { status: "verification_pending" };
  if (!await rememberEduPiAmbientUnconfirmedDurable({ sessionId: input.sessionId, messageId: input.messageId,
    occurredAt: input.occurredAt })) return { status: "unavailable" };
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
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).status !== "string") {
    return { status: "outcome_unknown" };
  }
  const result = body as Record<string, unknown>;
  const status = String(result.status);
  if (status === "unavailable") {
    if (["input", "owner", "runtime"].includes(String(result.stage))) {
      await clearEduPiAmbientUnconfirmedDurable(input.sessionId, input.messageId);
      return { status: "unavailable" };
    }
    return { status: "outcome_unknown" };
  }
  if (!["outcome_unknown", "recorded"].includes(status)) await clearEduPiAmbientUnconfirmedDurable(input.sessionId, input.messageId);
  return { status };
}
