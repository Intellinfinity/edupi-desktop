export type L4PreparationAction = "act" | "defer" | "ask" | "abstain" | "escalate";
export type L4PreparationGoalStatus = "active" | "paused" | "revoked" | "expired";

export type L4PreparationGoal = {
  id: string;
  text: string;
  scope: { classId: string; subject: string };
  startsAt: string;
  endsAt: string;
  successCondition: string;
  allowedActions: Array<"prepare" | "update">;
  budget: { maxCalls: number };
  prepareHours: number;
  escalateHours: number;
  version: number;
  sourceRef: string;
  status: L4PreparationGoalStatus;
};

export type L4PreparationOpportunity = {
  opportunityId: string;
  shadowOpportunityId: string;
  goalId: string;
  workCaseId: string;
  logicalOccurrenceKey: string;
  sourceRevision: string;
  evidenceIds: string[];
  gap: string;
  action: L4PreparationAction;
  reason: string;
  current: true;
  validUntil: string;
  nextWakeupAt: string | null;
  recheckOn: string[];
  fireKey: string;
  priority: {
    urgency: number;
    impact: number;
    evidenceQuality: number;
    risk: number;
    interruptionCost: number;
    computeCost: number;
    score: number;
  };
  expectedSatisfied: boolean;
};

export type L4PreparationDecision = {
  decisionId: string;
  goalId: string;
  opportunityId: string;
  action: L4PreparationAction;
  reason: string;
  evidenceIds: string[];
  policyVersion: string;
  decidedAt: string;
  nextWakeupAt: string | null;
  notify: boolean;
  apply: false;
};

export type L4AttentionIntent = {
  attentionIntentId: string;
  opportunityId: string;
  workCaseId: string;
  reason: string;
  createdAt: string;
  deliveryPolicy: "desktop_only";
  deepLink: string;
  externalSend: false;
};

export type L4AttentionDelivery = {
  receiptId: string;
  attentionIntentId: string;
  opportunityId: string;
  workCaseId: string;
  deepLink: string;
  carrier: { kind: "desktop" | "feishu" | "dingtalk"; instanceId: string };
  deliveryId: string;
  version: number;
  status: "queued" | "delivered" | "failed" | "retry" | "opened" | "expired";
  failureCode: string | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  intentCurrent: boolean;
  teacherAcceptance: "not_recorded";
  externalSend: false;
};

export type L4Preparation = {
  version: 1;
  policyVersion: string;
  generatedAt: string;
  goals: L4PreparationGoal[];
  opportunities: L4PreparationOpportunity[];
  decisions: L4PreparationDecision[];
  nextWakeupAt: string | null;
  attentionIntents: L4AttentionIntent[];
  attentionDeliveries: L4AttentionDelivery[];
  externalSend: false;
};

export type L4PreparationSummaryItem = {
  workCaseId: string;
  title: string;
  statusLabel: string;
  nextWakeupAt: string | null;
};

export type L4PreparationSummary = {
  ready: L4PreparationSummaryItem[];
  running: L4PreparationSummaryItem[];
  attention: L4PreparationSummaryItem[];
  nextWakeupAt: string | null;
};

type RawRecord = Record<string, unknown>;

const ACTIONS = new Set(["act", "defer", "ask", "abstain", "escalate"]);
const GOAL_STATUSES = new Set(["active", "paused", "revoked", "expired"]);
const MAX_TEXT = 2000;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function text(value: unknown, maxLength = MAX_TEXT): string | null {
  return typeof value === "string" && value.trim() && value.length <= maxLength ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  return text(value, 500);
}

function timestamp(value: unknown): string | null {
  const raw = text(value, 64);
  if (!raw || Number.isNaN(Date.parse(raw))) return null;
  return raw;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown, maxItems = 200): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const items: string[] = [];
  for (const item of value) {
    const normalized = identifier(item);
    if (!normalized) return null;
    items.push(normalized);
  }
  return items;
}

function action(value: unknown): L4PreparationAction | null {
  return typeof value === "string" && ACTIONS.has(value) ? value as L4PreparationAction : null;
}

