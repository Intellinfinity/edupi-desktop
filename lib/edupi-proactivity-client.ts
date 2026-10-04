import { desktopApiHeaders, fetchDesktopApi } from "./desktop-native";
import type { EduPiProactivityDomain } from "./edupi-proactivity-config";

export type { EduPiProactivityDomain } from "./edupi-proactivity-config";

export type EduPiProactivityState = {
  ok: true;
  degraded?: boolean;
  requiresSafeMode?: boolean;
  activationBlocked?: "isolated_canary_required" | "windows_unavailable" | null;
  activation: { enabled: boolean; source: "default" | "desktop_canary" | "environment"; configurationStatus: "missing" | "ready" | "legacy" | "stop_pending" | "mismatched" | "invalid"; scope: { classId: string; subject: string } | null; updatedAt: string | null };
  scopes: Array<{ classId: string; className: string | null; subject: string; slotCount: number; materialCount: number; ready: boolean }>;
  grant: { status: "active" | "paused" | "revoked" | "expired"; grantVersion: number; endsAt: string;
    modelBudget: { usedCalls: number; maxCalls: number; remainingCalls: number; usageUnverified: boolean } | null } | null;
  capabilities: { ambientPlanning: boolean; ownerIntent: boolean; attentionDelivery: boolean; teacherFeedback: boolean; studentFollowup?: boolean } | null;
  limits: { durationDays: number; maxModelCalls: number; domain: EduPiProactivityDomain };
  externalSend: false;
  grantPaused?: boolean;
  initialScan?: { queued: number; needsAttention: boolean };
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
  const modelBudget = record(grant?.modelBudget);
  const capabilities = state?.capabilities === null ? null : record(state?.capabilities);
  const initialScan = state?.initialScan === undefined ? null : record(state?.initialScan);
  if (state?.ok !== true || state.externalSend !== false || state.degraded !== undefined && typeof state.degraded !== "boolean"
    || state.requiresSafeMode !== undefined && typeof state.requiresSafeMode !== "boolean"
    || state.activationBlocked !== undefined && state.activationBlocked !== null
      && !["isolated_canary_required", "windows_unavailable"].includes(String(state.activationBlocked))
    || !activation || typeof activation.enabled !== "boolean"
    || !["default", "desktop_canary", "environment"].includes(String(activation.source))
    || !["missing", "ready", "legacy", "stop_pending", "mismatched", "invalid"].includes(String(activation.configurationStatus))
    || activationScope !== null && (typeof activationScope?.classId !== "string" || !activationScope.classId
      || typeof activationScope?.subject !== "string" || !activationScope.subject)
    || activation.updatedAt !== null && typeof activation.updatedAt !== "string"
    || !Array.isArray(scopes) || scopes.length > 50 || !limits || !["teaching_preparation", "student_followup"].includes(String(limits.domain))
    || !Number.isInteger(limits.durationDays) || Number(limits.durationDays) < 1 || Number(limits.durationDays) > 30
    || !Number.isInteger(limits.maxModelCalls) || Number(limits.maxModelCalls) < 0 || Number(limits.maxModelCalls) > 100
    || limits.domain === "student_followup" && (limits.durationDays !== 7 || limits.maxModelCalls !== 4)) {
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
  if (grant && (!Number.isInteger(grant.grantVersion) || !["active", "paused", "revoked", "expired"].includes(String(grant.status)) || typeof grant.endsAt !== "string"
    || (limits.domain === "student_followup" ? grant.modelBudget !== null
      : !modelBudget || !Number.isSafeInteger(modelBudget.usedCalls) || Number(modelBudget.usedCalls) < 0 || Number(modelBudget.usedCalls) > 1536
    || !Number.isSafeInteger(modelBudget.maxCalls) || Number(modelBudget.maxCalls) < 0 || Number(modelBudget.maxCalls) > 12
    || !Number.isSafeInteger(modelBudget.remainingCalls) || Number(modelBudget.remainingCalls) < 0 || Number(modelBudget.remainingCalls) > 12
    || typeof modelBudget.usageUnverified !== "boolean"
    || modelBudget.usageUnverified && modelBudget.remainingCalls !== 0
    || !modelBudget.usageUnverified && modelBudget.remainingCalls !== Math.max(0, Number(modelBudget.maxCalls) - Number(modelBudget.usedCalls))))) {
    throw new EduPiProactivityClientError("主动运行授权无效");
  }
  if (capabilities && (![capabilities.ambientPlanning, capabilities.ownerIntent, capabilities.attentionDelivery, capabilities.teacherFeedback].every((item) => typeof item === "boolean")
    || limits.domain === "student_followup" && typeof capabilities.studentFollowup !== "boolean")) {
    throw new EduPiProactivityClientError("主动运行能力无效");
  }
  if (state?.initialScan !== undefined && (limits.domain === "student_followup" || !initialScan || !Number.isInteger(initialScan.queued)
    || Number(initialScan.queued) < 0 || Number(initialScan.queued) > 20 || typeof initialScan.needsAttention !== "boolean")) {
    throw new EduPiProactivityClientError("主动运行检查结果无效");
  }
  return value as EduPiProactivityState;
}

async function responseState(response: Response, domain: EduPiProactivityDomain): Promise<EduPiProactivityState> {
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const error = record(body)?.error;
    throw new EduPiProactivityClientError(typeof error === "string" ? error : "主动运行设置暂不可用");
  }
  const state = parseEduPiProactivityState(body);
  if (state.limits.domain !== domain) throw new EduPiProactivityClientError("主动运行领域不匹配");
  return state;
}

export async function readEduPiProactivity(signal?: AbortSignal, domain: EduPiProactivityDomain = "teaching_preparation"): Promise<EduPiProactivityState> {
  const response = domain === "student_followup"
    ? await fetch("/api/edupi/proactivity?domain=student_followup", { cache: "no-store", signal, headers: await desktopApiHeaders() })
    : await fetchDesktopApi("/api/edupi/proactivity", { cache: "no-store", signal });
  return responseState(response, domain);
}

export async function updateEduPiProactivity(input: { enabled: boolean; classId: string | null; subject: string | null; expectedUpdatedAt: string | null; domain?: EduPiProactivityDomain }, signal?: AbortSignal): Promise<EduPiProactivityState> {
  return responseState(await fetchDesktopApi("/api/edupi/proactivity", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }), input.domain ?? "teaching_preparation");
}
