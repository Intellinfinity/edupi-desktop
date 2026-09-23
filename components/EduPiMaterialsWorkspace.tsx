"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import { MATERIAL_CATEGORIES, materialCategoryRoute, materialItemRoute, materialObjectId } from "@/lib/edupi-domain-navigation";
import type { MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { appendTeacherInputSlot } from "@/lib/edupi-teacher-input-slot";
import { buildMaterialRows, defaultMaterialIntakeMetadata, type MaterialIntakeMetadata, type MaterialRow } from "@/lib/edupi-material-rows";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { EduPiMaterialExcerpt } from "./EduPiMaterialExcerpt";
import { intakeOperationHistory } from "@/lib/edupi-operation-history";
import { EduPiOperationHistory } from "./EduPiOperationHistory";
import { EduPiMaterialMetadataEditor } from "./EduPiMaterialMetadataEditor";
import { EduPiIconButton, EduPiPagination } from "./EduPiActionIcon";
import { resolveScheduleSourceSelection, type ScheduleSourceOption } from "@/lib/edupi-schedule-source-selection";

const PAGE_SIZE = 8;

function documentScheduleSource(item: MaterialStagingDescriptor): boolean {
  const path = item.staging_path.toLowerCase();
  return item.kind === "pdf" && path.endsWith(".pdf") || item.kind === "word" && path.endsWith(".docx");
}

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}


