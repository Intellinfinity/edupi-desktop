"use client";
import { useCallback, useEffect, useState } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import { buildMaterialRows } from "@/lib/edupi-material-rows";
import { openPathNative } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";

type Job = { job_id: string; title: string; status: string; attempt_count?: number; error?: string | null; progress?: { phase: string; message: string; updated_at: string }; artifacts?: Array<{ relative_path: string }> };
type BackgroundJobRecovery = { label: string; target: "retry" | "models" | "materials" };
const labels: Record<string, string> = { queued: "排队中", running: "处理中", completed: "已完成", failed: "失败", canceled: "已取消" };
const failureLabels: Record<string, string> = {
  lease_expired: "任务中断，自动恢复次数已用完",
  model_unavailable: "默认模型不可用",
  model_error: "模型处理失败",
  source_unavailable: "缺少可用材料",
  excerpt_unconfirmed: "材料正文待确认",
  stale_source: "课程或材料已变化",
  timeout: "处理超时",
  deadline_exceeded: "处理超时",
  "执行未完成，请重试": "处理未完成",
};

function InfoIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
}

function workspaceFile(workspace: string, relativePath: string): string {
  const separator = workspace.includes("\\") ? "\\" : "/";
  return `${workspace.replace(/[\\/]$/, "")}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

function artifactLabel(relativePath: string, index: number): string {
  return relativePath.split(/[\\/]/).filter(Boolean).at(-1) || `产物 ${index + 1}`;
}

export function backgroundJobStatusText(job: Pick<Job, "status" | "attempt_count" | "error" | "progress">) {
  const attempt = job.status === "running" && (job.attempt_count || 0) > 1 ? ` · 第${job.attempt_count}次尝试` : "";
  const progress = ["queued", "running"].includes(job.status) && job.progress?.message ? ` · ${job.progress.message}` : "";
  const error = job.status === "failed" ? ` · ${failureLabels[job.error || ""] || "处理未完成"}` : "";
  return `${labels[job.status] || job.status}${attempt}${progress}${error}`;
}

export function backgroundJobRecovery(job: Pick<Job, "status" | "error">): BackgroundJobRecovery | null {
  if (job.status === "canceled") return { label: "重新开始", target: "retry" };
  if (job.status !== "failed") return null;
  if (job.error === "model_unavailable" || job.error === "model_error") return { label: "配置模型", target: "models" };
  if (job.error === "source_unavailable" || job.error === "excerpt_unconfirmed" || job.error === "stale_source") return { label: "检查材料", target: "materials" };
  return { label: "重试", target: "retry" };
}

export function backgroundJobTechnicalDetail(error: string | null | undefined): string | null {
  const value = error?.trim();
  return value ? value.slice(0, 240) : null;
}

export function EduPiBackgroundJobs({ data, onMaterials, onModels }: { data: EducationContract | null; onMaterials: () => void; onModels: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [kind, setKind] = useState("document");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/edupi/jobs", { cache: "no-store" });
    if (!response.ok) throw new Error("后台任务暂不可用");
    const result = await response.json(); setJobs(result.projection.jobs);
  }, []);
  useEffect(() => {
    let alive = true;
    const refresh = () => { if (alive && !document.hidden) void load().catch(error => { if (alive) setError(error.message); }); };
    refresh(); const timer = window.setInterval(refresh, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [load]);
  const action = async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/edupi/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "操作失败");
      setCreating(false); await load();
    } catch (error) { setError(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  };
  const recover = (job: Job) => {
    const recovery = backgroundJobRecovery(job);
    if (!recovery) return;
    if (recovery.target === "models") onModels();
    else if (recovery.target === "materials") onMaterials();
    else void action({ action: "retry", jobId: job.job_id });
  };
  return <section aria-label="后台文档任务">
    <header style={{ display: "flex", justifyContent: "space-between", margin: "20px 0 12px" }}><h2>后台任务</h2><button className="native-button" onClick={() => setCreating(value => !value)}>新建任务</button></header>
    {creating ? <form style={{ display: "grid", gap: 10 }} onSubmit={event => { event.preventDefault(); void action({ action: "enqueue", title, kind, instructions: `${instructions}${source ? `\n材料文件：${source}` : ""}` }); }}>
      <label>类型<select value={kind} onChange={event => setKind(event.target.value)}><option value="document">整理文档</option><option value="ocr">图片识别</option><option value="ppt">制作课件</option><option value="long_task">其他任务</option></select></label>
      <label>任务名称<input required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>材料<select value={source} onChange={event => setSource(event.target.value)}><option value="">不指定材料</option>{data ? buildMaterialRows(data).filter(item => item.filePath).map(item => <option key={item.id} value={item.filePath!}>{item.title}</option>) : null}</select></label>
      <label>处理要求<textarea required rows={3} maxLength={10000} value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
      <button className="native-button" disabled={busy} type="submit">{busy ? "提交中…" : "开始处理"}</button>
    </form> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="edupi-admin-list">{jobs.map(job => { const recovery = backgroundJobRecovery(job); const technicalDetail = job.status === "failed" ? backgroundJobTechnicalDetail(job.error) : null; return <div className="edupi-background-job-row" key={job.job_id}><span><strong>{job.title}</strong><small>{backgroundJobStatusText(job)}</small></span><div className="edupi-background-job-actions">{technicalDetail ? <details className="edupi-background-job-details"><summary aria-label={`查看“${job.title}”技术详情`} title="技术详情"><InfoIcon /></summary><code>{technicalDetail}</code></details> : null}{["queued", "running"].includes(job.status) ? <button type="button" disabled={busy} onClick={() => void action({ action: "cancel", jobId: job.job_id })}>取消</button> : recovery ? <button type="button" disabled={busy} onClick={() => recover(job)}>{recovery.label}</button> : job.artifacts?.length && data && isTauriDesktop() ? <div className="edupi-background-job-artifacts">{job.artifacts.map((file, index) => <button type="button" key={file.relative_path} onClick={() => void openPathNative(workspaceFile(data.workspace, file.relative_path)).catch(() => setError("文件打开失败"))}>{artifactLabel(file.relative_path, index)}</button>)}</div> : <button type="button" onClick={onMaterials}>查看产物</button>}</div></div>; })}{jobs.length === 0 ? <div>暂无后台任务</div> : null}</div>
  </section>;
}