function normalizeGoal(value: unknown): L4PreparationGoal | null {
  const goal = record(value);
  if (!goal) return null;
  const scope = record(goal.scope);
  const allowedActions = Array.isArray(goal.allowed_actions)
    && goal.allowed_actions.every(item => item === "prepare" || item === "update")
    && new Set(goal.allowed_actions).size === goal.allowed_actions.length
    && goal.allowed_actions.length > 0
    ? goal.allowed_actions as Array<"prepare" | "update">
    : null;
  const budget = record(goal.budget);
  const maxCalls = budget ? finiteNumber(budget.max_calls) : null;
  const prepareHours = finiteNumber(goal.prepare_hours);
  const escalateHours = finiteNumber(goal.escalate_hours);
  const id = identifier(goal.id);
  const goalText = text(goal.text);
  const classId = scope ? identifier(scope.class_id) : null;
  const subject = scope ? text(scope.subject, 200) : null;
  const startsAt = timestamp(goal.starts_at);
  const endsAt = timestamp(goal.ends_at);
  const successCondition = text(goal.success_condition);
  const sourceRef = text(goal.source_ref, 300);
  const status = GOAL_STATUSES.has(String(goal.status)) ? goal.status as L4PreparationGoalStatus : null;
  const version = finiteNumber(goal.version);
  if (maxCalls === null) return null;
  if (!id || !goalText || !classId || !subject || !startsAt || !endsAt || !successCondition
    || !allowedActions || !budget || !Number.isSafeInteger(maxCalls) || maxCalls < 0 || maxCalls > 12
    || prepareHours === null || prepareHours <= 0 || prepareHours > 168
    || escalateHours === null || escalateHours <= 0 || escalateHours > 168
    || version === null || !Number.isSafeInteger(version) || version < 1 || !sourceRef || !status) return null;
  return {
    id,
    text: goalText,
    scope: { classId, subject },
    startsAt,
    endsAt,
    successCondition,
    allowedActions,
    budget: { maxCalls },
    prepareHours,
    escalateHours,
    version,
    sourceRef,
    status,
  };
}

function normalizePriority(value: unknown): L4PreparationOpportunity["priority"] | null {
  const priority = record(value);
  if (!priority) return null;
  const urgency = finiteNumber(priority.urgency);
  const impact = finiteNumber(priority.impact);
  const evidenceQuality = finiteNumber(priority.evidence_quality);
  const risk = finiteNumber(priority.risk);
  const interruptionCost = finiteNumber(priority.interruption_cost);
  const computeCost = finiteNumber(priority.compute_cost);
  const score = finiteNumber(priority.score);
  if (urgency === null || impact === null || evidenceQuality === null || risk === null
    || interruptionCost === null || computeCost === null || score === null) return null;
  return { urgency, impact, evidenceQuality, risk, interruptionCost, computeCost, score };
}

function normalizeOpportunity(value: unknown): L4PreparationOpportunity | null {
  const opportunity = record(value);
  if (!opportunity || opportunity.current !== true) return null;
  const opportunityId = identifier(opportunity.opportunity_id);
  const shadowOpportunityId = identifier(opportunity.shadow_opportunity_id);
  const goalId = identifier(opportunity.goal_id);
  const workCaseId = identifier(opportunity.work_case_id);
  const logicalOccurrenceKey = text(opportunity.logical_occurrence_key, 300);
  const sourceRevision = text(opportunity.source_revision, 300);
  const evidenceIds = stringArray(opportunity.evidence_ids, 2000);
  const gap = text(opportunity.gap, 200);
  const opportunityAction = action(opportunity.action);
  const reason = text(opportunity.reason, 300);
  const validUntil = timestamp(opportunity.valid_until);
  const nextWakeupAt = opportunity.next_wakeup_at === null ? null : timestamp(opportunity.next_wakeup_at);
  const recheckOn = stringArray(opportunity.recheck_on, 20);
  const fireKey = text(opportunity.fire_key, 300);
  const priority = normalizePriority(opportunity.priority);
  const expectedSatisfied = opportunity.expected_satisfied;
  if (!opportunityId || !shadowOpportunityId || !goalId || !workCaseId || !logicalOccurrenceKey
    || !sourceRevision || !evidenceIds || !gap || !opportunityAction || !reason || !validUntil
    || nextWakeupAt === undefined || !recheckOn || !fireKey || !priority || typeof expectedSatisfied !== "boolean") return null;
  return {
    opportunityId,
    shadowOpportunityId,
    goalId,
    workCaseId,
    logicalOccurrenceKey,
    sourceRevision,
    evidenceIds,
    gap,
    action: opportunityAction,
    reason,
    current: true,
    validUntil,
    nextWakeupAt,
    recheckOn,
    fireKey,
    priority,
    expectedSatisfied,
  };
}

