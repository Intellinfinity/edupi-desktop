# R20 日历路由连续性验收

- 状态：开发版验收通过；尚未进入公开安装包。
- 代码版本：Desktop `9b31445be8c84dfaa331bbf1aac67889f1d32662`，PR [#161](https://github.com/PIGU-PPPgu/edupi-desktop/pull/161)。
- 环境：macOS、Next.js development server、Codex in-app browser、公开 `v0.3.18` 固定 Core `19c0fd5182c6c20d6534973e506d6fa36acc1b06`；教师数据临时副本，验收后删除。

## 操作与结果

| 操作 | 预期 | 实际 |
| --- | --- | --- |
| 打开只有 `module=calendar` 的稳定日历对象深链 | 恢复精确 Core 日历对象 | 通过；恢复“第3周 · 保持平常心”详情 |
| 将同一日历参数带到 `module=materials` | 不跨模块残留日历选择 | 通过；`calendarKind`、`calendarItem`、`date` 自动清理，停留在材料模块 |
| 打开 `calendarItem=missing-core-calendar` | 不用其他日历对象冒充失效对象 | 通过；三个日历参数自动清理并回日历主页 |
| 保持旧 URL 打开详情，将 Core 对象从 9 月 14—20 日改到 9 月 17—23 日并刷新工作区 | 同一 URL 键必须按新 Core 投影重新校验 | 通过；旧的 `date=2026-09-16` 自动清理、抽屉关闭，对象按新日期重排 |
| 浏览器控制台 | 无脚本错误 | 通过；`error` 日志为空 |

## 命令证据

- `node --test components/EduPiWorkbench.test.mjs lib/edupi-calendar-model.test.mjs`：30 passed，0 failed。
- `npm test`：1250 tests，1225 passed，25 skipped，0 failed。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。

## 未验证条件

- 尚未安装包含 #161 的原生包；安装版、Windows 和 Linux 留待发布批次验收。
