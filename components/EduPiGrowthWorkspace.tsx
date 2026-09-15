"use client";

import { useMemo, useState, type ReactNode } from "react";

import type { EducationContract, TeacherTask } from "@/lib/edupi-education-contract";
import { routePart } from "@/lib/edupi-domain-navigation";
import type { EduPiTeachingMethodAction, EduPiTeachingSkill, EduPiTeachingSkillLifecycle } from "@/lib/edupi-platform-client";
import { confirmedTaskArtifacts, taskDisplayTitle } from "@/lib/edupi-workbench";
import { EduPiTeachingMethodEditor } from "./EduPiTeachingMethodEditor";

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const METHOD_STATE_LABELS: Record<string, string> = { draft: "草稿", trial: "试用中", validated: "已验证", published: "已发布", retired: "已停用" };
const METHOD_ACTION_LABELS: Partial<Record<EduPiTeachingMethodAction, string>> = { update: "修订", record_trial: "记录试用", validate: "验证", publish: "发布", retire: "停用" };
const OUTCOME_LABELS: Record<string, string> = { helpful: "有效", mixed: "部分有效", not_helpful: "未达到预期" };

type ActiveEditor = { methodId: string | null; mode: Exclude<EduPiTeachingMethodAction, "create"> | "create" };

function savedMessageForAction(action: ActiveEditor["mode"]): string {
  if (action === "record_trial") return "试用反馈已保存";
  if (action === "validate") return "验证结果已保存";
  if (action === "publish") return "方法已发布";
  if (action === "retire") return "方法已停用";
  return "方法已修订";
}

