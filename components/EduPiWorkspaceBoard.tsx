"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { EducationContract, EducationWorkCandidate, EducationWorkCase, TeacherTask } from "@/lib/edupi-education-contract";
import { workCaseForTask, workCaseStateLabel } from "@/lib/edupi-work-case";
import { projectTaskBoard, taskBoardLane, taskBoardTargets, type TaskBoardLaneId } from "@/lib/edupi-task-board";
import { taskCategory, TASK_CATEGORY_CONFIG, type TaskCategoryId } from "@/lib/edupi-task-category";
import type { TaskSessionBinding } from "@/lib/edupi-task-sessions";
import { taskContentStatusLabel, taskDisplayTitle, taskPresentation, taskStatusLabel, taskTypeLabel } from "@/lib/edupi-workbench";
import type { CreateTeacherTaskInput, CreateTeacherTaskOutcome } from "@/lib/edupi-task-board-command";
import { dateBefore, lessonDateMatchesSlot, MAX_PREPARATION_MATERIALS, preparationDeliverables, timetableDayOfWeek, timetableSlotId as slotId } from "@/lib/edupi-teacher-task-form";

type Props = {
  data: EducationContract;
  query: string;
  onTaskDetail: (task: TeacherTask) => void;
  onCreateTask: (input: CreateTeacherTaskInput) => Promise<CreateTeacherTaskOutcome>;
  onMoveTask: (task: TeacherTask, stage: TaskBoardLaneId) => Promise<void>;
  mergeSuggestions?: ReactNode;
};

const stageLabels: Record<TaskBoardLaneId, string> = { todo: "待处理", progress: "进行中", review: "待我确认", done: "已完成" };
const DEFAULT_PREPARATION_DELIVERABLES = ["本节教案", "学生学案", "练习与参考答案", "材料准备清单"];
const weekdayLabels = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function rawText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function taskDate(task: TeacherTask): string {
  return task.dueDate || task.triggerDate || task.sourceEventDate || "日期待确认";
}

function taskSource(task: TeacherTask): string {
  return task.student || task.topic || task.sourceEventName || "教师内部";
}

function taskState(task: TeacherTask, session: TaskSessionBinding | null, lane: TaskBoardLaneId, candidate: EducationWorkCandidate | null, workCase: EducationWorkCase | null): string {
  if (workCase && (workCase.currentState !== "planned" || !task.boardStage || task.boardStage === "todo")) return workCaseStateLabel(workCase.currentState);
  const contentStatus = taskContentStatusLabel(task);
  if (contentStatus) return taskPresentation(task).label;
  if (task.boardStage) return taskPresentation(task).label;
  if (candidate?.status === "modified") return "修改后接受";
  if (candidate?.status === "accepted") return "已接受";
  if (candidate?.status === "rejected") return "已拒绝";
  if (candidate?.status === "suppressed") return "已停止提示";
  if (lane === "done") return taskStatusLabel(task);
  if (lane === "review") return "等待教师";
  if (session?.status === "running") return "Agent 运行中";
  if (session?.status === "idle") return "继续协作";
  if (session?.status === "missing") return "协作待恢复";
  return task.status === "hold" ? "已暂缓" : "待开始";
}

function stageAtPoint(x: number, y: number): TaskBoardLaneId | null {
  const stage = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-board-stage]")?.dataset.boardStage;
  return stage === "todo" || stage === "progress" || stage === "review" || stage === "done" ? stage : null;
}

