import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("long-term workspaces expose real source state instead of ambiguous empty screens", async () => {
  const [insights, growth, materials, sider] = await Promise.all([
    read("./EduPiInsightDatabase.tsx"),
    read("./EduPiGrowthWorkspace.tsx"),
    Promise.all([read("./EduPiMaterialsWorkspace.tsx"), read("../lib/edupi-material-rows.ts")]).then(parts => parts.join("\n")),
    read("./EduPiObjectSider.tsx"),
  ]);

  assert.match(insights, /data\.observations/);
  assert.match(insights, /原始观察/);
  assert.match(insights, /item\.provenance\.map/);
  assert.match(insights, /observationsByEvidence/);
  assert.match(insights, /原始观察审核/);
  assert.match(insights, /localRowCount/);
  assert.match(insights, /useStudentObservationRows\(category, status, query, page, localRowCount\)/);
  assert.match(insights, /打开审核/);
  assert.match(insights, /打开来源对话/);
  assert.match(insights, /sourceSessionId/);
  assert.match(insights, /观察与洞察数据尚未接入/);
  assert.match(insights, /数据已连接，当前没有该类记录/);
  assert.match(sider, /status === "observation"/);
  assert.match(growth, /dataSources\.growth/);
  assert.match(growth, /暂无成长记录/);
  assert.match(materials, /dataSources\.materials/);
  assert.match(materials, /材料索引尚未接入/);
  assert.match(materials, /data\.continuity\.documents\.map/);
  assert.match(materials, /taskArtifactFile/);
  assert.match(materials, /EduPi 生成/);
  assert.match(materials, /onOpenFile\(selected\.filePath/);
  assert.match(materials, /openPathNative/);
  assert.match(materials, /revealItemInDirNative/);
  assert.match(materials, /显示所在文件夹/);
  assert.match(sider, /buildMaterialRows\(data, query\)/);
});
