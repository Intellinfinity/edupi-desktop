import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const api = await createJiti(import.meta.url).import("./edupi-kernel-display.ts");

test("Kernel runs use teacher-facing tasks, reasons, and recovery actions", () => {
  const task = { id: "teaching_before_class:timetable:slot:2026-09-17", title: "703 班第 2 节课前准备" };
  const sourceFailure = { trigger_id: "g1_prepare_due", fire_key: "task:opaque", status: "failed", error_code: "source_unavailable", error_message: `${task.id}: source_unavailable`, attempt_count: 1 };
  assert.equal(api.kernelRunTitle(sourceFailure, [task]), task.title);
  assert.equal(api.kernelRunDetail(sourceFailure), "缺少可用材料");
  assert.deepEqual(api.kernelRunAction(sourceFailure), { label: "补充材料", target: "materials" });
  assert.deepEqual(api.kernelRunAction({ status: "failed", error_code: "model_unavailable" }), { label: "配置模型", target: "models" });
  assert.deepEqual(api.kernelRunAction({ status: "needs_review", error_code: "attempts_exhausted" }), { label: "查看任务", target: "workspace" });
  assert.equal(api.kernelRunAction({ status: "succeeded" }), null);
  assert.equal(api.kernelRunTitle({ trigger_id: "morning_brief" }, []), "早安简报");
  assert.equal(api.kernelRunDetail({ result_summary: "已生成", attempt_count: 2 }), "已生成");
});
