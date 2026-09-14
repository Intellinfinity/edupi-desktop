"use client";

import type { EduPiOperationHistoryRow } from "@/lib/edupi-operation-history";

const statusLabels: Record<string, string> = { accepted: "已写入", modified: "已更新", imported: "已写入", failed: "失败", stale_snapshot: "数据已变化" };

function time(value: string | null): string {
  if (!value) return "时间未记录";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN");
}

export function EduPiOperationHistory({ rows }: { rows: EduPiOperationHistoryRow[] }) {
  if (rows.length === 0) return null;
  return <details className="edupi-operation-history"><summary>操作历史 <span>{rows.length}</span></summary><ol>{rows.map((row) => <li key={row.id}><div><strong>{row.action}</strong><span>{statusLabels[row.status] || row.status}</span></div><time>{time(row.at)}</time>{row.note ? <p>{row.note}</p> : null}</li>)}</ol></details>;
}
