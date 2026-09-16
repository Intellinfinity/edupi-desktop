import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { backgroundJobRecovery, backgroundJobStatusText, backgroundJobTechnicalDetail } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiBackgroundJobs.tsx");
test("job status keeps technical errors out of the default teacher summary", () => {
  assert.equal(backgroundJobStatusText({status:"completed",error:"lease_expired"}),"已完成");
  assert.equal(backgroundJobStatusText({status:"running",error:"lease_expired"}),"处理中");
  assert.equal(backgroundJobStatusText({status:"running",attempt_count:2,progress:{phase:"working",message:"正在生成文档",updated_at:"2026-09-14T00:00:00.000Z"}}),"处理中 · 第2次尝试 · 正在生成文档");
  assert.equal(backgroundJobStatusText({status:"queued",progress:{phase:"queued",message:"等待恢复",updated_at:"2026-09-14T00:00:00.000Z"}}),"排队中 · 等待恢复");
  assert.equal(backgroundJobStatusText({status:"failed",error:"lease_expired"}),"失败 · 任务中断，自动恢复次数已用完");
  assert.equal(backgroundJobStatusText({status:"failed",error:"opaque_internal_code"}),"失败 · 处理未完成");
  assert.equal(backgroundJobTechnicalDetail(" opaque_internal_code "), "opaque_internal_code");
});

test("failed jobs expose one recovery action matched to the Core reason", () => {
  assert.deepEqual(backgroundJobRecovery({status:"failed",error:"model_unavailable"}), {label:"配置模型",target:"models"});
  assert.deepEqual(backgroundJobRecovery({status:"failed",error:"source_unavailable"}), {label:"检查材料",target:"materials"});
  assert.deepEqual(backgroundJobRecovery({status:"failed",error:"lease_expired"}), {label:"重试",target:"retry"});
  assert.deepEqual(backgroundJobRecovery({status:"canceled"}), {label:"重新开始",target:"retry"});
  assert.equal(backgroundJobRecovery({status:"completed"}), null);
});
