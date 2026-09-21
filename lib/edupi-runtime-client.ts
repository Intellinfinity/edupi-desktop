import { fetchDesktopApi } from "./desktop-native";

export type EduPiRuntimeReconnectResult = {
  ok: true;
  status: string;
  reason: string | null;
};

export type EduPiRuntimeRepairResult = {
  ok: true;
  status: string;
  before?: { status?: string; reason?: string | null };
  repaired?: { status?: string; backups?: string[] };
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

export async function repairEduPiCore(signal?: AbortSignal): Promise<EduPiRuntimeRepairResult> {
  const response = await fetchDesktopApi("/api/edupi/runtime/repair", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body) || (body as Record<string, unknown>).ok !== true) {
    const message = body && typeof body === "object" && !Array.isArray(body) && typeof (body as Record<string, unknown>).error === "string"
      ? (body as Record<string, string>).error
      : "Core Runtime 修复失败";
    throw new Error(message);
  }
  return body as EduPiRuntimeRepairResult;
}
