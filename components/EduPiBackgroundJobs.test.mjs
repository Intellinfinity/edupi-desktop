import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { backgroundJobStatusText } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiBackgroundJobs.tsx");
test("only a failed job shows the current error", () => {
  assert.equal(backgroundJobStatusText({status:"completed",error:"lease_expired"}),"已完成");
  assert.equal(backgroundJobStatusText({status:"running",error:"lease_expired"}),"处理中");
  assert.equal(backgroundJobStatusText({status:"running",attempt_count:2,progress:{phase:"working",message:"正在生成文档",updated_at:"2026-09-14T00:00:00.000Z"}}),"处理中 · 第2次尝试 · 正在生成文档");
  assert.equal(backgroundJobStatusText({status:"queued",progress:{phase:"queued",message:"等待恢复",updated_at:"2026-09-14T00:00:00.000Z"}}),"排队中 · 等待恢复");
  assert.equal(backgroundJobStatusText({status:"failed",error:"lease_expired"}),"失败 · lease_expired");
});
