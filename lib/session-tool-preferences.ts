import { existsSync, writeFileSync } from "node:fs";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "edupi.desktop.tool-names.v1";

function toolNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 256 || value.some(name =>
    typeof name !== "string" || !name.trim() || name !== name.trim() || name.length > 256)) {
    throw new Error("Invalid session tool preferences");
  }
  return [...new Set(value)];
}

export function readSessionToolNames(manager: SessionManager): string[] | undefined {
  // A teacher's setting applies to the session, independent of tree navigation.
  const entry = manager.getEntries().findLast(item => item.type === "custom" && item.customType === ENTRY_TYPE);
  if (!entry || entry.type !== "custom") return undefined;
  if (!entry.data || typeof entry.data !== "object" || Array.isArray(entry.data)
    || Object.keys(entry.data).length !== 1 || !Object.hasOwn(entry.data, "toolNames")) {
    throw new Error("Invalid session tool preferences");
  }
  return toolNames((entry.data as { toolNames: unknown }).toolNames);
}

export function saveSessionToolNames(manager: SessionManager, value: unknown): string[] {
  const names = toolNames(value);
  if (JSON.stringify(readSessionToolNames(manager)) !== JSON.stringify(names)) {
    manager.appendCustomEntry(ENTRY_TYPE, { toolNames: names });
  }
  const file = manager.getSessionFile();
  if (manager.isPersisted() && file && !existsSync(file)) {
    // Pi defers setup-only entries. Explicit settings must survive closing an
    // empty conversation, without inserting a fake provider-visible message.
    writeFileSync(file, [manager.getHeader(), ...manager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n",
      { encoding: "utf8", flag: "wx", mode: 0o600 });
    manager.setSessionFile(file);
  }
  return names;
}
