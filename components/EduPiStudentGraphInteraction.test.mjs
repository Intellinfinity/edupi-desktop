import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("graph zoom reserves scaled scroll space and keeps accessible controls", async () => {
  const source = await readFile(new URL("./EduPiStudentGraph.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-label="缩小图谱"/);
  assert.match(source, /aria-label="放大图谱"/);
  assert.match(source, /width: canvasWidth \* zoom, height: height \* zoom/);
  assert.match(source, /Math\.max\(0\.75/);
  assert.match(source, /Math\.min\(2,/);
  assert.match(source, /from\.x \+ nodeWidth \+ to\.x/);
  assert.doesNotMatch(source, /from\.x \+ 180/);
  assert.match(source, /focused\?\.recordIds/);
});
