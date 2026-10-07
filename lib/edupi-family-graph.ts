import type { FamilyPerson, FamilyRecord } from "./edupi-family-record-model";
import { familyQualityLabel } from "./edupi-family-record-model";
import type { StudentGraphModel, StudentGraphNode } from "./edupi-student-graph";
import { STUDENT_GRAPH_RECORD_LIMIT } from "./edupi-student-graph";

export function buildFamilyGraph(student: { id: string; label: string }, parents: FamilyPerson[], records: FamilyRecord[]): StudentGraphModel {
  const graph: StudentGraphModel = { nodes: [], edges: [], records: [], omittedRecordCount: Math.max(0, records.length - STUDENT_GRAPH_RECORD_LIMIT), participantLimitReached: false };
  const nodes = new Map<string, StudentGraphNode>();
  function node(id: string, kind: StudentGraphNode["kind"], label: string, recordId: string) {
    const current = nodes.get(id) || { id, kind, label, recordIds: [] };
    current.recordIds.push(recordId);
    nodes.set(id, current);
  }
  for (const row of records.slice(0, STUDENT_GRAPH_RECORD_LIMIT)) {
    if (!row.mutation_allowed || ["deleted", "rejected", "superseded", "stale"].includes(row.status) || row.source.status !== "active") continue;
    const parent = parents.find((item) => item.entity_id === row.parent_entity_id);
    if (!parent || row.student_entity_id !== student.id) continue;
    const quality = row.status === "accepted" && row.source.status === "active" ? row.display_quality : "unknown";
    const label = `${row.record.observed_on || "日期未记录"} · ${familyQualityLabel(quality)}`;
    const studentId = `student:${student.id}`, personId = `topic:family:${parent.entity_id}`, recordId = `record:${row.fact_id}`;
    node(studentId, "student", student.label, row.fact_id);
    node(personId, "topic", parent.canonical_name, row.fact_id);
    node(recordId, "record", label, row.fact_id);
    graph.edges.push({ from: studentId, to: recordId, recordId: row.fact_id, tone: quality }, { from: recordId, to: personId, recordId: row.fact_id, tone: quality });
    graph.records.push({ id: row.fact_id, summary: row.record.note });
  }
  graph.nodes = [...nodes.values()];
  return graph;
}