function normalizeDecision(value: unknown): L4PreparationDecision | null {
  const decision = record(value);
  if (!decision || decision.apply !== false) return null;
  const decisionId = identifier(decision.decision_id);
  const goalId = identifier(decision.goal_id);
  const opportunityId = identifier(decision.opportunity_id);
  const decisionAction = action(decision.action);
  const reason = text(decision.reason, 300);
  const evidenceIds = stringArray(decision.evidence_ids, 2000);
  const policyVersion = text(decision.policy_version, 100);
  const decidedAt = timestamp(decision.decided_at);
  const nextWakeupAt = decision.next_wakeup_at === null ? null : timestamp(decision.next_wakeup_at);
  if (!decisionId || !goalId || !opportunityId || !decisionAction || !reason || !evidenceIds
    || !policyVersion || !decidedAt || nextWakeupAt === undefined || typeof decision.notify !== "boolean") return null;
  return {
    decisionId,
    goalId,
    opportunityId,
    action: decisionAction,
    reason,
    evidenceIds,
    policyVersion,
    decidedAt,
    nextWakeupAt,
    notify: decision.notify,
    apply: false,
  };
}

function normalizeAttentionIntent(value: unknown): L4AttentionIntent | null {
  const intent = record(value);
  if (!intent || intent.delivery_policy !== "desktop_only" || intent.external_send !== false) return null;
  const attentionIntentId = identifier(intent.attention_intent_id);
  const opportunityId = identifier(intent.opportunity_id);
  const workCaseId = identifier(intent.work_case_id);
  const reason = text(intent.reason, 300);
  const createdAt = timestamp(intent.created_at);
  const deepLink = text(intent.deep_link, 500);
  if (!attentionIntentId || !opportunityId || !workCaseId || !reason || !createdAt || !deepLink) return null;
  return { attentionIntentId, opportunityId, workCaseId, reason, createdAt, deliveryPolicy: "desktop_only", deepLink, externalSend: false };
}

function normalizeAttentionDelivery(value: unknown): L4AttentionDelivery | null {
  const delivery = record(value);
  const carrier = record(delivery?.carrier);
  if (!delivery || !carrier || delivery.teacher_acceptance !== "not_recorded" || delivery.external_send !== false) return null;
  const receiptId = identifier(delivery.receipt_id);
  const attentionIntentId = identifier(delivery.attention_intent_id);
  const opportunityId = identifier(delivery.opportunity_id);
  const workCaseId = identifier(delivery.work_case_id);
  const deepLink = text(delivery.deep_link, 500);
  const carrierKind = carrier.kind;
  const instanceId = identifier(carrier.instance_id);
  const deliveryId = identifier(delivery.delivery_id);
  const version = finiteNumber(delivery.version);
  const status = typeof delivery.status === "string" && ["queued", "delivered", "failed", "retry", "opened", "expired"].includes(delivery.status) ? delivery.status as L4AttentionDelivery["status"] : null;
  const failureCode = delivery.failure_code === null ? null : identifier(delivery.failure_code);
  const occurredAt = timestamp(delivery.occurred_at);
  const createdAt = timestamp(delivery.created_at);
  const updatedAt = timestamp(delivery.updated_at);
  if (version === null || !Number.isSafeInteger(version) || version < 1) return null;
  if (!receiptId || !attentionIntentId || !opportunityId || !workCaseId || !deepLink
    || !instanceId || !deliveryId || !status
    || (status === "failed" || status === "retry") !== (failureCode !== null)
    || !occurredAt || !createdAt || !updatedAt || typeof delivery.intent_current !== "boolean"
    || !["desktop", "feishu", "dingtalk"].includes(String(carrierKind))) return null;
  return {
    receiptId,
    attentionIntentId,
    opportunityId,
    workCaseId,
    deepLink,
    carrier: { kind: carrierKind as L4AttentionDelivery["carrier"]["kind"], instanceId },
    deliveryId,
    version,
    status,
    failureCode,
    occurredAt,
    createdAt,
    updatedAt,
    intentCurrent: delivery.intent_current,
    teacherAcceptance: "not_recorded",
    externalSend: false,
  };
}

