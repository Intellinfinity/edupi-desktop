import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("graph reserves scaled scroll space and uses bounded viewport zoom", async () => {
  const source = await readFile(new URL("./EduPiStudentGraph.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-label="缩小图谱"/);
  assert.match(source, /aria-label="放大图谱"/);
  assert.match(source, /width: canvasWidth \* zoom, height: height \* zoom/);
  assert.match(source, /clampStudentGraphZoom\(value\)/);
  assert.match(source, /studentGraphFitZoom\(/);
  assert.match(source, /zoom <= STUDENT_GRAPH_MIN_ZOOM/);
  assert.match(source, /zoom >= STUDENT_GRAPH_MAX_ZOOM/);
  assert.match(source, /from\.x \+ nodeWidth \+ to\.x/);
  assert.doesNotMatch(source, /from\.x \+ 180/);
  assert.match(source, /focused\?\.recordIds/);
});
