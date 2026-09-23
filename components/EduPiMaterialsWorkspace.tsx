"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import { MATERIAL_CATEGORIES, materialCategoryRoute, materialItemRoute, materialObjectId } from "@/lib/edupi-domain-navigation";
import type { MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { buildMaterialRows, defaultMaterialIntakeMetadata, type MaterialIntakeMetadata, type MaterialRow } from "@/lib/edupi-material-rows";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { EduPiMaterialExcerpt } from "./EduPiMaterialExcerpt";
import { intakeOperationHistory } from "@/lib/edupi-operation-history";
import { EduPiOperationHistory } from "./EduPiOperationHistory";
import { EduPiMaterialMetadataEditor } from "./EduPiMaterialMetadataEditor";
import { EduPiIconButton, EduPiPagination } from "./EduPiActionIcon";
import { resolveScheduleSourceSelection, type ScheduleSourceOption } from "@/lib/edupi-schedule-source-selection";
import type { DocumentPairingItem, DocumentPairingPreview, DocumentPairingSubmission } from "@/lib/edupi-document-pairing-contract";
import { documentPairingSubmission } from "@/lib/edupi-document-pairing-selection";

const PAGE_SIZE = 8;

function documentScheduleSource(item: MaterialStagingDescriptor): boolean {
  const path = item.staging_path.toLowerCase();
  return item.kind === "pdf" && path.endsWith(".pdf") || item.kind === "word" && path.endsWith(".docx");
}

function pairingLabel(item: DocumentPairingItem): string {
  const date = item.endDate && item.endDate !== item.date ? `${item.date}—${item.endDate}` : item.date;
  return [date, item.name, item.time, item.location].filter(Boolean).join(" · ");
}

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}


