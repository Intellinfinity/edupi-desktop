"use client";

import { useEffect, useRef } from "react";
import { useModalDismiss } from "./useModalDismiss";

/** Docked details leave the chat usable; narrow drawers retain modal focus handling. */
export function usePanelDismiss<T extends HTMLElement>(onClose: () => void, docked: boolean, enabled = true) {
  const panelRef = useModalDismiss<T>(onClose, enabled && !docked);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!enabled || !docked) return;
    const panel = panelRef.current;
    const opener = document.activeElement as HTMLElement | null;
    panel?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (!panel?.contains(document.activeElement)) return;
      if (document.activeElement?.closest('[aria-modal="true"]')) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected && (panel?.contains(document.activeElement) || document.activeElement === document.body)) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [docked, enabled, panelRef]);
  return panelRef;
}
