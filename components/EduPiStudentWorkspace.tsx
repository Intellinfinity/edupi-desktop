"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { studentRecordKey, studentRecordName } from "@/lib/edupi-student-roster-model";
import { parseStudentProfileList } from "@/lib/edupi-student-profile-edit";
import { buildStudentProfileConversationPrompt } from "@/lib/edupi-student-profile-prompt";
import { appendTeacherInputSlot } from "@/lib/edupi-teacher-input-slot";
import { isUserFacingMemory, taskDisplayTitle, taskKey, taskStatusLabel } from "@/lib/edupi-workbench";
import { EduPiRosterPreview, type RosterPreview } from "./EduPiRosterPreview";
import { EduPiStudentEvents } from "./EduPiStudentEvents";
import { EduPiStudentFacts } from "./EduPiStudentFacts";
import { EduPiStudentMemoryActions } from "./EduPiStudentMemoryActions";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { studentDirectoryPage } from "@/lib/edupi-student-pagination";
import type {
  StudentProfileVersion,
  StudentProfileVersionHistory,
  StudentProfileVersionSide,
  StudentProfileVersionValues,
} from "@/lib/edupi-student-profile-versions";
import { studentSemesterRange } from "@/lib/edupi-student-semester";

type Props = {
  mode: "homeroom" | "students";
  data: EducationContract;
  context: TeacherContextSnapshot | null;
  query: string;
  selectedStudentId: string | null;
  onStudent: (student: Record<string, unknown> | null) => void;
  onEducation: (data: EducationContract) => void;
  onTask: (task: TeacherTask) => void;
  onStartAgent: (prompt: string, mode?: "insert" | "replace") => void;
  onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean>;
};

type StudentProfileEditor = {
  studentKey: string;
  className: string;
  traits: string;
  parentNotes: string;
  expectedUpdatedAt: string;
  expectedRevision: number;
};

const STUDENT_PROFILE_FIELD_LABELS = { class_name: "班级", traits: "学生特征", parent_notes: "家校备注" } as const;
const STUDENT_PROFILE_SOURCE_LABELS = { roster_import: "名单导入", teacher_edit: "手动修改", agent_update: "AI 协作", restore: "版本恢复" } as const;

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function shortDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "日期待补";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function csvCell(value: unknown): string {
  const source = String(value ?? "");
  const safe = /^\s*[=+\-@]/.test(source) ? `'${source}` : source;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(exportValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !/(?:^id$|_id$|_ids$|hash|path)/i.test(key)).map(([key, child]) => [key, exportValue(child)]));
}

function profileListLabel(value: string[]): string {
  return value.join("、") || "未设置";
}

function sameStudentProfileValues(left: StudentProfileVersionValues, right: StudentProfileVersionValues): boolean {
  return left.className === right.className
    && left.traits.length === right.traits.length && left.traits.every((value, index) => value === right.traits[index])
    && left.parentNotes.length === right.parentNotes.length && left.parentNotes.every((value, index) => value === right.parentNotes[index]);
}