export function EduPiMaterialsWorkspace({ data, context, query, selectedObjectId, onObject, stagedMaterials, stagingBusy, stagingMessage, onTask, onUpload, onIntakeMaterial, onRemoveStagedMaterial, onOpenFile, onStartAgent, onEducation, onDeleteEntity }: { data: EducationContract; context: TeacherContextSnapshot | null; query: string; selectedObjectId: string | null; onObject: (id: string) => void; stagedMaterials: MaterialStagingDescriptor[]; stagingBusy: boolean; stagingMessage: { text: string; tone: "success" | "error" } | null; onTask: (task: TeacherTask) => void; onUpload: () => void; onIntakeMaterial: (item: MaterialStagingDescriptor, metadata: MaterialIntakeMetadata, scheduleSource: ScheduleSourceOption | null, pairing?: DocumentPairingSubmission | null) => Promise<unknown>; onRemoveStagedMaterial: (item: MaterialStagingDescriptor) => Promise<void>; onOpenFile: (path: string) => void; onStartAgent: (prompt: string, mode?: "insert" | "replace") => void; onEducation: (data: EducationContract) => void; onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean> }) {
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
  const [sourceErrors, setSourceErrors] = useState({ calendar: "", timetable: "" });
  const [sourceUnavailable, setSourceUnavailable] = useState({ calendar: true, timetable: true });
  const sourceLoadRevision = useRef(0);
  const [pairingPreview, setPairingPreview] = useState<DocumentPairingPreview | null>(null);
  const [pairingChoices, setPairingChoices] = useState<Record<string, string>>({});
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const classes = useMemo(() => [...new Set((context?.classes || []).map(value => value.trim()).filter(Boolean))], [context?.classes]);
  const generatedError = data.generatedArtifactsUnavailable;
  const materialIntakeReady = data.capabilities.materialIntake.enabled;
  const calendarIntakeReady = materialIntakeReady && data.capabilities.calendar.enabled && data.capabilities.entityDelete.enabled;
  const documentScheduleReady = materialIntakeReady && (data.capabilities.calendar.enabled || data.capabilities.timetable.enabled);
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
    if (intakeDraft && !stagedMaterials.some(item => item.staging_id === intakeDraft.stagingId)) {
      setIntakeDraft(null);
      setPairingPreview(null);
      setPairingChoices({});
    }
  }, [intakeDraft, stagedMaterials]);
  const loadScheduleSources = useCallback(async () => {
    const revision = ++sourceLoadRevision.current;
    setSourceUnavailable({ calendar: true, timetable: true });
    setSourceErrors({ calendar: "", timetable: "" });
    setScheduleSources([]);
    const read = async (kind: "calendar" | "timetable") => {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(`/api/edupi/${kind}-sources`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { sources?: ScheduleSourceOption[] };
        const sources = result.sources;
        if (!response.ok || !Array.isArray(sources)) throw new Error("invalid source response");
        if (revision !== sourceLoadRevision.current) return;
        setScheduleSources((current) => [...current.filter((source) => kind === "calendar"
          ? source.sourceKind === "timetable" : source.sourceKind !== "timetable"), ...sources]);
        setSourceUnavailable((current) => ({ ...current, [kind]: false }));
      } catch {
        if (revision === sourceLoadRevision.current) setSourceErrors((current) => ({ ...current,
          [kind]: kind === "calendar" ? "日程来源读取失败" : "课表来源读取失败" }));
      } finally {
        clearTimeout(deadline);
      }
    };
    await Promise.allSettled([read("calendar"), read("timetable")]);
  }, []);
  useEffect(() => {
    if (!stagedMaterials.some((item) => item.kind === "calendar" || documentScheduleSource(item))) {
      sourceLoadRevision.current += 1;
      setScheduleSources([]); setSourceErrors({ calendar: "", timetable: "" });
      setSourceUnavailable({ calendar: true, timetable: true });
      return;
    }
    void loadScheduleSources();
  }, [loadScheduleSources, stagedMaterials]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const materialSource = data.dataSources.materials;
  const openMaterialAgent = () => {
    if (!selected) return;
    const prompt = [
      `材料：${selected.title}`,
      `当前说明：${selected.summary}`,
      `来源：${selected.source}`,
    ].join("\n");
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
  const sourceErrorRelevant = !intakeDraft || sourceUnavailable.calendar
    || stagedMaterials.some((item) => item.staging_id === intakeDraft.stagingId && documentScheduleSource(item));
  const scheduleSourceError = sourceErrors.calendar || (sourceErrorRelevant ? sourceErrors.timetable : "");
  const beginIntake = (item: MaterialStagingDescriptor) => {
    setOperationError("");
    setPairingPreview(null);
    setPairingChoices({});
    setPairingError("");
    if (item.kind === "calendar" || documentScheduleSource(item)) void loadScheduleSources();
    setIntakeDraft({ stagingId: item.staging_id, scheduleSourceId: "", ...defaultMaterialIntakeMetadata(item.original_name, context) });
  };
  const previewPairings = async (item: MaterialStagingDescriptor) => {
    const selectedSource = resolveScheduleSourceSelection(intakeDraft?.scheduleSourceId || "", scheduleSources).source;
    if (!selectedSource || selectedSource.sourceKind !== "document") {
      setPairingError("先选择要更新的材料日程来源。");
      return;
    }
    setPairingBusy(true);
    setPairingError("");
    setPairingPreview(null);
    setPairingChoices({});
    try {
      const response = await fetch("/api/edupi/document-pairings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stagingId: item.staging_id, sourceId: selectedSource.sourceId, sourceFingerprint: selectedSource.fingerprint }),
      });
      const result = await response.json() as DocumentPairingPreview & { error?: string };
      if (!response.ok) throw new Error(result.error || "逐项配对预览失败。");
      if (result.stagingId !== item.staging_id || result.sourceId !== selectedSource.sourceId || result.sourceFingerprint !== selectedSource.fingerprint
        || !/^sha256:[a-f0-9]{64}$/u.test(result.recognitionFingerprint) || !Array.isArray(result.groups)
        || result.groups.length > 200) throw new Error("逐项配对预览已失效，请重试。");
      setPairingPreview(result);
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : "逐项配对预览失败。");
      void loadScheduleSources();
    } finally {
      setPairingBusy(false);
    }
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
      if (item.kind === "calendar" && sourceUnavailable.calendar
        || documentScheduleSource(item) && (sourceUnavailable.calendar || sourceUnavailable.timetable)) {
        setOperationError("来源读取失败，请重试。");
        void loadScheduleSources();
        return;
      }
      const sourceSelection = resolveScheduleSourceSelection(intakeDraft.scheduleSourceId, scheduleSources);
      if (sourceSelection.state === "stale") {
        setOperationError("所选日程来源已变化，请重新选择");
        void loadScheduleSources();
        return;
      }
      let pairing: DocumentPairingSubmission | null = null;
      if (pairingPreview) {
        if (pairingPreview.stagingId !== item.staging_id || sourceSelection.source?.sourceId !== pairingPreview.sourceId
          || sourceSelection.source.fingerprint !== pairingPreview.sourceFingerprint) {
          setOperationError("日程来源已变化，请重新逐项配对。");
          setPairingPreview(null);
          return;
        }
        if (pairingPreview.groups.length > 0) {
          try {
            pairing = documentPairingSubmission(pairingPreview, pairingChoices);
          } catch (error) {
            setOperationError(error instanceof Error ? error.message : "逐项配对已失效，请重新核对。");
            return;
          }
        }
      }
      await onIntakeMaterial(item, { ...intakeDraft, title: intakeDraft.title.trim(), subject: intakeDraft.subject.trim(), classId: intakeDraft.classId.trim() },
        item.kind === "calendar" || documentScheduleSource(item) ? sourceSelection.source : null, pairing);
      setIntakeDraft(null);
      setPairingPreview(null);
      setPairingChoices({});
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
        const sourceOptions = calendar ? scheduleSources.filter((source) => source.sourceKind !== "timetable") : scheduleSources;
        return <div className="edupi-material-inbox__item" key={item.staging_id}>
          <div className="edupi-material-inbox__row">
            <strong>{item.original_name}</strong><span>{Math.ceil(item.expected_size_bytes / 1024)} KB</span>
            <button type="button" disabled={stagingBusy || !itemReady} title={!itemReady ? data.capabilities.materialIntake.reason : undefined} onClick={() => {
              if (intakeDraft?.stagingId === item.staging_id) {
                setIntakeDraft(null); setPairingPreview(null); setPairingChoices({}); setPairingError("");
              } else beginIntake(item);
            }}>{intakeDraft?.stagingId === item.staging_id ? "取消" : calendar ? "导入日历" : "接入 EduPi"}</button>
            <button type="button" disabled={stagingBusy} onClick={() => void onRemoveStagedMaterial(item)}>移除</button>
          </div>
          {intakeDraft?.stagingId === item.staging_id ? <form className="edupi-material-intake-form" onSubmit={(event) => void submitIntake(event, item)}>
            {calendar ? <>
              <label>导入方式<select value={intakeDraft.scheduleSourceId} onChange={(event) => setIntakeDraft({ ...intakeDraft, scheduleSourceId: event.target.value })}>
                <option value="">作为新日历</option>
                {sourceOptions.map((source) => <option value={source.selectionKey || source.sourceId} key={source.selectionKey || source.sourceId}>更新{source.sourceKind === "calendar" ? "日历" : "材料"}：{source.label}</option>)}
              </select></label>
              {intakeDraft.scheduleSourceId ? <p>更新可能撤回该来源的旧安排，请确认来源。</p> : null}
              <button type="submit" className="is-primary" disabled={stagingBusy || sourceUnavailable.calendar}>{intakeDraft.scheduleSourceId ? "确认更新" : "确认导入"}</button>
            </> : <>
              <label>材料名称<input required maxLength={240} value={intakeDraft.title} onChange={(event) => setIntakeDraft({ ...intakeDraft, title: event.target.value })} /></label>
              <label>材料类型<select value={intakeDraft.materialKind} onChange={(event) => setIntakeDraft({ ...intakeDraft, materialKind: event.target.value as MaterialIntakeMetadata["materialKind"] })}><option value="worksheet">学案 / 练习</option><option value="lesson_note">教案 / 备课</option><option value="assessment">测验 / 作业</option><option value="classroom_record">课堂记录</option><option value="other">其他</option></select></label>
              <label>学科<input required maxLength={120} value={intakeDraft.subject} onChange={(event) => setIntakeDraft({ ...intakeDraft, subject: event.target.value })} /></label>
              <label>班级{classes.length ? <select required value={intakeDraft.classId} onChange={(event) => setIntakeDraft({ ...intakeDraft, classId: event.target.value })}><option value="">选择班级</option>{classes.map(item => <option value={item} key={item}>{item}</option>)}</select> : <input required maxLength={160} value={intakeDraft.classId} onChange={(event) => setIntakeDraft({ ...intakeDraft, classId: event.target.value })} />}</label>
              {documentSchedule && documentScheduleReady ? <><label>日程或课表来源<select value={intakeDraft.scheduleSourceId} onChange={(event) => {
                setIntakeDraft({ ...intakeDraft, scheduleSourceId: event.target.value });
                setPairingPreview(null); setPairingChoices({}); setPairingError("");
              }}>
                <option value="">作为新材料来源</option>
                {sourceOptions.map((source) => <option value={source.selectionKey || source.sourceId} key={source.selectionKey || source.sourceId}>更新{source.sourceKind === "timetable" ? "课表" : source.sourceKind === "calendar" ? "日历" : "材料"}：{source.label}</option>)}
              </select></label>{intakeDraft.scheduleSourceId ? <p>只增量更新，未识别到的旧安排不会自动撤回。</p> : null}
              {sourceOptions.some(source => (source.selectionKey || source.sourceId) === intakeDraft.scheduleSourceId && source.sourceKind === "document")
                ? <button type="button" disabled={stagingBusy || pairingBusy} onClick={() => void previewPairings(item)}>{pairingBusy ? "正在识别…" : "逐项配对"}</button> : null}
              {pairingError ? <p className="edupi-material-pairing-error" role="alert">{pairingError}</p> : null}
              {pairingPreview?.stagingId === item.staging_id && pairingPreview.sourceId === intakeDraft.scheduleSourceId
                ? <section className="edupi-material-pairing" aria-label="逐项配对">
                  {pairingPreview.groups.length === 0 ? <p>没有需要逐项配对的事项。</p> : <>
                    <h3>逐项配对</h3>
                    {pairingPreview.groups.flatMap(group => [
                      <div className="edupi-material-pairing__current" key={`${group.anchor}-current`}>
                        <strong>原事项</strong>
                        {group.current.map((current, index) => <div key={current.sourceOccurrenceRef}>
                          <span>{index + 1}. {pairingLabel(current)}</span>
                          {current.notes ? <p>备注：{current.notes}</p> : null}
                        </div>)}
                      </div>,
                      ...group.incoming.map(incoming => <label key={incoming.variantRef}>
                      <span>新材料：{pairingLabel(incoming)}{incoming.notes ? <small>备注：{incoming.notes}</small> : null}</span>
                      <select required aria-label={`为 ${pairingLabel(incoming)}${incoming.notes ? `，备注 ${incoming.notes}` : ""} 选择原事项`} value={pairingChoices[incoming.variantRef] || ""}
                        onChange={event => setPairingChoices({ ...pairingChoices, [incoming.variantRef]: event.target.value })}>
                        <option value="">选择原事项</option>
                        <option value="__new">这是新增事项</option>
                        {group.current.map((current, index) => <option key={current.sourceOccurrenceRef} value={String(index)}
                          disabled={Object.entries(pairingChoices).some(([variant, value]) => variant !== incoming.variantRef
                            && group.incoming.some(item => item.variantRef === variant) && value === String(index))}>
                          原事项 {index + 1} · {pairingLabel(current)}
                        </option>)}
                      </select>
                    </label>)])}
                    <p>未配对的旧事项会保留。</p>
                  </>}
                </section> : null}</> : null}
              <button type="submit" className="is-primary" disabled={stagingBusy || pairingBusy
                || documentSchedule && (sourceUnavailable.calendar || sourceUnavailable.timetable)}>确认接入</button>
            </>}
          </form> : null}
        </div>;
      })}</div>
      {!materialIntakeReady && stagedMaterials.some((item) => item.kind !== "calendar") ? <p className="edupi-material-capability-note" role="status">{data.capabilities.materialIntake.reason}</p> : null}
      {!calendarIntakeReady && stagedMaterials.some((item) => item.kind === "calendar") ? <p className="edupi-material-capability-note" role="status">Core 尚未启用安全的日历更新。</p> : null}
    </details> : null}
    {stagingMessage ? <p className={`edupi-material-message${stagingMessage.tone === "error" ? " is-error" : ""}`} role={stagingMessage.tone === "error" ? "alert" : "status"}>{stagingMessage.text}</p> : null}
    {generatedError ? <p className="edupi-material-message" role="status">对话生成文件索引暂不可用</p> : null}
    {operationError ? <p role="alert">{operationError}</p> : null}
    {scheduleSourceError && sourceErrorRelevant ? <p className="edupi-material-message is-error" role="alert">{scheduleSourceError} <button type="button" className="native-button" onClick={() => void loadScheduleSources()}>重试</button></p> : null}
    {archivedId ? <p role="status">已移出材料，原文件保留。<button className="native-button" onClick={async () => { const response = await fetch("/api/edupi/artifacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", artifactId: archivedId }) }); if (response.ok) { setArchivedId(null); window.dispatchEvent(new Event("edupi-artifacts-updated")); } }}>撤销</button></p> : null}
    <section className="edupi-database"><div className="edupi-database__head edupi-material-db-grid"><span>材料</span><span>类型</span><span>学科 / 班级</span><span>来源</span><span>日期</span><span>状态</span></div>{visible.map((item) => <button type="button" className="edupi-database-button-row edupi-material-db-grid" key={item.id} onClick={() => openSelected(item)}><strong>{item.title}</strong><span>{item.type}</span><span>{item.subject}</span><span>{item.source}</span><time>{shortDate(item.date)}</time><span>{item.status}</span></button>)}{visible.length === 0 ? <div className="edupi-database__empty">{materialSource.present || stagedMaterials.length > 0 ? "数据已连接，当前分类暂无材料" : "材料索引尚未接入"}</div> : null}</section>
    <EduPiPagination label="材料分页" page={page} pages={pages} previousDisabled={page === 0} nextDisabled={page >= pages - 1} onPrevious={() => setPage((value) => value - 1)} onNext={() => setPage((value) => value + 1)}/>
    {selected ? <aside ref={drawerRef} className="edupi-material-drawer" role="dialog" aria-modal="true" aria-label={`${selected.title}材料详情`}><header><div><span>{selected.type}</span><h2>{selected.title}</h2></div><EduPiIconButton type="button" icon="close" label="关闭材料详情" data-autofocus onClick={closeSelected}/></header><div className="edupi-material-drawer__body"><dl className="edupi-material-drawer__facts"><div><dt>状态</dt><dd>{selected.status}</dd></div><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>学科 / 班级</dt><dd>{selected.subject}</dd></div><div><dt>日期</dt><dd>{shortDate(selected.date)}</dd></div><div><dt>说明</dt><dd>{selected.summary}</dd></div></dl><EduPiOperationHistory rows={selectedHistory} />{selected.material ? <EduPiMaterialMetadataEditor material={selected.material} classes={classes} onEducation={onEducation} onStartAgent={onStartAgent} /> : null}{selected.deleteKind === "material" ? <EduPiMaterialExcerpt key={selected.id} materialId={selected.id} onPreview={selected.filePath ? () => onOpenFile(selected.filePath!) : undefined} /> : null}</div><footer>{selected.filePath ? <EduPiIconButton type="button" icon="preview" label="预览材料" onClick={() => onOpenFile(selected.filePath!)}/> : null}{selected.filePath && isTauriDesktop() ? <><EduPiIconButton type="button" icon="open" label="打开文件" onClick={() => void openNative("open")}/><EduPiIconButton type="button" icon="reveal" label="显示所在文件夹" onClick={() => void openNative("reveal")}/></> : null}{selected.task ? <EduPiIconButton type="button" icon="task" label="打开关联任务" onClick={() => onTask(selected.task!)}/> : null}{canDeleteSelected ? <EduPiIconButton type="button" icon="delete" label={deleteBusy ? "正在删除材料" : "删除材料"} className="is-delete" busy={deleteBusy} disabled={deleteBusy} onClick={() => void deleteSelected()}/> : null}{!selected.material ? <EduPiIconButton type="button" icon="agent" label="补充或修订材料" className="is-primary" onClick={openMaterialAgent}/> : null}</footer></aside> : null}
  </main>;
}
