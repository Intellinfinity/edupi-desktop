"use client";

import { factEntityIdForRosterStudent, type EducationContract, type EducationFact, type EducationFactSpine } from "@/lib/edupi-education-contract";
import { EduPiFactActions } from "./EduPiFactActions";

const kindLabels: Record<EducationFact["kind"], string> = {
  error_pattern: "错因模式",
  progress: "学习进展",
  behavior: "行为观察",
  general: "一般事实",
  safety: "安全",
  academic: "学业",
  material: "材料事实",
  evidence: "证据",
};

const sourceLabels: Record<string, string> = {
  teacher_utterance: "教师对话",
  material: "材料",
  calendar: "校历",
  timetable: "课表",
  legacy: "历史记录",
};

export function EduPiStudentFacts({ factSpine, studentId, reviewer, onEducation }: { factSpine: EducationFactSpine | null; studentId: string; reviewer: string; onEducation: (data: EducationContract) => void }) {
  if (!factSpine) return null;
  const entityId = factEntityIdForRosterStudent(factSpine, studentId);
  const view = factSpine.studentViews.find(item => item.studentId === entityId);
  const facts = new Map([...factSpine.acceptedFacts, ...factSpine.factCandidates].map(item => [item.id, item]));
  const rows = [...(view?.acceptedFactIds || []), ...(view?.pendingFactIds || [])].flatMap(id => facts.get(id) || []).filter(fact => fact.entityId === entityId);
  const observations = new Map(factSpine.observations.map(item => [item.id, item]));
  return <details className="edupi-student-core-facts" open>
    <summary>学习事实 <span>{rows.length}</span></summary>
    <div>{rows.map(fact => {
      const sources = fact.observationIds.flatMap(id => observations.get(id) || []);
      const observedSourceIds = new Set(sources.map(source => source.sourceId));
      const unresolvedSourceIds = fact.sourceIds.filter(sourceId => !observedSourceIds.has(sourceId));
      return <article key={fact.id}>
        <header><strong>{kindLabels[fact.kind]}</strong><span>{fact.status === "accepted" ? "已确认" : fact.status === "held" ? "已暂缓" : "待确认"}</span></header>
        <p>{fact.value}</p>
        <small>{[fact.predicate, fact.subjectRef, fact.topicRef].filter(Boolean).join(" · ")}</small>
        <details><summary>来源 {sources.length + unresolvedSourceIds.length}</summary>{sources.map(source => <div key={source.id}><strong>{sourceLabels[source.sourceKind] || source.sourceKind}</strong><p>{source.text}</p><time>{new Date(source.observedAt).toLocaleString("zh-CN")}</time></div>)}{unresolvedSourceIds.map(sourceId => <code key={sourceId}>{sourceId}</code>)}</details>
        <EduPiFactActions fact={fact} spine={factSpine} reviewer={reviewer} onEducation={onEducation} />
      </article>;
    })}{rows.length === 0 ? <em>暂无已关联事实</em> : null}</div>
  </details>;
}
