# L4 Today 注意力预算验收

## 结论

- Today 不再把每列全部候选默认展开：每列先显示 4 项，其余保留在原生 disclosure 中，教师可展开和收起；Core 候选、状态、总数和写入动作完全不变。
- “待你决定”按 Core `dueAt` 与当天的日期距离排序；同距离时今天/未来先于过期项，再按日期与稳定身份排序。Desktop 没有推断新业务状态，也没有删除、接受、拒绝或暂缓任何事项。
- 当前是源码与 packaged server 验收，尚未进入签名安装版；整体仍为“L4 功能收敛中”。

## 风险依据

- 从真实工作区只读复制到隔离根后，共 43 个候选：31 个 `pending_review`、12 个 `held`、27 个日期早于 2026-09-24、4 个为当天或未来、12 个无日期、26 个 `reopened_source_changed`，`external_send=true` 为 0。
- 旧 UI 默认渲染全部 43 张卡片，真实页面首屏从最早过期项开始；这会把“主动”表现成积压噪音。该修复只收敛默认注意力占用，保留完整可追溯队列。

## 证据

- TDD RED：新增的日期距离排序测试仍得到旧的日期升序；6 项渲染测试找不到“查看其余 2 项”。实现后两项与原有 Today/工作台测试共 25/25 通过。
- 全量 `npm test` 为 1737 tests、1711 passed / 26 skipped / 0 failed；TypeScript、lint、npm audit（0 漏洞）与 `release:verify` 通过。
- `desktop:prepare` 完成生产 Next、TypeScript、依赖闭包、包内 Node 和 Core `68004b2` staging；只出现既有动态 export trace 警告。
- 使用真实 `.edupi` 的只读副本、空 locks/runtime 与隔离 state/agent 目录启动 packaged server；回读 51 名学生、240 项任务、43 项校历、9 项课表、43 个候选，`externalSend=false`。真实根未写入。
- packaged 页面默认显示 31 个“待你决定”的总数，但无障碍树中只展开 4 张卡片，并提供折叠的“查看其余 27 项”；“稍后处理”同样显示 4 项和“查看其余 8 项”。点击展开后 27 项可访问，再次点击恢复折叠。
- 390×844 视口下 `clientWidth=390`、`scrollWidth=390`；`visibleNow=4`、`totalNow=31`、`moreOpen=false`，无横向溢出。
- 结构化记录：[Today 注意力预算证据](../loop/evidence/2026-09-24-today-attention-budget.json)。

## Risk

- 此改动不替教师处置 27 个过期候选，也不改变 Core 是否应在未来自动失效或聚合它们。队列仍完整可见，因此不会以“隐藏卡片”伪造 precision 提升。
- 系统通知、提醒投递和 Core attention intent 没有改变；本批只解决 Today 默认视觉与可访问性负担。

## Unverified

- 签名安装版、macOS/Windows 原生窗口和重启后的 disclosure 状态尚未验证；native `<details>` 默认按设计在重载后收起，不保存展示偏好。
- 真实教师是否认为每列 4 项合适、积压处置时间是否下降、主动机会 precision/recall 是否改善，仍须通过已发布的反馈通道与连续试用验证。
