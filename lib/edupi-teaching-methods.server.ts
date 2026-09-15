import crypto from "node:crypto";

import { normalizeTeachingSkillLifecycle, type EduPiTeachingMethodAction, type EduPiTeachingMethodMutation, type EduPiTeachingSkillLifecycle } from "./edupi-platform-client";

type RawRecord = Record<string, unknown>;
const METHOD_ACTIONS = new Set<EduPiTeachingMethodAction>(["create", "update", "record_trial", "validate", "publish", "retire"]);
const METHOD_STATES = new Set(["draft", "trial", "validated", "published", "retired"]);

export class EduPiTeachingMethodMutationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = "EduPiTeachingMethodMutationError";
  }
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function normalizedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.replace(/\r\n?/gu, "\n").trim();
  return result && result.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result) ? result : null;
}

function identifier(value: unknown): string | null {
  const result = normalizedText(value, 160);
  return result && /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]*$/u.test(result) ? result : null;
}

function revision(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function exactKeys(value: RawRecord, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function invalid(): never {
  throw new EduPiTeachingMethodMutationError("invalid_request", "教学方法操作无效", 400);
}

export function parseTeachingMethodMutation(value: unknown): EduPiTeachingMethodMutation {
  const source = record(value);
  const action = normalizedText(source?.action, 40) as EduPiTeachingMethodAction | null;
  if (!source || !action) invalid();
  if (action === "create") {
    if (!exactKeys(source, ["action", "title", "content"])) invalid();
    const title = normalizedText(source.title, 240);
    const content = normalizedText(source.content, 12000);
    if (!title || !content) invalid();
    return { action, title, content };
  }
  const methodId = identifier(source.method_id);
  const expectedRevision = revision(source.expected_revision);
  if (!methodId || expectedRevision === null) invalid();
  if (action === "update") {
    if (!exactKeys(source, ["action", "method_id", "expected_revision", "title", "content"])) invalid();
    const title = normalizedText(source.title, 240);
    const content = normalizedText(source.content, 12000);
    if (!title || !content) invalid();
    return { action, methodId, expectedRevision, title, content };
  }
  if (action === "record_trial") {
    if (!exactKeys(source, ["action", "method_id", "expected_revision", "task_id", "outcome", "feedback"])) invalid();
    const taskId = identifier(source.task_id);
    const feedback = normalizedText(source.feedback, 4000);
    if (!taskId || !feedback || !["helpful", "mixed", "not_helpful"].includes(String(source.outcome))) invalid();
    return { action, methodId, expectedRevision, taskId, outcome: source.outcome as "helpful" | "mixed" | "not_helpful", feedback };
  }
  if (action === "validate") {
    if (!exactKeys(source, ["action", "method_id", "expected_revision", "decision", "feedback"])) invalid();
    const feedback = normalizedText(source.feedback, 4000);
    if (!feedback || !["accepted", "rejected"].includes(String(source.decision))) invalid();
    return { action, methodId, expectedRevision, decision: source.decision as "accepted" | "rejected", feedback };
  }
  if (action === "publish") {
    if (!exactKeys(source, ["action", "method_id", "expected_revision"])) invalid();
    return { action, methodId, expectedRevision };
  }
  if (action === "retire") {
    if (!exactKeys(source, ["action", "method_id", "expected_revision", "reason"])) invalid();
    const reason = normalizedText(source.reason, 1000);
    if (!reason) invalid();
    return { action, methodId, expectedRevision, reason };
  }
  return invalid();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const source = record(value);
  if (!source) return value;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonical(source[key])]));
}

export function teachingMethodMutationRequestId(input: EduPiTeachingMethodMutation): string {
  return `teaching-method-${crypto.createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex").slice(0, 40)}`;
}

export function teachingMethodCoreFields(input: EduPiTeachingMethodMutation): RawRecord {
  if (input.action === "create") return { action: input.action, title: input.title, content: input.content };
  if (input.action === "update") return { action: input.action, method_id: input.methodId, expected_revision: input.expectedRevision, title: input.title, content: input.content };
  if (input.action === "record_trial") return { action: input.action, method_id: input.methodId, expected_revision: input.expectedRevision, task_id: input.taskId, outcome: input.outcome, feedback: input.feedback };
  if (input.action === "validate") return { action: input.action, method_id: input.methodId, expected_revision: input.expectedRevision, decision: input.decision, feedback: input.feedback };
  if (input.action === "publish") return { action: input.action, method_id: input.methodId, expected_revision: input.expectedRevision };
  return { action: input.action, method_id: input.methodId, expected_revision: input.expectedRevision, reason: input.reason };
}

function rejectedMutation(input: EduPiTeachingMethodMutation, lifecycle: EduPiTeachingSkillLifecycle): never {
  if (input.action === "create") {
    if (lifecycle.skills.some((skill) => skill.origin === "managed" && skill.lifecycleState !== "retired" && skill.title.toLocaleLowerCase() === input.title.toLocaleLowerCase())) {
      throw new EduPiTeachingMethodMutationError("method_conflict", "已有同名教学方法");
    }
    throw new EduPiTeachingMethodMutationError("mutation_rejected", "教学方法没有保存，请刷新后重试");
  }
  const method = lifecycle.skills.find((skill) => skill.skillId === input.methodId);
  if (!method) throw new EduPiTeachingMethodMutationError("method_not_found", "教学方法已不存在");
  if (method.revision !== input.expectedRevision) throw new EduPiTeachingMethodMutationError("stale_method", "教学方法已更新，请刷新后重试");
  if (method.lifecycleState === "retired") throw new EduPiTeachingMethodMutationError("method_retired", "教学方法已经停用");
  if (input.action === "record_trial") throw new EduPiTeachingMethodMutationError("trial_rejected", "所选任务无法作为本次试用依据");
  if (input.action === "validate") throw new EduPiTeachingMethodMutationError("trial_required", "请先为当前版本记录一次真实试用");
  if (input.action === "publish") throw new EduPiTeachingMethodMutationError("validation_required", "请先完成教师验证");
  throw new EduPiTeachingMethodMutationError("mutation_rejected", "教学方法没有更新，请刷新后重试");
}

