import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

export const SAFE_MODE_ENV = "EDUPI_SAFE_MODE";

export function isSafeModeEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const value = environment[SAFE_MODE_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export type SafeModeResourceRoots = {
  coreExtensionRoot?: string;
  coreSkillRoot?: string;
  builtinSkillPaths?: string[];
};

function isInside(root: string | undefined, candidate: string): boolean {
  if (!root) return false;
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const remainder = relative(normalizedRoot, normalizedCandidate);
  return remainder === "" || (!isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${sep}`));
}

export function isCoreResourcePath(path: string, roots: SafeModeResourceRoots): boolean {
  return isInside(roots.coreExtensionRoot, path)
    || Boolean(roots.builtinSkillPaths?.some(builtin => resolve(builtin) === resolve(path)));
}

function canonical(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

export function safeModeResourceOptions(
  enabled: boolean,
  roots: SafeModeResourceRoots = {},
): Partial<Pick<ConstructorParameters<typeof DefaultResourceLoader>[0], "noExtensions" | "noSkills" | "skillsOverride">> {
  if (!enabled) return {};
  const allowedSkills = new Set(roots.builtinSkillPaths?.map(canonical) ?? []);
  return {
    noExtensions: true,
    noSkills: true,
    skillsOverride: result => ({
      ...result,
      skills: result.skills.filter(skill => allowedSkills.has(canonical(skill.filePath))),
    }),
  };
}
