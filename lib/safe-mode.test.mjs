import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isCoreResourcePath, isSafeModeEnabled, safeModeResourceOptions } = await jiti.import("./safe-mode.ts");

test("safe mode accepts explicit environment flags and stays off by default", () => {
  assert.equal(isSafeModeEnabled({}), false);
  assert.equal(isSafeModeEnabled({ EDUPI_SAFE_MODE: "1" }), true);
  assert.equal(isSafeModeEnabled({ EDUPI_SAFE_MODE: "true" }), true);
  assert.equal(isSafeModeEnabled({ EDUPI_SAFE_MODE: "0" }), false);
});
test("safe mode keeps only resources under the EduPi roots", () => {
  const roots = {
    coreExtensionRoot: "/opt/edupi/extensions",
    coreSkillRoot: "/opt/edupi/skills",
    dataSkillRoot: "/srv/teacher/skills",
  };
  assert.equal(isCoreResourcePath("/opt/edupi/extensions/memory.ts", roots), true);
  assert.equal(isCoreResourcePath("/srv/teacher/skills/01-basics/SKILL.md", roots), true);
  assert.equal(isCoreResourcePath("/opt/edupi-plugins/unsafe.ts", roots), false);
  assert.deepEqual(safeModeResourceOptions(true, roots), { noExtensions: true, noSkills: true });
  assert.deepEqual(safeModeResourceOptions(false, roots), {});
});
