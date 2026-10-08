# R21/L4 六领域自然消息路由源码检查点

- 代码版本：Desktop 独立分支 `codex/desktop-six-domain-routing-20261008`，实现提交 `b321e737`、范围前置修复 `46556d71` 与待接入状态修复 `f10ce257`，基线 `origin/main` 的 `3dca586c`；配对清单仍固定 Core `b195512fb9a96ae04c35340ebdea78eddd816152`。未合并、未推送、未发布。
- 运行环境：macOS，Node `22.23.1`，独立 Desktop 工作树；测试只用合成消息和隔离临时目录，未写真实教师/学生资料，未调用付费模型或外部发送。
- 预期：G1–G5 的普通消息由 Core `owner_intent_route_read` 给出领域、澄清或 hold；G1 当前请求由 Core `owner_intent_route_apply` 建 Goal，G2 保留 Core 原有观察入队；安全隐私只 hold；G3–G5 默认关闭，缺共享处理器的逐域停用栅栏时不得启动 Live。
- 实际：`node --test lib/edupi-ambient-message-runtime.test.mjs lib/edupi-g2-message.test.mjs lib/edupi-proactivity-config.test.mjs app/api/edupi/proactivity/route.g2.test.mjs app/api/edupi/proactivity/messages/route.test.mjs app/api/edupi/proactivity/messages/route.g2.test.mjs` 为 51/51 通过。覆盖 Core route 回执、G1 重放与取消/修订、G2 歧义、G3–G5 拒绝自动执行、无范围调用拒绝、旧配置不冒充启用、隐私人工审核、默认关闭配置和外发回执拒绝。`npm test` 为 2236 passed / 33 skipped / 0 failed；`node_modules/.bin/tsc --noEmit`、`npm run lint`、`git diff --check` 通过。精确旧 pin `b195512` 的独立 Core `node scripts/test_ambient_intent_route_runtime.mjs` 通过：只读路由、Goal 应用、精确重放、越域 hold、零模型调用和 `external_send=false`。这些分别是 Desktop 单元与 Core 单独运行证据，尚未构成 Desktop↔Core 的实际配对流程。源码证据在上述测试文件和 `b321e737`、`46556d71`、`f10ce257`。
- 未通过：`EDUPI_CORE_ROOT=<pinned-clean-Core-checkout> npm run test:edupi-proactivity-canary-e2` 在隔离根尚未进入消息路由时停于并发 G1 启用：两个请求为 409 `proactivity_configuration_stale` 与 503 `proactivity_runtime_unavailable`。因此此次没有真实 Core 路由 API、写入后回读或界面验收证据；不得把源码测试记为六领域 Live 完成。
- 剩余门：当前配对 Core 共享 G3 处理器尚无按当前 grant/domain 与 Desktop `stop_pending` 的可靠启动栅栏；G3–G5 的启用请求保持 `proactivity_activation_pending`，没有新增调度器或外发。待新 Core 合同合并并精确配对后用隔离受信任模型与合成来源重跑端到端；正式安装、六域逐项内容核对与真人教师价值反馈另行验收。

## 2026-10-08 G1 写后读失败修复

- 代码版本：同一独立分支追加 `6663d582`，只修改 Desktop 的自然消息运行时、消息 API、待核验提示和定向测试；未推送、合并或发布。本节取代上方 2236/33/0 的旧源码测试计数，不改变其安装与真实资料边界。
- 预期：Core `owner_intent_route_apply` 已持久写入并返回同一消息引用的有效 Goal 回执后，后续 `owner_intent_resolve` 失败、来源改动或 Goal/工作事项绑定不符，都不得告诉教师“未记录”，也不得再次应用或继续第二领域入队。
- RED 与实际：先写失败测试，模拟 Core 已返回 `application.status=applied`、`goal_id=goal-1`，再令关联读取抛错或返回 `held`；旧代码直接抛错。另以读取到 `work-2`、Core 当前 Goal 实际绑定 `work-1` 复现旧代码误报 `applied`。修复后只在 Core 回执的 `route.message_ref`、Goal ID、版本和无外发标志有效时返回 HTTP 200 `recorded/needs_verification`，已知 Goal ID 保留、`workCaseId=null`；相同消息的 Core `replayed` 回执仍走当前 Core 重查，不使用前端缓存。核对成功且 Core Goal 绑定同一工作事项和版本时才返回 `applied`。API 一旦得到 `recorded` 就停止本次 G2 入队，聊天只在待核验状态提示“请勿重复发送”。
- 检查：`node --test lib/edupi-ambient-message-runtime.test.mjs app/api/edupi/proactivity/messages/route.g2.test.mjs lib/edupi-ambient-message.test.mjs` 31/31 通过；`npm test` 2273 total / 2240 passed / 33 skipped / 0 failed；`node_modules/.bin/tsc --noEmit`、`npm run lint`、`git diff --check` 通过。证据位置为上述测试和提交 `6663d582`。
- 未验：本轮没有安装版提示交互或 Desktop↔Core 完整配对验收；上方隔离 E2 的 G1 启用 503 仍是阻断。若 Core 已写入但 `route_apply` 回执本身丢失，仍需独立恢复设计，不能由本次写后只读修复宣称解决。
