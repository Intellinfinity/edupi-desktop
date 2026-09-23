# G1 主动运行试用验收

## 状态

- 结论：开发态工程闭环通过，整体仍为“L4 功能收敛中”。
- Desktop 交付：[PR #233](https://github.com/Intellinfinity/edupi-desktop/pull/233)，merge `a3def0aa3a8f4b2655d04e50007ef4fe0c62b2cf`；未授权领域即时 tombstone 修复为 [#235](https://github.com/Intellinfinity/edupi-desktop/pull/235)。
- 范围：单教师、单班级、单学科、教学准备，默认关闭；显式开启后运行 7 天，最多 12 次模型调用，始终 `external_send=false`。
- 不计入本结论：正式安装版、真实模型内容质量、正式盲测和真实教师价值。
- Core 配对：[Core #178](https://github.com/Intellinfinity/edupi/pull/178)–[#183](https://github.com/Intellinfinity/edupi/pull/183)，最终 merge `26fc91ef656877b15ca3e60f14093cf52ea7b736`；Desktop/Runtime manifest 分别为 `sha256:9c019d02…` / `sha256:85c6a8da…`，Runtime schema `sha256:815f827e…`。

## 已实现

1. Desktop 私有配置绑定当前数据根，错误文件、异根、符号链接和宽权限目录均 fail closed；启停按数据根串行并使用 `updatedAt` CAS，并发启用只有一个提交成功。停止无法确认 grant 已暂停时保留原 scope/grant 作为栅栏，只提供“重试停止”，不允许切换到第二个范围；关闭后 Runtime 回到 ambient 默认关闭。
2. 管理中心提供一个班级/学科选择和一个启用动作，启用前明确确认期限、调用上限和不外发；运行中可显式停止。
3. 普通聊天在主 Agent 已接受 prompt 后异步镜像到 Core；提交正文前先以无正文、桌面令牌保护的本地 GET 核对配置、能力、未过期 grant，默认关闭时本机正文提交为零。G1 grant 未授权的 G2–G6/无领域消息在 Core 判定后立即 tombstone，并同步终结 Desktop ledger，不进入解析、Goal 或长期明文保留；slash/bash 不进入该链，页面切换使用 bounded keepalive，主聊天失败不生成 Goal。
4. Core 独占 owner、grant、intent、Goal、work case、task、取消、修订和重放。Desktop 只消费认证的 canonical guard 绑定；跨 scope、多目标、授权未开始/过期、时钟回退、过期 Goal 和错误响应均不执行。
5. 自然请求可创建 Goal；自然修订撤销旧 Goal 并创建新 Goal；自然取消撤销当前唯一 Goal。多目标无法唯一定位时保持询问态，不猜目标。
6. 反馈目标从同 scope、单领域的 Core 当前事件推导；Goal/Opportunity 在修改、撤销、到期或时钟回退后不再算 current。synthetic 回归反馈明确排除于真实教师价值指标。
7. 每条聊天在 Core capture 前先把可预测的 `message_ref`、会话和授权身份写入私有无正文账本，capture 回执后再确认；捕获与删除按 session 串行。删除会话先撤回所有 pending/captured 来源，Core 级联撤销派生 Goal 与队列/草稿；主动运行已停止时仍允许这一 bounded withdrawal，但不允许新 capture。进程在 prepare/capture 间崩溃的 pending 记录可在删除时撤回或安全标记未进入 Core。

## 证据

- Core：最终 merge `26fc91e` 的全量 `npm test`、runtime protocol、component manifest、writer matrix、daemon、`npm audit --audit-level=high` 与 `core-quality` run `35916645318` 通过；同一材料支撑多个普通课次 Goal 与旧 direct-source 精确重放回归通过。
- Desktop 全量：1673 tests，1647 passed / 26 skipped / 0 failed；配置、控制、owner/grant、普通消息、跨领域即时 tombstone、两阶段无正文账本、session 删除、canonical binding、API 鉴权、UI、反馈和 release workflow 定向测试、TypeScript、lint、actionlint 与 `npm audit --audit-level=high` 通过。
- Packaged staged：`desktop:prepare` 精确内嵌 Core `26fc91e`；Desktop、feedback、occurrence、conflict、uploaded ICS、offline OCR、DOCX、Core closure 3/3 和 isolated model host 2/2 均通过，staged 状态 `proactivity=disabled`、`external_send=false`。
- 真实合并 Core E2：并发显式开启（一个成功、一个 stale CAS）→ G2 消息因未授权领域立即 tombstone → 普通对话 Goal → 精确重放 → synthetic 反馈写入/回读且排除 → 自然修订/重放 → 自然取消/重复无新增控制事件 → 再创建一个共享材料的独立课次 Goal → Runtime 重启保持 → 显式停止 → ambient 关闭状态删除会话并撤回四条来源、撤销仍存活的 Goal，并安全终结一条模拟 capture-crash pending。
- E2 结果：`explicit_opt_in=true`、`scope_bound=true`、`concurrent_activation_cas=true`、`out_of_scope_tombstoned=true`、`ordinary_message_goal=true`、`natural_correction=true`、`natural_cancellation=true`、`feedback_channel=true`、`synthetic_feedback_excluded=true`、`replay_no_duplicate=true`、`restart_persistent=true`、`explicit_stop=true`、`session_delete_withdrawal=true`、`active_goal_delete_propagation=true`、`capture_crash_recovery=true`、`model_provider_calls=0`、`external_send=false`。

## 主动程度与用户投入

| 状态 | 系统行为 | 教师投入 |
| --- | --- | --- |
| 默认 | 不捕获普通对话，不创建 ambient Goal，不调用模型 | 无 |
| 首次试用 | 只选择一次班级/学科并确认 | 一次显式操作 |
| 日常对话 | 教师照常说“帮我准备明天的数学教案”；消息发送成功后后台形成 Goal，无需任务命令 | 不增加命令式操作 |
| 来源或时间变化 | 当前来源重查；唯一修订/取消自动进入 Core CAS，多义目标停在询问态 | 仅在歧义或审核时判断 |
| 产物与反馈 | 只生成内部草稿，Today 展示需判断事项；教师可评价、纠正或拒绝 | 保留最终教学判断 |
| 停止 | 暂停 grant，关闭 ambient Runtime，不外发 | 一次显式操作 |

## Risk

- 已关闭：机会列表交叉积导致错目标、跨班领域错绑、多 marker 错绑、G1 试用长期保留未授权领域聊天、共享材料的普通课次 source-binding 冲突、grant/Goal 到期漂移、时钟回退、重复修订/取消写入、修订或取消重放误伤后建 Goal、并发双 grant、停止失败后换 scope、会话删除与捕获竞态、capture 硬崩丢失撤回身份、来源删除未级联、synthetic 冒充真人指标。
- 当前代码风险边界：配置、账本或 Core 回执无法验证时均 fail closed；停止/删除可能暂时返回“需要恢复”或 503 并保留原对象供精确重试，不静默继续执行。

## Unverified

- macOS 当前锁屏，未完成最终原生窗口的启用—运行—停止视觉操作；组件语义测试和真实 API E2 已通过，但不替代原生安装版验收。
- 尚未生成、签名或安装包含本批的 Release；Windows、睡眠唤醒、系统通知点击和旧版应用内升级未复验。
- 未调用真实 provider，未人工核对生成教案；12 + 360 + 120 正式模型实验、独立盲评和真实教师试用均未开始。
- G2–G5 已有 Core Goal/执行与统一反馈机制，但普通聊天 ambient wiring 仍只开放 G1；安全隐私继续作为跨域 veto/hold，未开放任何自动外发。
