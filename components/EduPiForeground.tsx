"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_FOREGROUND_GRACE_DAYS, FOREGROUND_PAGE_SIZE, normalizeGraceDays, paginateForeground, shanghaiDate, type ForegroundPolicy } from "@/lib/edupi-foreground";
import { APP_PREF_KEYS, getPrefJson, trySetPrefJson } from "@/lib/app-prefs";

type ForegroundPreferences = ForegroundPolicy & { onPinTask?: (taskId: string, pinned: boolean) => void; dismissedStaleTaskIds?: string[]; onDismissStaleTasks?: (ids: string[]) => void };
export const EduPiForegroundContext = createContext<ForegroundPreferences | null>(null);
const EMPTY_PINS: string[] = [];

export function EduPiForegroundProvider({ graceDays = DEFAULT_FOREGROUND_GRACE_DAYS, pinnedTaskIds = EMPTY_PINS, onPinTask, dismissedStaleTaskIds = EMPTY_PINS, onDismissStaleTasks, children }: {
  graceDays?: number;
  pinnedTaskIds?: string[];
  onPinTask?: (taskId: string, pinned: boolean) => void;
  dismissedStaleTaskIds?: string[];
  onDismissStaleTasks?: (ids: string[]) => void;
  children: ReactNode;
}) {
  const [today, setToday] = useState(() => shanghaiDate()!);
  useEffect(() => {
    let timer: number;
    const scheduleMidnight = () => {
      window.clearTimeout(timer);
      const nextMidnight = Date.parse(`${shanghaiDate()}T00:00:00+08:00`) + 86_400_000;
      timer = window.setTimeout(() => { setToday(shanghaiDate()!); scheduleMidnight(); }, Math.max(10, nextMidnight - Date.now() + 10));
    };
    const updateDay = () => { setToday(shanghaiDate()!); scheduleMidnight(); };
    scheduleMidnight();
    document.addEventListener("visibilitychange", updateDay);
    window.addEventListener("focus", updateDay);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", updateDay); window.removeEventListener("focus", updateDay); };
  }, []);
  const value = useMemo(() => ({ today, graceDays: normalizeGraceDays(graceDays), pinnedTaskIds, onPinTask, dismissedStaleTaskIds, onDismissStaleTasks }), [today, graceDays, pinnedTaskIds, onPinTask, dismissedStaleTaskIds, onDismissStaleTasks]);
  return <EduPiForegroundContext.Provider value={value}>{children}</EduPiForegroundContext.Provider>;
}

export function useEduPiForegroundPolicy(): ForegroundPreferences {
  return useContext(EduPiForegroundContext) ?? { today: shanghaiDate()!, graceDays: DEFAULT_FOREGROUND_GRACE_DAYS, pinnedTaskIds: EMPTY_PINS, dismissedStaleTaskIds: EMPTY_PINS };
}

const listPositions = new Map<string, { page: number; scroll: number }>();
const MAX_LIST_POSITIONS = 80;
let positionsRestored = false;
function readPosition(key: string) {
  if (!positionsRestored && typeof window !== "undefined") {
    positionsRestored = true;
    const saved = getPrefJson<unknown>(APP_PREF_KEYS.edupiListPositions);
    if (Array.isArray(saved)) for (const entry of saved) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[1] || typeof entry[1] !== "object") continue;
      const { page, scroll } = entry[1];
      if (!Number.isInteger(page) || page < 0 || !Number.isFinite(scroll) || scroll < 0) continue;
      listPositions.delete(entry[0]);
      listPositions.set(entry[0], { page, scroll });
      if (listPositions.size > MAX_LIST_POSITIONS) listPositions.delete(listPositions.keys().next().value!);
    }
  }
  return listPositions.get(key);
}
function savePosition(key: string, page: number, scroll: number) {
  readPosition(key);
  listPositions.delete(key);
  listPositions.set(key, { page, scroll });
  if (listPositions.size > MAX_LIST_POSITIONS) listPositions.delete(listPositions.keys().next().value!);
  trySetPrefJson(APP_PREF_KEYS.edupiListPositions, Array.from(listPositions));
}

/** An independently browsable list. All rows are reachable, ten at a time. */
export function EduPiPagedRows<T>({ rows, memoryKey, renderRow, empty = "暂无事项", className = "", heading }: {
  rows: readonly T[];
  memoryKey: string;
  renderRow: (row: T, index: number) => ReactNode;
  empty?: string;
  className?: string;
  heading?: ReactNode;
}) {
  const [position, setPosition] = useState(() => ({ key: memoryKey, page: readPosition(memoryKey)?.page ?? 0 }));
  const page = position.key === memoryKey ? position.page : readPosition(memoryKey)?.page ?? 0;
  const projection = paginateForeground(rows, page);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = readPosition(memoryKey)?.scroll ?? 0;
  }, [memoryKey]);
  const changePage = (next: number) => {
    savePosition(memoryKey, next, 0);
    setPosition({ key: memoryKey, page: next });
    if (viewport.current) viewport.current.scrollTop = 0;
  };
  return <section className={`edupi-paged-list ${className}`}>
    {heading}
    <div ref={viewport} className="edupi-paged-list__rows" onScroll={event => savePosition(memoryKey, projection.page, event.currentTarget.scrollTop)}>
      {projection.rows.map((row, index) => renderRow(row, projection.page * FOREGROUND_PAGE_SIZE + index))}
      {rows.length === 0 ? <p className="edupi-module-empty">{empty}</p> : null}
    </div>
    <nav className="edupi-paged-list__pager" aria-label="列表分页">
      <span>{rows.length} 项 · {projection.page + 1} / {projection.pages} 页</span>
      <button type="button" disabled={projection.page === 0} onClick={() => changePage(projection.page - 1)}>上一页</button>
      <button type="button" disabled={projection.page + 1 >= projection.pages} onClick={() => changePage(projection.page + 1)}>下一页</button>
    </nav>
  </section>;
}

export function EduPiListPreview<T>({ rows, renderRow, onShowAll, limit = FOREGROUND_PAGE_SIZE }: {
  rows: readonly T[];
  renderRow: (row: T, index: number) => ReactNode;
  onShowAll: () => void;
  limit?: number;
}) {
  const preview = paginateForeground(rows, 0, limit);
  return <>{preview.rows.map(renderRow)}{rows.length > preview.rows.length ? <button type="button" className="edupi-list-more" onClick={onShowAll}>查看更多 <span>{rows.length} 项</span></button> : null}</>;
}
