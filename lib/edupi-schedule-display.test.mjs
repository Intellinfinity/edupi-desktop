import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { formatCoreSchedulerStatus } = await createJiti(import.meta.url).import("./edupi-schedule-display.ts");

test("formats only the schedule reported by the active Core Runtime", () => {
  assert.equal(formatCoreSchedulerStatus(null, 0), "自动检查未启动");
  assert.match(formatCoreSchedulerStatus({ timer_active: true, timer_error_code: null, next_timer_check_at: "2026-09-14T00:05:00.000Z", interval_ms: 300000 }, 3), /下次课程准备检查.*最近 3 次/);
  assert.equal(formatCoreSchedulerStatus({ timer_active: true, timer_error_code: "source_unavailable", next_timer_check_at: null, interval_ms: 300000 }, 1), "有课前任务缺少可用材料");
  assert.equal(formatCoreSchedulerStatus({ timer_active: true, timer_error_code: "unexpected_fault", next_timer_check_at: null, interval_ms: 300000 }, 1), "自动检查异常");
});
