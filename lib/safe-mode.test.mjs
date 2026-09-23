import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url);
const { isCoreResourcePath, isSafeModeEnabled, safeModeResourceOptions } = await jiti.import("./safe-mode.ts");
const { builtinEducationSkillPaths, prepareEducationResources } = await jiti.import("./edupi-runtime.ts");

test("safe mode accepts explicit environment flags and stays off by default", () => {
  assert.equal(isSafeModeEnabled({}), false);
  assert.equal(isSafeModeEnabled({ EDUPI_SAFE_MODE: "1" }), true);
  assert.equal(isSafeModeEnabled({ EDUPI_SAFE_MODE: "true" }), true);
  assert.equal(isSafeModeEnabled({ EDUPI_SAFE_MODE: "0" }), false);
});
test("safe mode keeps only resources under the EduPi roots", () => {
  const roots = {
    coreExtensionRoot: "/opt/edupi/extensions",
    builtinSkillPaths: ["/opt/edupi/skills/01-basics/SKILL.md"],
  };
  assert.equal(isCoreResourcePath("/opt/edupi/extensions/memory.ts", roots), true);
  assert.equal(isCoreResourcePath("/opt/edupi/skills/01-basics/SKILL.md", roots), true);
  assert.equal(isCoreResourcePath("/srv/teacher/skills/01-basics/SKILL.md", roots), false);
  assert.equal(isCoreResourcePath("/opt/edupi-plugins/unsafe.ts", roots), false);
  const enabled = safeModeResourceOptions(true, roots);
  assert.equal(enabled.noExtensions, true);
  assert.equal(enabled.noSkills, true);
  assert.deepEqual(safeModeResourceOptions(false, roots), {});
});

test("safe mode uses only manifest-listed Core skills, not writable teacher skills", async () => {
  const root = mkdtempSync(join(tmpdir(), "edupi-safe-mode-skills-"));
  const coreRoot = join(root, "core");
  const dataRoot = join(root, "teacher");
  const agentDir = join(root, "agent");
  const coreSkill = join(coreRoot, "skills", "01-built-in", "SKILL.md");
  const customSkill = join(dataRoot, "skills", "99-custom", "SKILL.md");
  const copiedCoreSkill = join(dataRoot, "skills", "01-built-in", "SKILL.md");
  const originalEnvironment = Object.fromEntries(
    ["EDUPI_PROJECT_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_SKILLS_DIR", "EDUPI_DATA_DIR", "EDUPI_CONFIG_DIR"]
      .map((key) => [key, process.env[key]]),
  );
  try {
    mkdirSync(join(coreRoot, "contracts"), { recursive: true });
    mkdirSync(join(coreRoot, "skills", "01-built-in"), { recursive: true });
    mkdirSync(join(dataRoot, "skills", "99-custom"), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(coreRoot, "contracts", "edupi-desktop-component-manifest.json"), JSON.stringify({ modules: [], assets: [{ path: "skills/01-built-in/SKILL.md" }] }));
    writeFileSync(coreSkill, "---\nname: built-in\ndescription: Trusted Core skill\n---\nCore content\n");
    writeFileSync(customSkill, "---\nname: custom\ndescription: Teacher-added skill\n---\nThird-party content\n");

    prepareEducationResources(dataRoot, coreRoot, { copySkills: false });
    assert.equal(existsSync(copiedCoreSkill), false);
    const builtinPaths = builtinEducationSkillPaths(coreRoot);
    assert.deepEqual(builtinPaths, [coreSkill]);
    const loader = new DefaultResourceLoader({
      cwd: dataRoot,
      agentDir,
      additionalSkillPaths: [customSkill, ...builtinPaths],
      ...safeModeResourceOptions(true, { builtinSkillPaths: builtinPaths }),
    });
    await loader.reload();
    assert.deepEqual(loader.getSkills().skills.map((skill) => skill.name), ["built-in"]);
  } finally {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("safe mode skips a broken third-party extension while retaining built-in extensions", async () => {
  const root = mkdtempSync(join(tmpdir(), "edupi-safe-mode-extension-"));
  const dataRoot = join(root, "teacher");
  const agentDir = join(root, "agent");
  const builtin = join(root, "core", "extensions", "builtin.ts");
  const broken = join(agentDir, "extensions", "broken.ts");
  const marker = join(root, "broken-plugin-ran");
  try {
    mkdirSync(dataRoot, { recursive: true });
    mkdirSync(join(root, "core", "extensions"), { recursive: true });
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(builtin, "export default function builtin() {}\n");
    writeFileSync(broken, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nthrow new Error("broken third-party extension");\n`);

    const normal = new DefaultResourceLoader({ cwd: dataRoot, agentDir, additionalExtensionPaths: [builtin] });
    await normal.reload();
    assert.equal(existsSync(marker), true);
    assert.ok(normal.getExtensions().errors.some(error => error.path === broken));

    rmSync(marker);
    const safe = new DefaultResourceLoader({
      cwd: dataRoot,
      agentDir,
      additionalExtensionPaths: [builtin],
      ...safeModeResourceOptions(true),
    });
    await safe.reload();
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(broken), true);
    assert.deepEqual(safe.getExtensions().extensions.map(extension => extension.path), [builtin]);
    assert.deepEqual(safe.getExtensions().errors, []);

    await normal.reload();
    assert.equal(existsSync(marker), true);
    assert.ok(normal.getExtensions().errors.some(error => error.path === broken));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
