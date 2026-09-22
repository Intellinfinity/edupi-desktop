import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { relative, resolve, sep } from "node:path";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";

const configuredDataRoot = resolve(process.env.EDUPI_DATA_ROOT || process.env.EDUPI_PROJECT_ROOT || "../edupi");
export const EDUPI_ROOT = existsSync(configuredDataRoot) ? realpathSync(configuredDataRoot) : configuredDataRoot;
export const EDUPI_CODE_ROOT = resolve(process.env.EDUPI_CORE_ROOT || process.env.EDUPI_PROJECT_ROOT || "../edupi");

function resourceFiles(codeRoot: string): Set<string> | null {
  const file = resolve(codeRoot, "contracts/edupi-desktop-component-manifest.json");
  if (!existsSync(file)) return null;
  try {
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    return new Set([...manifest.modules, ...manifest.assets].map((item: { path: string }) => item.path));
  } catch { return new Set(); }
}

export function allowedEducationExtensions(codeRoot: string, names: string[]): string[] {
  const allowed = resourceFiles(codeRoot);
  return names.filter(name => !allowed || allowed.has(`extensions/${name}`)).map(name => resolve(codeRoot, "extensions", name));
}

export function builtinEducationSkillPaths(codeRoot = EDUPI_CODE_ROOT): string[] {
  const allowed = resourceFiles(codeRoot);
  if (!allowed) return [];
  const skillRoot = resolve(codeRoot, "skills");
  if (!existsSync(skillRoot)) return [];
  const realSkillRoot = realpathSync(skillRoot);
  return [...allowed].filter(path => /^skills\/[^/]+\/SKILL\.md$/.test(path)).sort().flatMap(path => {
    const file = resolve(codeRoot, path);
    if (!existsSync(file)) return [];
    const realFile = realpathSync(file);
    return realFile.startsWith(`${realSkillRoot}${sep}`) ? [file] : [];
  });
}

export function prepareEducationResources(dataRoot = EDUPI_ROOT, codeRoot = EDUPI_CODE_ROOT, options: { copySkills?: boolean } = {}): string {
  process.env.EDUPI_PROJECT_ROOT = dataRoot;
  process.env.EDUPI_HOME = resolve(dataRoot, ".edupi");
  process.env.EDUPI_MEMORY_DIR = resolve(dataRoot, ".edupi/memory");
  process.env.EDUPI_OUTPUT_DIR = resolve(dataRoot, ".edupi/output");
  process.env.EDUPI_LOCK_DIR = resolve(dataRoot, ".edupi/locks");
  const skillsDir = process.env.EDUPI_SKILLS_DIR || resolve(dataRoot, "skills");
  const sourceDir = resolve(codeRoot, "skills");
  const allowed = resourceFiles(codeRoot);
  const copyMissing = (source: string, destination: string) => {
    if (!existsSync(source)) return;
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const from = resolve(source, entry.name), to = resolve(destination, entry.name);
      if (entry.isDirectory()) copyMissing(from, to);
      else if (entry.isFile() && !existsSync(to) && (!allowed || allowed.has(relative(codeRoot, from).replaceAll("\\", "/")))) copyFileSync(from, to);
    }
  };
  if (options.copySkills !== false && existsSync(sourceDir) && resolve(sourceDir) !== resolve(skillsDir)) {
    for (const name of readdirSync(sourceDir)) if (/^\d{2}-/.test(name)) copyMissing(resolve(sourceDir, name), resolve(skillsDir, name));
  }
  process.env.EDUPI_SKILLS_DIR ||= skillsDir;
  process.env.EDUPI_DATA_DIR ||= existsSync(resolve(dataRoot, "data")) ? resolve(dataRoot, "data") : resolve(codeRoot, "data");
  process.env.EDUPI_CONFIG_DIR ||= existsSync(resolve(dataRoot, "config")) ? resolve(dataRoot, "config") : resolve(codeRoot, "config");
  return skillsDir;
}
const extensionPaths = allowedEducationExtensions(EDUPI_CODE_ROOT, [
  "auto_extract.ts", "calendar.ts", "consciousness.ts", "diagnosis.ts", "education_article.ts",
  "evolution_engine.ts", "execution_engine.ts", "layers.ts", "memory.ts", "onboarding.ts",
  "parent_profiles.ts", "perception_l4.ts", "profiles.ts", "skill_router.ts", "subagent_consult.ts",
  "subconscious.ts", "subject_knowledge.ts", "timetable.ts",
]);

export function createEduPiResourceLoader({ cwd, agentDir }: { cwd: string; agentDir: string }) {
  return new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: extensionPaths });
}

export { extensionPaths };