export function normalizeL4Preparation(value: unknown): L4Preparation | null {
  const projection = record(value);
  if (!projection || projection.version !== 1 || projection.external_send !== false) return null;
  const goals = Array.isArray(projection.goals) ? projection.goals.map(normalizeGoal) : null;
  const opportunities = Array.isArray(projection.opportunities) ? projection.opportunities.map(normalizeOpportunity) : null;
  const decisions = Array.isArray(projection.decisions) ? projection.decisions.map(normalizeDecision) : null;
  const attentionIntents = Array.isArray(projection.attention_intents) ? projection.attention_intents.map(normalizeAttentionIntent) : null;
  const attentionDeliveries = Array.isArray(projection.attention_deliveries) ? projection.attention_deliveries.map(normalizeAttentionDelivery) : [];
  const policyVersion = text(projection.policy_version, 100);
  const generatedAt = timestamp(projection.generated_at);
  const nextWakeupAt = projection.next_wakeup_at === null ? null : timestamp(projection.next_wakeup_at);
  if (!goals || goals.some(item => item === null) || goals.length > 32
    || !opportunities || opportunities.some(item => item === null) || opportunities.length > 200
    || !decisions || decisions.some(item => item === null) || decisions.length > 200
    || !attentionIntents || attentionIntents.some(item => item === null) || attentionIntents.length > 100
    || attentionDeliveries.some(item => item === null) || attentionDeliveries.length > 100
    || !policyVersion || !generatedAt || nextWakeupAt === undefined) return null;
  const normalizedGoals = goals.filter((item): item is L4PreparationGoal => item !== null);
  const normalizedOpportunities = opportunities.filter((item): item is L4PreparationOpportunity => item !== null);
  const normalizedDecisions = decisions.filter((item): item is L4PreparationDecision => item !== null);
  const normalizedAttentionIntents = attentionIntents.filter((item): item is L4AttentionIntent => item !== null);
  if (normalizedGoals.length !== goals.length || normalizedGoals.length > 32
    || normalizedOpportunities.length !== opportunities.length || normalizedOpportunities.length > 200
    || normalizedDecisions.length !== decisions.length || normalizedDecisions.length > 200
    || normalizedAttentionIntents.length !== attentionIntents.length || normalizedAttentionIntents.length > 100) return null;
  const normalizedAttentionDeliveries = attentionDeliveries.filter((item): item is L4AttentionDelivery => item !== null);
  if (normalizedAttentionDeliveries.length !== attentionDeliveries.length || normalizedAttentionDeliveries.length > 100) return null;
  return {
    version: 1,
    policyVersion,
    generatedAt,
    goals: normalizedGoals,
    opportunities: normalizedOpportunities,
    decisions: normalizedDecisions,
    nextWakeupAt,
    attentionIntents: normalizedAttentionIntents,
    attentionDeliveries: normalizedAttentionDeliveries,
    externalSend: false,
  };
}

const STATUS_LABELS: Record<string, string> = {
  prepare: "自动准备中",
  update: "自动更新中",
  already_ready: "已准备好",
  missing_material: "缺少材料",
  source_withdrawn: "材料已撤回",
  teacher_rejected: "已拒绝",
  teacher_snoozed: "已安排稍后",
  teacher_held: "已暂缓",
  before_prepare_window: "未到准备时间",
  goal_paused: "目标已暂停",
  goal_revoked: "目标已撤销",
  goal_expired: "目标已过期",
};

function statusLabel(opportunity: L4PreparationOpportunity): string {
  return opportunity.expectedSatisfied ? "已准备好" : STATUS_LABELS[opportunity.reason] || "等待处理";
}

function summaryItem(opportunity: L4PreparationOpportunity, goals: Map<string, L4PreparationGoal>): L4PreparationSummaryItem {
  return {
    workCaseId: opportunity.workCaseId,
    title: goals.get(opportunity.goalId)?.text || "课程准备",
    statusLabel: statusLabel(opportunity),
    nextWakeupAt: opportunity.nextWakeupAt,
  };
}

export function summarizeL4Preparation(value: L4Preparation | null): L4PreparationSummary {
  if (!value) return { ready: [], running: [], attention: [], nextWakeupAt: null };
  const goals = new Map(value.goals.map(goal => [goal.id, goal]));
  const attentionIds = new Set(value.attentionIntents.map(intent => intent.opportunityId));
  const ready: L4PreparationSummaryItem[] = [];
  const running: L4PreparationSummaryItem[] = [];
  const attention: L4PreparationSummaryItem[] = [];
  for (const opportunity of value.opportunities) {
    const item = summaryItem(opportunity, goals);
    if (attentionIds.has(opportunity.opportunityId)) attention.push(item);
    else if (opportunity.expectedSatisfied) ready.push(item);
    else if (opportunity.action === "act") running.push(item);
  }
  return { ready, running, attention, nextWakeupAt: value.nextWakeupAt };
}
