"use client";

import type { EducationContract, EducationFact, EducationFactSpine } from "@/lib/edupi-education-contract";
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

export function EduPiTeachingFacts({ factSpine, query = "", reviewer, onEducation }: { factSpine: EducationFactSpine | null; query?: string; reviewer: string; onEducation: (data: EducationContract) => void }) {
  if (!factSpine) return null;
  const factById = new Map(factSpine.acceptedFacts.map(fact => [fact.id, fact]));
  const entityById = new Map(factSpine.entities.map(entity => [entity.id, entity]));
  const observationById = new Map(factSpine.observations.map(observation => [observation.id, observation]));
  const needle = query.trim().toLocaleLowerCase();
  const rows = factSpine.teachingView.acceptedFactIds
    .flatMap(id => factById.get(id) || [])
    .filter(fact => !needle || [fact.value, fact.predicate, fact.subjectRef, fact.topicRef, entityById.get(fact.entityId)?.name].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle));
  const nextLesson = new Set(factSpine.nextLessonFactIds);

  return <section className="edupi-teaching-core-facts" aria-label="教学依据">
    <header><h2>教学依据</h2><span>{rows.length} 条已确认</span></header>
    <div>{rows.map(fact => {
      const sources = fact.observationIds.flatMap(id => observationById.get(id) || []);
      const observedSourceIds = new Set(sources.map(source => source.sourceId));
      const unresolvedSourceIds = fact.sourceIds.filter(sourceId => !observedSourceIds.has(sourceId));
      const entity = entityById.get(fact.entityId);
      return <details key={fact.id}>
        <summary><span><strong>{fact.value}</strong><small>{[entity?.name, kindLabels[fact.kind], fact.subjectRef, fact.topicRef].filter(Boolean).join(" · ")}</small></span><em>{nextLesson.has(fact.id) ? "下节课采用" : "已确认"}</em></summary>
        <div><p>{fact.predicate}</p><details><summary>来源 {sources.length + unresolvedSourceIds.length}</summary>{sources.map(source => <article key={source.id}><strong>{sourceLabels[source.sourceKind] || source.sourceKind}</strong><p>{source.text}</p><time>{new Date(source.observedAt).toLocaleString("zh-CN")}</time></article>)}{unresolvedSourceIds.map(sourceId => <code key={sourceId}>{sourceId}</code>)}</details><EduPiFactActions fact={fact} spine={factSpine} reviewer={reviewer} onEducation={onEducation} /></div>
      </details>;
    })}{rows.length === 0 ? <p>暂无匹配的已确认事实</p> : null}</div>
  </section>;
}
