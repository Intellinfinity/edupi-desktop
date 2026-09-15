import type { StudentEvent } from "./edupi-student-events";

export const STUDENT_GRAPH_PAGE_SIZE = 20;
export const STUDENT_GRAPH_RECORD_LIMIT = 60;
export const STUDENT_GRAPH_PARTICIPANT_LIMIT = 100;

export type StudentGraphNode = {
  id: string;
  kind: "student" | "record" | "topic";
  label: string;
  recordIds: string[];
};

export type StudentGraphEdge = {
  from: string;
  to: string;
  recordId: string;
};

function participants(record: StudentEvent): Array<{ id: string; label: string }> {
  const result = new Map<string, string>();
  record.students.forEach((name, index) => {
    const stableId = record.student_ids?.[index] || name;
    const label = record.student_labels?.[index] || name;
    if (!result.has(stableId)) result.set(stableId, label);
  });
  return [...result].map(([id, label]) => ({ id, label }));
}

export function buildStudentGraph(records: readonly StudentEvent[]) {
  const selected: StudentEvent[] = [];
  const studentIds = new Set<string>();
  let participantLimitReached = false;
  for (const record of records) {
    if (selected.length >= STUDENT_GRAPH_RECORD_LIMIT) break;
    const eventParticipants = participants(record);
    const next = new Set([...studentIds, ...eventParticipants.map((item) => item.id)]);
    if (next.size > STUDENT_GRAPH_PARTICIPANT_LIMIT) {
      participantLimitReached = true;
      continue;
    }
    eventParticipants.forEach((item) => studentIds.add(item.id));
    selected.push(record);
  }

  const nodes = new Map<string, StudentGraphNode>();
  const edges: StudentGraphEdge[] = [];
  const edgeIds = new Set<string>();
  const addNode = (id: string, kind: StudentGraphNode["kind"], label: string, recordId: string) => {
    const node = nodes.get(id) || { id, kind, label, recordIds: [] };
    if (!node.recordIds.includes(recordId)) node.recordIds.push(recordId);
    nodes.set(id, node);
  };
  const addEdge = (edge: StudentGraphEdge) => {
    const edgeId = `${edge.from}\u0000${edge.to}\u0000${edge.recordId}`;
    if (edgeIds.has(edgeId)) return;
    edgeIds.add(edgeId);
    edges.push(edge);
  };

  for (const record of selected) {
    const eventId = `record:${record.id}`;
    addNode(eventId, "record", record.summary, record.id);
    for (const participant of participants(record)) {
      const studentId = `student:${participant.id}`;
      addNode(studentId, "student", participant.label, record.id);
      addEdge({ from: studentId, to: eventId, recordId: record.id });
    }
    const topic = record.canonical_topic || record.topic;
    if (topic) {
      const topicId = `topic:${topic}`;
      addNode(topicId, "topic", topic, record.id);
      addEdge({ from: eventId, to: topicId, recordId: record.id });
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    records: selected,
    omittedRecordCount: Math.max(0, records.length - selected.length),
    participantLimitReached,
  };
}
