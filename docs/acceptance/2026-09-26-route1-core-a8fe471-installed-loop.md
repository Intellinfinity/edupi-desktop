# 路线 1：Core a8fe471 安装版主动闭环验收

## 当前状态

- Desktop 独立 `codex/route1-core-a8fe471-20260926` 从 `main` 的 `9ff46e58e2adf07030d91bdd0e711a42c220cc9c` 创建；原 Desktop 工作树未改。Core 使用 detached `a8fe4711419fe3f36a19fd342e17abe33a7825b9` 的干净检出，原 Core 主工作树的大量未提交改动未动。真实教师数据根和 launchd 未操作。
- 本记录的当前 checkpoint **仅为配对源码与隔离包闭包通过**，不等于主动闭环、安装版或 PR 已完成。主验收路径与逐项状态见[路线 1 计划](../plans/2026-09-26-route1-core-a8fe471-installed-loop.md)。

## 合同核对

| 合同 | 原 #191 pin | Core a8fe471 | 处理 |
| --- | --- | --- | --- |
| Runtime schema | `sha256:9c8c287a…` | 相同 | 不改 schema pin |
| Bridge v1.1 / 课次 v1.2 schema | `sha256:7f0cffd2…` / `sha256:b739852f…` | 相同 | 不扩 supported commands |
| Runtime component manifest | `sha256:e2790002…` | `sha256:844eebaf4339062f0189df2af66762152780db043c8ea0b6baefa45fb118c851` | 精确更新 |
| Desktop component manifest | `sha256:d878f2fb…` | `sha256:8092bd3d10af41683433e87e6a06d0da4d9fdc2e83a631eb1b9e59c267486bf7` | 精确更新 |

- Core [#192](https://github.com/Intellinfinity/edupi/pull/192) 的功能 merge `79049fb` 是 a8fe471 祖先；[#193](https://github.com/Intellinfinity/edupi/pull/193) 仅补文档。`contracts/edupi-core-compat.json` 和解析器的强 pin 同时更新，并记入两项配对 PR。

## 当前证据

- Core clean checkout：`npm run test:core-runtime-g1-live` 通过，结果含 cold start、重启无额外模型调用、Unix SIGSTOP/SIGCONT 补扫；`npm run test:capability-live` 通过，G3/G4 仅当前 owner/accepted Fact 内部草稿，G5 未核实关系拒绝入队、material hold、`external_send=false`；`npm run check:core-runtime-manifest` 报模块 148、资产 201，Runtime component hash 与上述一致；`npm run typecheck` 通过。这些是 Core 工程证据，不是 macOS/Windows 系统睡眠或 Desktop installed 证据。
- Desktop pin 定向测试先因旧 `86a49de` 失败，更新后 `lib/edupi-bridge-contract.test.mjs` 在 `EDUPI_CORE_ROOT` 指向 clean a8 检出时 10/10 通过；`scripts/packaged-core-bundle.test.mjs` 3/3 通过，完整闭包复制、无 `.git` 校验、坏依赖拒绝和隔离 Runtime 启动均有证据。仍须完整 staged/安装版草稿—提醒—反馈验证。
- `EDUPI_CORE_ROOT=<clean a8> npm run desktop:prepare` 成功，将 2174 个 Core 文件打入隔离资源；普通 staged runtime 与反馈 smoke 均通过，G1 `active`、G2/共享能力 `activation_pending`、`externalSend=false`。新增无 WebView 冷启测试先失败：只请求包内 identity 时，20 秒内无 Core DB；`desktop/server-launcher.cjs` 只在 bundled/production/loopback 且随机实例身份匹配后有界调用一次现有 `ensure`。重新打包后 `EDUPI_STAGED_HEADLESS_BOOT=1 npm run test:staged-desktop-runtime` 返回 `headlessBoot=true`、Core/投影 ready、G1 active、G2/G3 pending。单元测试验证外部 Core、dev、非 loopback、坏端口/父 PID 不启动；身份错配不发送 Core 请求。当前全量 `npm test` 为 1769 total / 1743 passed / 26 skipped / 0 failed，TypeScript、lint 通过。这仍只证明包内冷启，不证明 macOS/Windows 安装版跨到期睡眠或草稿内容。
- 通知链的失败复现：同一原生失败回调可重复扣减失败预算，迟到回调可误伤下一次 claim，通知点击原先只进任务详情、不进入续聊。现在 delivered/failed 必须携带与当前 claim 一致的 `attemptedAt`；持久层、API 和 Core attention 同步均对重复/迟到结果不二次写入，点击带精确 reminder/task ID 进入既有 `continueReminder`，异常回站内提醒。Windows `send_reminder_notification` 等待 `Toast.show` 完成后才向 JS 返回，Linux 的等待点击线程保留；macOS 既有 UN completion 不变。存储、路由、Hook 和 AppShell 定向测试先红后绿，当前 `npm test` 为 1777 total / 1751 passed / 26 skipped / 0 failed；TypeScript、lint、macOS Cargo 31 项通过。Windows Rust 分支编译、真实通知失败与系统点击仍未实测，不能写成安装通过。
- 另有不应绕过的 Windows Core 边界：a8 的 `core_runtime_root.mjs` 对 `win32` 的文件系统证据固定返回 `native_attestation_required`，Core 文档将原生盘证明列为未完成。现有 Windows 公网安装仅证明应用/工作区启动，不证明 G1 Runtime active。若用户要求严格固定 a8，此项安装版闭环受阻；不能由 Desktop 环境变量或伪造 attestation 放行。是否允许后续 Core 修复 PR 与新 pin 已单独询问，其他独立工作继续。

## 不越界

- Desktop 包内 `core-runtime-host.mjs` 经 factory 注入 G1 Live；Core CLI 不开放 Live 环境开关。G2/G3/G4 默认保持 `activation_pending`，仅在隔离 canary 且满足 owner/ambient/model permit 时可试；不将 G3/G4 artifact 当作已具备反馈 scope 的目标。G5 监护关系、未核实材料、课次/学期归属仍无充分证明。
- `attention_delivery_record` 的送达回执不是 `teacher_feedback_record`。真实反馈须由教师先审核、再按当前 revision/fingerprint 明确提交并回读；synthetic 反馈不计入真人价值。
