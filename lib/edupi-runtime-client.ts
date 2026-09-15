export type EduPiRuntimeReconnectResult = {
  ok: true;
  status: string;
  reason: string | null;
};

type ErrorBody = { error?: unknown };

function isReconnectResult(value: unknown): value is EduPiRuntimeReconnectResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.ok === true
    && typeof result.status === "string"
    && (result.reason === null || typeof result.reason === "string");
}

export async function reconnectEduPiCore(signal?: AbortSignal): Promise<EduPiRuntimeReconnectResult> {
  const response = await fetch("/api/edupi/runtime/reconnect", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok || !isReconnectResult(body)) {
    const errorBody = body && typeof body === "object" && !Array.isArray(body) ? body as ErrorBody : null;
    const message = typeof errorBody?.error === "string" ? errorBody.error : "Core 重新连接失败";
    throw new Error(message);
  }
  return body;
}
