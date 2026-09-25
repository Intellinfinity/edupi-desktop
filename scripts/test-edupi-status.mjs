import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Structural sentinel only. The Core-backed HTTP path is exercised by the
// isolated C1/runtime tests; legacy JSON files are never status fallbacks.
const route = await readFile(new URL("../app/api/edupi/status/route.ts", import.meta.url), "utf8");
assert.match(route, /readEduPiCoreHealth\(/);
assert.match(route, /readEduPiEducationSnapshot\(/);
assert.match(route, /readEduPiKernelProjection\(/);
assert.match(route, /projectCoreRuntimeHealth\(/);
assert.match(route, /students: Array\.isArray\(workspace\.students\)/);
assert.match(route, /timetable: Array\.isArray\(workspace\.timetable\)/);
assert.match(route, /calendar: Array\.isArray\(workspace\.calendar\)/);
assert.match(route, /tasks: Array\.isArray\(workspace\.tasks\)/);
assert.match(route, /未使用本地 JSON 回退/);
assert.doesNotMatch(route, /student_profiles\.json|timetable\.json|calendar\.json|rhythm_plan\.json/);

console.log("Status route reads Core health, projection, and kernel without legacy JSON fallback.");
