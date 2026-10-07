"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { StudentEvent } from "@/lib/edupi-student-events";
import { buildStudentGraph, clampStudentGraphZoom, studentGraphFitZoom, STUDENT_GRAPH_MAX_ZOOM, STUDENT_GRAPH_MIN_ZOOM, type StudentGraphModel } from "@/lib/edupi-student-graph";
import { useModalDismiss } from "@/hooks/useModalDismiss";

type GraphKind = "learning" | "interaction" | "family";
type Position = { x: number; y: number };

const COLUMNS = ["student", "record", "topic"] as const;

function graphLegend(kind: GraphKind): [string, string, string] {
  if (kind === "family") return ["学生", "家校记录", "联系人"];
  return kind === "learning" ? ["学生", "学习记录", "知识点"] : ["学生", "互动事件", "活动主题"];
}

function nodeKindLabel(kind: typeof COLUMNS[number], graphKind: GraphKind): string {
  if (kind === "student") return "学生";
  if (graphKind === "family") return kind === "record" ? "家校记录" : "联系人";
  if (kind === "record") return graphKind === "learning" ? "学习记录" : "互动事件";
  return graphKind === "learning" ? "知识点" : "活动主题";
}

export function EduPiStudentGraph({ records = [], projection, total, kind, selectedId, onSelect, student, scope, details, loading = false, footer, alert }: { records?: StudentEvent[]; projection?: StudentGraphModel; total: number; kind: GraphKind; selectedId: string | null; onSelect: (id: string | null) => void; student?: string | null; scope?: string; details?: ReactNode; loading?: boolean; footer?: ReactNode; alert?: ReactNode }) {
  const graph = useMemo(() => projection || buildStudentGraph(records), [projection, records]);
  const graphTitle = kind === "family" ? "家校人物图" : kind === "learning" ? "学习图谱" : "互动图谱";
  const keyboardHelpId = useId();
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => setFocus(null), [kind, scope, student]);
  const [expanded, setExpanded] = useState(false);
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  const dialogRef = useModalDismiss<HTMLDivElement>(() => setExpanded(false), expanded);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 680, height: 400 });
  const [zoom, setZoom] = useState(1);
  const [fitting, setFitting] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [expanded]);

  const canvasWidth = Math.max(680, viewportSize.width);
  const nodeWidth = Math.min(180, Math.max(140, (canvasWidth - 96) / 3));
  const columnGap = (canvasWidth - 40 - 3 * nodeWidth) / 2;
  const height = Math.max(320, ...COLUMNS.map((column) => graph.nodes.filter((node) => node.kind === column).length * 72 + 40));
  useEffect(() => {
    if (!fitting || !viewportSize.width || !viewportSize.height) return;
    setZoom(studentGraphFitZoom({ width: canvasWidth, height }, viewportSize));
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  }, [canvasWidth, fitting, height, viewportSize]);
  const positions = useMemo(() => {
    const next = new Map<string, Position>();
    COLUMNS.forEach((column, columnIndex) => {
      const columnNodes = graph.nodes.filter((node) => node.kind === column);
      columnNodes.forEach((node, rowIndex) => {
        next.set(node.id, { x: 20 + columnIndex * (nodeWidth + columnGap), y: (height - columnNodes.length * 72) / 2 + rowIndex * 72 });
      });
    });
    return next;
  }, [columnGap, graph.nodes, height, nodeWidth]);
  const focused = graph.nodes.find((node) => node.id === focus) || null;
  const activeRecords = new Set(focused?.recordIds || (selectedId ? [selectedId] : []));
  const targetNodeId = focused?.id || (selectedId ? `record:${selectedId}` : null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const position = targetNodeId ? positions.get(targetNodeId) : null;
    if (!viewport || !position) return;
    const currentZoom = zoomRef.current;
    const left = (position.x + nodeWidth / 2) * currentZoom - viewport.clientWidth / 2;
    const top = (position.y + 22) * currentZoom - viewport.clientHeight / 2;
    viewport.scrollTo({ left: Math.max(0, left), top: Math.max(0, top) });
  }, [nodeWidth, positions, targetNodeId]);

  const fit = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setFitting(true);
    setZoom(studentGraphFitZoom({ width: canvasWidth, height }, { width: viewport.clientWidth, height: viewport.clientHeight }));
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  };
  const changeZoom = (value: number) => {
    const viewport = viewportRef.current;
    const next = clampStudentGraphZoom(value);
    if (!viewport || next === zoom) return;
    setFitting(false);
    const center = { x: (viewport.scrollLeft + viewport.clientWidth / 2) / zoom, y: (viewport.scrollTop + viewport.clientHeight / 2) / zoom };
    setZoom(next);
    requestAnimationFrame(() => viewport.scrollTo({ left: Math.max(0, center.x * next - viewport.clientWidth / 2), top: Math.max(0, center.y * next - viewport.clientHeight / 2) }));
  };
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button, [role=button], a, input")) return;
    const viewport = event.currentTarget;
    viewport.focus({ preventScroll: true });
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const pan = (event: PointerEvent<HTMLDivElement>) => {
    const origin = panRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    event.currentTarget.scrollTo({ left: origin.left - event.clientX + origin.x, top: origin.top - event.clientY + origin.y });
  };
  const endPan = () => { panRef.current = null; setPanning(false); };
  const keyboardPan = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-72, 0], ArrowRight: [72, 0], ArrowUp: [0, -72], ArrowDown: [0, 72] };
    if (arrows[event.key]) {
      event.preventDefault();
      const [left, top] = arrows[event.key];
      event.currentTarget.scrollBy({ left, top });
    } else if (["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "0") fit();
      else changeZoom(zoom + (event.key === "-" ? -0.25 : 0.25));
    }
  };
  const selectRecord = (recordId: string) => {
    setFocus(null);
    onSelect(recordId);
  };
  const selectNode = (nodeId: string) => {
    onSelect(null);
    setFocus((current) => current === nodeId ? null : nodeId);
  };
  const legend = graphLegend(kind);

  if (alert && !loading && graph.records.length === 0) {
    return <div className="edupi-student-graph">{alert}</div>;
  }

  const content = <>
    <div className="edupi-graph-controls" role="group" aria-label="图谱视图">
      <button type="button" className="native-button" aria-label="缩小图谱" disabled={zoom <= STUDENT_GRAPH_MIN_ZOOM} onClick={() => changeZoom(zoom - 0.25)}>−</button>
      <output aria-label="图谱缩放比例">{Math.round(zoom * 100)}%</output>
      <button type="button" className="native-button" aria-label="放大图谱" disabled={zoom >= STUDENT_GRAPH_MAX_ZOOM} onClick={() => changeZoom(zoom + 0.25)}>+</button>
      <button type="button" className="native-button" onClick={fit}>适应画布</button>
      <button type="button" className="native-button" onClick={() => changeZoom(1)}>复位</button>
      {targetNodeId ? <button type="button" className="native-button" onClick={() => { setFocus(null); onSelect(null); }}>显示全部</button> : null}
    </div>
    <div className="edupi-student-graph__legend">{legend.map((label) => <span key={label}>{label}</span>)}</div>
    {alert}
    <span id={keyboardHelpId} className="edupi-student-graph__keyboard-help">方向键平移，+ 和 − 缩放，0 适应画布。{expanded ? "Escape 关闭图谱。" : ""}</span>
    <div ref={viewportRef} className={`edupi-student-graph__viewport${panning ? " is-panning" : ""}`} tabIndex={0} role="region" aria-label="图谱画布" aria-describedby={keyboardHelpId} aria-busy={loading} title="拖动空白处或使用方向键平移；+ 和 − 缩放，0 适应画布" onPointerDown={startPan} onPointerMove={pan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan} onKeyDown={keyboardPan}>
      {graph.records.length === 0 ? <p className="edupi-student-graph__empty" role="status">{loading ? "读取中…" : alert ? "记录读取失败" : "暂无关联记录"}</p> : <div className="edupi-student-graph__scaled" style={{ width: canvasWidth * zoom, height: height * zoom }}>
        <div className="edupi-student-graph__canvas" style={{ height, width: canvasWidth, minWidth: canvasWidth, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
          <svg width={canvasWidth} height={height} aria-label="记录关联线">{graph.edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            const curve = `M${from.x + nodeWidth},${from.y + 21} C${from.x + nodeWidth + columnGap / 2},${from.y + 21} ${to.x - columnGap / 2},${to.y + 21} ${to.x},${to.y + 21}`;
            const active = activeRecords.has(edge.recordId);
            const dimmed = activeRecords.size > 0 && !active;
            return <g key={`${edge.from}:${edge.to}:${edge.recordId}`} role="button" tabIndex={0} aria-label={`查看关联记录：${graph.records.find((record) => record.id === edge.recordId)?.summary}`} onClick={() => selectRecord(edge.recordId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectRecord(edge.recordId); } }} className={`${active ? "is-selected" : ""}${dimmed ? " is-dimmed" : ""}`}><circle cx={(from.x + nodeWidth + to.x) / 2} cy={(from.y + to.y) / 2 + 21} r={7} fill="transparent" /><path d={curve} className="edupi-student-graph__hit" /><path d={curve} className="edupi-student-graph__edge" style={edge.tone ? { stroke: edge.tone === "supportive" ? "var(--green, #15815a)" : edge.tone === "tense" ? "var(--orange, #b57620)" : "var(--text-dim)" } : undefined} /></g>;
          })}</svg>
          {graph.nodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            const pressed = node.kind === "record" ? selectedId === node.recordIds[0] : focus === node.id;
            return <button key={node.id} type="button" title={node.label} className={`edupi-student-graph__node is-${node.kind}`} style={{ left: position.x, top: position.y, width: nodeWidth }} aria-label={`${nodeKindLabel(node.kind, kind)}：${node.label}`} aria-pressed={pressed} onClick={() => node.kind === "record" ? selectRecord(node.recordIds[0]) : selectNode(node.id)}>{node.kind === "record" ? <><small>{nodeKindLabel(node.kind, kind)} {graph.records.findIndex((record) => record.id === node.recordIds[0]) + 1}</small><span>{node.label}</span></> : <span>{node.label}</span>}</button>;
          })}
        </div>
      </div>}
    </div>
    {graph.records.length < total ? <small>已加载 {graph.records.length} / {total} 条记录</small> : null}
    {graph.participantLimitReached ? <p>部分事件参与者超过当前图谱上限，可在列表中查看。</p> : null}
    {focused ? <div className="edupi-student-graph__related" aria-live="polite"><strong>{focused.label}</strong><span>{focused.recordIds.length} 条关联记录</span>{graph.records.filter((record) => focused.recordIds.includes(record.id)).map((record) => <button key={record.id} type="button" onClick={() => selectRecord(record.id)}>{record.summary}</button>)}</div> : null}
    {footer}
  </>;

  return <div className="edupi-student-graph">
    <button type="button" className="native-button edupi-student-graph__expand" onClick={() => { setPortalHost(viewportRef.current?.closest(".edupi-teacher-shell") || document.body); setFitting(true); setExpanded(true); }}>展开图谱</button>
    {!expanded ? content : null}
    {expanded ? createPortal(<div className="edupi-student-graph-backdrop">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`${student ? `${student} · ` : ""}${graphTitle}`} className="edupi-student-graph-dialog edupi-student-events">
        <header className="edupi-student-graph-dialog__header"><h2>{graphTitle}</h2>{student ? <span>{student}</span> : null}{scope ? <span>{scope}</span> : null}<button type="button" className="native-button" onClick={() => setExpanded(false)} data-autofocus aria-label="关闭图谱">关闭</button></header>
        <div className="edupi-student-graph-dialog__body"><div className="edupi-student-graph">{content}</div><aside className="edupi-student-graph-dialog__details" aria-label="记录来源"><h3>记录来源</h3>{details || <p>选择记录查看来源</p>}</aside></div>
      </div>
    </div>, portalHost || document.body) : null}
  </div>;
}
