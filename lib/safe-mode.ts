import { isAbsolute, relative, resolve } from "node:path";

export const SAFE_MODE_ENV = "EDUPI_SAFE_MODE";

export function isSafeModeEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const value = environment[SAFE_MODE_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export type SafeModeResourceRoots = {
  coreExtensionRoot?: string;
  coreSkillRoot?: string;
  dataSkillRoot?: string;
};

function isInside(root: string | undefined, candidate: string): boolean {
  if (!root) return false;
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const remainder = relative(normalizedRoot, normalizedCandidate);
  return remainder === "" || (!isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${remainder.includes("\\") ? "\\" : "/"}`));
}

/**
 * Safe Mode keeps the built-in SDK and EduPi resources but excludes package,
 * user, and project extensions/skills before they are loaded. The runtime
 * uses the SDK's `noExtensions`/`noSkills` switches with the explicit Core
 * paths still supplied as additional resources.
 */
export function isCoreResourcePath(path: string, roots: SafeModeResourceRoots): boolean {
  return isInside(roots.coreExtensionRoot, path)
    || isInside(roots.coreSkillRoot, path)
    || isInside(roots.dataSkillRoot, path);
}

export function safeModeResourceOptions(
  enabled: boolean,
  roots: SafeModeResourceRoots = {},
): {
  noExtensions?: boolean;
  noSkills?: boolean;
} {
  if (!enabled) return {};
  // Keep the roots in the helper's public contract so callers and tests can
  // assert that Core paths remain explicitly owned even though the SDK's
  // no* switches do the actual package/project filtering.
  void roots;
  return { noExtensions: true, noSkills: true };
}
