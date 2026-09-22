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
