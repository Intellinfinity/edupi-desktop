"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  EducationC1Receipt,
  EducationContract,
  EducationMemoryCandidate,
  EducationObservation,
} from "@/lib/edupi-education-contract";

type ReviewDecision = "accept" | "modify" | "reject" | "hold";
type ReviewTargetKind = "observation" | "memory_candidate";

type Props = {
  data: EducationContract;
  reviewerId: string;
  onRefresh: () => Promise<EducationContract | void>;
  query?: string;
  selectedTarget?: { kind: ReviewTargetKind; id: string } | null;
};

type ReviewTarget =
  | { kind: "observation"; item: EducationObservation; id: string }
  | { kind: "memory_candidate"; item: EducationMemoryCandidate; id: string };

type ReceiptResult = {
  receipt?: unknown;
  data?: EducationContract;
  error?: string;
  reason?: string;
};

type ReceiptSummary = Pick<EducationC1Receipt, "receiptId" | "commandType" | "decision" | "status" | "externalSend" | "afterSnapshotId">;

const commandFor: Record<ReviewTargetKind, "review_observation" | "review_memory_candidate"> = {
  observation: "review_observation",
  memory_candidate: "review_memory_candidate",
};

const decisionLabels: Record<ReviewDecision, string> = {
  accept: "接受",
  modify: "修改",
  reject: "拒绝",
  hold: "暂缓",
};

function isPending(state: EducationObservation["teacherReview"]["state"]): boolean {
  return state === "pending_review" || state === "held";
}

