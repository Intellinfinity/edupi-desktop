"use client";
import { useCallback, useEffect, useState } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import { buildMaterialRows } from "@/lib/edupi-material-rows";
import { openPathNative } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";

type Job = { job_id: string; title: string; status: string; attempt_count?: number; error?: string; progress?: { phase: string; message: string; updated_at: string }; artifacts?: Array<{ relative_path: string }> };
const labels: Record<string, string> = { queued: "排队中", running: "处理中", completed: "已完成", failed: "失败", canceled: "已取消" };

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
  const error = job.status === "failed" && job.error ? ` · ${job.error}` : "";
  return `${labels[job.status] || job.status}${attempt}${progress}${error}`;
}

export function EduPiBackgroundJobs({ data, onMaterials }: { data: EducationContract | null; onMaterials: () => void }) {
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
    <div className="edupi-admin-list">{jobs.map(job => <div key={job.job_id}><span><strong>{job.title}</strong><small>{backgroundJobStatusText(job)}</small></span>{["queued", "running"].includes(job.status) ? <button disabled={busy} onClick={() => void action({ action: "cancel", jobId: job.job_id })}>取消</button> : ["failed", "canceled"].includes(job.status) ? <button disabled={busy} onClick={() => void action({ action: "retry", jobId: job.job_id })}>重试</button> : job.artifacts?.length && data && isTauriDesktop() ? <div className="edupi-background-job-artifacts">{job.artifacts.map((file, index) => <button type="button" key={file.relative_path} onClick={() => void openPathNative(workspaceFile(data.workspace, file.relative_path)).catch(() => setError("文件打开失败"))}>{artifactLabel(file.relative_path, index)}</button>)}</div> : <button onClick={onMaterials}>查看产物</button>}</div>)}{jobs.length === 0 ? <div>暂无后台任务</div> : null}</div>
  </section>;
}
