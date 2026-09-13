"use client";

import { useEffect, useRef, useState } from "react";
import type { EducationContract, TaskReviewAction, TeacherTask } from "@/lib/edupi-education-contract";
import type { EducationModule } from "@/lib/edupi-education-ui";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { stageBrowserMaterialFiles } from "@/lib/edupi-material-staging-client";
import { EduPiCalendarModule } from "./EduPiCalendarModule";
import { EduPiContextEditor } from "./EduPiContextEditor";
import { EduPiMaterialModule } from "./EduPiMaterialModule";
import { EduPiReviewTaskCard } from "./EduPiReviewTaskCard";

type Props = {
  initialModule?: EducationModule;
  materialInboxRequest?: number;
  onRequestMaterialUpload: () => void;
  embedded?: boolean;
};
type MaterialKind = "作业 / 错题" | "课堂记录" | "校历通知";
type Student = Record<string, unknown> & { name: string };

function taskTypeLabel(task: TeacherTask): string {
  if (task.trigger === "teaching_adjustment_candidate") return "教学调整候选";
  if (task.trigger === "student_follow_up") return "学生跟进";
  return "校历准备";
}

function taskId(task: TeacherTask): string {
  return task.id || `${task.trigger}-${task.title}`;
}

function asStudents(data: EducationContract): Student[] {
  return data.students.filter((student): student is Student => typeof student.name === "string");
}

