"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import { MATERIAL_CATEGORIES, materialCategoryRoute, materialItemRoute } from "@/lib/edupi-domain-navigation";
import type { MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { appendTeacherInputSlot } from "@/lib/edupi-teacher-input-slot";
import { buildMaterialRows, defaultMaterialIntakeMetadata, type MaterialIntakeMetadata, type MaterialRow } from "@/lib/edupi-material-rows";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { EduPiMaterialExcerpt } from "./EduPiMaterialExcerpt";
import { intakeOperationHistory } from "@/lib/edupi-operation-history";
import { EduPiOperationHistory } from "./EduPiOperationHistory";

const PAGE_SIZE = 8;

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}


export function EduPiMaterialsWorkspace({ data, context, query, selectedObjectId, stagedMaterials, stagingBusy, stagingMessage, onTask, onUpload, onIntakeMaterial, onRemoveStagedMaterial, onOpenFile, onStartAgent, onDeleteEntity }: { data: EducationContract; context: TeacherContextSnapshot | null; query: string; selectedObjectId: string | null; stagedMaterials: MaterialStagingDescriptor[]; stagingBusy: boolean; stagingMessage: string | null; onTask: (task: TeacherTask) => void; onUpload: () => void; onIntakeMaterial: (item: MaterialStagingDescriptor, metadata: MaterialIntakeMetadata) => Promise<unknown>; onRemoveStagedMaterial: (item: MaterialStagingDescriptor) => Promise<void>; onOpenFile: (path: string) => void; onStartAgent: (prompt: string, mode?: "insert" | "replace") => void; onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean> }) {
  const category = materialCategoryRoute(selectedObjectId);
  const focusedMaterialId = materialItemRoute(selectedObjectId);
  const categoryLabel = MATERIAL_CATEGORIES.find((item) => item.id === category)?.label || "全部材料";
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<MaterialRow | null>(null);
  const drawerRef = useModalDismiss<HTMLElement>(() => setSelected(null), Boolean(selected));
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [archivedId, setArchivedId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState("");
  const [intakeDraft, setIntakeDraft] = useState<(MaterialIntakeMetadata & { stagingId: string }) | null>(null);
  const classes = useMemo(() => [...new Set((context?.classes || []).map(value => value.trim()).filter(Boolean))], [context?.classes]);
  const generatedError = data.generatedArtifactsUnavailable;
  const materialIntakeReady = data.capabilities.materialIntake.enabled;
  const rows = useMemo(() => buildMaterialRows(data, query).filter(item => category === "all" || item.category === category), [data, query, category]);
  useEffect(() => { setPage(0); setSelected(null); }, [category, query]);
  useEffect(() => {
    if (!focusedMaterialId) return;
    const index = rows.findIndex((item) => item.id === focusedMaterialId);
    if (index < 0) return;
    setPage(Math.floor(index / PAGE_SIZE));
    setSelected(rows[index]);
  }, [focusedMaterialId, rows]);
  useEffect(() => {
    if (intakeDraft && !stagedMaterials.some(item => item.staging_id === intakeDraft.stagingId)) setIntakeDraft(null);
  }, [intakeDraft, stagedMaterials]);
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
        setArchivedId(selected.id); setSelected(null);
        window.dispatchEvent(new Event("edupi-artifacts-updated"));
        return;
      }
      const deleted = selected.deleteKind === "task" && selected.task?.id
        ? await onDeleteEntity("task", selected.task.id, selected.title)
        : await onDeleteEntity("material", selected.id, selected.title);
      if (deleted) setSelected(null);
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
    setIntakeDraft({ stagingId: item.staging_id, ...defaultMaterialIntakeMetadata(item.original_name, context) });
  };
  const submitIntake = async (event: FormEvent, item: MaterialStagingDescriptor) => {
    event.preventDefault();
    if (!intakeDraft || intakeDraft.stagingId !== item.staging_id || !intakeDraft.title.trim() || !intakeDraft.subject.trim() || !intakeDraft.classId.trim()) {
      setOperationError("请填写材料名称、学科和班级");
      return;
    }
    setOperationError("");
    try {
      await onIntakeMaterial(item, { ...intakeDraft, title: intakeDraft.title.trim(), subject: intakeDraft.subject.trim(), classId: intakeDraft.classId.trim() });
      setIntakeDraft(null);
    } catch { /* Parent surface reports the bounded intake error. */ }
  };

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><span>材料</span><h1>{categoryLabel}</h1><p>{materialSource.present ? "数据已连接" : "材料索引尚未接入"} · {rows.length} 份材料 · {stagedMaterials.length} 份待接入</p></div><button type="button" disabled={stagingBusy} onClick={onUpload}>{stagingBusy ? "处理中…" : "上传材料"}</button></header>
    {stagedMaterials.length > 0 ? <details className="edupi-material-inbox" open><summary>待接入材料 <span>{stagedMaterials.length}</span></summary><div>{stagedMaterials.map((item) => <div className="edupi-material-inbox__item" key={item.staging_id}><div className="edupi-material-inbox__row"><strong>{item.original_name}</strong><span>{Math.ceil(item.expected_size_bytes / 1024)} KB</span><button type="button" disabled={stagingBusy || !materialIntakeReady} title={!materialIntakeReady ? data.capabilities.materialIntake.reason : undefined} onClick={() => intakeDraft?.stagingId === item.staging_id ? setIntakeDraft(null) : beginIntake(item)}>{intakeDraft?.stagingId === item.staging_id ? "取消" : "接入 EduPi"}</button><button type="button" disabled={stagingBusy} onClick={() => void onRemoveStagedMaterial(item)}>移除</button></div>{intakeDraft?.stagingId === item.staging_id ? <form className="edupi-material-intake-form" onSubmit={(event) => void submitIntake(event, item)}><label>材料名称<input required maxLength={240} value={intakeDraft.title} onChange={(event) => setIntakeDraft({ ...intakeDraft, title: event.target.value })} /></label><label>材料类型<select value={intakeDraft.materialKind} onChange={(event) => setIntakeDraft({ ...intakeDraft, materialKind: event.target.value as MaterialIntakeMetadata["materialKind"] })}><option value="worksheet">学案 / 练习</option><option value="lesson_note">教案 / 备课</option><option value="assessment">测验 / 作业</option><option value="classroom_record">课堂记录</option><option value="other">其他</option></select></label><label>学科<input required maxLength={120} value={intakeDraft.subject} onChange={(event) => setIntakeDraft({ ...intakeDraft, subject: event.target.value })} /></label><label>班级{classes.length ? <select required value={intakeDraft.classId} onChange={(event) => setIntakeDraft({ ...intakeDraft, classId: event.target.value })}><option value="">选择班级</option>{classes.map(item => <option value={item} key={item}>{item}</option>)}</select> : <input required maxLength={160} value={intakeDraft.classId} onChange={(event) => setIntakeDraft({ ...intakeDraft, classId: event.target.value })} />}</label><button type="submit" className="is-primary" disabled={stagingBusy}>确认接入</button></form> : null}</div>)}</div>{!materialIntakeReady ? <p className="edupi-material-capability-note" role="status">{data.capabilities.materialIntake.reason}</p> : null}</details> : null}
    {stagingMessage ? <p className="edupi-material-message" role="status">{stagingMessage}</p> : null}
    {generatedError ? <p className="edupi-material-message" role="status">对话生成文件索引暂不可用</p> : null}
    {operationError ? <p role="alert">{operationError}</p> : null}
    {archivedId ? <p role="status">已移出材料，原文件保留。<button className="native-button" onClick={async () => { const response = await fetch("/api/edupi/artifacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", artifactId: archivedId }) }); if (response.ok) { setArchivedId(null); window.dispatchEvent(new Event("edupi-artifacts-updated")); } }}>撤销</button></p> : null}
    <section className="edupi-database"><div className="edupi-database__head edupi-material-db-grid"><span>材料</span><span>类型</span><span>学科 / 班级</span><span>来源</span><span>日期</span><span>状态</span></div>{visible.map((item) => <button type="button" className="edupi-database-button-row edupi-material-db-grid" key={item.id} onClick={() => setSelected(item)}><strong>{item.title}</strong><span>{item.type}</span><span>{item.subject}</span><span>{item.source}</span><time>{shortDate(item.date)}</time><span>{item.status}</span></button>)}{visible.length === 0 ? <div className="edupi-database__empty">{materialSource.present || stagedMaterials.length > 0 ? "数据已连接，当前分类暂无材料" : "材料索引尚未接入"}</div> : null}</section>
    <nav className="edupi-database-pagination" aria-label="材料分页"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>
    {selected ? <aside ref={drawerRef} className="edupi-material-drawer" role="dialog" aria-modal="true" aria-label={`${selected.title}材料详情`}><header><div><span>{selected.type}</span><h2>{selected.title}</h2></div><button type="button" data-autofocus onClick={() => setSelected(null)} aria-label="关闭材料详情">×</button></header><dl><div><dt>状态</dt><dd>{selected.status}</dd></div><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>学科 / 班级</dt><dd>{selected.subject}</dd></div><div><dt>日期</dt><dd>{shortDate(selected.date)}</dd></div><div><dt>说明</dt><dd>{selected.summary}</dd></div></dl><EduPiOperationHistory rows={selectedHistory} />{selected.deleteKind === "material" ? <EduPiMaterialExcerpt key={selected.id} materialId={selected.id} onPreview={selected.filePath ? () => onOpenFile(selected.filePath!) : undefined} /> : null}<footer>{selected.filePath ? <button type="button" onClick={() => onOpenFile(selected.filePath!)}>预览</button> : null}{selected.filePath && isTauriDesktop() ? <><button type="button" onClick={() => void openNative("open")}>打开文件</button><button type="button" onClick={() => void openNative("reveal")}>显示所在文件夹</button></> : null}{selected.task ? <button type="button" onClick={() => onTask(selected.task!)}>关联任务</button> : null}{canDeleteSelected ? <button type="button" className="is-delete" disabled={deleteBusy} onClick={() => void deleteSelected()}>{deleteBusy ? "删除中…" : "删除材料"}</button> : null}<button type="button" className="is-primary" onClick={openMaterialAgent}>补充 / 修订</button></footer></aside> : null}
  </main>;
}
