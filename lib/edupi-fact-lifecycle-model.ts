import type { EducationFact, EducationFactSpine } from "./edupi-education-contract";
import type { InsightCategoryId, InsightStatusId } from "./edupi-domain-navigation";

export const FACT_REVIEW_DECISIONS = ["accept", "reject", "hold"] as const;
export type FactReviewDecision = typeof FACT_REVIEW_DECISIONS[number];
export type FactLifecycleAction = "review" | "modify" | "delete" | "restore";

export type FactMutationInput =
  | { action: "review"; expectedRevision: number; decision: FactReviewDecision; reviewer: string; note: string | null; supersedesFactId: string | null; supersedesFactRevision: number | null }
  | { action: "modify"; expectedRevision: number; replacementValue: string; reviewer: string; note: string | null }
  | { action: "delete"; expectedRevision: number; reviewer: string }
  | { action: "restore"; expectedRevision: number; reviewer: string; supersedesFactId: string | null; supersedesFactRevision: number | null };

export type FactMutationReceipt = {
  requestId: string;
  action: FactLifecycleAction;
  factId: string;
  resultFactId: string;
  revision: number;
  status: "candidate" | "pending_review" | "held" | "accepted" | "rejected" | "stale" | "superseded" | "deleted";
  supersededFactId: string | null;
  replayed: boolean;
  externalSend: false;
};

export type DeletedEducationFact = {
  factId: string;
  entityId: string;
  kind: EducationFact["kind"];
  predicate: string;
  value: string;
  subjectRef: string | null;
  topicRef: string | null;
  sourceIds: string[];
  sourceCount: number;
  observationIds: string[];
  observationCount: number;
  restoreConflicts: Array<{ factId: string; revision: number; externalSend: false }>;
  restoreConflictCount: number;
  restoreMode: "direct" | "replace" | "pending_review" | "blocked";
  status: "deleted";
  deletedPreviousStatus: FactMutationReceipt["status"];
  revision: number;
  deletedAt: string;
  externalSend: false;
};

export type DeletedEducationFactPage = {
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  facts: DeletedEducationFact[];
  externalSend: false;
};

export const FACT_KIND_LABELS: Record<EducationFact["kind"], string> = {
  error_pattern: "错因模式",
  progress: "学习进展",
  behavior: "行为观察",
  general: "一般事实",
  safety: "安全",
  academic: "学业",
  material: "材料事实",
  evidence: "证据",
};

export function factStatusLabel(status: FactMutationReceipt["status"]): string {
  return { candidate: "待确认", pending_review: "待确认", held: "已暂缓", accepted: "已确认", rejected: "已拒绝", stale: "已失效", superseded: "已取代", deleted: "已删除" }[status];
}

export function factInsightCategory(fact: Pick<EducationFact, "kind" | "value" | "predicate">): InsightCategoryId {
  if (fact.kind === "error_pattern" || fact.kind === "progress" || fact.kind === "academic") return "learning";
  if (fact.kind === "behavior" || fact.kind === "safety") return "class";
  if (fact.kind === "material" || fact.kind === "evidence") return "teaching";
  const content = `${fact.value} ${fact.predicate}`;
  if (/学生|学习|错因|掌握|成绩|学情/u.test(content)) return "learning";
  if (/班级|安全|家长|家校|纪律|活动/u.test(content)) return "class";
  if (/教学|课程|课堂|材料|备课|作业/u.test(content)) return "teaching";
  return "edupi";
}

export function factInsightStatus(fact: Pick<EducationFact, "status">): InsightStatusId {
  if (fact.status === "accepted") return "fact_confirmed";
  if (fact.status === "held") return "fact_held";
  return "fact_pending";
}

export function conflictingAcceptedFacts(fact: EducationFact, spine: EducationFactSpine): EducationFact[] {
  const conflictIds = new Set(fact.conflictIds);
  const related = new Set(spine.conflicts.filter((conflict) => conflictIds.has(conflict.id)).flatMap((conflict) => conflict.factIds));
  return spine.acceptedFacts.filter((candidate) => candidate.id !== fact.id && related.has(candidate.id));
}

export function conflictingAcceptedFact(fact: EducationFact, spine: EducationFactSpine): EducationFact | null {
  const matches = conflictingAcceptedFacts(fact, spine);
  return matches.length === 1 ? matches[0] : null;
}