function includesQuery(value: string, query: string): boolean {
  return !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function reviewStateLabel(value: EducationObservation["teacherReview"]["state"]): string {
  return {
    pending_review: "待确认",
    held: "已暂缓",
    accepted: "已接受",
    modified: "已修改",
    rejected: "已拒绝",
    not_required: "无需确认",
  }[value];
}

function uncertaintyLabel(target: ReviewTarget): string {
  return target.kind === "memory_candidate" ? "尚未确认" : "待确认";
}

function boundaryLabel(target: ReviewTarget): string {
  return target.kind === "memory_candidate"
    ? "候选内容不会自动进入正式记忆，不会外发。"
    : "教师观察仅作为内部事实候选，需确认后才能沉淀，不会外发。";
}

function safeText(value: unknown, fallback = "待补充"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sourceLabel(target: ReviewTarget): string {
  if (target.kind === "observation") {
    const teacherMessage = target.item.provenance.find((entry) => entry.sourceKind === "teacher_message");
    return safeText(teacherMessage?.sourceId, "教师消息");
  }
  return target.item.basedOnObservationIds.length > 0
    ? `观察 ${target.item.basedOnObservationIds.slice(0, 3).join("、")}`
    : "观察来源待补";
}

function evidenceLabel(target: ReviewTarget): string {
  const count = target.item.evidenceIds.length;
  return count > 0 ? `${count} 条证据` : "证据待补";
}

function targetTitle(target: ReviewTarget): string {
  return target.kind === "observation" ? target.item.text : target.item.proposedContent;
}

function targetTypeLabel(target: ReviewTarget): string {
  return target.kind === "observation" ? "教师观察" : "记忆候选";
}

function receiptRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function trustedReceipt(value: unknown, target: ReviewTarget): value is Record<string, unknown> {
  const receipt = receiptRecord(value);
  const receiptTarget = receiptRecord(receipt?.target);
  const commandType = commandFor[target.kind];
  return Boolean(
    receipt
      && typeof receipt.receipt_id === "string"
      && receipt.receipt_id.trim()
      && receipt.command_type === commandType
      && receiptTarget?.target_kind === target.kind
      && receiptTarget.target_id === target.id
      && receiptTarget.command_type === commandType
      && receipt.external_send === false
      && receipt.status !== "failed"
      && typeof receipt.after_snapshot_id === "string"
      && receipt.after_snapshot_id.trim(),
  );
}

function normalizeReceipt(value: Record<string, unknown>): ReceiptSummary {
  return {
    receiptId: safeText(value.receipt_id, "回执"),
    commandType: safeText(value.command_type),
    decision: typeof value.decision === "string" ? value.decision : null,
    status: safeText(value.status),
    externalSend: false,
    afterSnapshotId: typeof value.after_snapshot_id === "string" ? value.after_snapshot_id : null,
  };
}

function receiptLabel(receipt: ReceiptSummary): string {
  return `${receipt.receiptId} · ${receipt.decision || receipt.status}`;
}

function targetKey(target: ReviewTarget): string {
  return `${target.kind}:${target.id}`;
}

function pendingTarget(target: ReviewTarget): boolean {
  return isPending(target.item.teacherReview.state);
}

function ReviewCard({
  target,
  capabilityEnabled,
  supportedCommands,
  supportedActions,
  busy,
  editing,
  draft,
  error,
  onDecision,
  onDraft,
  onCancelEdit,
}: {
  target: ReviewTarget;
  capabilityEnabled: boolean;
  supportedCommands: readonly string[];
  supportedActions: readonly ReviewDecision[];
  busy: ReviewDecision | null;
  editing: boolean;
  draft: string;
  error: string | null;
  onDecision: (decision: ReviewDecision) => void;
  onDraft: (value: string) => void;
  onCancelEdit: () => void;
}) {
  const commandType = commandFor[target.kind];
  const canReview = capabilityEnabled && supportedCommands.includes(commandType);
  const status = target.item.teacherReview.state;
  const content = targetTitle(target);
  const recordedAt = target.kind === "observation" ? target.item.observedAt : target.item.teacherReview.reviewedAt;
  const canSubmitEdit = draft.trim().length > 0;
  return (
    <article className="edupi-c1-review-card" id={`edupi-c1-review-${target.kind}-${target.id}`}>
      <div className="edupi-c1-review-card__header">
        <div className="edupi-c1-review-card__badges">
          <span className="edupi-c1-review-card__type">{targetTypeLabel(target)}</span>
          <span className="edupi-c1-review-card__uncertainty">{uncertaintyLabel(target)}</span>
          <span className="edupi-c1-review-card__status">{reviewStateLabel(status)}</span>
        </div>
        <span className="edupi-c1-review-card__scope">教师内部 · 不外发</span>
      </div>

      {editing ? (
        <label className="edupi-c1-review-card__editor">
          <span>修改内容</span>
          <textarea value={draft} onChange={(event) => onDraft(event.target.value)} rows={3} autoFocus />
        </label>
      ) : (
        <h2>{content}</h2>
      )}

      <div className="edupi-c1-review-card__meta">
        <span><small>来源</small><strong>{sourceLabel(target)}</strong></span>
        <span><small>证据</small><strong>{evidenceLabel(target)}</strong></span>
        <span><small>记录于</small><strong>{recordedAt ? dateLabel(recordedAt) : "待确认"}</strong></span>
      </div>

      <details className="edupi-c1-review-card__evidence">
        <summary>来源与边界</summary>
        <div>
          <p>{target.kind === "observation" ? `观察内容：${content}` : `基于观察：${target.item.basedOnObservationIds.join("、") || "待补"}`}</p>
          <p>证据：{target.item.evidenceIds.join("、") || "待补"}</p>
          <p>{boundaryLabel(target)}</p>
        </div>
      </details>

      <div className="edupi-c1-review-card__actions" aria-label={`${targetTypeLabel(target)}审核动作`}>
        {editing ? (
          <>
            <button type="button" className="is-primary" disabled={!canReview || busy !== null || !canSubmitEdit} onClick={() => onDecision("modify")}>
              {busy === "modify" ? "处理中…" : "保存修改"}
            </button>
            <button type="button" className="is-quiet" disabled={busy !== null} onClick={onCancelEdit}>取消</button>
          </>
        ) : (
          (Object.keys(decisionLabels) as ReviewDecision[]).map((decision) => (
            <button
              type="button"
              key={decision}
              className={decision === "accept" ? "is-primary" : decision === "reject" ? "is-danger" : ""}
              disabled={!canReview || !supportedActions.includes(decision) || busy !== null}
              onClick={() => onDecision(decision)}
            >
              {busy === decision ? "处理中…" : decisionLabels[decision]}
            </button>
          ))
        )}
      </div>
      {!canReview ? <p className="edupi-c1-review-card__disabled" role="status">当前只读。</p> : null}
      {error ? <p className="edupi-c1-review-card__error" role="alert">{error}</p> : null}
    </article>
  );
}

export function EduPiC1Review({ data, reviewerId, onRefresh, query = "", selectedTarget = null }: Props) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busyDecision, setBusyDecision] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptSummary | null>(null);

  const targets = useMemo<ReviewTarget[]>(() => [
    ...data.observations.filter((item) => pendingTarget({ kind: "observation", item, id: item.observationId }) && includesQuery(`${item.text} ${item.observationId} ${item.evidenceIds.join(" ")}`, query)).map((item) => ({ kind: "observation" as const, item, id: item.observationId })),
    ...data.memoryCandidates.filter((item) => item.teacherReview.state !== "rejected" && pendingTarget({ kind: "memory_candidate", item, id: item.candidateId }) && includesQuery(`${item.proposedContent} ${item.candidateId} ${item.tags.join(" ")}`, query)).map((item) => ({ kind: "memory_candidate" as const, item, id: item.candidateId })),
  ], [data.memoryCandidates, data.observations, query]);

  useEffect(() => {
    if (editingKey && !targets.some((target) => targetKey(target) === editingKey)) {
      setEditingKey(null);
      setDraft("");
    }
  }, [editingKey, targets]);

  const startEdit = (target: ReviewTarget) => {
    setError(null);
    setErrorKey(null);
    setReceipt(null);
    setEditingKey(targetKey(target));
    setDraft(targetTitle(target));
  };

  const handleDecision = async (target: ReviewTarget, decision: ReviewDecision) => {
    const commandType = commandFor[target.kind];
    const capability = data.capabilities.c1Review;
    if (decision === "modify" && editingKey !== targetKey(target)) {
      startEdit(target);
      return;
    }
    if (!capability.enabled || !capability.commands.includes(commandType) || !capability.actions.includes(decision)) return;
    const patch = decision === "modify"
      ? target.kind === "observation" ? { text: draft.trim() } : { proposed_content: draft.trim() }
      : null;
    if (decision === "modify" && !draft.trim()) return;
    const key = targetKey(target);
    setBusyKey(key);
    setBusyDecision(decision);
    setError(null);
    setErrorKey(null);
    setReceipt(null);
    try {
      const response = await fetch("/api/edupi/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetKind: target.kind,
          targetId: target.id,
          decision,
          patch,
          reviewerId: reviewerId.trim() || "teacher",
          externalSend: false,
        }),
      });
      let result: ReceiptResult = {};
      try {
        result = await response.json() as ReceiptResult;
      } catch {
        result = {};
      }
      if (!response.ok) throw new Error(result.reason || result.error || `审核失败（HTTP ${response.status}）`);
      if (!trustedReceipt(result.receipt, target)) throw new Error("未收到可信审核回执，列表保持不变。");
      setReceipt(normalizeReceipt(result.receipt));
      await onRefresh();
      setErrorKey(null);
      setEditingKey(null);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setErrorKey(key);
    } finally {
      setBusyKey(null);
      setBusyDecision(null);
    }
  };

  const activeMemoryIds = new Set(data.c1Memories.filter((memory) => memory.state === "active").map((memory) => memory.memoryId));
  const activeMemoryCount = activeMemoryIds.size;
  const latestReceipts = data.receipts.slice(-3).reverse();
  const latestHistory = data.reviewHistory.slice(-3).reverse();
  const reviewCapability = data.capabilities.c1Review;
  const visibleTarget = selectedTarget
    ? targets.find((target) => target.kind === selectedTarget.kind && target.id === selectedTarget.id) || null
    : targets[0] || null;

  return (
    <main className="edupi-c1-review" aria-labelledby="edupi-c1-review-title">
      <header className="edupi-c1-review__heading">
        <div>
          <span className="edupi-c1-review__eyebrow">审核队列</span>
          <h1 id="edupi-c1-review-title">待我确认</h1>
          <p>{targets.length} 项待判断 · {activeMemoryCount} 条正式记忆</p>
        </div>
        <span className={`edupi-c1-review__capability${reviewCapability.enabled ? " is-enabled" : ""}`} title={reviewCapability.reason}>
          {reviewCapability.enabled ? "可审核" : "只读"}
        </span>
      </header>

      {visibleTarget ? (
        <section className="edupi-c1-review__queue" aria-label="待确认队列">
            <ReviewCard
              key={targetKey(visibleTarget)}
              target={visibleTarget}
              capabilityEnabled={reviewCapability.enabled}
              supportedCommands={reviewCapability.commands}
              supportedActions={reviewCapability.actions}
              busy={busyKey === targetKey(visibleTarget) ? busyDecision : null}
              editing={editingKey === targetKey(visibleTarget)}
              draft={draft}
              error={errorKey === targetKey(visibleTarget) ? error : null}
              onDecision={(decision) => decision === "modify" && editingKey !== targetKey(visibleTarget) ? startEdit(visibleTarget) : void handleDecision(visibleTarget, decision)}
              onDraft={setDraft}
              onCancelEdit={() => { setEditingKey(null); setDraft(""); setError(null); setErrorKey(null); }}
            />
        </section>
      ) : (
        <section className="edupi-c1-review__empty" role="status">
          <strong>暂无新的待确认内容</strong>
          <span>教师观察或记忆候选出现后，会先在这里等你确认。</span>
        </section>
      )}

      {receipt ? (
        <section className="edupi-c1-review__receipt" role="status">
          <span>✓ 已记录回执</span>
          <strong>{receiptLabel(receipt)}</strong>
          <small>已刷新队列与正式记忆 · 外发关闭</small>
        </section>
      ) : null}

      {latestReceipts.length > 0 || latestHistory.length > 0 ? (
        <details className="edupi-c1-review__history">
          <summary>最近回执与审核记录（{data.receipts.length + data.reviewHistory.length}）</summary>
          <div>
            {latestReceipts.map((item) => <p key={`receipt:${item.receiptId}`}>回执 {receiptLabel(item)} · {item.externalSend === false ? "不外发" : "边界异常"}</p>)}
            {latestHistory.map((item) => <p key={`history:${item.reviewId}`}>{item.decision} · {item.status} · {item.target?.targetId || "目标待补"} · {item.externalSend === false ? "不外发" : "边界异常"}</p>)}
          </div>
        </details>
      ) : null}
    </main>
  );
}
