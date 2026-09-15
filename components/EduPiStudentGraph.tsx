"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { StudentEvent } from "@/lib/edupi-student-events";
import { buildStudentGraph } from "@/lib/edupi-student-graph";

type GraphKind = "learning" | "interaction";
type Position = { x: number; y: number };

const COLUMNS = ["student", "record", "topic"] as const;

function graphLegend(kind: GraphKind): [string, string, string] {
  return kind === "learning" ? ["学生", "学习记录", "知识点"] : ["学生", "互动事件", "活动主题"];
}

function nodeKindLabel(kind: typeof COLUMNS[number], graphKind: GraphKind): string {
  if (kind === "student") return "学生";
  if (kind === "record") return graphKind === "learning" ? "学习记录" : "互动事件";
  return graphKind === "learning" ? "知识点" : "活动主题";
}

export function EduPiStudentGraph({ records, total, kind, selectedId, onSelect }: { records: StudentEvent[]; total: number; kind: GraphKind; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const graph = useMemo(() => buildStudentGraph(records), [records]);
  const [focus, setFocus] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(680);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setViewportWidth(Math.max(320, viewport.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const canvasWidth = Math.max(680, viewportWidth);
  const nodeWidth = Math.min(180, Math.max(140, (canvasWidth - 96) / 3));
  const columnGap = (canvasWidth - 40 - 3 * nodeWidth) / 2;
  const height = Math.max(400, ...COLUMNS.map((column) => graph.nodes.filter((node) => node.kind === column).length * 62 + 220));
  const positions = useMemo(() => {
    const next = new Map<string, Position>();
    COLUMNS.forEach((column, columnIndex) => {
      graph.nodes.filter((node) => node.kind === column).forEach((node, rowIndex) => {
        next.set(node.id, { x: 20 + columnIndex * (nodeWidth + columnGap), y: 20 + rowIndex * 62 });
      });
    });
    return next;
  }, [columnGap, graph.nodes, nodeWidth]);
  const focused = graph.nodes.find((node) => node.id === focus) || null;
  const activeRecords = new Set(focused?.recordIds || (selectedId ? [selectedId] : []));
  const targetNodeId = focus || (selectedId ? `record:${selectedId}` : null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const position = targetNodeId ? positions.get(targetNodeId) : null;
    if (!viewport || !position) return;
    const left = (position.x + nodeWidth / 2) * zoom - viewport.clientWidth / 2;
    const top = (position.y + 22) * zoom - viewport.clientHeight / 2;
    viewport.scrollTo({ left: Math.max(0, left), top: Math.max(0, top) });
  }, [nodeWidth, positions, targetNodeId, zoom]);

  const reset = () => {
    setZoom(1);
    setFocus(null);
    onSelect(null);
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
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

  return <div className="edupi-student-graph">
    <div className="edupi-graph-controls" role="group" aria-label="图谱视图">
      <button type="button" className="native-button" aria-label="缩小图谱" disabled={zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}>−</button>
      <output aria-label="图谱缩放比例">{Math.round(zoom * 100)}%</output>
      <button type="button" className="native-button" aria-label="放大图谱" disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))}>+</button>
      <button type="button" className="native-button" onClick={reset}>复位</button>
      {targetNodeId ? <button type="button" className="native-button" onClick={() => { setFocus(null); onSelect(null); }}>显示全部</button> : null}
    </div>
    <div className="edupi-student-graph__legend">{legend.map((label) => <span key={label}>{label}</span>)}</div>
    <div ref={viewportRef} className="edupi-student-graph__viewport">
      <div className="edupi-student-graph__scaled" style={{ width: canvasWidth * zoom, height: height * zoom }}>
        <div className="edupi-student-graph__canvas" style={{ height, width: canvasWidth, minWidth: canvasWidth, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
          <svg width={canvasWidth} height={height} aria-label="记录关联线">{graph.edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            const curve = `M${from.x + nodeWidth},${from.y + 21} C${from.x + nodeWidth + columnGap / 2},${from.y + 21} ${to.x - columnGap / 2},${to.y + 21} ${to.x},${to.y + 21}`;
            const active = activeRecords.has(edge.recordId);
            const dimmed = activeRecords.size > 0 && !active;
            return <g key={`${edge.from}:${edge.to}:${edge.recordId}`} role="button" tabIndex={0} aria-label={`查看关联记录 ${graph.records.findIndex((record) => record.id === edge.recordId) + 1}`} onClick={() => selectRecord(edge.recordId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectRecord(edge.recordId); } }} className={`${active ? "is-selected" : ""}${dimmed ? " is-dimmed" : ""}`}><circle cx={(from.x + nodeWidth + to.x) / 2} cy={(from.y + to.y) / 2 + 21} r={7} fill="transparent" /><path d={curve} className="edupi-student-graph__hit" /><path d={curve} className="edupi-student-graph__edge" /></g>;
          })}</svg>
          {graph.nodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            const pressed = node.kind === "record" ? selectedId === node.recordIds[0] : focus === node.id;
            return <button key={node.id} type="button" title={node.label} className={`edupi-student-graph__node is-${node.kind}`} style={{ left: position.x, top: position.y, width: nodeWidth }} aria-label={`${nodeKindLabel(node.kind, kind)}：${node.label}`} aria-pressed={pressed} onClick={() => node.kind === "record" ? selectRecord(node.recordIds[0]) : selectNode(node.id)}>{node.kind === "record" ? <><small>{nodeKindLabel(node.kind, kind)} {graph.records.findIndex((record) => record.id === node.recordIds[0]) + 1}</small><span>{node.label}</span></> : <span>{node.label}</span>}</button>;
          })}
        </div>
      </div>
    </div>
    <small>已加载 {graph.records.length} / {total} 条记录</small>
    {graph.participantLimitReached ? <p>部分事件参与者超过当前图谱上限，可在列表中查看。</p> : null}
    {focused ? <div className="edupi-student-graph__related" aria-live="polite"><strong>{focused.label}</strong><span>{focused.recordIds.length} 条关联记录</span>{graph.records.filter((record) => focused.recordIds.includes(record.id)).map((record) => <button key={record.id} type="button" onClick={() => selectRecord(record.id)}>{record.summary}</button>)}</div> : null}
  </div>;
}