function StudentProfileHistory({
  open,
  count,
  history,
  loading,
  error,
  current,
  busy,
  restoring,
  onToggle,
  onRestore,
}: {
  open: boolean;
  count: number;
  history: StudentProfileVersionHistory | null;
  loading: boolean;
  error: string | null;
  current: StudentProfileVersionValues;
  busy: boolean;
  restoring: string | null;
  onToggle: (open: boolean) => void;
  onRestore: (version: StudentProfileVersion, side: StudentProfileVersionSide) => void;
}) {
  return <details className="edupi-student-profile-history" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
    <summary>档案历史 <span>{history?.profileHistoryCount ?? count}</span></summary>
    <div>
      {loading ? <p className="edupi-student-profile-history__state">正在读取…</p> : error ? <p className="edupi-student-profile-history__state is-error" role="alert">{error}</p> : history && history.versions.length > 0 ? <>
        <p className="edupi-student-profile-history__notice">恢复会同时替换班级、学生特征和家校备注。</p>
        <ol>{history.versions.slice().reverse().map((version) => <li key={version.versionId}>
          <header><div><strong>版本 {version.revision}</strong><span>{STUDENT_PROFILE_SOURCE_LABELS[version.sourceKind]}</span></div><time>{new Date(version.changedAt).toLocaleString("zh-CN")}</time></header>
          <small>修改了 {version.changedFields.map((field) => STUDENT_PROFILE_FIELD_LABELS[field]).join("、")}</small>
          <div className="edupi-student-profile-history__sides">{(["before", "after"] as const).map((side) => {
            const sideValues = side === "before" ? version.beforeValues : version.afterValues;
            const sideLabel = side === "before" ? "修改前" : "修改后";
            const isCurrent = sameStudentProfileValues(current, sideValues);
            const restoreKey = `${version.versionId}:${side}`;
            return <section key={side}>
              <header><strong>{sideLabel}</strong>{isCurrent ? <span>当前档案</span> : <button type="button" disabled={busy} onClick={() => onRestore(version, side)}>{restoring === restoreKey ? "恢复中…" : `恢复${sideLabel}`}</button>}</header>
              <dl><div><dt>班级</dt><dd title={sideValues.className || "未设置"}>{sideValues.className || "未设置"}</dd></div><div><dt>学生特征</dt><dd title={profileListLabel(sideValues.traits)}>{profileListLabel(sideValues.traits)}</dd></div><div><dt>家校备注</dt><dd title={profileListLabel(sideValues.parentNotes)}>{profileListLabel(sideValues.parentNotes)}</dd></div></dl>
            </section>;
          })}</div>
        </li>)}</ol>
      </> : <p className="edupi-student-profile-history__state">暂无档案历史</p>}
    </div>
  </details>;
}