export function EduPiGrowthWorkspace({ data, teachingSkills, query, selectedObjectId, onOpenFile, onTask, onStartAgent, onTeachingSkills }: { data: EducationContract; teachingSkills: EduPiTeachingSkillLifecycle; query: string; selectedObjectId: string | null; onOpenFile: (path: string) => void; onTask: (task: TeacherTask) => void; onStartAgent: (prompt: string, mode?: "insert" | "replace") => void; onTeachingSkills: (lifecycle: EduPiTeachingSkillLifecycle) => void }) {
  const category = routePart(selectedObjectId, "growth", "teacher");
  const [editor, setEditor] = useState<ActiveEditor | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const normalizedQuery = query.toLocaleLowerCase();
  const documents = data.continuity.documents.filter((item) => item.kind === "weekly" && (!query || `${item.title} ${item.excerpt}`.toLocaleLowerCase().includes(normalizedQuery)));
  const artifacts = confirmedTaskArtifacts(data.tasks, query);
  const skills = teachingSkills.skills.filter((item) => !query || `${item.title} ${METHOD_STATE_LABELS[item.lifecycleState] || item.lifecycleState} ${item.details?.content || ""}`.toLocaleLowerCase().includes(normalizedQuery));
  const growth = teachingSkills.teacherGrowth.filter((item) => !query || `${item.methodTitle} ${item.taskTitle} ${item.feedback} ${OUTCOME_LABELS[item.outcome]}`.toLocaleLowerCase().includes(normalizedQuery));
  const growthSource = data.dataSources.growth;
  const tasksById = useMemo(() => new Map(data.tasks.flatMap((task) => task.id ? [[task.id, task] as const] : [])), [data.tasks]);
  const workspaceFile = (relative: string) => {
    const separator = data.workspace.includes("\\") ? "\\" : "/";
    return `${data.workspace.replace(/[\\/]$/, "")}${separator}${relative.replace(/^[\\/]+/, "").replace(/[\\/]/g, separator)}`;
  };
  const saved = (next: EduPiTeachingSkillLifecycle, message: string) => {
    onTeachingSkills(next);
    setEditor(null);
    setSavedMessage(message);
  };
  const edit = (method: EduPiTeachingSkill, mode: Exclude<EduPiTeachingMethodAction, "create">) => {
    setSavedMessage("");
    setEditor({ methodId: method.skillId, mode });
  };
  const headingTitle = category === "teacher" ? "教师专业成长" : "EduPi 能力成长";
  let headingDescription = "教学方法从试用到后续备课复用的记录";
  if (category === "teacher") headingDescription = "真实教学实践、反馈与改进记录";
  else if (teachingSkills.status === "unavailable") headingDescription = "教学方法暂不可用";
  let headingAction: ReactNode = null;
  if (category === "teacher") headingAction = <button type="button" onClick={() => onStartAgent("请根据我填写的课堂经历整理教学复盘，保存到 .edupi/output/weekly/，不要编造课堂效果。\n\n本次教学与效果（在这里填写）：", "replace")}>记录复盘</button>;
  else if (teachingSkills.mutationEnabled) headingAction = <button type="button" onClick={() => { setSavedMessage(""); setEditor((current) => current?.mode === "create" ? null : { methodId: null, mode: "create" }); }}>新增教学方法</button>;

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><h1>{headingTitle}</h1><p>{headingDescription}</p></div>{headingAction}</header>
    {category !== "teacher" && savedMessage ? <p className="edupi-method-status" role="status">{savedMessage}</p> : null}
    {category !== "teacher" && !teachingSkills.mutationEnabled ? <p className="edupi-method-status">旧方法仍可查看，当前版本不能修改。</p> : null}
    {category !== "teacher" && editor?.mode === "create" ? <EduPiTeachingMethodEditor key="create" mode="create" mutationEnabled={teachingSkills.mutationEnabled} onSaved={(next) => saved(next, "方法已保存为草稿")} onCancel={() => setEditor(null)} /> : null}

    {category === "teacher" ? <section className="edupi-database">
      <div className="edupi-database__head edupi-growth-db-grid"><span>类型</span><span>内容</span><span>来源</span><span>日期</span><span>动作</span></div>
      {growth.map((item) => {
        const task = tasksById.get(item.taskId);
        return <div className="edupi-database-static-row edupi-growth-db-grid" key={item.growthId}><span>方法试用</span><strong>{item.feedback}</strong><span>{item.methodTitle} · {item.taskTitle} · {OUTCOME_LABELS[item.outcome]}</span><time>{shortDate(item.recordedAt)}</time>{task ? <button type="button" onClick={() => onTask(task)}>查看任务</button> : <span>任务已归档</span>}</div>;
      })}
      {documents.map((item) => <div className="edupi-database-static-row edupi-growth-db-grid" key={item.id}><span>周复盘</span><strong>{item.title}</strong><span>工作沉淀</span><time>{shortDate(item.date)}</time><button type="button" onClick={() => onOpenFile(workspaceFile(item.path))}>打开</button></div>)}
      {artifacts.map(({ task, artifact }) => <div className="edupi-database-static-row edupi-growth-db-grid" key={artifact.id}><span>确认成果</span><strong>{artifact.title}</strong><span>{taskDisplayTitle(task)}</span><time>{task.reviewedAt ? shortDate(task.reviewedAt) : "—"}</time><button type="button" onClick={() => onTask(task)}>查看</button></div>)}
      {growth.length + documents.length + artifacts.length === 0 ? <div className="edupi-database__empty">{growthSource.present || teachingSkills.status !== "unavailable" ? "暂无成长记录" : "教师成长数据尚未接入"}</div> : null}
    </section> : <section className="edupi-database">
      <div className="edupi-database__head edupi-edupi-growth-db-grid"><span>教学方法</span><span>状态</span><span>试用</span><span>依据</span><span>最近更新</span></div>
      {skills.map((item) => <details className="edupi-database-row edupi-method-row" key={item.skillId}>
        <summary className="edupi-edupi-growth-db-grid"><strong>{item.title}</strong><span>{METHOD_STATE_LABELS[item.lifecycleState] || item.lifecycleState}</span><span>{item.trialCount}</span><span>{item.evidenceIds.length}</span><time>{shortDate(item.updatedAt)}</time></summary>
        <div className="edupi-method-detail">
          <section><h3>方法正文</h3><p className="edupi-method-content">{item.details?.content || "正文暂不可用"}</p>{item.details?.truncated ? <p>正文只显示了前一部分。</p> : null}</section>
          {item.details?.approval ? <section><h3>教师验证</h3><p>{item.details.approval.status === "accepted" ? "已通过" : "未通过"} · {shortDate(item.details.approval.at)}</p>{item.details.approval.feedback ? <p>{item.details.approval.feedback}</p> : null}</section> : null}
          {item.details?.retirementReason ? <section><h3>停用原因</h3><p>{item.details.retirementReason}</p></section> : null}
          <section><h3>试用记录</h3>{item.details?.trials.length ? item.details.trials.map((trial) => {
            const task = trial.taskId ? tasksById.get(trial.taskId) : null;
            return <div className="edupi-method-trial" key={trial.trialId || `${trial.at}:${trial.taskId}`}><p><strong>{trial.taskTitle || "历史试用"}</strong><span>{shortDate(trial.at)} · {OUTCOME_LABELS[trial.outcome || ""] || trial.outcome || "已记录"}</span></p>{trial.feedback ? <p>{trial.feedback}</p> : null}{task ? <button type="button" onClick={() => onTask(task)}>查看任务</button> : null}</div>;
          }) : <p>暂无试用记录</p>}</section>
          {item.details?.evaluation ? <section><h3>历史评估</h3><p>{item.details.evaluation.eligible ? "符合晋级条件" : "未达到晋级条件"} · {shortDate(item.details.evaluation.at)}</p></section> : null}
          {item.details?.files.length ? <section><h3>相关文件</h3>{item.details.files.map((file) => <button type="button" key={file.relativePath} onClick={() => onOpenFile(workspaceFile(file.relativePath))}>{file.label}</button>)}</section> : null}
          {item.availableActions.length ? <div className="edupi-method-actions">{item.availableActions.filter((action): action is Exclude<EduPiTeachingMethodAction, "create"> => action !== "create").map((action) => <button type="button" className={action === "publish" ? "is-primary" : ""} key={action} onClick={() => edit(item, action)}>{METHOD_ACTION_LABELS[action] || action}</button>)}</div> : <p>{item.origin === "legacy_read_only" ? "历史方法只读保留" : "没有可执行操作"}</p>}
          {editor?.methodId === item.skillId ? <EduPiTeachingMethodEditor key={`${item.skillId}:${editor.mode}:${item.revision}`} mode={editor.mode} method={item} tasks={data.tasks} mutationEnabled={teachingSkills.mutationEnabled} onSaved={(next) => saved(next, savedMessageForAction(editor.mode))} onCancel={() => setEditor(null)} /> : null}
          <details className="edupi-method-technical"><summary>技术信息</summary><p>方法 ID：{item.skillId}</p><p>对象版本：{item.revision ?? "旧记录"} · 正文版本：{item.contentRevision ?? "旧记录"}</p></details>
        </div>
      </details>)}
      {skills.length === 0 ? <div className="edupi-database__empty">{teachingSkills.status === "unavailable" ? "教学方法暂不可用" : "暂无教学方法"}</div> : null}
    </section>}
  </main>;
}
