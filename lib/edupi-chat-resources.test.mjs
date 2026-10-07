import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const resources = await createJiti(import.meta.url).import("./edupi-chat-resources.ts");

test("materials expose actual identities and retain unavailable status without fabricated content", () => {
  const items = resources.workspaceChatResources({
    teacherMaterials: [{ material_id: "m1", title: "合成练习", relative_path: "materials/test.pdf", metadata_revision: 2, available: true }],
    generatedArtifacts: [{ artifact_id: "a1", title: "合成草稿", relative_path: "drafts/test.md", available: false, access: "read_only" }],
  }, "material");
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "material:m1");
  assert.match(items[0].reference, /m1/);
  assert.match(items[0].reference, /版本：2/);
  assert.equal(items[1].disabled, true);
  assert.match(items[1].status, /不可用/);
  assert.deepEqual(resources.workspaceChatResources({ workspaceResourcesUnavailable: true }, "material"), []);
});

test("knowledge includes retained active evidence, not superseded memories or unreviewed candidates", () => {
  const items = resources.workspaceChatResources({
    continuity: { memories: [{ id: "k1", content: "合成教学记录", state: "active", revision: 4 }, { id: "old", content: "旧记录", state: "superseded" }] },
    c1Memories: [{ memoryId: "k2", content: "合成审核记忆", state: "active", evidenceIds: ["evidence-2"], acceptedAt: "2026-10-07" }],
    memoryCandidates: [{ content: "未审核" }],
  }, "knowledge");
  assert.equal(items.length, 2);
  assert.match(items[1].reference, /evidence-2/);
  assert.equal(items.some(item => item.title === "未审核"), false);
});

test("skill and connector references never grant execution permission", () => {
  const skill = resources.skillChatResources([{ name: "合成技能", filePath: "/isolated/skills/test/SKILL.md", disableModelInvocation: true, description: "记录用途" }])[0];
  assert.equal(skill.disabled, true);
  const connectors = resources.connectorChatResources({ connectors: [{ connector_id: "calendar", label: "日历", status: "not_configured", capabilities: ["read"] }] });
  assert.match(connectors[0].status, /未配置/);
  assert.match(connectors[0].reference, /不代表调用授权/);
  const catalog = resources.catalogChatResources([{ service: "test", displayName: "合成服务", scenario: "教学" }])[0];
  assert.equal(catalog.status, "仅目录");
  assert.match(catalog.reference, /账号与执行未接入/);
});
