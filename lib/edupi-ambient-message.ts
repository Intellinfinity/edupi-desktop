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
