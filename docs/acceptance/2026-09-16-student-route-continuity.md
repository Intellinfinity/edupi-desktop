# R20 学生详情路由连续性验收

- 状态：开发版验收通过；尚未进入公开安装包。
- 代码版本：Desktop `ddb84da373028161bfffd67c3c0046ce6bcfc180`，PR [#157](https://github.com/PIGU-PPPgu/edupi-desktop/pull/157)。
- 运行环境：macOS、Next.js development server、Codex in-app browser、公开 `v0.3.18` 固定 Core `19c0fd5182c6c20d6534973e506d6fa36acc1b06`；50 名学生的数据副本，验收后删除。

## 操作与结果

| 操作 | 预期 | 实际 |
| --- | --- | --- |
| 直接打开带稳定 `student` ID 的学生 URL | 从最新 Core 学生投影恢复同一详情 | 通过；详情标题、记录与动作出现，URL 保留同一 ID |
| 刷新有效学生 URL | 不丢详情、不切到其他学生 | 通过 |
| 打开 `student=missing-core-student` | 不显示假详情；清理失效参数；恢复名单与全局控件 | 通过；最终 URL 无 `student`，详情关闭，“已删除”入口重新可见 |
| 浏览器控制台 | 无脚本错误 | 通过；`error` 日志为空 |

## 命令证据

- `npm test`：1248 tests，1223 passed，25 skipped，0 failed。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：通过。

## 未验证条件

- 没有在验收副本中删除真实学生；删除后的路由清理由相同的“最新投影中 ID 不存在”路径覆盖。
- 尚未安装包含 #157 的原生包；Windows/Linux 与安装版窗口仍待后续批次验收。
