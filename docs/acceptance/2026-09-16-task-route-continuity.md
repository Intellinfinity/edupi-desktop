# R20 任务路由连续性验收

- 状态：开发版验收通过；尚未进入公开安装包。
- 代码版本：Desktop `29c0bb95950ccf848c7b32e2b2bb7275a2d46d18`，PR [#160](https://github.com/PIGU-PPPgu/edupi-desktop/pull/160)。
- 环境：macOS、Next.js development server、Codex in-app browser、公开 `v0.3.18` 固定 Core `19c0fd5182c6c20d6534973e506d6fa36acc1b06`；教师数据临时副本，验收后删除。

## 操作与结果

| 操作 | 预期 | 实际 |
| --- | --- | --- |
| 打开只有 `module=tasks` 的稳定任务深链 | 恢复精确 Core 任务与请求阶段 | 通过；指定教学准备任务及“任务目标”出现 |
| 打开 `task=missing-core-task&stage=review` | 不用其他任务冒充失效对象；清理任务与阶段 | 通过；最终 URL 无 `task`/`stage`，默认任务显示“任务目标”，“教师审核”不可见 |
| 浏览器控制台 | 无脚本错误 | 通过；`error` 日志为空 |

## 命令证据

- `npm test`：1250 tests，1225 passed，25 skipped，0 failed。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。

## 未验证条件

- 没有在验收副本里删除任务；删除后最新 Core 投影缺少该任务时会走同一个失效键清理路径。
- 尚未安装包含 #160 的原生包；安装版、Windows 和 Linux 留待发布批次验收。
