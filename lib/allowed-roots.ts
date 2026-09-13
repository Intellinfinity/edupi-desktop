// In-memory roots that should be browsable in addition to roots derived from
// persisted sessions. Stored on globalThis so Next.js hot-reload keeps them.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
  var __piAdditionalAllowedRoots: Set<string> | undefined;
  var __piScopedAllowedRoots: Map<string, Set<string>> | undefined;
}

export function getScopedAllowedFileRoots(): Set<string> {
  const roots = new Set<string>();
  for (const values of globalThis.__piScopedAllowedRoots?.values() || []) for (const value of values) roots.add(value);
  return roots;
}

export function setScopedAllowedFileRoots(scope: string, roots: readonly string[]): void {
  if (!scope) return;
  const scopes = globalThis.__piScopedAllowedRoots ||= new Map<string, Set<string>>();
  const normalized = new Set(roots.filter(Boolean).map(normalizeSlashes));
  if (normalized.size) scopes.set(scope, normalized);
  else scopes.delete(scope);
  globalThis.__piAllowedRootsCache = undefined;
}

export function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function getAdditionalAllowedRoots(): Set<string> {
  if (!globalThis.__piAdditionalAllowedRoots) {
    globalThis.__piAdditionalAllowedRoots = new Set();
  }
  return globalThis.__piAdditionalAllowedRoots;
}

export function allowFileRoot(root: string): void {
  if (!root) return;
  const normalizedRoot = normalizeSlashes(root);
  getAdditionalAllowedRoots().add(normalizedRoot);
  globalThis.__piAllowedRootsCache?.roots.add(normalizedRoot);
}