function TaskCard({ task, session, lane, candidate, workCase, busy, selected, dragSource, onSelect, onOpen, onCardPointerDown, onHandlePointerDown, onMove }: {
  task: TeacherTask;
  session: TaskSessionBinding | null;
  lane: TaskBoardLaneId;
  candidate: EducationWorkCandidate | null;
  workCase: EducationWorkCase | null;
  busy: boolean;
  selected: boolean;
  dragSource: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onCardPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onHandlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onMove: (stage: TaskBoardLaneId) => void;
}) {
  const title = taskDisplayTitle(task);
  const visibleFlowState = workCase?.currentState === "planned" && task.boardStage && task.boardStage !== "todo" ? task.boardStage : workCase?.currentState || lane;
  const selectId = `edupi-task-move-${String(task.id || title).replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return (
    <article className={`edupi-task-board-card${workCase ? " has-flow" : ""}${busy ? " is-moving" : ""}${selected ? " is-selected" : ""}${dragSource ? " is-drag-source" : ""}`} aria-busy={busy || undefined} onPointerDown={onCardPointerDown}>
      <button type="button" className="edupi-task-board-card__open" onClick={(event) => { if (event.detail === 0) onOpen(); else onSelect(); }} onDoubleClick={onOpen} aria-label={`${title}，${taskState(task, session, lane, candidate, workCase)}，双击打开`} aria-pressed={selected}>
        <span className="edupi-task-board-card__topline"><span>{taskTypeLabel(task)}</span><time>{taskDate(task)}</time></span>
        <strong>{title}</strong>
        <span className="edupi-task-board-card__source">{taskSource(task)}</span>
      </button>
      <footer className="edupi-task-board-card__footer">
        <span className="edupi-task-board-card__handle" onPointerDown={(event) => { event.stopPropagation(); onHandlePointerDown(event); }} title="拖动任务" aria-hidden="true">⠿</span>
        <span><i className={`edupi-flow-state is-${visibleFlowState}`} aria-hidden="true" />{busy ? "正在移动" : taskState(task, session, lane, candidate, workCase)}</span>
        <label className="edupi-visually-hidden" htmlFor={selectId}>移动到</label>
        <select id={selectId} value="" disabled={busy} onChange={(event) => { const value = event.target.value as TaskBoardLaneId; if (value) onMove(value); }}>
          <option value="">移动到</option>
          {taskBoardTargets(lane).map((stage) => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}
        </select>
      </footer>
    </article>
  );
}

export function EduPiWorkspaceBoard({ data, query, onTaskDetail, onCreateTask, onMoveTask, mergeSuggestions }: Props) {
  const [category, setCategory] = useState<"all" | TaskCategoryId>("all");
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [managedPreparation, setManagedPreparation] = useState(false);
  const [timetableSlotId, setTimetableSlotId] = useState("");
  const [lessonDate, setLessonDate] = useState("");
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [deliverables, setDeliverables] = useState(DEFAULT_PREPARATION_DELIVERABLES.join("\n"));
  const dueDateManuallyEditedRef = useRef(false);
  const draggedTaskIdRef = useRef<string | null>(null);
  const pendingCreateRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const dragStartRef = useRef<{ id: string; x: number; y: number; offX: number; offY: number; width: number } | null>(null);
  const suppressClickRef = useRef(false);
  const ghostFrameRef = useRef(0);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<{ id: string; x: number; y: number; offX: number; offY: number; width: number } | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskBoardLaneId | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const scopedTasks = category === "all" ? data.tasks : data.tasks.filter((task) => taskCategory(task) === category);
  const columns = projectTaskBoard(scopedTasks, data.taskSessions, data.workCandidates, query);
  const candidateByTask = new Map(data.workCandidates.map((candidate) => [candidate.taskId, candidate]));
  const taskById = new Map(data.tasks.filter((task) => task.id).map((task) => [task.id!, task]));
  const visibleCount = columns.reduce((total, column) => total + column.tasks.length, 0);
  const usableSlots = data.timetable.filter((slot) => slotId(slot) && timetableDayOfWeek(slot) && rawText(slot.subject) && rawText(slot.class_name));
  const activeSlotId = timetableSlotId || slotId(usableSlots[0] || {});
  const activeSlot = usableSlots.find((slot) => slotId(slot) === activeSlotId) || null;
  const activeSubject = rawText(activeSlot?.subject);
  const activeClass = rawText(activeSlot?.class_name);
  const compatibleMaterials = useMemo(() => (data.teacherMaterials || []).filter((material) => material.available !== false
    && material.subject === activeSubject && material.class_id === activeClass), [activeClass, activeSubject, data.teacherMaterials]);
  const compatibleMaterialIds = useMemo(() => new Set(compatibleMaterials.map((material) => material.material_id)), [compatibleMaterials]);
  useEffect(() => setMaterialIds((current) => {
    const next = current.filter((id) => compatibleMaterialIds.has(id));
    return next.length === current.length ? current : next;
  }), [compatibleMaterialIds]);
  const deliverableValidation = preparationDeliverables(deliverables);
  const requestedDeliverables = deliverableValidation.items;
  const lessonDateValid = Boolean(activeSlot && lessonDateMatchesSlot(lessonDate, activeSlot));
  const lessonDateError = activeSlot && lessonDate && !lessonDateValid
    ? `请选择${weekdayLabels[timetableDayOfWeek(activeSlot) || 0]}对应的上课日期。`
    : null;
  const canCreate = Boolean(title.trim()) && (!managedPreparation || Boolean(activeSlot && lessonDateValid
    && materialIds.length > 0 && materialIds.length <= MAX_PREPARATION_MATERIALS
    && materialIds.every((id) => compatibleMaterialIds.has(id))
    && requestedDeliverables.length > 0 && !deliverableValidation.error));

  const stopDragging = () => {
    draggedTaskIdRef.current = null;
    dragStartRef.current = null;
    if (ghostFrameRef.current) { cancelAnimationFrame(ghostFrameRef.current); ghostFrameRef.current = 0; }
    setDraggedTaskId(null);
    setDragGhost(null);
    setDropTarget(null);
  };

  const queueGhostPosition = (x: number, y: number) => {
    if (ghostFrameRef.current) return;
    ghostFrameRef.current = requestAnimationFrame(() => {
      ghostFrameRef.current = 0;
      setDragGhost((ghost) => (ghost ? { ...ghost, x, y } : ghost));
    });
  };

  const beginDrag = (start: { id: string; offX: number; offY: number; width: number }, x: number, y: number) => {
    draggedTaskIdRef.current = start.id;
    setDraggedTaskId(start.id);
    setDragGhost({ id: start.id, x, y, offX: start.offX, offY: start.offY, width: start.width });
  };

  const dragTarget = (event: ReactPointerEvent<HTMLElement>) => {
    const task = draggedTaskIdRef.current ? taskById.get(draggedTaskIdRef.current) : null;
    if (!task) return null;
    const source = taskBoardLane(task, task.id ? data.taskSessions[task.id] ?? null : null, task.id ? candidateByTask.get(task.id) : null);
    const stage = stageAtPoint(event.clientX, event.clientY);
    return stage && taskBoardTargets(source).includes(stage) ? { task, stage } : null;
  };

  const move = async (task: TeacherTask, stage: TaskBoardLaneId) => {
    const current = taskBoardLane(task, task.id ? data.taskSessions[task.id] : null, task.id ? candidateByTask.get(task.id) : null);
    if (!taskBoardTargets(current).includes(stage)) {
      setMessage({ tone: "error", text: `不能从“${stageLabels[current]}”直接移动到“${stageLabels[stage]}”。` });
      return;
    }
    setMovingTaskId(task.id);
    setMessage(null);
    try {
      await onMoveTask(task, stage);
      setMessage({ tone: "success", text: `已移动到“${stageLabels[stage]}”。` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "任务移动失败。" });
    } finally {
      setMovingTaskId(null);
      stopDragging();
    }
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || creating) return;
    setCreating(true);
    setMessage(null);
    try {
      const requested: Omit<CreateTeacherTaskInput, "clientRequestId"> = {
        title: title.trim(),
        dueDate: dueDate || null,
        note: note.trim() || null,
        preparationSource: managedPreparation ? { kind: "teaching_before_class", timetableSlotId: activeSlotId, lessonDate, materialIds, deliverables: requestedDeliverables } : null,
      };
      const fingerprint = JSON.stringify(requested);
      if (pendingCreateRef.current?.fingerprint !== fingerprint) pendingCreateRef.current = { fingerprint, id: crypto.randomUUID() };
      const result = await onCreateTask({ clientRequestId: pendingCreateRef.current.id, ...requested });
      pendingCreateRef.current = null;
      setTitle("");
      setDueDate("");
      dueDateManuallyEditedRef.current = false;
      setNote("");
      setManagedPreparation(false);
      setTimetableSlotId("");
      setLessonDate("");
      setMaterialIds([]);
      setDeliverables(DEFAULT_PREPARATION_DELIVERABLES.join("\n"));
      setCreateOpen(false);
      setMessage(result.preparationState === "error"
        ? { tone: "error", text: `任务已创建；Core 尚未启动：${result.preparationError || "请打开任务后重试"}` }
        : { tone: "success", text: result.preparationState ? "任务已创建，Core 正在准备教学产物。" : "任务已创建到“待处理”。" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "任务创建失败。" });
    } finally {
      setCreating(false);
    }
  };

  const ghostTask = draggedTaskId ? taskById.get(draggedTaskId) ?? null : null;
  return (
    <main className="edupi-workspace-board" onPointerMove={(event) => { if (!draggedTaskIdRef.current) { const start = dragStartRef.current; if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 6) return; suppressClickRef.current = true; beginDrag(start, event.clientX, event.clientY); } queueGhostPosition(event.clientX, event.clientY); setDropTarget(dragTarget(event)?.stage ?? null); }} onPointerUp={(event) => { const target = dragTarget(event); stopDragging(); if (target) void move(target.task, target.stage); }} onPointerCancel={stopDragging} onPointerLeave={() => { if (draggedTaskIdRef.current) stopDragging(); }}>
      <header className="edupi-workspace-board__heading">
        <div><span>教师工作</span><h1>工作区</h1><p>{query.trim() ? `找到 ${visibleCount} 项` : `${data.tasks.length} 项任务`}</p></div>
        <div className="edupi-workspace-board__actions"><span className="edupi-workspace-board__mode"><i aria-hidden="true" />Core 回执流转</span><button type="button" onClick={() => setCreateOpen((open) => !open)}>新建任务</button></div>
      </header>
      {mergeSuggestions}
      <div className="edupi-task-category-segment" role="group" aria-label="任务类型">
        <button type="button" className={category === "all" ? "is-active" : ""} onClick={() => setCategory("all")} aria-pressed={category === "all"}>全部 <span>{data.tasks.length}</span></button>
        {TASK_CATEGORY_CONFIG.map((item) => { const count = data.tasks.filter((task) => taskCategory(task) === item.id).length; return count > 0 ? <button type="button" key={item.id} className={category === item.id ? "is-active" : ""} onClick={() => setCategory(item.id)} aria-pressed={category === item.id}>{item.label} <span>{count}</span></button> : null; })}
      </div>
      {createOpen ? <form className="edupi-task-board-create" onSubmit={submitCreate}>
        <label><span>任务</span><input autoFocus required maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：准备第一次单元检测" /></label>
        <label><span>截止日期</span><input type="date" value={dueDate} onInput={(event) => { dueDateManuallyEditedRef.current = true; setDueDate(event.currentTarget.value); }} /></label>
        <label><span>备注</span><input maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选" /></label>
        <label className="edupi-task-board-create__managed"><input type="checkbox" checked={managedPreparation} onChange={(event) => { setManagedPreparation(event.target.checked); if (event.target.checked && !timetableSlotId) setTimetableSlotId(slotId(usableSlots[0] || {})); }} /><span>由 Core 准备教学产物</span></label>
        {managedPreparation ? <div className="edupi-task-board-create__source">
          <label><span>课次</span><select value={activeSlotId} onChange={(event) => { setTimetableSlotId(event.target.value); setMaterialIds([]); }}><option value="">选择课次</option>{usableSlots.map((slot) => <option key={slotId(slot)} value={slotId(slot)}>{weekdayLabels[timetableDayOfWeek(slot) || 0]} · {rawText(slot.subject)} · {rawText(slot.class_name)} · 第 {String(slot.period ?? "?")} 节</option>)}</select></label>
          <label><span>上课日期</span><input type="date" value={lessonDate} onChange={(event) => { const nextDate = event.target.value; setLessonDate(nextDate); if (!dueDateManuallyEditedRef.current) setDueDate(dateBefore(nextDate)); }} /></label>
          {lessonDateError ? <p role="alert">{lessonDateError}</p> : null}
          <fieldset><legend>材料</legend>{compatibleMaterials.map((material) => { const checked = materialIds.includes(material.material_id); return <label key={material.material_id}><input type="checkbox" aria-label={material.title} checked={checked} disabled={!checked && materialIds.length >= MAX_PREPARATION_MATERIALS} onChange={(event) => setMaterialIds((current) => event.target.checked ? [...new Set([...current, material.material_id])].slice(0, MAX_PREPARATION_MATERIALS) : current.filter((id) => id !== material.material_id))} /><span>{material.title}</span></label>; })}{activeSlot && compatibleMaterials.length === 0 ? <p>请先接入同班同学科材料</p> : null}</fieldset>
          <label><span>产物</span><textarea rows={4} maxLength={4800} value={deliverables} onChange={(event) => setDeliverables(event.target.value)} /></label>
          {deliverableValidation.error ? <p role="alert">{deliverableValidation.error}</p> : null}
        </div> : null}
        <div className="edupi-task-board-create__actions"><button type="button" disabled={creating} onClick={() => setCreateOpen(false)}>取消</button><button type="submit" className="is-primary" disabled={creating || !canCreate}>{creating ? "创建中…" : managedPreparation ? "创建并准备" : "创建任务"}</button></div>
      </form> : null}
      {message ? <p className={`edupi-task-board-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
      <div className="edupi-task-board-scroll">
        <div className="edupi-task-board" aria-label="教师工作任务板">
          {columns.map((column) => {
            const draggedTask = draggedTaskId ? taskById.get(draggedTaskId) : null;
            const sourceStage = draggedTask?.id ? taskBoardLane(draggedTask, data.taskSessions[draggedTask.id] ?? null, candidateByTask.get(draggedTask.id)) : null;
            const canDrop = Boolean(sourceStage && taskBoardTargets(sourceStage).includes(column.id));
            return <section data-board-stage={column.id} className={`edupi-task-board-column is-${column.id}${dropTarget === column.id && canDrop ? " is-drop-target" : ""}`} key={column.id} aria-labelledby={`edupi-task-board-${column.id}`}>
              <header><span className="edupi-task-board-column__mark" aria-hidden="true" /><h2 id={`edupi-task-board-${column.id}`}>{column.label}</h2><em>{column.tasks.length}</em></header>
              <div className="edupi-task-board-column__cards" role="list">
                {column.tasks.map((task) => {
                  const session = task.id ? data.taskSessions[task.id] ?? null : null;
                  const candidate = task.id ? candidateByTask.get(task.id) ?? null : null;
                  const workCase = workCaseForTask(data, task.id);
                  return <div role="listitem" key={task.id || `${task.trigger}:${task.title}`}><TaskCard task={task} session={session} lane={column.id} candidate={candidate} workCase={workCase} busy={movingTaskId === task.id} selected={Boolean(task.id) && selectedCardId === task.id} dragSource={draggedTaskId === task.id} onSelect={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return; } setSelectedCardId(task.id ?? null); }} onOpen={() => onTaskDetail(task)} onCardPointerDown={(event) => { suppressClickRef.current = false; if (!task.id || movingTaskId) return; if ((event.target as HTMLElement).closest("select")) return; const rect = event.currentTarget.getBoundingClientRect(); dragStartRef.current = { id: task.id, x: event.clientX, y: event.clientY, offX: event.clientX - rect.x, offY: event.clientY - rect.y, width: rect.width }; }} onHandlePointerDown={(event) => { if (!task.id || movingTaskId) return; event.preventDefault(); const card = event.currentTarget.closest<HTMLElement>(".edupi-task-board-card"); const rect = card?.getBoundingClientRect(); beginDrag({ id: task.id, offX: rect ? event.clientX - rect.x : 14, offY: rect ? event.clientY - rect.y : 14, width: rect?.width ?? 240 }, event.clientX, event.clientY); }} onMove={(stage) => void move(task, stage)} /></div>;
                })}
                {column.tasks.length === 0 ? <div className="edupi-task-board-column__empty" role="status">暂无任务</div> : null}
              </div>
            </section>;
          })}
        </div>
      </div>
      {dragGhost && ghostTask ? <div className="edupi-drag-ghost" style={{ left: dragGhost.x - dragGhost.offX, top: dragGhost.y - dragGhost.offY, width: dragGhost.width }} aria-hidden="true"><div className="edupi-task-board-card"><div className="edupi-task-board-card__open"><span className="edupi-task-board-card__topline"><span>{taskTypeLabel(ghostTask)}</span><time>{taskDate(ghostTask)}</time></span><strong>{taskDisplayTitle(ghostTask)}</strong><span className="edupi-task-board-card__source">{taskSource(ghostTask)}</span></div></div></div> : null}
    </main>
  );
}
