import { desktopApiHeaders, fetchDesktopApi } from "./desktop-native";
import type { EduPiProactivityDomain } from "./edupi-proactivity-config";
import type { EduPiStudentFollowupExecution } from "./edupi-proactivity-runtime";

export type { EduPiProactivityDomain } from "./edupi-proactivity-config";

export type EduPiProactivityState = {
  ok: true;
  degraded?: boolean;
  requiresSafeMode?: boolean;
  activationBlocked?: "isolated_canary_required" | "windows_unavailable" | "activation_pending" | null;
  activation: { enabled: boolean; source: "default" | "desktop_canary" | "environment"; configurationStatus: "missing" | "ready" | "legacy" | "stop_pending" | "mismatched" | "invalid"; scope: { classId: string; subject: string } | null; updatedAt: string | null };
  scopes: Array<{ classId: string; className: string | null; subject: string; slotCount: number; materialCount: number; ready: boolean }>;
  grant: { status: "active" | "paused" | "revoked" | "expired"; grantVersion: number; endsAt: string;
    modelBudget: { usedCalls: number; maxCalls: number; remainingCalls: number; usageUnverified: boolean } | null } | null;
  capabilities: { ambientPlanning: boolean; ownerIntent: boolean; attentionDelivery: boolean; teacherFeedback: boolean; studentFollowup?: boolean } | null;
  execution?: EduPiStudentFollowupExecution | null;
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
      && !["isolated_canary_required", "windows_unavailable", "activation_pending"].includes(String(state.activationBlocked))
    || !activation || typeof activation.enabled !== "boolean"
    || !["default", "desktop_canary", "environment"].includes(String(activation.source))
    || !["missing", "ready", "legacy", "stop_pending", "mismatched", "invalid"].includes(String(activation.configurationStatus))
    || activationScope !== null && (typeof activationScope?.classId !== "string" || !activationScope.classId
      || typeof activationScope?.subject !== "string" || !activationScope.subject)
    || activation.updatedAt !== null && typeof activation.updatedAt !== "string"
    || !Array.isArray(scopes) || scopes.length > 50 || !limits || !["teaching_preparation", "student_followup",
      "calendar_administration", "lesson_reflection", "parent_communication"].includes(String(limits.domain))
    || !Number.isInteger(limits.durationDays) || Number(limits.durationDays) < 1 || Number(limits.durationDays) > 30
    || !Number.isInteger(limits.maxModelCalls) || Number(limits.maxModelCalls) < 0 || Number(limits.maxModelCalls) > 100
    || limits.domain === "student_followup" && (limits.durationDays !== 7 || limits.maxModelCalls !== 4)
    || ["calendar_administration", "lesson_reflection", "parent_communication"].includes(String(limits.domain))
      && (limits.maxModelCalls !== 0 || state.activationBlocked !== "activation_pending")) {
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
  const budgetLimit = limits.domain === "student_followup" ? 4 : limits.domain === "teaching_preparation" ? 12 : 0;
  if (grant && (!Number.isInteger(grant.grantVersion) || !["active", "paused", "revoked", "expired"].includes(String(grant.status)) || typeof grant.endsAt !== "string"
    || !(limits.domain !== "teaching_preparation" && grant.modelBudget === null) && (
    !modelBudget || !Number.isSafeInteger(modelBudget.usedCalls) || Number(modelBudget.usedCalls) < 0 || Number(modelBudget.usedCalls) > 1536
    || !Number.isSafeInteger(modelBudget.maxCalls) || Number(modelBudget.maxCalls) < 0 || Number(modelBudget.maxCalls) > budgetLimit
    || !Number.isSafeInteger(modelBudget.remainingCalls) || Number(modelBudget.remainingCalls) < 0 || Number(modelBudget.remainingCalls) > budgetLimit
    || typeof modelBudget.usageUnverified !== "boolean"
    || modelBudget.usageUnverified && modelBudget.remainingCalls !== 0
    || !modelBudget.usageUnverified && modelBudget.remainingCalls !== Math.max(0, Number(modelBudget.maxCalls) - Number(modelBudget.usedCalls))))) {
    throw new EduPiProactivityClientError("主动运行授权无效");
  }
  if (state.execution !== undefined && state.execution !== null) {
    const execution = record(state.execution);
    if (limits.domain !== "student_followup" || !execution || Object.keys(execution).length !== 5
      || execution.version !== 1 || typeof execution.available !== "boolean" || execution.externalSend !== false
      || !Array.isArray(execution.records) || execution.records.length > 500
      || (execution.available ? !Number.isSafeInteger(execution.revision) || Number(execution.revision) < 0
        : execution.revision !== null || execution.records.length !== 0)) {
      throw new EduPiProactivityClientError("学生跟进执行记录无效");
    }
    const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u.test(value);
    const seen = new Set();
    for (const raw of execution.records) {
      const item = record(raw);
      if (!item || Object.keys(item).length !== 8 || !id(item.executionId) || seen.has(item.executionId)
        || !id(item.followUpId) || item.grantId !== null && !id(item.grantId)
        || typeof item.status !== "string" || !["queued", "claimed", "completed", "failed", "cancelled"].includes(item.status)
        || !Number.isSafeInteger(item.attempt) || Number(item.attempt) < 0 || Number(item.attempt) > 3
        || item.errorCode !== null && (typeof item.errorCode !== "string" || !/^[a-z][a-z0-9_]{0,79}$/u.test(item.errorCode))
        || typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))
        || new Date(item.updatedAt).toISOString() !== item.updatedAt
        || typeof item.sourceStatus !== "string" || !["current", "historical", "unverified"].includes(item.sourceStatus)
        || item.sourceStatus === "current" && item.grantId === null) {
        throw new EduPiProactivityClientError("学生跟进执行记录无效");
      }
      seen.add(item.executionId);
    }
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
  const response = domain !== "teaching_preparation"
    ? await fetch(`/api/edupi/proactivity?domain=${encodeURIComponent(domain)}`, { cache: "no-store", signal, headers: await desktopApiHeaders() })
    : await fetchDesktopApi("/api/edupi/proactivity", { cache: "no-store", signal });
  return responseState(response, domain);
}

export async function updateEduPiProactivity(input: { enabled: boolean; classId: string | null; subject: string | null; expectedUpdatedAt: string | null; domain?: EduPiProactivityDomain }, signal?: AbortSignal): Promise<EduPiProactivityState> {
  return responseState(await fetchDesktopApi("/api/edupi/proactivity", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }), input.domain ?? "teaching_preparation");
}
