# 路线 1：Core a8fe471 安装版主动闭环验收

## 当前状态

- Desktop [PR #281](https://github.com/Intellinfinity/edupi-desktop/pull/281) 的独立 `codex/route1-core-a8fe471-20260926` 从 `main` 的 `9ff46e58e2adf07030d91bdd0e711a42c220cc9c` 创建；原 Desktop 工作树未改。Core 使用 detached `a8fe4711419fe3f36a19fd342e17abe33a7825b9` 的干净检出，原 Core 主工作树的大量未提交改动未动。真实教师数据根和 launchd 未操作。
- 本记录已包含隔离 macOS `.app` 的启动、界面和重启实测，但**不等于路线 1 全部验收通过**。Windows Core 根证明、真实跨到期系统睡眠和系统通知成功点击仍未通过。下文旧版 canary 与预览 CI 证据均早于 `71e32de` 回执恢复修复，不能代替最终提交的安装版/CI 复核。主验收路径与逐项状态见[路线 1 计划](../plans/2026-09-26-route1-core-a8fe471-installed-loop.md)。

## 2026-09-26 回执与冷启恢复修复

- Desktop `ebc6c6e` 在包内服务尚未就绪或首次 Core ensure 报错时持续有界重试，逐次重核同一桌面实例身份；`34e6d8b` 将原生通知点击目标放入进程内队列，前端注册监听后串行取出，导航不会被回执网络请求卡住，原生权限拒绝改为延期而非耗尽失败次数。`71e32de` 将已发生的通知送达、失败、点击写入原子本地 outbox，按原载体身份向 Core 精确重放；Core 不可用时保留回执且阻止同一提醒的新领取，满队列扫描不饿死其他提醒。旧版无法证明 Core 绑定的回执保持待处理，不伪造已同步。
- 最终源码 `npm test`：1810 项，1784 passed、26 skipped、0 failed；TypeScript、lint、Cargo 35 项与针对性回执/原生点击测试通过。代码复审未发现剩余 P1/P2 阻塞。此前 [预览 CI 36225798404](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36225798404) 的质量、macOS `.app`、Windows NSIS 均成功，且 Windows 二次启动只保留一个进程；该 run 的提交早于上述恢复修复，最终提交必须另跑 CI。
- [最终预览 CI 36232143818](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36232143818) 绑定 `02781cb2e073cd5cf1f194dbb58db50671844e9b`：quality、macOS app/dmg、Windows NSIS 三个 job 全部 success。Windows 在 runner 的隔离目录实际安装和启动预览 NSIS，原生日志返回 `{"coreRoot":"native_attestation_required","g1Installed":false}`；单实例二次启动检查所在步骤通过。此结果证明 Windows 安装壳与明确拒绝边界，不是 Windows G1 冷启或完整通知/睡眠验收。
- 已知恢复边界：本地 claim 写入后、操作系统发送返回前若进程崩溃，因旧通知无稳定系统级去重 ID，不自动重发以免重复弹窗；旧提醒撤销且 Core 不再返回对应 current L4 intent 时，待处理回执保留诊断而不冒充已同步。G1 本地授权与 Core L4 回执是两种路径，前者不声称 Core L4 已完成。

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
| 后台与重启 | 旧 canary 关闭窗口后应用 PID 40859 和包内 server PID 40866 继续运行；重启后 task/work-case/4 个 artifact ID 一致。最终 `.app` 的 PID 93954 关闭窗口后窗口数为 0，实际点击菜单栏 `Show EduPi` 恢复同 PID 窗口；再重启为 PID 9918，隔离任务与通知延期回读保持。 | macOS 菜单栏点击、后台进程和重启保留通过；跨到期真实睡眠及 Windows 托盘未验。 |
| 睡眠跨到期 | Core G1 单测使用 SIGSTOP/SIGCONT；本次 macOS 原生测试未跨上海日期到期点，也未执行真实 OS 睡眠。Core 按上海日期判断到期，下一次真实跨日边界是 2026-09-27 00:00 CST；本次未改宿主系统时钟或设置自动唤醒。 | 未验，不能用进程暂停或重启代替。 |
| Windows | [最终预览 CI 36232143818](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36232143818) 的质量、macOS 包、Windows NSIS 包三项成功；Windows runner 将本 PR 的 NSIS 静默安装到 `RUNNER_TEMP`，用隔离教师根启动本机服务并拿到 HTTP 200，包内 Core 原生验证明确返回 `native_attestation_required`、`g1Installed=false`。Core `a8fe471` 在 `scripts/core_runtime_root.mjs:79` 对 `win32` 固定拒绝，Desktop 无权伪造证明。 | Windows 预览安装/原生壳启动通过；G1 冷启、托盘、睡眠、通知及教师反馈全链仍受 Core 合同阻塞，不能把 HTTP 200 写成 G1 可用。 |

本次 canary 的材料、任务、消息、反馈均为 synthetic；未向学生、家长或第三方外发。`/Applications/EduPi.app`、真实教师数据根、Core 主工作树和 launchd 未改。保留测试根仅用于复核隔离数据，不能作为教师正式环境。

### 最终代码的本机复核

- 在 `71e32de` 上重新执行 `EDUPI_CORE_ROOT=<clean a8> npm run desktop:prepare`，2174 个 Core 文件与 `a8fe471` 一致；`npm run release:verify`、`cargo metadata --locked`、`cargo test --locked`（35 passed）、`tsc --noEmit`、`npm run lint`、`npm audit --audit-level=high`（0 vulnerabilities）和 preview `actionlint` 通过。
- `EDUPI_STAGED_HEADLESS_BOOT=1 npm run test:staged-desktop-runtime` 在最终代码上重新返回 `headlessBoot=true`、Core 与投影 `ready`、occurrence v1.2、G1 `active`、G2/共享能力 `activation_pending`、`proactivity=disabled`、`externalSend=false`；未靠 WebView 页面请求启动 Core。
- 从复制后的 `.app/Contents/Resources/resources/server/contracts/edupi-core-compat.json` 回读，包内 pin 仍为 `a8fe4711419fe3f36a19fd342e17abe33a7825b9`、Runtime schema `9c8c287a…`、Runtime component `844eebaf…`、Desktop component `8092bd3d…`、Bridge v1.1 与课次 v1.2；原生进程的 `/api/edupi/status?summary=1` 也返回相同 Core commit、G1 active。清单 hash 使用合同的规范化算法，不把 JSON 文件原始 SHA-256 冒充规范化清单 hash。
- 同一最终代码的 staged 与重新构建 `.app` 资源各执行一次 `npm run test:route1-packaged-loop`，均返回 `platform=darwin`、`coreCommit=a8fe471…`、4 个产物、1 次模型调用、失败回调去重、审核接受、synthetic 反馈排除、重启保持、`externalSend=false`。后一次另保留隔离根用于原生 UI：`/private/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/edupi-route1-packaged-loop-7sdriq`。
- 最终 `.app` 复制到 `/tmp/edupi-route1-final.Aavckr/Applications/EduPi Route1 Canary.app` 并通过 LaunchServices 启动。首次人为设置 `EDUPI_CORE_ROOT` 把内置 Core 错误声明成外部来源，投影返回 503；退出该测试进程后移除这项覆盖，按真实内置 Core 路径重启同一隔离根，Core `ready`、G1 `active`、G2/G3 `activation_pending`、`externalSend=false`，UI 显示同一个七一班数学课前任务与材料。此配置失误不是包内 Core 失败，不计入通过路径。
- 原生窗口关闭后 Orca 返回窗口数 0，测试应用 PID `93954` 与包内服务继续存活；实际点击菜单栏托盘项，菜单为 `Quick Entry / Show EduPi / Quit EduPi`，点击 `Show EduPi` 后同 PID 的窗口恢复。该证据覆盖 macOS 菜单栏恢复，不代替 Windows 托盘或系统睡眠。
- 隔离签名通知 canary 的设置页仍显示系统通知“已拒绝”。随后前台应用进程切至 `loginwindow` 锁屏；未得到已授权的系统通知成功送达/点击，也未对正式应用的隐私设置做任何操作。最终 `.app` 的权限延期逻辑只由单元测试覆盖，不能写成系统通知原生验收通过。
- 锁屏时仅对最终 `.app` 的隔离 loopback 服务补测持久性：创建 `teacher-task-6bc2c442-7bb7-4fb2-bf50-895d89c6cabb` 的当日任务，提醒确认为 `teacher_created/due`；POST 领取得到精确提醒和 `teacher_local` 路由，POST 同 attempt 的 `notification_deferred` 后失败次数仍为空、重试约 5 分钟，且事项未撤回。原生进程 `93954` 退出后重启为 `9918`，同一任务/提醒、延期时间和 Core G1 active 均回读保持。这证明包内服务状态，不代表操作系统权限返回或通知点击。

## 不越界

- Desktop 包内 `core-runtime-host.mjs` 经 factory 注入 G1 Live；Core CLI 不开放 Live 环境开关。G2/G3/G4 默认保持 `activation_pending`，仅在隔离 canary 且满足 owner/ambient/model permit 时可试；不将 G3/G4 artifact 当作已具备反馈 scope 的目标。G5 监护关系、未核实材料、课次/学期归属仍无充分证明。
- `attention_delivery_record` 的送达回执不是 `teacher_feedback_record`。真实反馈须由教师先审核、再按当前 revision/fingerprint 明确提交并回读；synthetic 反馈不计入真人价值。