export function EduPiMaterialsWorkspace({ data, context, query, selectedObjectId, onObject, stagedMaterials, stagingBusy, stagingMessage, onTask, onUpload, onIntakeMaterial, onRemoveStagedMaterial, onOpenFile, onStartAgent, onEducation, onDeleteEntity }: { data: EducationContract; context: TeacherContextSnapshot | null; query: string; selectedObjectId: string | null; onObject: (id: string) => void; stagedMaterials: MaterialStagingDescriptor[]; stagingBusy: boolean; stagingMessage: string | null; onTask: (task: TeacherTask) => void; onUpload: () => void; onIntakeMaterial: (item: MaterialStagingDescriptor, metadata: MaterialIntakeMetadata, scheduleSource: ScheduleSourceOption | null) => Promise<unknown>; onRemoveStagedMaterial: (item: MaterialStagingDescriptor) => Promise<void>; onOpenFile: (path: string) => void; onStartAgent: (prompt: string, mode?: "insert" | "replace") => void; onEducation: (data: EducationContract) => void; onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean> }) {
  const category = materialCategoryRoute(selectedObjectId);
  const focusedMaterialId = materialItemRoute(selectedObjectId);
  const categoryLabel = MATERIAL_CATEGORIES.find((item) => item.id === category)?.label || "全部材料";
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<MaterialRow | null>(null);
  const closeSelected = useCallback(() => {
    setSelected(null);
    onObject(materialObjectId(category));
  }, [category, onObject]);
  const openSelected = useCallback((item: MaterialRow) => {
    setSelected(item);
    onObject(materialObjectId(category, item.id));
  }, [category, onObject]);
  const drawerRef = useModalDismiss<HTMLElement>(closeSelected, Boolean(selected));
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [archivedId, setArchivedId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState("");
  const [intakeDraft, setIntakeDraft] = useState<(MaterialIntakeMetadata & { stagingId: string; scheduleSourceId: string }) | null>(null);
  const [scheduleSources, setScheduleSources] = useState<ScheduleSourceOption[]>([]);
  const [scheduleSourceError, setScheduleSourceError] = useState("");
  const classes = useMemo(() => [...new Set((context?.classes || []).map(value => value.trim()).filter(Boolean))], [context?.classes]);
  const generatedError = data.generatedArtifactsUnavailable;
  const materialIntakeReady = data.capabilities.materialIntake.enabled;
  const calendarIntakeReady = materialIntakeReady && data.capabilities.calendar.enabled && data.capabilities.entityDelete.enabled;
  const documentScheduleReady = materialIntakeReady && data.capabilities.calendar.enabled;
  const allRows = useMemo(() => buildMaterialRows(data, query), [data, query]);
  const rows = useMemo(() => allRows.filter(item => category === "all" || item.category === category), [allRows, category]);
  useEffect(() => { setPage(0); }, [category, query]);
  useEffect(() => {
    if (!focusedMaterialId) { setSelected(null); return; }
    const index = rows.findIndex((item) => item.id === focusedMaterialId);
    if (index < 0) { closeSelected(); return; }
    setPage(Math.floor(index / PAGE_SIZE));
    setSelected(rows[index]);
  }, [closeSelected, focusedMaterialId, rows]);
  useEffect(() => {
    if (!selected) return;
    const current = allRows.find((item) => item.id === selected.id);
    if (!current) closeSelected();
    else if (current !== selected) setSelected(current);
  }, [allRows, closeSelected, selected]);
  useEffect(() => {
    if (intakeDraft && !stagedMaterials.some(item => item.staging_id === intakeDraft.stagingId)) setIntakeDraft(null);
  }, [intakeDraft, stagedMaterials]);
  const loadScheduleSources = useCallback(async () => {
    try {
      const response = await fetch("/api/edupi/calendar-sources", { cache: "no-store" });
      const result = await response.json() as { sources?: ScheduleSourceOption[] };
      if (!response.ok || !Array.isArray(result.sources)) throw new Error("invalid source response");
      setScheduleSources(result.sources);
      setScheduleSourceError("");
    } catch {
      setScheduleSources([]);
      setScheduleSourceError("日程来源读取失败，请重试");
    }
  }, []);
  useEffect(() => {
    if (!stagedMaterials.some((item) => item.kind === "calendar" || documentScheduleSource(item))) { setScheduleSources([]); setScheduleSourceError(""); return; }
    void loadScheduleSources();
  }, [loadScheduleSources, stagedMaterials]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const materialSource = data.dataSources.materials;
  const openMaterialAgent = () => {
    if (!selected) return;
    const prompt = appendTeacherInputSlot([
      `请补充或修订这份材料的信息：${selected.title}`,
      `当前说明：${selected.summary}`,
      `来源：${selected.source}`,
      "请保留原始来源，根据我的要求整理修改候选，待我确认后写回。",
    ].join("\n"), "我要补充或修改的信息（在这里输入或口述）：");
    onStartAgent(prompt, "replace");
  };
  const deleteSelected = async () => {
    if (!selected?.deleteKind || deleteBusy) return;
    setDeleteBusy(true);
    setOperationError("");
    try {
      if (selected.deleteKind === "generated") {
      const response = await fetch("/api/edupi/artifacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive", artifactId: selected.id }) });
      if (!response.ok) throw new Error("移除失败");
        setArchivedId(selected.id); closeSelected();
        window.dispatchEvent(new Event("edupi-artifacts-updated"));
        return;
      }
      const deleted = selected.deleteKind === "task" && selected.task?.id
        ? await onDeleteEntity("task", selected.task.id, selected.title)
        : await onDeleteEntity("material", selected.id, selected.title);
      if (deleted) closeSelected();
    } catch {
      setOperationError("材料操作失败，请重试");
    } finally {
      setDeleteBusy(false);
    }
  };
  const openNative = async (mode: "open" | "reveal") => {
    if (!selected?.filePath) return;
    const desktop = await import("@/lib/desktop-native");
    if (mode === "open") await desktop.openPathNative(selected.filePath);
    else await desktop.revealItemInDirNative(selected.filePath);
  };
  const canDeleteSelected = selected?.deleteKind === "generated" || Boolean(selected?.deleteKind && data.capabilities.entityDelete.enabled && data.capabilities.entityDelete.targetKinds.includes(selected.deleteKind) && (selected.deleteKind !== "task" || selected.task?.id));
  const selectedHistory = selected?.deleteKind === "material" ? intakeOperationHistory(data, "intake_material", selected.id) : [];
  const beginIntake = (item: MaterialStagingDescriptor) => {
    setOperationError("");
    if (item.kind === "calendar" || documentScheduleSource(item)) void loadScheduleSources();
    setIntakeDraft({ stagingId: item.staging_id, scheduleSourceId: "", ...defaultMaterialIntakeMetadata(item.original_name, context) });
  };
  const submitIntake = async (event: FormEvent, item: MaterialStagingDescriptor) => {
    event.preventDefault();
    if (!intakeDraft || intakeDraft.stagingId !== item.staging_id
      || item.kind !== "calendar" && (!intakeDraft.title.trim() || !intakeDraft.subject.trim() || !intakeDraft.classId.trim())) {
      setOperationError("请填写材料名称、学科和班级");
      return;
    }
    setOperationError("");
    try {
      const sourceSelection = resolveScheduleSourceSelection(intakeDraft.scheduleSourceId, scheduleSources);
      if (sourceSelection.state === "stale") {
        setOperationError("所选日程来源已变化，请重新选择");
        void loadScheduleSources();
        return;
      }
      await onIntakeMaterial(item, { ...intakeDraft, title: intakeDraft.title.trim(), subject: intakeDraft.subject.trim(), classId: intakeDraft.classId.trim() },
        item.kind === "calendar" || documentScheduleSource(item) ? sourceSelection.source : null);
      setIntakeDraft(null);
    } catch {
      if (item.kind === "calendar" || documentScheduleSource(item)) void loadScheduleSources();
      /* Parent surface reports the bounded intake error. */
    }
  };

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><span>材料</span><h1>{categoryLabel}</h1><p>{materialSource.present ? "数据已连接" : "材料索引尚未接入"} · {rows.length} 份材料 · {stagedMaterials.length} 份待接入</p></div><button type="button" disabled={stagingBusy} onClick={onUpload}>{stagingBusy ? "处理中…" : "上传材料"}</button></header>
    {stagedMaterials.length > 0 ? <details className="edupi-material-inbox" open>
      <summary>待接入材料 <span>{stagedMaterials.length}</span></summary>
      <div>{stagedMaterials.map((item) => {
        const calendar = item.kind === "calendar";
        const documentSchedule = documentScheduleSource(item);
        const itemReady = calendar ? calendarIntakeReady : materialIntakeReady;
        const sourceOptions = scheduleSources;
        return <div className="edupi-material-inbox__item" key={item.staging_id}>
          <div className="edupi-material-inbox__row">
            <strong>{item.original_name}</strong><span>{Math.ceil(item.expected_size_bytes / 1024)} KB</span>
            <button type="button" disabled={stagingBusy || !itemReady} title={!itemReady ? data.capabilities.materialIntake.reason : undefined} onClick={() => intakeDraft?.stagingId === item.staging_id ? setIntakeDraft(null) : beginIntake(item)}>{intakeDraft?.stagingId === item.staging_id ? "取消" : calendar ? "导入日历" : "接入 EduPi"}</button>
            <button type="button" disabled={stagingBusy} onClick={() => void onRemoveStagedMaterial(item)}>移除</button>
          </div>
          {intakeDraft?.stagingId === item.staging_id ? <form className="edupi-material-intake-form" onSubmit={(event) => void submitIntake(event, item)}>
            {calendar ? <>
              <label>导入方式<select value={intakeDraft.scheduleSourceId} onChange={(event) => setIntakeDraft({ ...intakeDraft, scheduleSourceId: event.target.value })}>
                <option value="">作为新日历</option>
                {sourceOptions.map((source) => <option value={source.sourceId} key={source.sourceId}>更新 {source.sourceKind === "calendar" ? "日历" : "材料"}：{source.label}</option>)}
              </select></label>
              {intakeDraft.scheduleSourceId ? <p>更新可能撤回该来源的旧安排，请确认来源。</p> : null}
              <button type="submit" className="is-primary" disabled={stagingBusy}>{intakeDraft.scheduleSourceId ? "确认更新" : "确认导入"}</button>
            </> : <>
              <label>材料名称<input required maxLength={240} value={intakeDraft.title} onChange={(event) => setIntakeDraft({ ...intakeDraft, title: event.target.value })} /></label>
              <label>材料类型<select value={intakeDraft.materialKind} onChange={(event) => setIntakeDraft({ ...intakeDraft, materialKind: event.target.value as MaterialIntakeMetadata["materialKind"] })}><option value="worksheet">学案 / 练习</option><option value="lesson_note">教案 / 备课</option><option value="assessment">测验 / 作业</option><option value="classroom_record">课堂记录</option><option value="other">其他</option></select></label>
              <label>学科<input required maxLength={120} value={intakeDraft.subject} onChange={(event) => setIntakeDraft({ ...intakeDraft, subject: event.target.value })} /></label>
              <label>班级{classes.length ? <select required value={intakeDraft.classId} onChange={(event) => setIntakeDraft({ ...intakeDraft, classId: event.target.value })}><option value="">选择班级</option>{classes.map(item => <option value={item} key={item}>{item}</option>)}</select> : <input required maxLength={160} value={intakeDraft.classId} onChange={(event) => setIntakeDraft({ ...intakeDraft, classId: event.target.value })} />}</label>
              {documentSchedule && documentScheduleReady ? <><label>日程来源<select value={intakeDraft.scheduleSourceId} onChange={(event) => setIntakeDraft({ ...intakeDraft, scheduleSourceId: event.target.value })}>
                <option value="">作为新材料来源</option>
                {sourceOptions.map((source) => <option value={source.sourceId} key={source.sourceId}>更新 {source.sourceKind === "calendar" ? "日历" : "材料"}：{source.label}</option>)}
              </select></label>{intakeDraft.scheduleSourceId ? <p>只增量更新，未识别到的旧安排不会自动撤回。</p> : null}</> : null}
              <button type="submit" className="is-primary" disabled={stagingBusy}>确认接入</button>
            </>}
          </form> : null}
        </div>;
      })}</div>
      {!materialIntakeReady && stagedMaterials.some((item) => item.kind !== "calendar") ? <p className="edupi-material-capability-note" role="status">{data.capabilities.materialIntake.reason}</p> : null}
      {!calendarIntakeReady && stagedMaterials.some((item) => item.kind === "calendar") ? <p className="edupi-material-capability-note" role="status">Core 尚未启用安全的日历更新。</p> : null}
    </details> : null}
    {stagingMessage ? <p className="edupi-material-message" role="status">{stagingMessage}</p> : null}
    {generatedError ? <p className="edupi-material-message" role="status">对话生成文件索引暂不可用</p> : null}
    {operationError ? <p role="alert">{operationError}</p> : null}
    {scheduleSourceError ? <p role="alert">{scheduleSourceError}</p> : null}
    {archivedId ? <p role="status">已移出材料，原文件保留。<button className="native-button" onClick={async () => { const response = await fetch("/api/edupi/artifacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", artifactId: archivedId }) }); if (response.ok) { setArchivedId(null); window.dispatchEvent(new Event("edupi-artifacts-updated")); } }}>撤销</button></p> : null}
    <section className="edupi-database"><div className="edupi-database__head edupi-material-db-grid"><span>材料</span><span>类型</span><span>学科 / 班级</span><span>来源</span><span>日期</span><span>状态</span></div>{visible.map((item) => <button type="button" className="edupi-database-button-row edupi-material-db-grid" key={item.id} onClick={() => openSelected(item)}><strong>{item.title}</strong><span>{item.type}</span><span>{item.subject}</span><span>{item.source}</span><time>{shortDate(item.date)}</time><span>{item.status}</span></button>)}{visible.length === 0 ? <div className="edupi-database__empty">{materialSource.present || stagedMaterials.length > 0 ? "数据已连接，当前分类暂无材料" : "材料索引尚未接入"}</div> : null}</section>
    <EduPiPagination label="材料分页" page={page} pages={pages} previousDisabled={page === 0} nextDisabled={page >= pages - 1} onPrevious={() => setPage((value) => value - 1)} onNext={() => setPage((value) => value + 1)}/>
    {selected ? <aside ref={drawerRef} className="edupi-material-drawer" role="dialog" aria-modal="true" aria-label={`${selected.title}材料详情`}><header><div><span>{selected.type}</span><h2>{selected.title}</h2></div><EduPiIconButton type="button" icon="close" label="关闭材料详情" data-autofocus onClick={closeSelected}/></header><div className="edupi-material-drawer__body"><dl className="edupi-material-drawer__facts"><div><dt>状态</dt><dd>{selected.status}</dd></div><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>学科 / 班级</dt><dd>{selected.subject}</dd></div><div><dt>日期</dt><dd>{shortDate(selected.date)}</dd></div><div><dt>说明</dt><dd>{selected.summary}</dd></div></dl><EduPiOperationHistory rows={selectedHistory} />{selected.material ? <EduPiMaterialMetadataEditor material={selected.material} classes={classes} onEducation={onEducation} onStartAgent={onStartAgent} /> : null}{selected.deleteKind === "material" ? <EduPiMaterialExcerpt key={selected.id} materialId={selected.id} onPreview={selected.filePath ? () => onOpenFile(selected.filePath!) : undefined} /> : null}</div><footer>{selected.filePath ? <EduPiIconButton type="button" icon="preview" label="预览材料" onClick={() => onOpenFile(selected.filePath!)}/> : null}{selected.filePath && isTauriDesktop() ? <><EduPiIconButton type="button" icon="open" label="打开文件" onClick={() => void openNative("open")}/><EduPiIconButton type="button" icon="reveal" label="显示所在文件夹" onClick={() => void openNative("reveal")}/></> : null}{selected.task ? <EduPiIconButton type="button" icon="task" label="打开关联任务" onClick={() => onTask(selected.task!)}/> : null}{canDeleteSelected ? <EduPiIconButton type="button" icon="delete" label={deleteBusy ? "正在删除材料" : "删除材料"} className="is-delete" busy={deleteBusy} disabled={deleteBusy} onClick={() => void deleteSelected()}/> : null}{!selected.material ? <EduPiIconButton type="button" icon="agent" label="补充或修订材料" className="is-primary" onClick={openMaterialAgent}/> : null}</footer></aside> : null}
  </main>;
}