export function EduPiEducationHome({ initialModule = "home", materialInboxRequest = 0, onRequestMaterialUpload, embedded = false }: Props) {
  const [onboarding, setOnboarding] = useState<TeacherContextSnapshot | null>(null);
  const [data, setData] = useState<EducationContract | null>(null);
  const [activeModule, setActiveModule] = useState<EducationModule>(initialModule);
  const [contextEditorOpen, setContextEditorOpen] = useState(initialModule === "context");
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [educationError, setEducationError] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const selectedMaterialKind: MaterialKind = "作业 / 错题";

  useEffect(() => {
    setActiveModule(initialModule);
    setContextEditorOpen(initialModule === "context");
  }, [initialModule]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/edupi/onboarding", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(`引导状态 HTTP ${response.status}`);
        return response.json() as Promise<TeacherContextSnapshot>;
      }),
      fetch("/api/edupi/education", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(`教育数据 HTTP ${response.status}`);
        return response.json() as Promise<EducationContract>;
      }),
    ]).then(([nextOnboarding, nextData]) => {
      setOnboarding(nextOnboarding);
      setData(nextData);
    }).catch((reason) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setEducationError(message);
      setOnboardingError(message);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (materialInboxRequest <= 0) return;
    setUploadMessage(null);
    uploadInputRef.current?.click();
  }, [materialInboxRequest]);

  const tasks = data?.tasks ?? [];
  const upcomingTasks = tasks.slice().sort((left, right) => (left.dueDate || "").localeCompare(right.dueDate || "")).slice(0, 5);
  const pendingTaskCount = tasks.filter((task) => task.status === "planned").length;
  const nextOnboardingItem = onboarding?.checklist.find((item) => item.status === "next");
  const teacherName = onboarding?.name || "老师";
  const setupTitle = onboarding?.configured ? "补齐上下文" : "新手引导";
  const setupDescription = onboarding?.configured
    ? `下一步：${nextOnboardingItem?.label ?? "上传第一份材料"}。`
    : "填写称呼、学科和年级。";

  async function handleContextReviewed(result: { data: EducationContract }): Promise<EducationContract> {
    const response = await fetch("/api/edupi/onboarding", { cache: "no-store" });
    if (!response.ok) throw new Error(`上下文刷新失败（HTTP ${response.status}）`);
    const nextContext = await response.json() as TeacherContextSnapshot;
    setData(result.data);
    setOnboarding(nextContext);
    return result.data;
  }

  function handleDataUpdated(nextData: EducationContract) {
    setData(nextData);
  }

  async function importSelectedMaterials(files: File[]) {
    if (files.length === 0) return;
    const staged = await stageBrowserMaterialFiles(files);
    setUploadMessage(`已安全暂存 ${staged.length} 个文件（${selectedMaterialKind}），等待识别。`);
  }

  function handleMaterialSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    void importSelectedMaterials(files).catch((reason) => setUploadMessage(reason instanceof Error ? reason.message : String(reason)));
  }

  async function reviewTask(task: TeacherTask, action: TaskReviewAction) {
    const id = task.id;
    if (!id || !data?.capabilities.taskReview.enabled) return;
    setReviewBusy(id);
    setReviewMessage(null);
    try {
      const response = await fetch("/api/edupi/education", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: id, action, note: `教师在 EduPi 工作台执行：${action}` }) });
      const result = await response.json() as { error?: string; data?: EducationContract };
      if (!response.ok) throw new Error(result.error || `审核失败（HTTP ${response.status}）`);
      if (result.data) setData(result.data);
      setReviewMessage(`已记录：${action}`);
    } catch (reason) {
      setReviewMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setReviewBusy(null);
    }
  }

  if (!data) return <section className="edupi-education-home"><div className="edupi-education-loading">正在读取 EduPi 教育工作区…</div></section>;

  const currentData = data;
  const students = asStudents(data);
  const hasTaskReview = currentData.capabilities.taskReview.enabled;

  const surfaceClassName = embedded ? "edupi-education-home edupi-education-home--embedded" : "edupi-education-home";
  return <section className={surfaceClassName} aria-label="EduPi 教育工作台">
    <input ref={uploadInputRef} type="file" multiple hidden accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={handleMaterialSelection} />
    {activeModule === "home" ? <header className="edupi-education-home__header">
      <div><div className="edupi-education-home__eyebrow">教师工作区</div><h1>{onboarding?.configured ? `今天先处理什么，${teacherName}？` : "新手引导"}</h1><p>{setupDescription}</p></div>
      <div className="edupi-entry-actions"><button className="edupi-entry-primary" type="button" onClick={() => { setUploadMessage(null); onRequestMaterialUpload(); }}>上传教学材料</button><button className="edupi-entry-secondary" type="button" onClick={() => setActiveModule("tasks")}>下一步：查看待审核（{pendingTaskCount}）</button></div>
    </header> : null}
    {activeModule === "home" ? <><section className="edupi-first-use-card" aria-label="首次使用引导"><div className="edupi-first-use-card__copy"><span className="edupi-section-kicker">FIRST USE</span><h2>{setupTitle}</h2><p>{setupDescription}</p></div><button type="button" className="edupi-entry-primary" onClick={() => { setActiveModule("context"); setContextEditorOpen(true); }}>打开引导</button></section>
    <section className="edupi-entry-guide" aria-label="工作路径"><div className="edupi-entry-guide__title"><strong>使用顺序</strong><span>随时可看</span></div><div className="edupi-entry-steps"><div className="edupi-entry-step"><b>01</b><div><strong>补齐身份</strong><span>称呼、学科、年级。</span></div></div><div className="edupi-entry-step"><b>02</b><div><strong>导入校历</strong><span>学校重要日期。</span></div></div><div className="edupi-entry-step"><b>03</b><div><strong>上传材料</strong><span>作业、错题或课堂记录。</span></div></div></div></section></> : null}
    {uploadMessage ? <div className="edupi-entry-message" role="status">{uploadMessage}</div> : null}
    {activeModule === "home" ? <nav className="edupi-education-nav" aria-label="教育模块">{[["home", "工作台"], ["context", "我的上下文"], ["students", "学生档案"], ["calendar", "课程与校历"], ["materials", "材料与证据"], ["tasks", "待审核任务"]].map(([id, label]) => <button key={id} type="button" className={activeModule === id ? "is-active" : ""} onClick={() => setActiveModule(id as EducationModule)}>{label}</button>)}</nav> : null}
    {activeModule !== "home" ? <div className="edupi-module-nav" aria-label="教育模块快捷导航">{[["home", "工作台"], ["context", "我的上下文"], ["students", "学生档案"], ["calendar", "课程与校历"], ["materials", "材料与证据"], ["tasks", "待审核任务"]].map(([id, label]) => <button key={id} type="button" className={activeModule === id ? "is-active" : ""} onClick={() => setActiveModule(id as EducationModule)}>{label}</button>)}</div> : null}
    {educationError ? <div className="edupi-education-error" role="alert">数据读取失败：{educationError}</div> : null}
    {activeModule === "context" ? (contextEditorOpen ? <EduPiContextEditor initial={onboarding} candidate={data.teacherContextCandidates[0] ?? null} capability={data.capabilities.teacherContextReview} history={data.teacherContextReviewHistory} onReviewed={handleContextReviewed} /> : <section className="edupi-module-view edupi-context-view"><span className="edupi-section-kicker">MY EDUCATION CONTEXT</span><h2>我的教育上下文</h2><p>这是 EduPi 开始工作的基础。你可以随时回来更新，不需要重新开始。</p><div className="edupi-context-summary"><strong>{onboarding?.name || "称呼待设置"}</strong><span>{onboarding?.subject || "学科待设置"} · {onboarding?.grade || "年级待设置"}</span></div><div className="edupi-context-checklist">{(onboarding?.checklist ?? []).map((item) => <div className={`edupi-context-row is-${item.status}`} key={item.id}><span>{item.status === "complete" ? "✓" : item.status === "next" ? "→" : "·"}</span><div><strong>{item.label}</strong><small>{item.description}</small></div><em>{item.status === "complete" ? "已完成" : item.status === "next" ? "下一步" : "可稍后补充"}</em></div>)}</div><button type="button" className="edupi-entry-secondary" onClick={() => setContextEditorOpen(true)}>编辑我的上下文</button>{onboardingError ? <div className="edupi-education-error">引导状态读取失败：{onboardingError}</div> : null}</section>) : null}
    {activeModule === "home" ? <><div className="edupi-home-stats"><div className="edupi-home-stat"><strong>{students.length}</strong><span>学生档案</span></div><div className="edupi-home-stat"><strong>{currentData.timetable.length}</strong><span>每周课程</span></div><div className="edupi-home-stat"><strong>{currentData.calendar.length}</strong><span>校历节点</span></div><div className="edupi-home-stat"><strong>{pendingTaskCount}</strong><span>待教师确认</span></div></div><div className="edupi-education-columns"><section className="edupi-education-card edupi-education-card--wide"><div className="edupi-education-card__heading"><div><span className="edupi-section-kicker">MATERIAL INBOX</span><h2>教师材料收件箱</h2></div></div><div className="edupi-next-work-list"><button type="button" onClick={() => { setUploadMessage(null); onRequestMaterialUpload(); }}><strong>上传一份作业或错题材料</strong><span>先核对，再生成 candidate_only 证据候选</span></button><button type="button" onClick={() => { setUploadMessage(null); onRequestMaterialUpload(); }}><strong>上传课堂记录</strong><span>生成教师内部跟进候选，不自动写正式事实</span></button><button type="button" onClick={() => setActiveModule("calendar")}><strong>补充校历和课程节奏</strong><span>先把真实日期和每周安排写入 EduPi 事实源</span></button></div></section><section className="edupi-education-card"><div className="edupi-education-card__heading"><div><span className="edupi-section-kicker">REVIEW</span><h2>待审核任务</h2></div><button type="button" onClick={() => setActiveModule("tasks")}>查看全部</button></div><div className="edupi-task-list">{upcomingTasks.map((task) => <div className="edupi-task-row" key={taskId(task)}><span className="edupi-task-dot" /><div><strong>{task.title}</strong><small>{taskTypeLabel(task)} · {task.dueDate || "日期待确认"} · {task.externalSend ? "外发标记异常" : "不外发"}</small></div></div>)}</div></section></div></> : null}
    {activeModule === "materials" ? <EduPiMaterialModule data={currentData} onRequestMaterialUpload={onRequestMaterialUpload} onOpenTasks={() => setActiveModule("tasks")} /> : null}
    {activeModule === "students" ? <section className="edupi-module-view"><span className="edupi-section-kicker">STUDENT RECORDS</span><h2>学生档案</h2><p>只从已有教师事实进入跟进；要新增内容，请先上传课堂记录或作业材料。</p><div className="edupi-student-grid">{students.map((student) => <article key={student.name} className="edupi-student-card"><strong>{student.name}</strong><span>教师事实记录</span><small>{Array.isArray(student.traits) ? student.traits.join("、") : "暂无教师观察标签"}</small></article>)}</div></section> : null}
    {activeModule === "calendar" ? <EduPiCalendarModule data={currentData} onData={handleDataUpdated} /> : null}
    {activeModule === "tasks" ? <section className="edupi-module-view"><span className="edupi-section-kicker">TEACHER REVIEW</span><h2>待审核任务</h2><p>{hasTaskReview ? "每条任务都显示来源事实、系统候选和教师审核边界；写回继续走 EduPi safe store。" : "当前任务审核保持只读：没有安全绑定的 EduPi teacher_task_review runtime。"}</p>{reviewMessage ? <div className="edupi-review-message">{reviewMessage}</div> : null}<div className="edupi-review-list">{tasks.map((task) => <EduPiReviewTaskCard key={taskId(task)} task={task} enabled={hasTaskReview} busy={reviewBusy === task.id} onAction={(action) => void reviewTask(task, action)} />)}</div></section> : null}
  </section>;
}
