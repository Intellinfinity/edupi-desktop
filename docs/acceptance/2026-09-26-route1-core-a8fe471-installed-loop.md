# 路线 1：Core a8fe471 安装版主动闭环验收

## 当前状态

- Desktop 独立 `codex/route1-core-a8fe471-20260926` 从 `main` 的 `9ff46e58e2adf07030d91bdd0e711a42c220cc9c` 创建；原 Desktop 工作树未改。Core 使用 detached `a8fe4711419fe3f36a19fd342e17abe33a7825b9` 的干净检出，原 Core 主工作树的大量未提交改动未动。真实教师数据根和 launchd 未操作。
- 本记录已包含隔离 macOS `.app` 的启动、界面和重启实测，但**不等于路线 1 全部验收通过**。Windows Core 根证明、真实跨到期系统睡眠和系统通知成功点击仍未通过。主验收路径与逐项状态见[路线 1 计划](../plans/2026-09-26-route1-core-a8fe471-installed-loop.md)。

## 合同核对

| 合同 | 原 #191 pin | Core a8fe471 | 处理 |
| --- | --- | --- | --- |
| Runtime schema | `sha256:9c8c287a…` | 相同 | 不改 schema pin |
| Bridge v1.1 / 课次 v1.2 schema | `sha256:7f0cffd2…` / `sha256:b739852f…` | 相同 | 不扩 supported commands |
| Runtime component manifest | `sha256:e2790002…` | `sha256:844eebaf4339062f0189df2af66762152780db043c8ea0b6baefa45fb118c851` | 精确更新 |
| Desktop component manifest | `sha256:d878f2fb…` | `sha256:8092bd3d10af41683433e87e6a06d0da4d9fdc2e83a631eb1b9e59c267486bf7` | 精确更新 |

