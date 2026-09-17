"use client";

import type { WorkbenchView } from "@/lib/edupi-workbench";
import { workbenchViews } from "@/lib/edupi-workbench";
import { APP_VERSION_DISPLAY } from "@/lib/branding";
import { useRouter } from "next/navigation";

type Props = {
  activeView: WorkbenchView;
  pendingReviewCount: number;
  runningAgentCount: number;
  memoryCount: number;
  workspaceLabel: string;
  collapsed: boolean;
  onSelect: (view: WorkbenchView) => void;
  onOpenAdmin: () => void;
  onOpenProactive: () => void;
  onOpenGuide: () => void;
  onCollapse: () => void;
};

const groups: Array<{ label: string; views: WorkbenchView[] }> = [
  { label: "协作", views: ["chat", "dashboard", "workspace"] },
  { label: "教师工作", views: ["teaching", "homeroom", "calendar"] },
  { label: "长期积累", views: ["memory", "insights", "growth"] },
  { label: "控制", views: ["materials", "review"] },
];

function RailIcon({ view }: { view: WorkbenchView }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (view === "chat") return <svg {...common}><path d="M6.5 5.5h11A2.5 2.5 0 0 1 20 8v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3v-3A2.5 2.5 0 0 1 4 15V8a2.5 2.5 0 0 1 2.5-2.5Z" /><path d="M8 10h8M8 13.5h5" /></svg>;
  if (view === "dashboard") return <svg {...common}><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10.5V20h11v-9.5" /><path d="M10 20v-5h4v5" /></svg>;
  if (view === "workspace") return <svg {...common}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M8.8 4.5v15M15.2 4.5v15" /><path d="M5.7 8h.9M11.5 8h1M17.4 8h.9M5.7 11h.9M11.5 11h1" /></svg>;
  if (view === "teaching") return <svg {...common}><path d="M5 4.5h11.5A2.5 2.5 0 0 1 19 7v12.5H7.5A2.5 2.5 0 0 1 5 17z" /><path d="M5 17c0-1.4 1.1-2.5 2.5-2.5H19M9 8h6M9 11h4" /></svg>;
  if (view === "homeroom") return <svg {...common}><path d="M4 19.5v-11L12 4l8 4.5v11" /><circle cx="9" cy="12" r="2" /><circle cx="15.5" cy="12.5" r="1.5" /><path d="M5.8 18c.5-2.2 1.6-3.3 3.2-3.3 1.7 0 2.8 1.1 3.3 3.3M13.5 17.5c.4-1.5 1.2-2.3 2.3-2.3 1.2 0 2 .8 2.4 2.3" /></svg>;
  if (view === "tasks") return <svg {...common}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5h6M8.5 10h7M8.5 14h7M8.5 18h4" /></svg>;
  if (view === "students") return <svg {...common}><circle cx="9" cy="9" r="3" /><path d="M3.8 19c.7-3.2 2.4-4.8 5.2-4.8s4.5 1.6 5.2 4.8" /><circle cx="17" cy="10" r="2" /><path d="M15.5 15.5c2.7-.6 4.5.6 5.2 3.5" /></svg>;
  if (view === "calendar") return <svg {...common}><rect x="3.5" y="5.5" width="17" height="15" rx="2" /><path d="M7 3v5M17 3v5M3.5 10h17M8 14h2M14 14h2M8 17h2" /></svg>;
  if (view === "memory") return <svg {...common}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>;
  if (view === "insights") return <svg {...common}><path d="M9 18h6M10 21h4" /><path d="M8.2 14.8A6 6 0 1 1 15.8 14.8C14.7 15.7 14.3 16.2 14.2 17h-4.4c-.1-.8-.5-1.3-1.6-2.2Z" /><path d="M12 2v2M4.9 4.9l1.4 1.4M19.1 4.9l-1.4 1.4" /></svg>;
  if (view === "growth") return <svg {...common}><path d="M12 21v-9" /><path d="M12 14c-4.2 0-7-2.2-7-6 4.2 0 7 2.2 7 6ZM12 11c0-4.2 2.5-7 7-7 0 4.2-2.5 7-7 7Z" /><path d="M7 21h10" /></svg>;
  if (view === "materials") return <svg {...common}><path d="M7 3.5h8l3 3V20H7z" /><path d="M15 3.5V7h3M10 11h5M10 15h5" /><path d="M4 7v13h10" /></svg>;
  if (view === "artifacts") return <svg {...common}><path d="M12 3 4.5 7.2 12 11l7.5-3.8z" /><path d="m4.5 11 7.5 4 7.5-4M4.5 15l7.5 4 7.5-4" /></svg>;
  return <svg {...common}><path d="M12 3.5 19 6v5.2c0 4.4-2.5 7.6-7 9.3-4.5-1.7-7-4.9-7-9.3V6z" /><path d="m9 12 2 2 4-4" /></svg>;
}

function UtilityIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1-2.9 2.9-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.1h-4v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1-2.9-2.9.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3v-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1 2.9-2.9.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V3h4v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1 2.9 2.9-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.1v4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></svg>;
}

export function EduPiNavigationRail({ activeView, pendingReviewCount, runningAgentCount, memoryCount, workspaceLabel, collapsed, onSelect, onOpenAdmin, onOpenProactive, onOpenGuide, onCollapse }: Props) {
  const router = useRouter();
  const item = (view: WorkbenchView) => {
    const config = workbenchViews.find((entry) => entry.id === view)!;
    return <button key={view} type="button" title={config.label} aria-label={config.label} className={activeView === view ? "is-active" : ""} aria-current={activeView === view ? "page" : undefined} onClick={() => onSelect(view)}><span className="edupi-teacher-rail__icon"><RailIcon view={view} /></span><span className="edupi-teacher-rail__text"><span>{config.label}</span><small>{config.shortLabel}</small></span>{view === "review" && pendingReviewCount > 0 ? <em>{pendingReviewCount}</em> : null}</button>;
  };
  return (
    <nav className={`edupi-teacher-rail${collapsed ? " is-collapsed" : ""}`} aria-label="EduPi 主导航">
      <div className="edupi-teacher-rail__brand"><span>π</span><div><strong>EduPi</strong><small>{workspaceLabel}</small></div><button type="button" className="edupi-teacher-rail__collapse" onClick={onCollapse} title={collapsed ? "展开主导航" : "收起主导航"} aria-label={collapsed ? "展开主导航" : "收起主导航"} aria-expanded={!collapsed}><span aria-hidden="true">{collapsed ? "›" : "‹"}</span></button></div>
      <div className="edupi-teacher-rail__items">
        {groups.map((group) => <section className="edupi-teacher-rail__group" key={group.label}><div className="edupi-teacher-rail__group-title">{group.label}</div>{group.views.map(item)}</section>)}
      </div>
      <button type="button" className={`edupi-activity-pulse${runningAgentCount > 0 ? " is-running" : ""}`} title={runningAgentCount > 0 ? `主动协作 · ${runningAgentCount} 项运行中` : `主动协作 · 已记住 ${memoryCount}`} aria-label={runningAgentCount > 0 ? `打开主动协作，${runningAgentCount} 项运行中` : "打开主动协作"} onClick={onOpenProactive}><i aria-hidden="true" /><span>{runningAgentCount > 0 ? `${runningAgentCount} 项运行中` : "主动协作"}</span></button>
      <div className="edupi-teacher-rail__utilities">
        <button type="button" title="提醒" aria-label="提醒" onClick={() => router.replace("/?edupi=1&module=home&view=chat&reminders=1", { scroll: false })}><span className="edupi-teacher-rail__icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3V9Z"/><path d="M10 21h4"/></svg></span><span className="edupi-teacher-rail__text">提醒</span></button>
        <button type="button" title="新手教程" aria-label="新手教程" onClick={onOpenGuide}><span className="edupi-teacher-rail__icon" aria-hidden="true">?</span><span className="edupi-teacher-rail__text">新手教程</span></button>
        <button type="button" title={`管理中心 · v${APP_VERSION_DISPLAY}`} aria-label={`管理中心，当前版本 v${APP_VERSION_DISPLAY}`} onClick={onOpenAdmin}><span className="edupi-teacher-rail__icon"><UtilityIcon /></span><span className="edupi-teacher-rail__text">管理中心</span><span className="edupi-teacher-rail__version">v{APP_VERSION_DISPLAY}</span></button>
      </div>
    </nav>
  );
}