function validRawMutationReceipt(value: RawRecord): boolean {
  return exactKeys(value, ["request_id", "action", "method_id", "revision", "content_revision", "status", "trial_id", "replayed", "external_send"])
    && Boolean(identifier(value.request_id))
    && METHOD_ACTIONS.has(value.action as EduPiTeachingMethodAction)
    && Boolean(identifier(value.method_id))
    && revision(value.revision) !== null
    && typeof value.content_revision === "number" && Number.isSafeInteger(value.content_revision) && value.content_revision >= 1
    && METHOD_STATES.has(String(value.status))
    && (value.trial_id === null || Boolean(identifier(value.trial_id)))
    && value.replayed === false
    && value.external_send === false;
}

export function validateTeachingMethodMutationResponse(value: unknown, requestId: string, input: EduPiTeachingMethodMutation): { lifecycle: EduPiTeachingSkillLifecycle; projection: RawRecord } {
  const source = record(value);
  if (!source || !exactKeys(source, ["ok", "operation", "request_id", "projection"]) || source.ok !== true || source.operation !== "teaching-skills" || source.request_id !== requestId) {
    throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法响应无效", 502);
  }
  const projection = record(source.projection);
  if (!projection || !exactKeys(projection, ["projection_kind", "projection_version", "mutation_enabled", "generated_at", "summary", "skills", "teacher_growth", "mutation_receipts", "external_send"])
    || projection.projection_kind !== "teaching_skill_lifecycle" || projection.projection_version !== 2 || projection.external_send !== false
    || !Array.isArray(projection.mutation_receipts)) {
    throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法状态无效", 502);
  }
  const lifecycle = normalizeTeachingSkillLifecycle(projection);
  if (lifecycle.status === "unavailable" || !lifecycle.mutationEnabled) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法状态无效", 502);
  const rawReceipts = projection.mutation_receipts.map(record);
  if (rawReceipts.some((receipt) => !receipt || !validRawMutationReceipt(receipt))) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法回执无效", 502);
  const validReceipts = rawReceipts as RawRecord[];
  const matchingRawReceipts = validReceipts.filter((receipt) => receipt.request_id === requestId);
  if (matchingRawReceipts.length > 1) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法回执重复", 502);
  if (matchingRawReceipts.length === 1) {
    const receipt = matchingRawReceipts[0];
    if (!validRawMutationReceipt(receipt)) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法回执无效", 502);
  }
  const receipts = lifecycle.mutationReceipts.filter((receipt) => receipt.requestId === requestId);
  if (receipts.length !== 1) return rejectedMutation(input, lifecycle);
  const receipt = receipts[0];
  if (receipt.action !== input.action) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法回执无效", 502);
  const matchingMethods = lifecycle.skills.filter((skill) => skill.skillId === receipt.methodId);
  const method = matchingMethods[0];
  if (matchingMethods.length !== 1 || !method || method.origin !== "managed" || method.revision !== receipt.revision || method.contentRevision !== receipt.contentRevision || method.lifecycleState !== receipt.status) {
    throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法结果不一致", 502);
  }
  if (input.action !== "create" && receipt.methodId !== input.methodId) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法身份不一致", 502);
  if (input.action === "create" && (method.title !== input.title || method.details?.content !== input.content || method.lifecycleState !== "draft")) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法保存结果不一致", 502);
  if (input.action === "update" && (method.title !== input.title || method.details?.content !== input.content || receipt.revision < input.expectedRevision || receipt.revision > input.expectedRevision + 1)) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 教学方法修订结果不一致", 502);
  if (input.action === "record_trial") {
    const trial = method.details?.trials.find((item) => item.trialId === receipt.trialId);
    if (receipt.revision !== input.expectedRevision + 1 || !receipt.trialId || !trial || trial.taskId !== input.taskId || trial.outcome !== input.outcome || trial.feedback !== input.feedback) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 试用记录不一致", 502);
  }
  if (input.action === "validate" && (receipt.revision !== input.expectedRevision + 1 || method.lifecycleState !== (input.decision === "accepted" ? "validated" : "retired")
    || method.details?.approval?.status !== input.decision || method.details.approval.feedback !== input.feedback)) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 验证结果不一致", 502);
  if (input.action === "publish" && (receipt.revision !== input.expectedRevision + 1 || method.lifecycleState !== "published" || !method.canReuse)) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 发布结果不一致", 502);
  if (input.action === "retire" && (receipt.revision !== input.expectedRevision + 1 || method.lifecycleState !== "retired" || method.details?.retirementReason !== input.reason)) throw new EduPiTeachingMethodMutationError("invalid_response", "Core 停用结果不一致", 502);
  return { lifecycle, projection };
}
