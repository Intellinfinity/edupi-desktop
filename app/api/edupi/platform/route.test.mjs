import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { projectPlatformResults } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-platform-projection.ts");
const success = (projection_kind) => ({ status: "fulfilled", value: { ok: true, projection: { projection_kind } } });

test("keeps each valid Core platform projection when a sibling fails", () => {
  const result = projectPlatformResults([
    success("teaching_skill_lifecycle"),
    { status: "rejected", reason: new Error("connector unavailable") },
    success("persistent_agent_computer"),
    success("hosted_core_harness_registry"),
  ]);
  assert.equal(result.status, "partial");
  assert.equal(result.connectors, null);
  assert.equal(result.projections.connectors, "unavailable");
  assert.equal(result.teachingSkills.projection_kind, "teaching_skill_lifecycle");
  assert.equal(result.agentComputer.projection_kind, "persistent_agent_computer");
  assert.equal(result.platform.projection_kind, "hosted_core_harness_registry");
});

test("rejects a mismatched projection without hiding valid siblings", () => {
  const result = projectPlatformResults([
    success("wrong_kind"),
    success("connector_registry"),
    success("persistent_agent_computer"),
    success("hosted_core_harness_registry"),
  ]);
  assert.equal(result.status, "partial");
  assert.equal(result.teachingSkills, null);
  assert.equal(result.connectors.projection_kind, "connector_registry");
});