- Core [#192](https://github.com/Intellinfinity/edupi/pull/192) 的功能 merge `79049fb` 是 a8fe471 祖先；[#193](https://github.com/Intellinfinity/edupi/pull/193) 仅补文档。`contracts/edupi-core-compat.json` 和解析器的强 pin 同时更新，并记入两项配对 PR。

## 实现阶段证据

- Core clean checkout：`npm run test:core-runtime-g1-live` 通过，结果含 cold start、重启无额外模型调用、Unix SIGSTOP/SIGCONT 补扫；`npm run test:capability-live` 通过，G3/G4 仅当前 owner/accepted Fact 内部草稿，G5 未核实关系拒绝入队、material hold、`external_send=false`；`npm run check:core-runtime-manifest` 报模块 148、资产 201，Runtime component hash 与上述一致；`npm run typecheck` 通过。这些是 Core 工程证据，不是 macOS/Windows 系统睡眠或 Desktop installed 证据。
- Desktop pin 定向测试先因旧 `86a49de` 失败，更新后 `lib/edupi-bridge-contract.test.mjs` 在 `EDUPI_CORE_ROOT` 指向 clean a8 检出时 10/10 通过；`scripts/packaged-core-bundle.test.mjs` 3/3 通过，完整闭包复制、无 `.git` 校验、坏依赖拒绝和隔离 Runtime 启动均有证据。后续包内与安装版结果另列在下表。
- `EDUPI_CORE_ROOT=<clean a8> npm run desktop:prepare` 成功，将 2174 个 Core 文件打入隔离资源；普通 staged runtime 与反馈 smoke 均通过，G1 `active`、G2/共享能力 `activation_pending`、`externalSend=false`。新增无 WebView 冷启测试先失败：只请求包内 identity 时，20 秒内无 Core DB；`desktop/server-launcher.cjs` 只在 bundled/production/loopback 且随机实例身份匹配后有界调用一次现有 `ensure`。重新打包后 `EDUPI_STAGED_HEADLESS_BOOT=1 npm run test:staged-desktop-runtime` 返回 `headlessBoot=true`、Core/投影 ready、G1 active、G2/G3 pending。单元测试验证外部 Core、dev、非 loopback、坏端口/父 PID 不启动；身份错配不发送 Core 请求。当前全量 `npm test` 为 1769 total / 1743 passed / 26 skipped / 0 failed，TypeScript、lint 通过。这仍只证明包内冷启，不证明 macOS/Windows 安装版跨到期睡眠或草稿内容。
- 通知链的失败复现：同一原生失败回调可重复扣减失败预算，迟到回调可误伤下一次 claim，通知点击原先只进任务详情、不进入续聊。现在 delivered/failed 必须携带与当前 claim 一致的 `attemptedAt`；持久层、API 和 Core attention 同步均对重复/迟到结果不二次写入，点击带精确 reminder/task ID 进入既有 `continueReminder`，异常回站内提醒。Windows `send_reminder_notification` 等待 `Toast.show` 完成后才向 JS 返回，Linux 的等待点击线程保留；macOS 既有 UN completion 不变。存储、路由、Hook 和 AppShell 定向测试先红后绿，后续全量 `npm test` 为 1779 total / 1753 passed / 26 skipped / 0 failed；TypeScript、lint、macOS Cargo 31 项通过。此处仍是源码验证；原生失败实测与未验项目另列在下表。
- 另有不应绕过的 Windows Core 边界：a8 的 `core_runtime_root.mjs` 对 `win32` 的文件系统证据固定返回 `native_attestation_required`，Core 文档将原生盘证明列为未完成。现有 Windows 公网安装仅证明应用/工作区启动，不证明 G1 Runtime active。若用户要求严格固定 a8，此项安装版闭环受阻；不能由 Desktop 环境变量或伪造 attestation 放行。是否允许后续 Core 修复 PR 与新 pin 已单独询问，其他独立工作继续。

## 2026-09-26 隔离打包与 macOS 原生验收

| 条件 | 环境、操作与实际结果 | 状态和边界 |
| --- | --- | --- |
| G1 冷启动 | 从 clean Core `a8fe471` 执行 `npm run desktop:prepare`，再用 `tauri build --ci --no-sign --bundles app --config src-tauri/tauri.route1-canary.conf.json` 生成独立标识 `com.abcwyc.pi-agent.route1-canary` 的 `.app`；复制到 `/tmp/edupi-route1-native.4KirDB/Applications/` 后，用 `open -n -F -a` 启动。原生 PID 35305/40859 的包内服务 Core/投影 `ready`、G1 `active`、G2/G3 `activation_pending`、`externalSend=false`，Core commit 精确为 a8。启动根为 `/private/var/folders/.../edupi-route1-packaged-loop-ciA2t6/teacher-data`，不是实际教师根。 | macOS 隔离安装冷启通过；此 canary 未签名、未发布。 |
| 可信课次到草稿 | `EDUPI_INSTALLED_APP=<隔离 .app> npm run test:route1-packaged-loop` 使用一次性教师数据、canonical `class-7-1`/数学课次、已确认的合成材料与 loopback 模型。无 WebView 冷启自动得到 1 个 Core work case、4 个内部可审产物、1 次模型调用；重复 `ensure/run` 未重做。 | 包内服务通过；合成模型输出不代表教学内容质量或真人确认。 |
| G1 本机通知授权 | Core a8 的 G1 草稿没有 L4 attention intent；原实现把通知永久延后。现在仅当 Core 当前 work case 与内部待审草稿及可用产物匹配、Runtime 证明 G1 active 且 L4 attention/ambient 均 `activation_pending` 时，才允许 Desktop 本机通知；Core linked intent 仍需精确 current 绑定，Core 不可用不能放行 G1。定向测试 21/21。 | 包内 claim 通过；G1 本机送达不是 Core L4 delivery receipt，不宣称 L4 已验收。 |
| 失败与站内回退 | 包内测试同一 `attemptedAt` 重复失败只计 1 次。原生 canary 隐藏后，另建隔离 teacher-created 到期事项，系统通知尝试在 2026-09-26 05:36 UTC 失败；提醒文件记录 `notificationFailureCount=1` 和 5 分钟后重试，重新打开安装版仍在“待处理”显示。另用独立 `com.abcwyc.pi-agent.route1-notify-canary` 做本地 Developer ID 签名，`codesign --verify --deep --strict` 通过，隔离通知仍返回失败一次；未取得明确系统权限错误码。 | macOS 原生失败回退通过；本地签名不等于公证或通知成功，系统点击未验。 |
| 教师审核与 Core 反馈 | 包内 E2 用当前 snapshot/revision 接受 G1 work candidate；仅在隔离 canary 内开启单班单科 ambient permit，读取目标 revision/fingerprint，写入 `evidence_level=synthetic` 的反馈，回读 `synthetic_excluded=1`、`real_teacher_current=0`。随后关停 canary；重启后再短暂开启回读并再次关停，G2/G3 Live 始终未注入。 | 隔离写回与持久性通过；真人价值与默认关闭状态下读取反馈不宣称通过。 |
| 原生 UI 续聊与数据 | Orca 在独立 `.app` 1440×901 界面看见同一任务、已接受状态和产物；从该任务的已移除提醒点“继续聊”，输入并发送隔离消息，loopback 模型返回。Core `taskSessions` 绑定 `01a0dc32-4d65-7a14-b8c0-b6f4069daa40`；离开再进，同一会话和两条消息仍在。另一任务的未发送草稿未串到数学课，返回后仍在。 | 安装版站内续聊通过；这不是系统通知点击证据。 |
| 后台与重启 | 关闭原生窗口后，Orca `list-windows` 为 0，但应用 PID 40859 和包内 server PID 40866 继续运行；`open -a` 恢复同 PID 窗口。此前应用 PID 35305 → 40859 的真实重启后，task/work-case/4 个 artifact ID 完全一致。 | 窗口隐藏、同进程恢复、重启保留通过；托盘菜单直接点击未测。 |
| 睡眠跨到期 | Core G1 单测使用 SIGSTOP/SIGCONT；本次 macOS 原生测试未跨上海日期到期点，也未执行真实 OS 睡眠。Core 按上海日期判断到期，下一次真实跨日边界是 2026-09-27 00:00 CST；本次未改宿主系统时钟或设置自动唤醒。 | 未验，不能用进程暂停或重启代替。 |
| Windows | [预览 CI 36224211786](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36224211786) 的质量、macOS 包、Windows NSIS 包三项成功；Windows runner 将本 PR 的 NSIS 静默安装到 `RUNNER_TEMP`，用隔离教师根启动本机服务并拿到 HTTP 200，包内 Core 原生验证明确返回 `native_attestation_required`、`g1Installed=false`。Core `a8fe471` 在 `scripts/core_runtime_root.mjs:79` 对 `win32` 固定拒绝，Desktop 无权伪造证明。 | Windows 预览安装/原生壳启动通过；G1 冷启、托盘、睡眠、通知及教师反馈全链仍受 Core 合同阻塞，不能把 HTTP 200 写成 G1 可用。 |

本次 canary 的材料、任务、消息、反馈均为 synthetic；未向学生、家长或第三方外发。`/Applications/EduPi.app`、真实教师数据根、Core 主工作树和 launchd 未改。保留测试根仅用于复核隔离数据，不能作为教师正式环境。

## 不越界

- Desktop 包内 `core-runtime-host.mjs` 经 factory 注入 G1 Live；Core CLI 不开放 Live 环境开关。G2/G3/G4 默认保持 `activation_pending`，仅在隔离 canary 且满足 owner/ambient/model permit 时可试；不将 G3/G4 artifact 当作已具备反馈 scope 的目标。G5 监护关系、未核实材料、课次/学期归属仍无充分证明。
- `attention_delivery_record` 的送达回执不是 `teacher_feedback_record`。真实反馈须由教师先审核、再按当前 revision/fingerprint 明确提交并回读；synthetic 反馈不计入真人价值。
