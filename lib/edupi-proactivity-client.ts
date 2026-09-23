import { fetchDesktopApi } from "./desktop-native";

export type EduPiProactivityState = {
  ok: true;
  degraded?: boolean;
  activation: { enabled: boolean; source: "default" | "desktop_canary" | "environment"; configurationStatus: "missing" | "ready" | "mismatched" | "invalid"; scope: { classId: string; subject: string } | null; updatedAt: string | null };
  scopes: Array<{ classId: string; className: string | null; subject: string; slotCount: number; materialCount: number; ready: boolean }>;
  grant: { status: "active" | "paused" | "revoked" | "expired"; grantVersion: number; endsAt: string } | null;
  capabilities: { ambientPlanning: boolean; ownerIntent: boolean; attentionDelivery: boolean; teacherFeedback: boolean } | null;
  limits: { durationDays: number; maxModelCalls: number; domain: "teaching_preparation" };
  externalSend: false;
  grantPaused?: boolean;
};

export class EduPiProactivityClientError extends Error {
  constructor(message: string) { super(message); this.name = "EduPiProactivityClientError"; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseEduPiProactivityState(value: unknown): EduPiProactivityState {
  const state = record(value);
  const activation = record(state?.activation);
  const activationScope = activation?.scope === null ? null : record(activation?.scope);
  const limits = record(state?.limits);
  const scopes = state?.scopes;
  const grant = state?.grant === null ? null : record(state?.grant);
  const capabilities = state?.capabilities === null ? null : record(state?.capabilities);
  if (state?.ok !== true || state.externalSend !== false || state.degraded !== undefined && typeof state.degraded !== "boolean"
    || !activation || typeof activation.enabled !== "boolean"
    || !["default", "desktop_canary", "environment"].includes(String(activation.source))
    || !["missing", "ready", "mismatched", "invalid"].includes(String(activation.configurationStatus))
    || activationScope !== null && (typeof activationScope?.classId !== "string" || !activationScope.classId
      || typeof activationScope?.subject !== "string" || !activationScope.subject)
    || activation.updatedAt !== null && typeof activation.updatedAt !== "string"
    || !Array.isArray(scopes) || scopes.length > 50 || !limits || limits.domain !== "teaching_preparation"
    || !Number.isInteger(limits.durationDays) || Number(limits.durationDays) < 1 || Number(limits.durationDays) > 30
    || !Number.isInteger(limits.maxModelCalls) || Number(limits.maxModelCalls) < 0 || Number(limits.maxModelCalls) > 100) {
    throw new EduPiProactivityClientError("主动运行状态无效");
  }
  for (const raw of scopes) {
    const scope = record(raw);
    if (!scope || typeof scope.classId !== "string" || !scope.classId || typeof scope.subject !== "string" || !scope.subject
      || scope.className !== null && typeof scope.className !== "string" || typeof scope.ready !== "boolean"
      || !Number.isInteger(scope.slotCount) || Number(scope.slotCount) < 0 || !Number.isInteger(scope.materialCount) || Number(scope.materialCount) < 0) {
      throw new EduPiProactivityClientError("主动运行范围无效");
    }
  }
  if (grant && (!Number.isInteger(grant.grantVersion) || !["active", "paused", "revoked", "expired"].includes(String(grant.status)) || typeof grant.endsAt !== "string")) {
    throw new EduPiProactivityClientError("主动运行授权无效");
  }
  if (capabilities && ![capabilities.ambientPlanning, capabilities.ownerIntent, capabilities.attentionDelivery, capabilities.teacherFeedback].every((item) => typeof item === "boolean")) {
    throw new EduPiProactivityClientError("主动运行能力无效");
  }
  return value as EduPiProactivityState;
}

async function responseState(response: Response): Promise<EduPiProactivityState> {
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const error = record(body)?.error;
    throw new EduPiProactivityClientError(typeof error === "string" ? error : "主动运行设置暂不可用");
  }
  return parseEduPiProactivityState(body);
}

export async function readEduPiProactivity(signal?: AbortSignal): Promise<EduPiProactivityState> {
  return responseState(await fetchDesktopApi("/api/edupi/proactivity", { cache: "no-store", signal }));
}

export async function updateEduPiProactivity(input: { enabled: boolean; classId: string | null; subject: string | null; expectedUpdatedAt: string | null }, signal?: AbortSignal): Promise<EduPiProactivityState> {
  return responseState(await fetchDesktopApi("/api/edupi/proactivity", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }));
}
