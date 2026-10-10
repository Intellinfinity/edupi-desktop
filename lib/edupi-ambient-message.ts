import { fetchDesktopApi } from "./desktop-native";
import { isTauriDesktop } from "./desktop-updater";

export async function captureEduPiAmbientMessage(input: { sessionId: string; messageId: string; text: string; occurredAt: string }): Promise<{ status: string }> {
  if (!isTauriDesktop()) return { status: "disabled" };
  const availability = await fetchDesktopApi("/api/edupi/proactivity/messages", { method: "GET", cache: "no-store" });
  const availabilityBody = await availability.json().catch(() => null) as unknown;
  if (!availability.ok || !availabilityBody || typeof availabilityBody !== "object" || Array.isArray(availabilityBody)
    || (availabilityBody as Record<string, unknown>).status !== "enabled"
    || (availabilityBody as Record<string, unknown>).externalSend !== false) {
    return { status: availability.ok ? "disabled" : "unavailable" };
  }
  const response = await fetchDesktopApi("/api/edupi/proactivity/messages", {
    method: "POST",
    cache: "no-store",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => null) as unknown;
  return body && typeof body === "object" && !Array.isArray(body) && typeof (body as Record<string, unknown>).status === "string"
    ? { status: String((body as Record<string, unknown>).status) }
    : { status: "unavailable" };
}

export async function sendEduPiCapturedPrompt(input: {
  sessionId: string;
  messageId: string;
  occurredAt: string;
  command: { type: "prompt"; message: string; clientRequestId: string; images?: Array<{ type: "image"; data: string; mimeType: string }> };
}): Promise<"disabled" | "accepted" | "uncertain" | "blocked" | "prior_unresolved" | "attachment_requires_review" | "cancelled" | "source_withdrawn"> {
  if (!isTauriDesktop()) return "disabled";
  if (input.command.images?.length) {
    const availability = await fetchDesktopApi("/api/edupi/proactivity/messages", { cache: "no-store" });
    const state = await availability.json().catch(() => null) as { status?: unknown } | null;
    if (!availability.ok) return "blocked";
    if (state?.status === "enabled") return "attachment_requires_review";
    if (state?.status !== "disabled") return "blocked";
    return "disabled";
  }
  const response = await fetchDesktopApi("/api/edupi/proactivity/prompt", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => null) as { status?: unknown } | null;
  if (body?.status === "disabled" && response.ok) return "disabled";
  if (body?.status === "accepted" && response.ok) return "accepted";
  if (body?.status === "uncertain" && response.ok) return "uncertain";
  if (body?.status === "cancelled") return "cancelled";
  if (body?.status === "source_withdrawn") return "source_withdrawn";
  if (body?.status === "prior_unresolved") return "prior_unresolved";
  if (body?.status === "attachment_requires_review") return "attachment_requires_review";
  return "blocked";
}

export async function reconcileEduPiCapturedPrompt(sessionId: string, clientRequestId: string): Promise<string> {
  if (!isTauriDesktop()) return "unavailable";
  const response = await fetchDesktopApi("/api/edupi/proactivity/prompt", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, clientRequestId }),
  });
  const body = await response.json().catch(() => null) as { status?: unknown } | null;
  return typeof body?.status === "string" ? body.status : "unavailable";
}

export async function persistEduPiPromptIntent(input: { sessionId: string; clientRequestId: string;
  occurredAt: string; message: string; draftValue: string; cwd: string }): Promise<"ready" | "resolved"> {
  const response = await fetchDesktopApi("/api/edupi/proactivity/prompt/intent", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => null) as { status?: unknown } | null;
  if (response.ok && (body?.status === "ready" || body?.status === "resolved")) return body.status;
  throw new Error("prompt_intent_unavailable");
}

export async function resolveEduPiPromptIntentClient(sessionId: string, clientRequestId: string): Promise<void> {
  const response = await fetchDesktopApi("/api/edupi/proactivity/prompt/intent", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, clientRequestId, confirmedPiPersistence: true }),
  });
  if (!response.ok) throw new Error("prompt_intent_resolution_unavailable");
}