export function EduPiStudentWorkspace({ mode, data, context, query, selectedStudentId, onStudent, onEducation, onTask, onStartAgent, onDeleteEntity }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [editor, setEditor] = useState<StudentProfileEditor | null>(null);
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [showRecords, setShowRecords] = useState(false);
  const [profileHistoryOpen, setProfileHistoryOpen] = useState(false);
  const [profileHistory, setProfileHistory] = useState<{ studentId: string; value: StudentProfileVersionHistory } | null>(null);
  const [profileHistoryLoading, setProfileHistoryLoading] = useState(false);
  const [profileHistoryError, setProfileHistoryError] = useState<string | null>(null);
  const [restoringProfile, setRestoringProfile] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState("");
  const filterKey = JSON.stringify([classFilter, query]);
  const [pagination, setPagination] = useState({ filterKey, page: 0 });
  if (pagination.filterKey !== filterKey) setPagination({ filterKey, page: 0 });
  const directory = studentDirectoryPage(data.students, classFilter, query, pagination.filterKey === filterKey ? pagination.page : 0);
  if (pagination.filterKey === filterKey && pagination.page !== directory.page) setPagination({ filterKey, page: directory.page });
  const classNames = [...new Set(data.students.map(student => String(student.class_name || "")).filter(Boolean))].sort();
  const students = directory.filtered.map(row => row.student);
  const selected = data.students.find((student, index) => studentRecordKey(student, index) === selectedStudentId) || null;
  const selectedName = selected ? studentRecordName(selected) : null;
  const uniqueSelectedName = Boolean(selectedName && (data.studentNameCounts ? data.studentNameCounts[selectedName] === 1 : data.students.filter(student => studentRecordName(student) === selectedName).length === 1));
  const patterns = selected ? records(selected.error_patterns) : [];
  const trajectory = selected ? records(selected.trajectory) : [];
  const traits = selected && Array.isArray(selected.traits) ? selected.traits.filter((item): item is string => typeof item === "string") : [];
  const parentNotes = selected && Array.isArray(selected.parent_notes) ? selected.parent_notes.filter((item): item is string => typeof item === "string") : [];
  const selectedUpdatedAt = selected && typeof selected.updated_at === "string" ? selected.updated_at : null;
  const selectedProfileRevision = selected && Number.isInteger(selected.profile_revision) && Number(selected.profile_revision) >= 0 ? Number(selected.profile_revision) : 0;
  const selectedProfileHistoryCount = selected && Number.isInteger(selected.profile_history_count) && Number(selected.profile_history_count) >= 0 ? Number(selected.profile_history_count) : 0;
  const selectedProfileValues: StudentProfileVersionValues = { className: selected && typeof selected.class_name === "string" ? selected.class_name : null, traits, parentNotes };
  const visibleProfileHistory = profileHistory?.studentId === selectedStudentId ? profileHistory.value : null;
  const familyContacts = selectedName ? data.continuity.familyContacts.filter((contact) => contact.student === selectedStudentId || uniqueSelectedName && contact.student === selectedName) : [];
  const tasks = selectedName ? data.tasks.filter((task) => task.student === selectedStudentId || uniqueSelectedName && (task.student === selectedName || task.sourceEventName?.includes(selectedName))) : [];
  const memories = selectedName ? data.continuity.memories.filter((memory) => memory.state === "active" && isUserFacingMemory(memory) && (memory.student === selectedStudentId || uniqueSelectedName && (memory.student === selectedName || memory.content.includes(selectedName)))) : [];
  const classes = context?.classes?.length ? context.classes.join(" · ") : context?.grade || "班级待设置";
  const activePatterns = students.reduce((total, student) => total + records(student.error_patterns).filter((item) => item.status !== "resolved").length, 0);
  const openFollowUps = data.tasks.filter((task) => task.trigger === "student_follow_up" && task.boardStage !== "done").length;
  const currentSemesterRange = studentSemesterRange(data.calendar);
  const studentDrawerRef = useModalDismiss<HTMLElement>(() => { setEditor(null); onStudent(null); }, Boolean(selected));

  const fetchProfileHistory = useCallback(async (signal?: AbortSignal): Promise<StudentProfileVersionHistory> => {
    if (!selectedName || !selectedStudentId) throw new Error("学生身份无效");
    const response = await fetch(`/api/edupi/students/${encodeURIComponent(selectedName)}/versions?studentId=${encodeURIComponent(selectedStudentId)}`, { cache: "no-store", signal });
    const result = await response.json() as { history?: StudentProfileVersionHistory; error?: string };
    if (!response.ok || !result.history) throw new Error(result.error || "学生档案历史读取失败");
    return result.history;
  }, [selectedName, selectedStudentId]);

  useEffect(() => {
    if (!selected || !selectedStudentId) return;
    const selectedClass = String(selected.class_name || "");
    if (classFilter && classFilter !== selectedClass) {
      setClassFilter("");
      return;
    }
    const selectedIndex = directory.filtered.findIndex(({ student, key }) => key === selectedStudentId || student === selected);
    if (selectedIndex < 0) return;
    const selectedPage = Math.floor(selectedIndex / 24);
    setPagination((current) => current.filterKey === filterKey && current.page === selectedPage ? current : { filterKey, page: selectedPage });
  }, [classFilter, directory.filtered, filterKey, selected, selectedStudentId]);

  useEffect(() => {
    setProfileHistoryOpen(false);
    setProfileHistory(null);
    setProfileHistoryError(null);
    setRestoringProfile(null);
  }, [selectedStudentId]);

  useEffect(() => {
    if (!profileHistoryOpen || !selectedStudentId) return;
    const controller = new AbortController();
    setProfileHistoryLoading(true);
    setProfileHistoryError(null);
    fetchProfileHistory(controller.signal)
      .then((value) => setProfileHistory({ studentId: value.studentId, value }))
      .catch((error) => { if (!controller.signal.aborted) setProfileHistoryError(error instanceof Error ? error.message : "学生档案历史读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setProfileHistoryLoading(false); });
    return () => controller.abort();
  }, [fetchProfileHistory, profileHistoryOpen, selectedProfileRevision, selectedStudentId]);

  useEffect(() => {
    if (!message) return;
    if (message.tone === "error") setLastError(message.text);
    const timer = window.setTimeout(() => setMessage(null), message.tone === "error" ? 8_000 : 4_000);
    return () => window.clearTimeout(timer);
  }, [message]);


  const importRosterFile = async (file: File) => {
    const body = new FormData();
    body.append("file", file, file.name);
    const response = await fetch("/api/edupi/students/import?preview=1", { method: "POST", body });
    const result = await response.json() as RosterPreview & { error?: string };
    if (!response.ok || !result.sheets?.length) throw new Error(result.error || "名单预览失败。");
    setPreview(result);
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    setPreview(null);
    setBusy(true); setMessage(null);
    try { await importRosterFile(file); }
    catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "学生名单导入失败。" }); }
    finally { setBusy(false); }
  };
  const confirmImport = async (csv: string) => {
    if (!preview || busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/edupi/students/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceName: preview.sourceName, csv }) });
      const result = await response.json() as { error?: string; data?: EducationContract; result?: { imported?: number } };
      if (!response.ok || !result.data) throw new Error(result.error || "学生名单导入失败。");
      onEducation(result.data); setPreview(null);
      setMessage({ tone: "success", text: `已导入 ${result.result?.imported ?? 0} 名学生` });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "导入失败，请重试。" }); }
    finally { setBusy(false); }
  };
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedName || !editor || editor.studentKey !== selectedStudentId || busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/edupi/students/${encodeURIComponent(selectedName)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId:selectedStudentId, className:editor.className.trim() || null, traits: parseStudentProfileList(editor.traits), parentNotes: parseStudentProfileList(editor.parentNotes), expectedUpdatedAt: editor.expectedUpdatedAt, expectedRevision: editor.expectedRevision }) });
      const result = await response.json() as { error?: string; data?: EducationContract };
      if (!response.ok || !result.data) throw new Error(result.error || "学生档案修改失败。");
      onEducation(result.data);
      setEditor(null);
      setMessage({ tone: "success", text: "学生档案已更新" });
    }
    catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "学生档案修改失败。" }); }
    finally { setBusy(false); }
  };
  const openEditor = () => {
    if (!selectedName || !selectedUpdatedAt || !selectedStudentId) return;
    setMessage(null);
    setEditor({ studentKey: selectedStudentId, className:String(selected?.class_name || ""), traits: traits.join("\n"), parentNotes: parentNotes.join("\n"), expectedUpdatedAt: selectedUpdatedAt, expectedRevision: selectedProfileRevision });
  };
  const restoreProfile = async (version: StudentProfileVersion, versionSide: StudentProfileVersionSide) => {
    if (!selectedName || !selectedStudentId || busy) return;
    const restoreKey = `${version.versionId}:${versionSide}`;
    setBusy(true); setRestoringProfile(restoreKey); setMessage(null);
    try {
      const response = await fetch(`/api/edupi/students/${encodeURIComponent(selectedName)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedStudentId, versionId: version.versionId, versionSide, expectedRevision: selectedProfileRevision }),
      });
      const result = await response.json() as { error?: string; data?: EducationContract; history?: StudentProfileVersionHistory };
      if (!response.ok || !result.data || !result.history) throw new Error(result.error || "学生档案恢复失败");
      onEducation(result.data);
      setProfileHistory({ studentId: result.history.studentId, value: result.history });
      setEditor(null);
      setMessage({ tone: "success", text: `已恢复版本 ${version.revision} 的${versionSide === "before" ? "修改前" : "修改后"}档案` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "学生档案恢复失败" });
    } finally {
      setBusy(false); setRestoringProfile(null);
    }
  };
  const openStudentAgent = () => {
    if (!selectedName) return;
    const prompt = buildStudentProfileConversationPrompt({ name: selectedName, studentId:selectedStudentId || undefined, className:String(selected?.class_name || ""), traits, parentNotes, patternCount: patterns.length, trajectoryCount: trajectory.length });
    onStartAgent(prompt, "replace");
  };
  const openStudentMemoryAgent = (content: string) => {
    if (!selectedName) return;
    const prompt = appendTeacherInputSlot([
      `请修订关于${selectedName}的这条 EduPi 记忆。`,
      `当前内容：${content}`,
      "请根据我的要求说明修改建议和依据，待我确认后再写回并保留旧版本。",
    ].join("\n"), "我希望改成（在这里输入或口述）：");
    onStartAgent(prompt, "replace");
  };
  const deleteStudent = async () => {
    if (!selectedName || busy) return;
    setBusy(true); setMessage(null);
    try {
      const label = [selectedName, selected?.class_name].filter(Boolean).join(" · ");
      const deleted = await onDeleteEntity("student", selectedStudentId || selectedName, label);
      if (!deleted) return;
      setEditor(null);
      onStudent(null);
      setMessage({ tone: "success", text: "学生档案已删除" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "学生档案删除失败。" });
    } finally {
      setBusy(false);
    }
  };
  const exportCurrent = () => download(`${JSON.stringify({ exported_at: new Date().toISOString(), students: exportValue(selected ? [selected] : data.students) }, null, 2)}\n`, selectedName ? `${selectedName}-学生档案.json` : "班级学生档案.json", "application/json;charset=utf-8");
  const exportTimeline = () => {
    if (!selectedName) return;
    const rows = trajectory.map((item) => [item.date || "", item.event || "", item.note || item.description || ""]);
    download(`\uFEFF${[["日期", "事件", "备注"], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`, `${selectedName}-成长轨迹.csv`, "text/csv;charset=utf-8");
  };

  return <main className={`edupi-module-workspace edupi-class-workspace${selected ? " has-student-drawer" : ""}`}>
    <header className="edupi-module-heading edupi-student-heading"><div><span>{mode === "homeroom" ? "班级工作区" : "学生档案"}</span><h1>{mode === "homeroom" ? "班级" : "学生档案"}</h1><p>{classes} · {students.length} 名学生</p></div><div className="edupi-student-heading__actions"><button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "导入中…" : "导入名单"}</button><button type="button" onClick={exportCurrent} disabled={data.students.length === 0}>导出档案</button><button type="button" onClick={exportTimeline} disabled={!selected}>导出轨迹</button></div><input ref={inputRef} type="file" accept=".csv,.tsv,.xlsx,.xls,.xlsm,.xlsb,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={importFile} /></header>
    {message ? <p className={`edupi-student-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
    {classNames.length > 0 ? <label>班级 <select value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="">全部班级</option>{classNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label> : null}
    {lastError ? <details className="edupi-student-message is-error"><summary>最近一次操作失败</summary><p>{lastError}</p><button type="button" onClick={() => setLastError(null)}>清除</button></details> : null}
    {preview ? <EduPiRosterPreview key={preview.sourceName} preview={preview} busy={busy} onCancel={() => setPreview(null)} onImport={(csv) => void confirmImport(csv)} /> : null}
    <div className="edupi-student-events-toggle"><button type="button" aria-expanded={showRecords} onClick={()=>setShowRecords(value=>!value)}>{showRecords?"收起学生记录":"学习与互动记录"}</button>{selectedName?<span>当前：{selectedName}</span>:null}</div>
    {showRecords&&!selectedName?<EduPiStudentEvents key="all" student={null} semesterRange={currentSemesterRange} onAgent={onStartAgent}/>:null}
    <section className="edupi-class-summary-strip"><div><strong>{students.length}</strong><span>学生</span></div><div><strong>{activePatterns}</strong><span>观察中模式</span></div><div><strong>{openFollowUps}</strong><span>待跟进</span></div><div><strong>{data.continuity.familyContacts.length}</strong><span>家校档案</span></div></section>
    <section className="edupi-student-directory" aria-label="学生名单"><header><h2>学生</h2><span>按姓名排序</span></header><div>{directory.rows.map(({ student, key }, index) => { const name = studentRecordName(student); const studentPatterns = records(student.error_patterns); return <button type="button" key={key} className={key === selectedStudentId ? "is-selected" : ""} onClick={() => { setEditor(null); onStudent(student); }}><span className={`is-tint-${index % 4}`}>{name.slice(0, 1)}</span><strong>{name}</strong>{student.class_name ? <small>{String(student.class_name)}</small> : null}<small>{studentPatterns.filter((item) => item.status !== "resolved").length} 个学习模式</small></button>; })}</div>{students.length === 0 ? <button type="button" className="edupi-student-directory__empty" onClick={() => inputRef.current?.click()}>导入学生名单</button> : null}</section>
    {directory.pages > 1 ? <nav className="edupi-database-pagination" aria-label="学生分页"><button type="button" disabled={directory.page === 0} onClick={() => setPagination({ filterKey, page: directory.page - 1 })}>上一页</button><span aria-live="polite">{directory.page + 1} / {directory.pages}</span><button type="button" disabled={directory.page === directory.pages - 1} onClick={() => setPagination({ filterKey, page: directory.page + 1 })}>下一页</button></nav> : null}
    {selected && selectedName ? <aside ref={studentDrawerRef} role="dialog" aria-modal="true" className="edupi-student-drawer" aria-label={`${selectedName}学生档案`}><header><div><span>学生档案</span><h2>{selectedName}</h2><p>{[selected.class_name, ...traits].filter(Boolean).join(" · ") || "教师内部"}</p></div><div className="edupi-student-drawer__actions"><button type="button" onClick={()=>setShowRecords(value=>!value)}>学习与互动</button><button type="button" onClick={openEditor} disabled={!selectedUpdatedAt || busy}>手动修改</button><button type="button" onClick={openStudentAgent}>AI 协作</button>{data.capabilities.entityDelete.enabled && data.capabilities.entityDelete.targetKinds.includes("student") ? <button type="button" className="is-delete" disabled={busy} onClick={() => void deleteStudent()}>{busy ? "处理中…" : "删除"}</button> : null}<button type="button" onClick={() => { setEditor(null); onStudent(null); }} data-autofocus aria-label="关闭学生档案">×</button></div></header><section className="edupi-student-drawer__metrics"><div><strong>{patterns.length}</strong><span>学习模式</span></div><div><strong>{trajectory.length}</strong><span>成长节点</span></div><div><strong>{memories.length}</strong><span>EduPi 记忆</span></div></section><div className="edupi-student-drawer__scroll"><EduPiStudentEvents key={selectedStudentId} student={selectedName} studentId={typeof selected.student_id === "string" ? selected.student_id : undefined} studentClass={String(selected.class_name || "")} semesterRange={currentSemesterRange} onAgent={onStartAgent}/>{typeof selected.student_id === "string" ? <EduPiStudentFacts factSpine={data.factSpine} studentId={selected.student_id} reviewer={context?.name || "teacher"} onEducation={onEducation} /> : null}{editor?.studentKey === selectedStudentId ? <form className="edupi-student-profile-editor" onSubmit={saveProfile}><header><h3>修改档案</h3><button type="button" onClick={() => setEditor(null)} disabled={busy}>取消</button></header><label><span>班级</span><input value={editor.className} maxLength={120} onChange={event => setEditor({...editor,className:event.target.value})} /></label><label><span>学生特征</span><textarea value={editor.traits} maxLength={12000} rows={4} placeholder="每行一个特征" onChange={(event) => setEditor({ ...editor, traits: event.target.value })} /></label><label><span>家校备注</span><textarea value={editor.parentNotes} maxLength={12000} rows={5} placeholder="每行一条备注" onChange={(event) => setEditor({ ...editor,parentNotes:event.target.value })} /></label><button type="submit" disabled={busy}>{busy ? "保存中…" : "保存修改"}</button></form> : null}<StudentProfileHistory open={profileHistoryOpen} count={selectedProfileHistoryCount} history={visibleProfileHistory} loading={profileHistoryLoading} error={profileHistoryError} current={selectedProfileValues} busy={busy} restoring={restoringProfile} onToggle={setProfileHistoryOpen} onRestore={(version, side) => void restoreProfile(version, side)} /><details open><summary>学习模式 <span>{patterns.length}</span></summary><div>{patterns.map((item, index) => <p key={index}><strong>{String(item.description || "学习观察")}</strong><span>{item.status === "resolved" ? "已解决" : "观察中"}{item.last_seen ? ` · ${shortDate(item.last_seen)}` : ""}</span></p>)}{patterns.length === 0 ? <em>暂无记录</em> : null}</div></details><details><summary>成长轨迹 <span>{trajectory.length}</span></summary><div>{trajectory.slice().reverse().map((item, index) => <p key={index}><strong>{String(item.event || "成长记录")}</strong><span>{shortDate(item.date)} · {String(item.note || "")}</span></p>)}{trajectory.length === 0 ? <em>暂无记录</em> : null}</div></details><details><summary>家校记录 <span>{parentNotes.length + familyContacts.length}</span></summary><div>{parentNotes.map((item, index) => <p key={`note:${index}`}><strong>{item}</strong></p>)}{familyContacts.map((item) => <p key={item.id}><strong>{item.name}</strong><span>{item.lastTopic || item.lastOutcome || "已联系"}</span></p>)}</div></details><details open><summary>EduPi 相关记忆 <span>{memories.length}</span></summary><div>{memories.map((memory) => <div key={memory.id}><strong>{memory.content}</strong><EduPiStudentMemoryActions memory={memory} onEducation={onEducation} onAgent={() => openStudentMemoryAgent(memory.content)} onDelete={() => { void onDeleteEntity("memory", memory.id, memory.content).catch(() => {}); }} /></div>)}{memories.length === 0 ? <em>暂无已关联记忆</em> : null}</div></details><details><summary>相关任务 <span>{tasks.length}</span></summary><div>{tasks.map((task) => <button type="button" key={taskKey(task)} onClick={() => onTask(task)}><strong>{taskDisplayTitle(task)}</strong><span>{taskStatusLabel(task)}</span></button>)}</div></details></div></aside> : null}
  </main>;
}
