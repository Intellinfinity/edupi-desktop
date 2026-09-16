import type { ButtonHTMLAttributes } from "react";

export type EduPiActionIconName = "agent" | "close" | "delete" | "edit" | "loading" | "next" | "open" | "preview" | "previous" | "records" | "reveal" | "task";

export function EduPiActionIcon({ name, size = 16 }: { name: EduPiActionIconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "agent") return <svg {...common}><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z"/><path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z"/><path d="M5 13v7M2 16.5h6"/></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
  if (name === "delete") return <svg {...common}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>;
  if (name === "edit") return <svg {...common}><path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>;
  if (name === "loading") return <svg {...common}><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v6h-6"/></svg>;
  if (name === "next") return <svg {...common}><path d="m9 5 7 7-7 7"/></svg>;
  if (name === "open") return <svg {...common}><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H5V6h6"/></svg>;
  if (name === "preview") return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>;
  if (name === "previous") return <svg {...common}><path d="m15 5-7 7 7 7"/></svg>;
  if (name === "records") return <svg {...common}><circle cx="6" cy="6" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><path d="m7.7 7.1 3.1 8.9M16.2 8.2l-3.1 7.8M8 6.2l8-.1"/></svg>;
  if (name === "reveal") return <svg {...common}><path d="M3 7h7l2 2h9v10H3V7Z"/><path d="M3 7V5h7l2 2"/></svg>;
  return <svg {...common}><path d="M7 3h8l4 4v14H7V3Z"/><path d="M15 3v5h5M10 13h6M10 17h4"/></svg>;
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "title"> & {
  icon: EduPiActionIconName;
  label: string;
  busy?: boolean;
};

export function EduPiIconButton({ icon, label, busy = false, className = "", ...props }: IconButtonProps) {
  return <button {...props} className={`edupi-icon-action${busy ? " is-busy" : ""}${className ? ` ${className}` : ""}`} aria-label={label} title={label} aria-busy={busy || undefined}><EduPiActionIcon name={busy ? "loading" : icon} /></button>;
}

export function EduPiPagination({ label, page, pages, previousDisabled, nextDisabled, onPrevious, onNext }: {
  label: string;
  page: number;
  pages: number;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return <nav className="edupi-database-pagination" aria-label={label}><EduPiIconButton type="button" icon="previous" label="上一页" disabled={previousDisabled} onClick={onPrevious}/><span aria-live="polite">{page + 1} / {pages}</span><EduPiIconButton type="button" icon="next" label="下一页" disabled={nextDisabled} onClick={onNext}/></nav>;
}
