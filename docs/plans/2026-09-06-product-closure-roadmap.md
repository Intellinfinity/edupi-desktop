# EduPi 产品闭环 PR 路线图

## 2026-09-26 路线 1：Core a8fe471 安装版主动闭环（部分验收）

- 独立 Desktop `codex/route1-core-a8fe471-20260926` 从 `9ff46e5` 起步；Core `main` 精确 `a8fe471`（#192 功能、#193 仅文档）。Runtime schema/bridge/课次 schema 不变，Runtime/Desktop component manifest 分别配对到 `844eebaf…` / `8092bd3d…`。隔离 macOS `.app` 已实测冷启 G1、单班数学 4 份内部草稿、失败通知站内回退、Core synthetic 反馈、站内续聊绑定与原生重启保留。回执 outbox、原生点击队列、权限延期和冷启恢复已在 `ebc6c6e`、`34e6d8b`、`71e32de` 修复；最终源码 1810 项测试中 1784 通过、26 跳过、0 失败。先前[预览 CI 36225798404](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36225798404) 的 macOS/Windows 打包和 Windows 二次启动通过，但早于恢复修复，不能代替最终 CI。Windows NSIS 在隔离根实际安装启动，包内 Core 明确拒绝 `native_attestation_required`。真实跨到期系统睡眠、系统通知成功点击、原生 UI 反馈表单和 Windows G1 全链仍缺；路线 1 不记作完整闭环。实施表见[路线 1 计划](2026-09-26-route1-core-a8fe471-installed-loop.md)，实际证据见[验收记录](../acceptance/2026-09-26-route1-core-a8fe471-installed-loop.md)。
- 主验收是隔离的单教师/单班/单科可信事件 → G1 后台到期草稿 → 通知点击续聊 → 教师审核及 Core 反馈。包内无 WebView 冷启曾红测无 Core DB，受身份校验的启动唤醒后 staged 实测 G1 active/G2/G3 pending；通知 attempt 去重与精确点击续聊已通过源码/持久层回归，但这些都不是安装版草稿/睡眠/系统通知证据。G2/G3/G4 默认关闭且仅隔离 canary 可启用；G5 监护关系、材料和课次/学期归属未经 Core 证明时保持 hold，不自动外发。Core a8 Windows Runtime 明确要求尚未实现的原生盘证明，不绕过；macOS/Windows 安装证据、PR/CI/合并状态分别记录，不提前打勾。

## 2026-09-26 v0.3.45 官方 Console 签名版（已发布，本机原位升级与公网安装通过）

- Desktop [#277](https://github.com/Intellinfinity/edupi-desktop/pull/277)、[#278](https://github.com/Intellinfinity/edupi-desktop/pull/278) 已合并；[三平台正式发布 run 36190180285](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36190180285) 与 Apple 公证装订全绿，[公开 v0.3.45](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.45) 有 11 项资产和七个平台签名键。Linux [公网安装](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36194964574) 与 Windows [公网安装及诊断](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36197070379) 全绿；后者的匿名 API 限流由 CI-only [#279](https://github.com/Intellinfinity/edupi-desktop/pull/279) 修复，令牌在启动安装器前清除，未重发包。公开 DMG 摘要、严格签名、Gatekeeper 与包内 Console 只读 smoke 通过；本机 stapler 查询被 CloudKit TLS 阻断，runner 装订验证通过。详细证据见 [官方 Console 验收](../acceptance/2026-09-26-openconnector-official-console.md)。
- 本机唯一 EduPi.app 从 v0.3.44 经应用内下载、安装和自动重启至 v0.3.45，Core `86a49de`、51/160/24/6 教师数据、五份配置摘要、7897 更新代理和现有手机开关保持。签名版原生 Console 实际完成概览、服务搜索、Action 参数、运行记录和窗口关闭重开；半屏截图 768×846，服务/参数页面未见横向裁切，安装版连接写入/Action POST 继续 403。账号、OAuth、真实 Action 和 Core grant/Receipt 仍关闭，R23 继续部分实现；Windows/Linux UI 点击未验，不能以只读 UI 发布写成 R23 完成。

## 2026-09-26 R23 官方 OpenConnector Console 接入（历史源码阶段，发布状态由上方取代）

- 教师指出 v0.3.44 的独立目录页不是上游已有的连接器界面。Desktop 在固定的 OpenConnector v1.6.5 源码上构建官方 Console，保留 Overview、Providers、Actions、Runs；独立原生窗口不继承主窗口 Tauri capability。出处、许可、补丁和生成资产摘要可重建，见 [官方 Console 验收](../acceptance/2026-09-26-openconnector-official-console.md)。
- 隔离浏览器已看到 1554 个服务、18010 个 Action、服务搜索、参数详情和运行记录，800 像素无横向溢出；staged Console 与旧目录 host 均保持写入/执行阻断。账号、OAuth、真实 Action 和 Core grant/Receipt 仍未实现，R23 继续“部分实现”。本段当时的三平台发布、安装版原生窗口及真实教师数据状态已由上方 v0.3.45 安装验收取代。

## 2026-09-26 v0.3.44 独立管理页与意图预检签名版（本机原位升级通过）

- Desktop [#274](https://github.com/Intellinfinity/edupi-desktop/pull/274) 合并为 `0af3f6e`；[正式发布 run 36139803358](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36139803358) 三平台、Apple 公证装订与 manifest 全绿。[公开 v0.3.44](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.44) 含 11 项资产和 7 个有签名的平台键；Linux/Windows 公网安装及诊断全绿。独立下载公开 DMG 的摘要、只读挂载版本、严格签名与 Gatekeeper 均通过；本机 stapler 因 Apple CloudKit TLS `-1200` 无结论，runner 装订验证通过。详见 [v0.3.44 发布验收](../acceptance/2026-09-25-v0.3.44-signed-release.md)。
- 教师解锁后，本机唯一 `/Applications/EduPi.app` 从 v0.3.42 经应用内下载、替换、重启到 v0.3.44；Core `86a49de` 与 Core/投影/Kernel ready、`externalSend=false`、五份配置摘要保持。工作区在升级前已变为 51 学生/160 任务/24 校历/6 课表，前后保持；与前一日 51/240/43/9 的差异未归属，不拿旧数作本轮基线。1440×901、800×901 原生页实际完成服务选择、Action 搜索、参数查看和离开再进入；安装包 catalog smoke 仍阻断 execute。公开 DMG 的压缩镜像冷启动曾超 15 秒，复制资源与正式安装目录均通过。正式教师语义盲测、受管外部 Action 和 Core grant/Receipt 继续部分实现或未验收。

## 2026-09-25 OpenConnector 独立管理页与 JEV 意图预检（历史源码阶段，发布状态由上方取代）

- 应教师要求，OpenConnector 从“连接”中的小卡片升级为管理中心独立入口；按服务浏览、服务内 Action 列表、全局/服务内搜索与参数详情使用包内 headless runtime，只读、令牌保护、`blockedActions/blockedProxies` 不变。上游 headless NPM 包不附带 Console，因此没有直接嵌入拥有凭据和执行能力的完整后台。Core grant/Receipt、可信授权与真实 Action 仍属 R23 部分实现。
- 借鉴 `jev-chat-windows` 的固定候选意图评测，新增 21 条仅含合成教师短句的六领域 + 弃答预检。现有 JEV 实服 21 次请求中六领域各 3/3、模糊语句 3/3 弃答，21/21 与合成标签一致；正式双裁决语义盲测仍 `not_run`。隔离浏览器 1280×720、800×900 独立页面及 staged 官方包的 1554 Provider/Action/inspect/阻断执行已有证据；本段源码状态已由上方 v0.3.44 公开发布取代，本机签名安装版仍待验证。见 [本批验收](../acceptance/2026-09-25-openconnector-admin-jev-intent-preflight.md)。

## 2026-09-25 v0.3.43 管理界面公开签名版（本机升级待验）

- Desktop [#272](https://github.com/Intellinfinity/edupi-desktop/pull/272) 合并后，正式 run [`36125163938`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36125163938) 三平台、Apple 公证装订与 manifest 全绿；公开 Release v0.3.43 有 11 项资产、7 个签名平台键。Linux/Windows 公网安装与后置原生诊断全绿；本机独立下载公开 DMG 的摘要、严格签名、应用和镜像 Gatekeeper 均通过。Mac 因锁屏且检测到实体输入，桌面自动控制暂停，尚未从现有 v0.3.42 原位更新，不能把新布局算作安装版验收。见 [v0.3.43 发布验收](../acceptance/2026-09-25-v0.3.43-signed-release.md)。
- 新版把分散的后台入口收进“工作与资源”，OpenConnector 只读目录和 JEV 设置归“连接”，主工作台直达通用设置；上游完整 Console 的账号、令牌、Action 管理没有开放。教师延后的通知点击和真实材料盲评，以及 Windows/Linux 旧版原位升级，继续保持未验收。

## 2026-09-25 管理中心与设置归位（源码/隔离页面，待发布）

- 按教师截图，管理中心 12 个入口收为 7 个；原“教学能力、学校平台、上传内容、任务与产物”连同教师/日程整合在“工作与资源”同一页。OpenConnector 的只读目录与 JEV 设置移到“连接”，后台任务归“自动运行”；工作台新增“设置”直达，常用语言/外观和教师信息收紧到首屏。OpenConnector 官方 Console 的凭据/Action/审计能力没有因此启用。隔离页面在 1280×720 与 800×900 实际操作，800 像素无横向溢出；详见 [管理与设置归位验收](../acceptance/2026-09-25-admin-settings-consolidation.md)。本段为源码/隔离页面阶段，公开发布由上方 v0.3.43 取代；本机安装交互仍待验收。

## 2026-09-25 v0.3.42 Core #191 配对签名版

- Desktop [#270](https://github.com/Intellinfinity/edupi-desktop/pull/270) 与 [#271](https://github.com/Intellinfinity/edupi-desktop/pull/271) 已合并；正式 run [`36110749260`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36110749260) 在 `ad8ab76` 上三平台、公证装订与 manifest 全绿。Release v0.3.42 公开、11 项资产、7 个签名平台键；Linux/Windows 公开安装全绿，本机从 v0.3.41 经 7897 原位下载、验签、安装、重启，唯一副本/Core #191/51 学生、240 任务、43 校历、9 课表及五份配置摘要保持。公开 DMG 摘要、严格签名和 Gatekeeper 公证核对通过；本机 stapler 因 Apple CloudKit TLS `-1200` 无结论，runner 装订验证通过。见 [v0.3.42 验收](../acceptance/2026-09-25-v0.3.42-signed-release.md)。
- 安装版管理中心准确显示 G1 可运行、G2 与共享能力待接入；OpenConnector 只读目录人工搜索返回 10 项，人工 inspect 因窗口切换未完成。G2 独立授权/受信任模型主机、R23 受管 Action 与 Core Receipt、Windows/Linux 旧版应用内升级均未因此完成。教师此前延后的系统通知手动点击和真实材料模型盲评仍未验收。

## 2026-09-25 L4 Core #191 Desktop 配对（源码/staged，未发布）

- Desktop 已精确配对 Core `86a49de`（[#191](https://github.com/Intellinfinity/edupi/pull/191)），桥接 v1.1 保持，Runtime schema/组件哈希更新。隔离 C1、G1 canary、slot alias、课前准备与 staged server/occurrence/feedback 均通过；全量 1732 passed / 9 skipped / 0 failed，TypeScript、lint、audit、release verify、Cargo metadata 通过。管理中心实际显示 G1 可运行、G2/共享能力待接入；新 Core 启动补扫的单项目 `binding_incomplete` 不再误报整机自动检查异常。见 [#191 配对验收](../acceptance/2026-09-25-core-191-desktop-pairing.md)。
- G2 live Core 入口已存在，但 Desktop 尚无默认关闭的受信任模型主机/单教师 canary，因此生产仍 `activation_pending`；G3–G5 同样未启用。只读 OpenConnector host 的 `/tmp` 路径别名静默退出已在隔离 staged 修正并守住 Action 全拒绝。本段记录源码/staged 阶段，安装版状态由上方 v0.3.42 记录取代；仍不能称 L4 established。
- 教师已明确把系统通知手动点击与真实材料模型盲评放到后续，不让两项外部验收阻塞当前 Desktop/Core 配对；二者仍保持未验收，不从路线图删除。

## 2026-09-25 v0.3.41 签名发布与提醒修复安装验收

- Desktop [#266](https://github.com/Intellinfinity/edupi-desktop/pull/266) 合并后，正式 run [`36088969006`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36088969006) 完成三平台、公证装订和 feed，Linux/Windows 公网安装全绿；本机由 v0.3.40 经保存的 7897 代理原位升级到 v0.3.41，Core、51/240/43/9 与五份配置摘要保持。见 [v0.3.41 验收](../acceptance/2026-09-25-v0.3.41-signed-release.md)。
- 安装版提醒页实际显示 11 条待处理。经教师允许临时放行共享屏幕通知，macOS 日志确认 EduPi 测试通知展示横幅并入历史，测试后恢复原隐私设置；通知点击路由仍未观察。签名版在 0 项隔离教师数据根经历真实整机 Sleep/DarkWake/FullWake，Core ready、G1 唤醒时补查、队列和完成数未重复，真实配置与数据恢复后保持。真实模型两次合成题答案与引用核对通过；到期任务跨睡眠补跑、正式材料盲评和通知点击仍未完成，R21/L4 继续部分实现。见 [v0.3.41 验收](../acceptance/2026-09-25-v0.3.41-signed-release.md)。

## 2026-09-25 R18/R20/R21 AI 协作与提醒续聊复核（包内隔离验收，已由 v0.3.41 取代发布状态）

- 已安装 v0.3.40 的包内 server 使用隔离教师数据、固定 Core `68004b2` 和本地合成模型，实际完成管理中心与教师上下文 AI 入口、首页已有输入保护、提醒到期任务 → 发送 → Core `taskSessions` 绑定 → 离开重进原会话，以及普通/任务两份草稿的切换与重载回读；真实工作区 51/240/43/9 未变。见 [AI 协作验收](../acceptance/2026-09-23-ai-collaboration-composer.md)。
- 重现提醒工作台首次 GET 前短暂显示“0 条/暂无提醒”的误导状态；Desktop `4536d03` 改为首次读取时显示“正在读取提醒”，稳定路由依赖避免反复加载。首次读取失败时仅显示“提醒暂不可用”，不再假称没有提醒。两项定向回归先失败后通过，全量 1713 passed / 26 skipped / 0 failed；当前源码隔离页面暂停 GET 时显示读取态、返回后显示 2 条，模拟失败时显示错误态，800×900 无横向溢出。见 [提醒工作台验收](../acceptance/2026-09-20-reminder-workbench.md)。
- 本段原记录时 v0.3.40 不含该修正；现已由上方 v0.3.41 签名版安装验收取代发布状态。macOS 通知点击、真实睡眠唤醒、正式模型盲评和真实教师材料仍未因此验收，R21/L4 整体继续部分实现。

## 2026-09-24 v0.3.40 Today 注意力预算签名版（已发布，本机升级通过）

- 正式 run [`35993787607`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35993787607) 在 `c5460ce` 上完成三平台、macOS 公证/装订和 manifest；Release [`v0.3.40`](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.40) 已公开，11 项资产、7 个签名平台键，Core 固定 `68004b2`。三条 feed 摘要均为 `b3605f88…`。
- Linux 公网安装 [`35998790991`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35998790991) 通过；Windows 完整公网安装与 diagnose [`35998805393`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35998805393) 全绿。公开 DMG 经 7897 下载后摘要与 GitHub 一致，挂载应用为 v0.3.40、严格签名和 Gatekeeper 公证通过。本机随后完成 v0.3.39→0.3.40 代理原位升级，Core、51/240/43/9 和五份配置摘要保持，默认 4+27 / 4+8 及两列展开收起均通过；v0.3.39 保持可回退资产。证据见 [v0.3.40 验收](../acceptance/2026-09-24-v0.3.40-signed-release.md)。

## 2026-09-24 L4 Today 注意力预算（源码、packaged 与安装版验收）

- 真实工作区只读副本暴露了主动体验风险：43 个候选中 31 个待判断、12 个 held、27 个已过日期、26 个因来源更新重开；全部默认展开会把主动协作变成积压噪音。
- Desktop 不改 Core 状态或总数，只按 Core 截止日期距当天的距离排列“待你决定”，每列默认显示 4 项，其余通过原生 disclosure 展开。packaged 页面实际显示“查看其余 27 项”与“查看其余 8 项”，展开/收起通过；390×844 无横向溢出，`external_send=false`。证据见 [Today 注意力预算验收](../acceptance/2026-09-24-today-attention-budget.md)。
- 本机签名安装版实际显示 4+27 / 4+8，近期事项优先，两列展开和收起通过；它不自动处置旧候选。真实教师是否更无感仍须由反馈通道测量，整体状态保持“L4 功能收敛中”。

## 2026-09-24 v0.3.39 更新代理公开签名版

- 正式 run [`35979258168`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35979258168) 在 `acd7ae4` 上完成三平台、macOS 公证/装订和 manifest；Release [`v0.3.39`](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.39) 已公开，11 项资产、7 个签名平台键，Core 固定 `68004b2`。三条 feed 的 `latest.json` SHA-256 均为 `758e0d10…`。
- Linux 公开干净安装通过；Windows 首轮 public install 通过、后置 diagnose 暴露 Core checkout 字节恢复漏项，#258 修复后完整重跑 [`35986226781`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35986226781) 全绿。本机随后从 v0.3.37 原位升级到 v0.3.39，同路径 Core/投影/Kernel ready、51/240/43/9 与模型/认证/设置保持、唯一安装副本 Gatekeeper 通过；完整边界见 [v0.3.39 验收](../acceptance/2026-09-24-v0.3.39-signed-release.md)。
- 本版包含本机更新代理和 Windows 覆盖替换修复；首次升级仍走旧链路，稍后合并的 #256 Today 注意力预算不在此安装包中。

## 2026-09-24 R15/R22 更新代理一次保存（macOS 全链通过，跨平台待验）

- 桌面原生设置只接受无凭据本机 HTTP 地址，独立持久化、损坏配置保守失败；Tauri updater 和服务端 Release 检查使用同一设置而不改全局网络。v0.3.39 安装版保存 7897 并重启回读后，已经同一代理完成 v0.3.40 清单/资产下载、验签、覆盖安装与自动重启；升级后代理文件和 UI 回读保持。第一次到 2% 中断、第二次成功的边界均保留；Windows/Linux 实机尚未操作，证据见 [更新代理验收](../acceptance/2026-09-24-update-proxy.md)。

## 2026-09-24 v0.3.38 公开签名版与安装验收

- Desktop `v0.3.38` 固定 Core `68004b2`，正式 run [`35967579321`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35967579321) 的 macOS、Windows、Linux 和 manifest 全部成功。Release [`v0.3.38`](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.38) 固定 `8871a1b`，非草稿、非预发布，含 11 项资产和 7 个签名 updater 平台键；三条 feed 均返回 `0.3.38`，`latest.json` SHA-256 为 `eadbc4db…`。
- macOS runner 完成签名 runtime 启动、updater 公钥、公证、staple 与 Gatekeeper；独立下载公开 DMG 的 SHA-256 为 `f58462f5…`，挂载后的 `.app` 通过严格签名校验，Gatekeeper 为 `Notarized Developer ID` 且 ticket 已装订。Linux [`35973841908`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35973841908) 与 Windows [`35973841420`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35973841420) 均完成公开安装、包内只读目录和原生/Core readiness 验收。
- 首轮 Linux/Windows 公网验收暴露的是稀疏 checkout 脚本顶层依赖开发包 `jiti`，没有进入已安装应用。Desktop [#250](https://github.com/Intellinfinity/edupi-desktop/pull/250) 合并为 `f7349df`，让公开安装 smoke 不依赖 `node_modules`，并保留仓库态 `--managed` 验证；同一批已发布资产随后重跑，未重发或替换 Release。
- 本版已公开 R23 生产 Action 隔离、按需只读目录、教师价值与六领域漏报反馈。它不等于 L4 建立：本机未单独执行 0.3.37→0.3.38，而是后续直升 0.3.39；Windows/Linux 旧版原位升级、真实睡眠/通知点击、真实教师连续试用与正式模型语义盲测仍分别保留为 Unverified。完整边界见 [v0.3.38 发布验收](../acceptance/2026-09-24-v0.3.38-signed-release.md)。
- 旧 Desktop PR #71、#74 已关闭为 superseded，没有在落后分支上解冲突或整批覆盖主线；旧依赖 PR #32 的目标版本已在当前锁文件且 `npm audit` 为 0，亦已关闭。

## 2026-09-24 L4 真实教师价值与漏报反馈通道（已发布，待真人证据）

- G1 决策后的评价不再只写“有用性”：教师可按需记录是否实际使用、下次是否复用、原流程预计分钟、本次实际投入分钟和补充说明；时间必须成对且在 1–1440 分钟内，接受/调整之外的决定不能伪装为“已使用”。Core 当前目标的 revision、fingerprint、领域、scope 和 evidence 仍在写入前重查，失败保留同一 command 供幂等重试。
- 管理中心“自动运行”增加默认折叠的六领域漏报入口，绑定当前 Core 候选班级/学科；教师可以报告系统本应主动提示但未提示的事项。漏报使用独立 `missed_opportunity` 合同，不伪造已有目标，也不填写有用性或时间节省。
- 隔离真实 Core `68004b2` 的 HTTP 路径已完成：价值反馈首次写入、同 command replay、当前目标汇总为 30 分钟基线 / 6 分钟投入 / 24 分钟节省；漏报首次写入与 replay 后仅 1 条，`teacher_reported_missed=1`。停止并重启后两条记录仍可读，旧 Goal 反馈按来源重查降为 historical，不再计入当前价值；均 `external_send=false`。这些是明确标记的隔离工程数据，不是实际教师价值。1280 与 360 像素组件浏览器验收无横向溢出，表单控件均有可访问名称。详见 [教师价值反馈验收](../acceptance/2026-09-24-teacher-value-feedback.md)。
- Unverified：真实教师仍须按用户安排完成连续试用并提供真实决定/时间；v0.3.38 已包含该 UI 与持久合同，但尚未在三平台签名安装版中实际提交评价/漏报并重启回读。Tauri 的 Next dev WebView 存在独立 React interop 失败，静态组件浏览器验收不能替代原生操作证据。

## 2026-09-24 R23 未受管 Action 生产隔离（已发布）

- 生产 AgentSession 不再读取环境变量注册 `edupi_external_connector`；即使同时提供 enable、runtime/admin token、URL 与 capability policy，工具仍不存在。服务端在扩展和 Agent 资源加载前删除 OpenConnector runtime/admin token，避免旧配置把凭据留给同用户子进程或扩展。
- `OpenConnectorProvider` 默认只允许目录搜索与 inspect；执行、连接管理和审计回读在网络前返回稳定的 `core_authority_required`。只有隔离合同测试可显式开启旧 HTTP Adapter 的假 Provider 副作用路径；环境工厂已移除。只读 staged catalog host 的 `blockedActions:["*"]` / `blockedProxies:["*"]` 双重门继续保留。
- 此项已进入 v0.3.38，关闭了“仅凭环境配置即可让 Agent 触发真实 Action”的当前高风险路径，不代表 R23 完成。Core WorkCase/一次性 grant/Receipt、受管 Action runtime、可信人工确认和跨平台 OS 隔离尚未实现，真实 `no_auth`、API Key、OAuth Action 继续为零。证据见 [R23 生产隔离验收](../acceptance/2026-09-24-r23-action-quarantine.md)。

## 2026-09-24 R23 OpenConnector 只读目录按需查询（已发布）

- 基于已合并的只读目录资源，桌面设置新增折叠的 OpenConnector 目录搜索与参数查看；打包服务器只在桌面令牌授权后按请求启动包内 Node/host，使用私有临时数据目录、12 秒截止、最小子进程环境和单进程并发门，请求完成即退出。重叠请求返回 429；inspect 失败先清空旧 schema。API 只允许 `search/inspect`，不会重新注册 Agent Action 工具、管理账户、传凭据、POST Action 或授予 Core capability；R23 仍“部分实现”。v0.3.38 的 macOS 签名 runtime、Linux 公开安装和 Windows 公开安装流程均包含目录 smoke；正式安装版 UI 的人工搜索/inspect 仍未操作。证据见 [只读目录资源验收](../acceptance/2026-09-24-r23-openconnector-catalog.md)。

## 2026-09-24 R18/R20 AI 入口漏项修正（开发态，待发布）

- 回查发现管理中心“让 EduPi 更新档案”仍用固定句覆盖输入、无绑定 Session 的任务协作清除通用草稿、任务详情关闭与会话激活竞相覆盖 URL、教师上下文“放入对话”预填固定指令，以及首页快捷建议覆盖未提交命令。现分别改为可移除的事项参考、保留通用草稿并原子切到任务 URL、五字段事实参考及已有命令时禁用快捷建议。800×900 隔离页面操作已证明管理中心原话保留、教师上下文输入空白、快捷建议不覆盖；隔离合成任务页面核对了任务 URL 与独立空输入、返回普通对话后原草稿恢复。无真实模型发送或 Core 写入，当前签名安装版仍是旧行为。证据见 [AI 协作输入验收](../acceptance/2026-09-23-ai-collaboration-composer.md)。

## 2026-09-24 R23 OpenConnector 只读目录资源（staged，未发布）

- OpenConnector `1.6.5` 的 headless package、许可与只读 catalog host 已单独 staged 到 `resources/open-connector`，不监听 HTTP；只允许 `providers/search/inspect`，全部真实 Action 与代理由 host 协议和 runtime policy 双层阻断。本机 staged bundle 约 245 MB，实际包内 Node 启动返回 1554 个 Provider、10 个 calendar 搜索结果和 `npm.get_package` schema，执行请求被拒。macOS/Windows 无签名预览包已构建；macOS 最终 `.app` 内目录 host 运行通过，Windows staged 目录与 exe 版本门禁通过；Linux/Windows 公开安装版的后续验收门禁已准备，仍须下一正式包实测。当前证据见 [只读目录资源验收](../acceptance/2026-09-24-r23-openconnector-catalog.md)。
- 此段记录打包目录资源时的状态；上方开发态已加入按需只读查询，但正式安装版尚未发布，也没有账户凭据、Core grant/Receipt 或真实 Action 执行。R23 继续“部分实现”，手机异地服务仍排最后。

## 2026-09-24 v0.3.37 公开签名版与本机原位升级

- Desktop `0.3.37` 固定 Core `68004b2`，公开三平台签名资产和 7 个 updater 平台键已发布；Linux/Windows 公开安装启动、macOS DMG 的 runner 公证及本机 Gatekeeper 核对通过。本机从 0.3.36 设置页发起更新后原位替换、重启、Core ready，51/240/43/9 教师数据及模型/认证/设置摘要保持；签名版教学 AI 入口的空输入与独立参考已操作，但真实模型内容和提醒续聊未核对。R23 仍默认关闭且未完成受管执行/权威落账。详见 [v0.3.37 发布验收](../acceptance/2026-09-24-v0.3.37-signed-release.md)。

## 2026-09-24 R23 OpenConnector 授权止血（历史；生产执行入口现已隔离）

- 当前 Desktop 分支 `feat/jev-openconnector-integration` 将所有外部 Action 执行收敛到教师可见确认；`operationType=read`、未知元数据与 Action 名称均不再免确认。弹窗和执行使用同一 JSON 快照，不能完整展示的输入拒绝执行；授权绑定运行时幂等键。Agent/用户 bash 子进程环境移除 OpenConnector runtime/admin token 和 JEV 密钥。
- 授权止血已进入 v0.3.37；上方更严格的生产隔离已进入 v0.3.38，进一步移除了生产 Agent 工具和环境凭据。R23 仍为部分实现，下一步须建立受管进程生命周期 + Core WorkCase 权威 grant/Receipt 合同，并让 runtime 原子验证一次性授权。JEV 受管浏览器与实服执行也未完成。下方 2026-09-20 的 Adapter 验收是历史状态，由较新的安全边界覆盖。
- 合同约束与安全负测已列于 [R23 外部 Action 权限规格](../architecture/R23-external-action-authority-spec.md)；文档本身不代表实现或验收。

## 2026-09-24 L4 课表材料来源别名（已发布，真实材料未验）

- Core [#182](https://github.com/Intellinfinity/edupi/pull/182) 与 [#184](https://github.com/Intellinfinity/edupi/pull/184) 已合并；Desktop `0f2c75d` 固定 Core `68004b2`，将权威课表来源/证据用于 PDF/DOCX 的纯课表与混合材料保守别名。重复导入、增量新增、旧材料删除和快照竞争均由隔离 Core 真写入回读；缺失、歧义、已删除或被教师更正的证据不自动绑来源。教师可显式选当前课表来源，选项及提交均按指纹与独占锚点核对。详见 [课表来源别名验收](../acceptance/2026-09-24-l4-timetable-source-alias.md)。
- staged bundle 的 Core/投影/Kernel ready、来源只读 API、DOCX/OCR smoke 与隔离浏览器 800×900 通过；课表来源 503 或悬挂时 PDF 禁提交且可重试，日历来源独立可用。v0.3.37 已正式安装并回读新 Core，但当前教师课表来源列表为 0；真实材料、来源配对与真实模型语义仍未验，整体 L4 不能勾选完成。本节取代下方历史记录中“slot alias 未实现”的状态，OCR 与多项日程配对的旧证据继续有效。

## 2026-09-24 L4 G1 主动运行风险收敛（源码与 staged 验收，未发布）

- Core [#178](https://github.com/Intellinfinity/edupi/pull/178)–[#183](https://github.com/Intellinfinity/edupi/pull/183) 已依次合并。此 G1 checkpoint 当时固定 merge `26fc91ef656877b15ca3e60f14093cf52ea7b736`，Desktop/Runtime manifest 为 `sha256:9c019d02…` / `sha256:85c6a8da…`；当前唯一配对 pin 已由上方 `68004b2` 取代。Core 提供当前 canonical Goal/work-case/task 绑定、同 scope 单领域反馈目标、时钟/到期重查、owner-message 撤回到 Goal/队列/G2–G5 草稿的级联失效，以及多普通课次共享同一材料时的 intent-scoped planning source；旧 direct-source 历史仍可精确重放。Runtime schema 保持 `sha256:815f827e…`。
- Desktop [#233](https://github.com/Intellinfinity/edupi-desktop/pull/233) 已合并为 `a3def0aa3a8f4b2655d04e50007ef4fe0c62b2cf`，[#235](https://github.com/Intellinfinity/edupi-desktop/pull/235) 的未授权领域即时 tombstone 已合并为 `e47bcca6cb18fa8feeb403dd2520a7d1a4515a6b`；默认关闭的单班单科 G1 canary 为 7 天、最多 12 次模型调用、不外发。启停按数据根串行并使用 `updatedAt` CAS；停止不确定时保留 scope/grant 栅栏，只能重试停止。普通聊天仅在主 prompt 接受后、无正文 GET 证明 capability 和未过期 grant 后镜像；自然请求、修订、取消与重放由 Core 控制，多目标保持询问态。
- 会话删除传播已收敛：capture 前先持久化可预测 `message_ref` 的私有无正文 pending，Core 回执后确认；capture 与 DELETE 共享 session 锁。删除先撤回所有 pending/captured 来源，失败返回 503 且保留会话；capture 前后进程崩溃、删除并发、停止后删除和精确重放均有恢复路径。取消重放不会误伤后来新建的 Goal。
- 工程证据：Core 全量、audit 与 `core-quality` run `35916645318` 通过；Desktop 1673 tests 中 1647 passed / 26 skipped / 0 failed，TypeScript、lint、actionlint、audit 通过。真实 merge Core E2 覆盖并发启用 CAS、未授权领域即时 tombstone、多个普通课次共享材料、请求/修订/取消、synthetic 反馈排除、重启、停止、active Goal 会话删除撤回和 capture-crash pending 恢复；staged Desktop/feedback/occurrence/conflict/ICS/OCR/DOCX、Core closure 3/3、model host 2/2 通过，全部 `external_send=false`。完整记录见 [G1 主动运行试用验收](../acceptance/2026-09-24-proactivity-canary.md)。
- Risk：已关闭双 grant、换 scope 越权、过期仍捕获、取消 replay 错目标、会话删除未撤回、删除/capture 竞态和 capture 回执崩溃窗口；配置、账本或回执不能验证时 fail closed，并保留可重试对象。
- 安装版补验：当前公开签名 v0.3.37 已用隔离 data/config/agent 目录在 macOS 原生管理中心完成 G1 启用、Core active、显式停止与重启后保持 disabled；全程 `external_send=false`。恢复真实 config 后 Core `68004b2`、Projection/Kernel 与 51/240/43/9 保持。真实教师根缺少稳定 class_id 与同范围材料，因此按设计禁用启用按钮，未写合成数据绕过。
- Unverified：Windows/Linux 尚未执行 G1 原生界面启停；真实睡眠、通知点击和 Windows 旧版原位升级仍需验收。真实 provider 内容质量、60 故事/360 时间点正式盲测和真实教师连续试用未开始；G2–G5 普通聊天 ambient wiring、课表别名的真实材料验收和六领域逐域内容核对仍未完成。整体状态仍为“L4 功能收敛中”，不能写 `L4 established`。

## 2026-09-24 L4 同名多项日程逐项配对（源码与 staged 验收，未发布）

- Desktop `b029a45` 在 PDF/DOCX 来源修订中加入教师逐项配对：Core 来源指纹在模型识别前验证，预览不写入；提交重新校验候选指纹、来源 CAS、同名锚点、旧事项唯一性，保留原 Core ID，改期继续 `held`。同日同名而仅备注、结束日期或时区不同的项目可视且可访问地逐项区分。完整证据见 [逐项配对验收](../acceptance/2026-09-24-l4-document-pairing.md)。
- 隔离 Core 真实 DOCX E2、打包 Node/Mammoth 和页面点击链路通过；800×900 视口无整页横向溢出。`npm test` 1601 passed / 26 skipped / 0 failed，TypeScript、lint、actionlint 通过。公开 Latest 仍为 v0.3.36，本批未安装或发布。
- L4 的“同名多项同时变化”达到源码/staged 验收，正式安装版、真实老师材料和日历冲突最终决议仍待验；slot alias、六领域逐域内容核对仍未完成。下方 OCR 阶段记录仍有效，但本节取代旧表中“多项同时变化完全未实现”的状态。

## 2026-09-24 L4 扫描材料可信 OCR（源码与 staged 验收，未发布）

- Desktop `77e88f8` 为图片/三页内扫描 PDF 加入离线打包 OCR 来源，词级高置信与坐标校验、材料/页面哈希、单行完整日期/名称引文；不可信或无年份时 fail closed，不向模型发送扫描原图，不导入 OCR 时段、地点或课表。Core 仍固定 `c1edefd…` 且唯一拥有日程状态。准确证据和未验证条件见 [L4 扫描材料 OCR 验收](../acceptance/2026-09-24-l4-scanned-material-ocr.md)。
- 隔离 Core 的真实图片/PDF→OCR→日程写入→投影回读为 2 条 `inferred/hold`、`external_send=false`；打包 Node/PDF/WASM/语言数据的 staged smoke 与 800×900 隔离页面失败提示通过。`npm test` 1590 passed / 26 skipped / 0 failed，TypeScript、lint、audit、release verify、Cargo metadata、actionlint 均通过。
- L4 仅该 OCR 子项达到“已实现待正式安装及真实材料验收”；同名组多项同时变化的逐项配对、slot alias、六领域内容人工核对仍未完成。公开 Latest 仍为 v0.3.36。材料 OCR 失败提示刷新后不持久、正式签名包和 Windows/Linux 未验收，不能把本段记为整体 L4 完成。

## 2026-09-24 R18/R20 AI 协作输入与提醒续聊（开发态验收通过）

- Desktop `3c146fe` 及 PR #227 后续修正将“找 AI 继续聊 / AI 协作”的固定长模板改为可移除的事项参考；老师输入框留空且自由编辑，原草稿不被入口覆盖。页面参考与教师本次要求分开传给模型，历史消息默认显示老师原话，参考按需展开；工作台新要求遇旧草稿时必须明确选择。各模块改为传入对象事实，删除旧的“在这里输入”模板。
- 隔离 Core `b2c2bb8` 与本地合成模型的实际页面完成教学、成长、工作台和真实到期任务提醒续聊：异步项目就绪、切换事项、草稿恢复、发送、会话绑定、离开再进入及普通会话不串任务均回读通过；运行期排队/收回保留老师原话与参考，遇旧草稿先等待明确选择。清远端队列前同步保存本地副本，服务端精确快照后以私有恢复记录和请求 ID 处理并发/丢响应，完整落盘后 ACK 并清除明文。合入 Core `c1edefd` 对应的 Desktop 主线 #228–#230 后，全量 1590 tests 中 1564 passed / 26 skipped / 0 failed，TypeScript 与 lint 通过；AI 对话的页面 E2 仍是旧隔离 Core pin，不能替代新 pin 安装版验收。完整证据见 [AI 协作输入验收](../acceptance/2026-09-23-ai-collaboration-composer.md)。
- 此段记录的是当时的源码与隔离开发版验收；当时公开 Latest 为 v0.3.36，现由顶部 v0.3.38 发布记录取代。签名安装版的 AI 输入交互、窄原生窗口、真实模型语义和系统通知点击仍需另验，不能把提醒续聊局部通过等同 R21 全部完成。

## 2026-09-23 未完成计划与手机端目标（当前优先级）

| 顺序 | 原任务 | 尚未完成的交付 | 状态 |
| --- | --- | --- | --- |
| 近期 | L4 | 扫描 PDF/图片 OCR、同名多项配对与课表来源别名的真实材料验收；六领域内容逐域核对与真人反馈 | v0.3.40 三平台已公开并通过公网安装，macOS 原位升级与 Today 4+27 / 4+8 安装版交互通过；真实材料、教师决议、原生反馈表单和真实睡眠/通知仍未核对 |
| 近期 | R23 | JEV 受管理浏览器闭环；OpenConnector 受管 Action runtime；Core WorkCase capability 与 Receipt 落账 | v0.3.40 保持生产 Action 隔离和只读目录；安装版 JEV 已配置但单次实服测试返回 `service_unavailable`，不用于对话。实服 Action、权威落账、人工授权与 OS 隔离未实现；见 [JEV/OpenConnector 验收](../acceptance/2026-09-20-jev-openconnector-adapters.md) |
| 当前验收 | R22 / R15 | 安装版保存 7897、重启回读并从下一版经代理更新；Windows/Linux 旧版原位升级 | macOS 已从 v0.3.39 经 7897 原位升级到 v0.3.40，Core `68004b2`、51/240/43/9、模型/认证/设置/桌面偏好/代理摘要与唯一安装副本保持；Windows/Linux 旧版原位升级未验 |
| 验收批 | R21 / R22 / R25 | 通知点击回到事项、真实睡眠补跑、安装版故障插件 Safe Mode 恢复；Windows/Linux 旧版应用内升级 | 功能或源码回归已有，所列真实流程未验收 |
| 部署批 | R16 / L4 | 真实外部账号、学校隔离与备份恢复、正式盲测和教师连续试用 | 依赖目标环境、账号与真人参与，不计入本地工程通过 |
| 最后 | R26 | 手机离开局域网，经服务器安全访问同一教师会话与提醒 | 局域网桥接只是原型，远程服务尚未设计和实现 |

- R26 产品目标由用户确认：局域网同网段配对不是手机端的最终交付条件，后续不再把第二台手机的同 Wi-Fi 测试排在桌面/Core 收口之前。最终验收需在异地网络通过受认证的 HTTPS 服务完成会话续接、撤销和对象回读，Core 继续拥有状态与权限；具体托管、同步和身份合同须在实施前设计，不把当前本地 HTTP 网关直接暴露公网。
- R01/R02/R03/R04/R05/R06/R13/R14 的旧任务表仍有原生文件操作、首配、OCR、课堂内容与性能实机等逐项验收空缺；它们是已实现功能的验收/关账工作，不能与上表的待实现能力混为一谈。下方历史记录保留原始证据，以上方较新的发布与配对状态为准。

## 2026-09-23 文档同名 occurrence 消歧（工程验收通过，尚未发布）

- [Desktop #229](https://github.com/Intellinfinity/edupi-desktop/pull/229) 的提交 `082648e` 让同一 PDF/DOCX 内多条 `name + type` 相同的事项使用完整语义 variant ref；完全重复行折叠，改名重放稳定，旧 singleton ID 保持。
- 修订配对按“variant 精确匹配 → 剩余仅 1:1”执行。一项变化复用原 occurrence，并由 Core 按 revision/conflict 规则处理；日期或时段变化进入 held/conflict。多项同时变化、foreign legacy、删除 sibling 复活和教师已确认内容差异均在写入前拒绝。pre-typed inferred legacy 的同字节 typed 升级保留 canonical ID。
- 固定 Core `c1edefd…` 的真实 DOCX E2 覆盖两场同名会议、新旧 ID、一次改期无第三条重复和文档内 exact duplicate。全量 1547 tests，1521 passed / 26 skipped / 0 failed；TypeScript、lint、audit、`desktop:prepare`、staged runtime 和独立复审通过，`external_send=false`。
- Unverified：同名组两项以上同时变化仍缺教师逐项配对 UI；slot alias、图片/扫描 PDF 的可信 OCR、正式安装版、真实 provider、正式盲测和真实教师价值仍未验证。`proactivity` 仍默认关闭，整体状态仍是“L4 功能收敛中”。

## 2026-09-23 文档来源别名与材料删除传播（工程验收通过，尚未发布）

- [Core #177](https://github.com/Intellinfinity/edupi/pull/177) 合并为 `c1edefd2a2b77e3d10dfc9f0a47eceb7b5f7b1de`，将 PDF/DOCX `source_hash` 映射到 `schedule-evidence-*`，统一同哈希多副本、calendar/document 混合 evidence、calendar/timetable、准备/能力与反馈 lineage 的删除和恢复语义；Core 全量、CI 与独立复审通过。
- [Desktop #228](https://github.com/Intellinfinity/edupi-desktop/pull/228) 的提交 `3b7f1e5` 从 Core 当前 evidence 恢复 H2→H logical source alias，同时要求当前 accepted material target 证明同一 hash。删除材料或只有残留跨格式 evidence 时不自动绑定；slot、内容漂移、多 alias 和 direct/foreign 冲突继续 fail closed。
- 真实 route E2 覆盖 H2 精确重放、同哈希两份材料逐份删除、全部来源隐藏、恢复任一副本和恢复后无感重放。全量 1545 tests，1519 passed / 26 skipped / 0 failed；TypeScript、lint、audit、`desktop:prepare`、四项 staged runtime 与 bundle/model-host 8/8 通过，全部 `external_send=false`。
- 后续状态以上方 Desktop #229 为准：同一文档重复 `name + type` 已支持稳定多 occurrence 和单项变化；多项同时变化仍 fail closed。自动 alias 尚不覆盖 slot；图片/扫描 PDF 的可信 OCR、正式安装版、真实 provider、正式盲测和真实教师价值仍未验证。staged runtime 的 `proactivity` 仍为默认关闭，因此整体状态仍是“L4 功能收敛中”。

## 2026-09-23 PDF/DOCX 跨修订来源与删除传播（工程验收通过，尚未发布）

- [Desktop #226](https://github.com/Intellinfinity/edupi-desktop/pull/226) 以 `0f9ec30`、`f255674`、`bd10438` 完成 PDF/DOCX logical source、Core-owned CAS、稳定 occurrence、跨格式显式去重、旧状态接管、教师确认防降级、omission 保留和 tombstone 恢复防护；证据见 [PDF/DOCX 日程修订来源验收](../acceptance/2026-09-23-document-schedule-revision-source.md)。
- 真实 DOCX E2 已覆盖 route POST、新建/更新、同字节重放、不同字节显式绑定、stale CAS、改期 held、legacy/filename issuer、PDF/DOCX↔ICS、删 A 而 B 保持来源可见、H2 重传拒绝及明确 restore；全部 `external_send=false`。隔离浏览器来源选择与 omission 文案可见，console error/warn 为 0。
- 文档修订只增量 upsert，不因模型漏识别自动撤回。旧格式首次接管必须完整覆盖旧 issuer，并通过 held conflict 等待教师决定；Desktop 不保存第二份来源 baseline。
- packaged symlink worktree 的 trace leak 已用 exclusive owner directory、inode 与私有 marker 收敛；真实 `desktop:prepare` 后不再污染仓库根。
- 后续状态以上方 Core #177 / Desktop #228/#229 为准：H2→H exact replay alias、材料删除传播和同名 occurrence 单项变化已完成。多项同时变化、slot 自动 alias、图片/扫描 PDF、正式安装版、provider 质量、盲测和真实教师价值仍未验证。公开 Latest 仍为 v0.3.36/Core `860594a…`，整体状态仍是“L4 功能收敛中”。

## 2026-09-23 R25 故障扩展恢复与 R21 通知补验

- R25 源码回归提交 `dce3570`，环境为 macOS / Node 22.23.1。隔离的真实 Pi `DefaultResourceLoader` 在正常模式执行故障第三方扩展并记录加载错误；Safe Mode 不执行它、不删除文件，仍加载内置扩展；恢复正常模式后再次检测到同一故障。证据为 `lib/safe-mode.test.mjs` 的故障扩展用例。`node --test lib/safe-mode.test.mjs` 4/4 通过；补齐主线新增的锁文件依赖后，`npm test` 为 1510 tests、1484 passed / 26 skipped / 0 failed，TypeScript 与 lint 通过。
- R25 仍是部分验收：上述为隔离 SDK 进程，不等于在正式安装包中放入故障插件、`--safe-mode` 冷启动、点击恢复正常启动并核对用户数据。旧安装版的普通 Safe Mode 冷启动/恢复验收见下文；故障注入的安装版流程仍未执行。
- R21 本机安装版 v0.3.36 的“测试通知跳转”返回“系统已接受通知”，设置显示系统通知已开启。该结果只证明提交到 macOS 通知中心；通知中心没有暴露可操作窗口，未观察到实际送达或点击回到提醒，真实通知点击与睡眠唤醒继续为未验收。

## 2026-09-23 文本 PDF/DOCX 时间地点证据（工程验收通过）

- [Desktop #225](https://github.com/Intellinfinity/edupi-desktop/pull/225) 的提交 `fe53b51` 为文本 PDF/DOCX 增加原子 typed time/location 合同：同一原文摘录必须证明名称、日期、完整时段、时区/offset 和地点；DST、UTC/GMT、Unicode minus、冲突 offset、跨日和缓存重放均 fail closed，详细证据见 [文本材料时间地点验收](../acceptance/2026-09-23-text-schedule-evidence.md)。
- 真实 DOCX→提取→受控模型 JSON→Core v1.2 E2 通过；同字节改名不重复、typed cache 会重新提取原文重放验证、改源 hash 拒绝，最终事项保持 `inferred / hold / external_send=false`。release gate 与 symlink packaged server 闭包同步更新。
- 全量 1520 tests，1494 passed / 26 skipped / 0 failed；TypeScript、lint、audit、actionlint 通过，独立终审无 P0/P1/P2。
- 本节的跨修订来源缺口已由上方 Desktop #226 收敛；文档 omission 明确不自动撤回。仍未完成图片/扫描 PDF 的可信 OCR、重复同名同类事项消歧、source-hash alias、真实 provider 质量、Windows 安装版、正式盲测和真实教师价值。公开 Latest 仍为 v0.3.36/Core `860594a…`，整体状态仍为“L4 功能收敛中”。

## 2026-09-23 PDF、图片与 Word 日程来源身份（部分实现已验收）

- 非 ICS 材料的 schedule issuer 已从“文件名优先”改为“校验后的内容 SHA-256 优先”：同字节改名保持同一来源，同名不同字节严格分离；交付为 [Desktop #223](https://github.com/Intellinfinity/edupi-desktop/pull/223)，实现提交 `c8cb6f0`，证据见 [非 ICS 日程来源身份验收](../acceptance/2026-09-23-document-schedule-content-identity.md)。
- 全量 1509 tests，1483 passed / 26 skipped / 0 failed，TypeScript 与 lint 通过。该切片不改真实数据、不外发，也不生成正式安装包。
- 文本 PDF/DOCX 的 source evidence、occurrence/time/location 与跨修订合同现以上方 #225/#226 为准；图片与扫描 PDF 在没有可信 OCR/坐标证据前继续 hold，不自动做同来源遗漏撤回。
- 发布边界：公开 Latest 仍为 v0.3.36/Core `860594a…`；本批未发布或安装，交付与合并状态以 Desktop #223 为准。整体状态仍为“L4 功能收敛中”。

## 2026-09-23 上传 ICS 来源与循环日程收敛（开发验收通过，尚未发布）

- Core [#174](https://github.com/Intellinfinity/edupi/pull/174)、[#175](https://github.com/Intellinfinity/edupi/pull/175)、[#176](https://github.com/Intellinfinity/edupi/pull/176) 已依次合并，最终 pin 为 `b2c2bb809d4c4f8c09af7bc0e2741c025985dd3e`；Desktop 交付为 [#222](https://github.com/Intellinfinity/edupi-desktop/pull/222)，实现提交为 `e097865`、`1e4c2c8`、`1402691`、`ee71640`。完整证据见 [上传 ICS 日历来源收敛验收](../acceptance/2026-09-23-uploaded-calendar-source-sync.md)。
- `.ics` 现在走严格暂存和确定性解析，不调用模型；Core 持有原始 evidence、来源、occurrence、CAS 和 tombstone。支持全量修订、REQUEST/PUBLISH 增量、EXDATE、单次/整组 CANCEL、系列改时、recurring↔single、精确重放、重启回读和同来源其他 UID 保持。
- 风险门已覆盖错源/混源、旧 CAS、命名空间碰撞、history 截断、丢响应重试、active tombstone 与并发恢复。取消 no-op 绑定 source+evidence hash、batch request 与最终 source→ledger 复核；无关 ambient snapshot 漂移不阻塞。
- Desktop 最终全量为 1509 tests，1483 passed / 26 skipped / 0 failed；TypeScript、lint、audit、actionlint、source/staged uploaded-calendar E2、staged occurrence/conflict/feedback/desktop、bundle closure 3/3、model host 2/2 和 packaged 页面操作通过。页面实际完成首次导入及“导入 1 项、撤回 1 项”的来源更新，console error/warn 为 0。
- 发布边界：以上是当前开发分支和 packaged staged 证据，公开 Latest 仍是 v0.3.36/Core `860594a…`；未生成、签名、上传或安装包含本批的正式 Release。
- Unverified：文本 PDF/DOCX 已由上方 #225/#226 建立保守 occurrence/来源修订合同；图片、扫描 PDF 与 legacy DOC 仍缺可信合同。Windows 安装版 ICS、旧版应用内升级、通知点击、真实睡眠补跑、正式盲测和真实教师价值未验证。整体状态仍是“L4 功能收敛中”。

## 2026-09-23 L4 风险收敛与行程 occurrence 配对（v0.3.36 应用内升级通过）

- 当前发布状态覆盖下方历史结论：v0.3.30/v0.3.33/v0.3.34 的 macOS 签名 helper 启动失败，三版已改回 draft；v0.3.35 修复签名并从 v0.3.29 手动 bootstrap。v0.3.36 增加更新公钥构建门禁，本机从 v0.3.35 实际完成应用内下载、验签、替换和重启；Core `860594a…` 就绪，51/240/43/9 与模型/认证/设置摘要保持，唯一安装副本和 Gatekeeper 通过。公开 Latest/三条 feed 均为 v0.3.36。完整证据见 [v0.3.36 updater 验收](../acceptance/2026-09-23-v0.3.36-in-app-updater.md)。

- Core 风险批已按顺序合并：[Core #170](https://github.com/Intellinfinity/edupi/pull/170) 为 `03a25b0e3a2d40ceb60040d00685f3841ac57b7e`，[Core #171](https://github.com/Intellinfinity/edupi/pull/171) 为 `d1478ce6d917bbea03db7df5c01854d3500a9ef5`，[Core #172](https://github.com/Intellinfinity/edupi/pull/172) 为 `172f75531f84b0bb0fca422598bd895eb2920cb8`，[Core #173](https://github.com/Intellinfinity/edupi/pull/173) 为 `860594a05c5d32617fffdbdf03d56e6ade6dc211`。#172/#173 的 `core-quality` runs `35782721446`、`35788428478` 均通过。Desktop 现在精确 pin 最后一个 merge commit，Desktop/Runtime component hash 分别为 `sha256:5a767d1c…` 与 `sha256:f98d0de5…`。
- Risk 已完成源码与 packaged staged 收敛：反馈只接受当前 Core 目标的真实领域、班级和学科；日程按 issuer + occurrence ref 稳定标识，精确重复合并，同一 occurrence 改期进入 hold 和 owner 审核，“保留两项”对 same-ref 冲突被拒绝；来源删除、旧提醒、旧进程写入和 snapshot CAS 均 fail closed。显式冲突审核在 ambient planning 默认关闭时可用，owner 二次凭据仍必需，conversation、intent、attention 和自动调度保持关闭。occurrence E2 从首次 intake 起保持 ambient 开启，command receipt 的 after snapshot 与紧接读取完全一致，不再依赖切换模式的绕路。
- Desktop 已完成源码与 staged 证据：`npm test` 1451 tests，1425 passed / 26 skipped / 0 failed；TypeScript、lint、`desktop:prepare`、packaged Core closure 3/3、隔离 model host 2/2 通过。source 与 staged occurrence E2 均完成 intake、精确重放、v1.2 投影、改期 hold、same-ref keep-both 拒绝、replace 和重启回读；source/staged schedule conflict 在 ambient 默认关闭时完成 owner bootstrap、读取、决定、重放与重启回读；feedback 与 desktop runtime 同时通过。完整记录见 [Core 860594a 与 Desktop occurrence 配对验收](../acceptance/2026-09-23-desktop-core-occurrence-pin.md)。
- v0.3.34 发布前 P2 已修：所有 review/task/memory/delete/restore mutation 都在验证回执后重读 occurrence v1.2 当前快照，教师资料审核后时间、时区、地点和 occurrence ref 不消失；旧 owner state 缺持久 key 时普通 Core 降级启动，owner/反馈/冲突读取统一 fail closed，ambient 仍阻止启动，不自动重绑、不修改旧状态。全量 1425 passed / 26 skipped / 0 failed，source occurrence mutation E2、lost credential conflict E2 与真实旧状态升级演练通过。首次 run `35804036187` 在上传前暴露并修正 409/503 错误映射，空 draft 已删除。
- v0.3.34 曾由 merge `c492aea` 发布：Release `394223451` 有 11 项资产和 7 个签名 updater 键，Apple DMG submission `192c6e32-de59-47d3-9f12-4e5b54702eb4` Accepted；Linux `35811719843` 与 Windows `35811727023` 公共安装启动通过。macOS 实装反证后该 Release 已撤回为 draft；这些构建证据不构成 macOS 运行验收。
- Unverified：文本 PDF/DOCX 已形成保守 occurrence、时区、地点和来源修订链，但重复同名同类事项、source-hash alias、图片/扫描件仍未完成；ICS 与文档开发态收敛尚未进入正式安装版。macOS 后台通知点击与真实睡眠唤醒尚未执行；Windows/Linux 旧版应用内升级也未由干净安装替代；旧随机 owner key 没有自动迁移，已有 owner 状态缺凭据时继续保留数据并 fail closed。
- L4 仍为“L4 功能收敛中”：六领域机制和统一反馈通道已有工程闭环，但实际教学内容仍需逐域人工核对；正式盲测、真实教师 5 日基线、至少 10 日试用和不少于 20 个机会仍未开始。真实教师价值由用户组织，本地合成反馈不计入价值门。
- 版本边界：v0.3.33 只包含 Core G6 且 macOS helper 同样启动失败；occurrence/Core `860594a` 配对和两项 P2 修复已由 v0.3.35 修复发布并在本机安装验收。v0.3.29 缺 updater 插件，本次手动 bootstrap 不冒充应用内验签升级。

## 2026-09-23 v0.3.32 DMG 公证、启动回滚与 v0.3.33 恢复（历史，已由 v0.3.35 取代）

- v0.3.31 已由正式 run `35757858707` 从 merge `bef61195` 完成三平台构建、签名和 manifest，公开 Release 含 11 项资产；canonical `updater-feed` 为 0.3.31、7 个平台键，更新资产均走 GitHub API。macOS updater tar 内 `.app` 的 Developer ID、公证和 Gatekeeper 验收通过。
- R22 公证缺口已定位：v0.3.31 workflow 在 Tauri 公证 `.app` 后才生成并签名 DMG，没有把 DMG 再提交 Apple 公证。公开 DMG 的 `codesign` 通过，但 `stapler validate` 无 ticket，`spctl --type open` 为 `Unnotarized Developer ID`；因此不能把 v0.3.31 DMG 记为已装订公证。
- v0.3.32 正式仓库和首选 Raw feed 已统一为 `Intellinfinity/edupi-desktop`，旧 PIGU Raw 与 Release URL 仅作迁移 fallback；macOS 在上传后单独提交 DMG 公证、staple、Gatekeeper 验证，再按精确 Release ID 事务替换。替换前核对唯一 tag、draft 和目标 SHA，先保留旧资产，上传后重新下载核对 size/SHA-256，成功才删除备份；上传或验真失败恢复旧资产，备份清理不确定则保留已验真资产与备份并让 manifest 阻止发布。
- R22 的 DMG 链路验收通过、安装启动未通过：首轮 `35771039553` 的 Linux/Windows 构建成功，macOS 因 G6 临时根 attestation 单点失败并保持 draft；同提交单平台 run `35772209888` 完成 DMG 公证与 manifest。Release ID `394034871` 固定 merge `9f33463`，submission `500735b4-4a03-4b0b-8376-c6cf3270c48c` Accepted，runner staple/validate 与 Gatekeeper 通过，事务重传 SHA `3ee2667b…`；公开包本机 codesign 与 Gatekeeper 复核通过。
- 随后的 Linux/Windows 公共安装验收均失败；诊断 run `35783207989` / `35783220232` 证明 packaged server 缺 `next`。v0.3.31/v0.3.32 已退回 draft，v0.3.30 恢复为 Latest，feed 由非强制快进 commit `446a73a` 恢复 v0.3.30/7 键；本机更新接口也已回读 0.3.30。完整证据见 [v0.3.32 公证与回滚记录](../acceptance/2026-09-23-v0.3.32-notarized-dmg.md)。
- v0.3.33 修复普通 standalone `node_modules` 被排除的问题，保留 symlink/NFT 路径，并增加最终零 symlink/realpath containment 与三平台仓库外 staged server 启动门禁。正式 run `35789747783` 三平台和 manifest 全绿；Linux `35792864973` 与 Windows `35792875124` 公共安装启动通过。DMG submission `2a5b8e12-9340-4ca2-b6f9-7dd78f137862` Accepted，公开摘要和 Gatekeeper 通过。证据见 [v0.3.33 packaged server 恢复验收](../acceptance/2026-09-23-v0.3.33-packaged-server-recovery.md)。
- 本地门禁通过：`npm test` 1398 项中 1373 passed、25 skipped、0 failed；TypeScript、lint、npm audit、release verify、目标仓库校验、actionlint、`cargo metadata --locked` 与 28 项 Tauri/Cargo 测试通过。41 项发布事务定向测试覆盖发布/改 target/重复 tag 拒绝、上传失败、哈希不符、进程中断恢复、DELETE 响应丢失和 cleanup 持续失败；独立复审无 P1/P2。
- 当时本机唯一安装副本为 v0.3.29；更新接口检测 v0.3.33。Core/投影/Kernel ready，51 学生/240 任务/43 校历/9 课表、模型/认证/设置摘要和手机默认关闭均已记录。后来 macOS 签名 helper 启动反证及 v0.3.35 安装验收以上方当前状态为准。
- 当前 L4 配对已通过 v0.3.34 的 Linux/Windows 安装，但 macOS 包启动失败并已撤回。v0.3.29 缺 updater 插件，须等修复版手动 bootstrap 验证。R23 JEV 实服/受管浏览器/Core Receipt 与 OpenConnector 安装版 sidecar 仍未完成。

## 2026-09-22 v0.3.31 手机中断恢复与 Core G6 配对（历史，已由上节取代）

- 当前分支 `feat/jev-openconnector-integration`、PR #207；源码版本 `0.3.31` 精确 pin Core G6 `acce81e3b59ae93a998e7c1e9d1f008059ec3e85`。只使用独立干净 checkout 打包，Core 主工作树的未提交改动未触碰；下方 G5 条目是这一版本较早的历史快照，现由本节取代。打包后远端 `main` 又合并 #169 为 `156ee8e`，新增 owner 审核日程冲突；该合同不在本次签名包，下一轮配对时单独验收，不能宣称 Desktop 已消费。
- R26 手机中断恢复已实现、待安装验收：响应头和 JSON 正文都受截止时间约束；配对响应丢失后只允许同一随机请求键重放，缺失或错误键不得取回激活令牌；退出手机撤销服务端授权。发送 POST 中断不自动重发、恢复可误发草稿或凭同文本消息自动确认；后台继续回读会话，须教师查看并明确核对。浏览器延迟 POST 为模拟响应，不冒充真实模型完成；真实第二台手机、网络切换和安装版重启仍未验收。默认关闭、可信局域网 HTTP 边界不变。
- R21/R22 与 Core G6 配对已实现待远端/安装验收：可信反馈目标新增领域与班级/学科校验，未知范围不产生正向评价；日程歧义写入和旧进程写入受到 Core 围栏。Bridge v1.1、12 命令、`education_workspace` 和 `external_send=false` 不变。隔离 G6 全量 1377 通过/9 跳过、TypeScript、lint、Core 反馈和日程测试、生产资源 Core/投影 ready、反馈错班拒绝与回读及独立模型 host 通过；证据见 [G6 配对验收](../acceptance/2026-09-22-desktop-core-g6-pin.md)。公共 Release、应用内验签升级、原生通知/睡眠和真实价值仍分别待验收。
- R23 JEV 实服/受管浏览器/Core Receipt 与 OpenConnector 安装版 sidecar 仍未完成；Windows/Linux 旧版升级和学校设备继续外部待验收。不能用 G6 pin 或这轮测试总数替代这些流程。
- R22 正式发布现为外部阻塞：Desktop #207 合并为 `0d36b5f`，run `35714740346` 已通过三平台源码质量门和 Apple 六项凭据门，但三平台在私有 Core checkout 统一收到 SSH `Repository not found`；组织禁用 Deploy Key，注册新只读 Key 返回 HTTP 422。`v0.3.31` 仅为绑定该 merge SHA 的草稿，manifest/feed 未发布，本机安装版仍是 0.3.29。禁止用广权限个人 OAuth token 替代；等待仅限 Core 的短期 Contents 只读凭据或组织批准的等价方案，仍需重跑同一草稿、三平台、公证、更新与安装验收。
- R22 凭据路径修正由 [Desktop #210](https://github.com/Intellinfinity/edupi-desktop/pull/210) 承载：已把三套打包工作流的 Core checkout 统一到新仓库，并在有受限 Token 时优先 HTTPS、否则沿用旧 SSH。29 项工作流测试、release/preview 的 actionlint 和 lint 通过；不宣称该 PR 能在缺凭据时完成发布。当前 `gh auth` 返回 401，需要重新登录；PR 公开只读 API 显示 head `b33b3ed` 且可合并，依赖审计因未改依赖的路径过滤无新检查。直接 Raw feed 本机超时，经 GitHub API 读取的公开 feed 仍为 0.3.30/7 平台键。
- R21 安装版原生通知仍未验收：本机唯一正在运行的 EduPi 仍是 0.3.29、Core `d05cf89`，Core/投影/Kernel ready，51 学生/240 任务/43 校历/9 课表与模型、认证、设置文件摘要保持；原生设置显示“系统通知 待授权”，未替教师点击系统授权或宣称通知中心跳转成功。
- R27 新增 Core #169 日程冲突审核消费（未实现）：已合并 Core `156ee8e` 在 Runtime 新增 `schedule_conflicts_read`、`schedule_conflict_resolve`，要求 owner 控制与 `conflict_id`、revision、内容及冲突哈希；决定限于保留原项、替换候选、保留两个不同项。Desktop 当前 G6 pin 不包含这两个操作。先完成 v0.3.31 安全发布，再在独立 G7 配对里接日程工作台的明确审核、失效拒绝、重放和跨页重读，不提前把 Core 合并等同于可用 UI。

## 2026-09-22 v0.3.31 手机安全修复与 Core G5 配对（历史阶段）

- 该阶段源码版本 `0.3.31`，Core 当时精确 pin `7cbb280eaf33bdb259e719a0149b7f2ca343d356`；Bridge v1.1 schema、12 命令和教育投影不扩权。Core G5 的家校沟通仍为 Core 内部草稿能力，桌面端未开放外发。后续 G6 配对状态以上方新记录为准，不以更新 pin 代替真实教学价值验收。
- R26 风险修正（已实现待安装验收，取代下方 v0.3.29 LAN 隔离已验收的旧结论）：公开 v0.3.30 在开启手机入口时可伪造 loopback Host 接触桌面 API。新包将 Next 固定监听 loopback，并把限定路径的网关绑定具体 LAN 地址；配对管理要求桌面进程令牌，未探测到真实网关就不显示手机地址或生成配对码。隔离 LAN 双接口实测：伪造 Host 的会话与配对管理均为 403，合法手机配对、批准、Cookie 会话回读均为 200；0.3.31 standalone 手机页无刷新显示会话，撤销后从已打开和未打开会话均自动退出，390×844 无溢出。真实第二台手机、网络切换与 0.3.31 安装版仍未验收。LAN 手机流量仍是 HTTP，默认关闭，仅在可信局域网启用；不受信任网络需要独立的加密接入方案。
- R25 风险修正（已实现待安装验收）：Safe Mode 只传入 Core 清单列出的内置 Skill，并在 SDK 加载结果中过滤误传的教师目录 Skill；正常模式不变，不复制或删除教师 Skill。隔离 SDK 加载器测试通过；故障插件冷启动与正常模式恢复需要在 0.3.31 包内复核。
- R22 发布门禁（已实现待远端验收）：正式 Release 缺任一 Apple 六项凭据就不建 draft；macOS 在上传资产后、公开 Release 前校验 `.app` 代码签名及公证 ticket、DMG 签名和 Gatekeeper。G5 隔离生产构建的 server/Core ready、教师反馈令牌拒绝与写入重放、模型 host 独立 localhost 调用通过，macOS CI 现在重跑这三项。v0.3.31 三平台签名发布、旧包应用内验签升级和用户数据保持仍待验收。
- R21 通知中心点击、真实睡眠唤醒与补跑，以及 R23 JEV 实服/受管浏览器/Core Receipt、OpenConnector 安装版 sidecar 仍为部分实现或未验收；Windows/Linux 实机应用内升级、学校设备与账号继续外部待验收。详细操作与证据见 [v0.3.31 验收记录](../acceptance/2026-09-22-v0.3.31-mobile-safe-g5.md)。

## 2026-09-22 Developer ID 签名与公证链路

- Apple Developer ID Application 证书已创建、导入本机钥匙串并导出受限 `.p12`；p12 同时携带 Developer ID G2 中间证书，`security find-identity` 回读有效身份。
- GitHub Actions 六个 Apple Secret 已配置；发布 workflow 的 macOS 资源签名修复已推送到远端 `783faf6`，对 packaged server/Core 的 Mach-O、dylib、node addon 和 helper app 加入 timestamped hardened-runtime 签名。
- `npm test`、TypeScript、lint 和 audit 已通过；最终 run `35676436480` 三平台与 manifest 全绿。Apple submission `3e2d7f01-39bd-430f-8260-454d0df6bc28` 返回 `Accepted`，Tauri 完成 stapling，Latest `v0.3.30` 已发布并包含 11 个资产；公开 DMG 的 `codesign` 与 `spctl` 验收通过。

## 2026-09-21 对话输入、手机入口与 Core Runtime 修复补记

- Desktop 提交 `2e36729` 已完成三条反馈的代码收口：流式三点菜单与方形停止键、加号附件菜单、左下主导航手机图标及手机桥接设置定位。
- Core Runtime 修复已加入缺库 fail-closed、死 admission lease 恢复和桌面 token 边界；安装版 server/Core/projection/kernel 已回读 ready，隔离 memory-write 通过。
- 解锁后补齐安装版视觉与交互：附件菜单、流式三点菜单、方形停止键、主导航/输入区手机入口均真实操作；iPhone Simulator 经 LAN 完成配对、批准、100 会话/20 提醒回读、撤销与 loopback 恢复。测试会话已删除。
- 公开 `v0.3.29` 尚未包含本提交；`d62f3cf` 已把版本推进到 `0.3.30` 并推送。发布只剩 Apple Developer ID 证书与公证 credentials：当前 GitHub secrets 和本机钥匙串均没有这些身份，不能发布 ad-hoc 包替代公证验收。
## 2026-09-22 L4 风险、未验证项与下一步

- 合并：Core [#166](https://github.com/Intellinfinity/edupi/pull/166) 最终 head `bd39463` 的 `core-quality` 成功，合并为 `7cbb280`；Desktop [#206](https://github.com/Intellinfinity/edupi-desktop/pull/206) 最终 head `35ceb67` 的 `audit`/`rust-audit` 成功，合并为 `4d55f88`。Desktop 仍精确固定已合并的 Core G4 `368bcd8`，不把 G5 主线合并冒充已打包。该批未发布安装包，合并、发布和用户验收是不同状态。
- R21/R22 实现与隔离验收：Desktop #206 补日历/课表上传的稳定语义 ID、顺序无关来源哈希、反馈令牌、教师显式评价与精确重试。`npm test` 1326 passed / 25 skipped / 0 failed，TypeScript、ESLint、安全审计和 G4 staged server 的无令牌拒绝、绑定回放、重读通过；完整边界见 [G4 验收](../acceptance/2026-09-22-desktop-core-g4-pin.md)。原生通知点击、真实睡眠、干净安装仍未验收。`release:verify` 因公开 `v0.3.30` 高于主线/该 PR 的 `0.3.29` 而失败，本批不冒充发布。
- Risk（部分实现）：先将反馈和时间安排的权威班级/学科/身份、来源修订与删除传播接入 Core 投影；覆盖同日不同事项、用户任意上传行程的去重和冲突，不将日历/课表导入等同于所有行程。保留决策、显式评价、纠正与撤回的可追溯关系；当前只在已有可信 class/subject 时开放 Today 评价，不伪造范围或使用价值。
- Unverified（已实现待验收/部分实现）：从 Core G5 merge commit 开新 Desktop pin PR，同步 schema/fixtures/manifest 并验证 staged server；在隔离原生安装版完成 Today 审核→评价→失败重试→重启回读、后台通知显示/点击、托盘、真实睡眠唤醒、升级与权限收窄撤回，macOS 和 Windows 分别留证据（R21/R22）。现有源码通过不替代这些流程。
- L4（未验证）：完成 G6 安全 veto 和六领域 Desktop 消费，逐域非盲核对实际产物、拒绝/取消/修订/重启；六领域及安装版闭环之后冻结 60 故事/360 时间点与预算，再做正式盲测。真实教师的 5 日基线、至少 10 日试用与不少于 20 个机会由用户组织，合成反馈不计入价值门。整体状态仍是“L4 功能收敛中”，不是 `L4 established`。

## 2026-09-20 更新链路、Safe Mode 与手机桥接（v0.3.29）

- R24 更新链路迁移：验收通过（macOS bootstrap + 三平台发布）。v0.3.29 已发布，Raw `updater-feed` 有 7 个平台键，资产 URL 全部为 GitHub API endpoint；旧 v0.3.28 完成一次手动 bootstrap，版本、教师数据和模型配置保持。下一跳 Tauri 自动验签安装需等 v0.3.30 验收。
- R25 DSH 式 Safe Mode：安装版验收通过。`--safe-mode` 冷启动、横幅、只读工作区与正常模式恢复均已回读；只暂停第三方 Plugins/Skills，Core、JEV/OpenConnector 边界与数据未改。真实损坏插件夹具仍待独立故障注入。
- R26 手机继续对话：同机 LAN 验收通过。显式开关、LAN 隔离、短时配对码、教师批准/撤销、HttpOnly cookie、会话/提醒回读和关闭后回到 loopback 均有证据；未开放 Core 写入、JEV/OpenConnector、文件操作或公网隧道。真实第二台手机和网络切换仍待外部设备验收。完整证据见 [v0.3.29 验收](../acceptance/2026-09-21-v0.3.29-update-safe-mobile.md)。

## 2026-09-20 提醒工作台重构

- Desktop [#196](https://github.com/PIGU-PPPgu/edupi-desktop/pull/196) 将提醒页从窄列原生 disclosure 列表改为全宽主从工作台：左侧队列承载状态、标题和时间，右侧展示详情与“继续聊 / 查看事项 / 稍后提醒 / 从提醒中移除”；现有 Core 投影和 `/api/edupi/reminders` 读写语义保持不变。
- 修复对话页两列网格在隐藏会话侧栏后仍保留 280px 列的问题；1440×900 使用 406px 队列 + 706px 详情，800×900 与 390×844 改为纵向队列 + 详情，均无横向溢出。隔离数据根中 5 条真实投影提醒完成选择、状态切换和刷新回读，“稍后提醒”从 `0` 变为 `1` 且待处理从 `5` 变为 `4`，刷新后保持；控制台 error/warning 为 0。证据见 [提醒工作台验收](../acceptance/2026-09-20-reminder-workbench.md)。
- 源码开发版验收通过后，Desktop [#197](https://github.com/PIGU-PPPgu/edupi-desktop/pull/197) 将改动发布为正式 Latest [`v0.3.28`](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.28)；workflow `35505373874` 三平台和 manifest 全绿，11 项资产、7 个 updater 平台键完整。当前本机安装版仍是 v0.3.25，受 `github.com:443` 下载阻塞，不能把本次页面改动记为安装版通过，也不改变 R21 的系统通知点击与睡眠唤醒边界。

## 2026-09-20 v0.3.27 JEV 设置与连接适配器

- Desktop PR [#192](https://github.com/PIGU-PPPgu/edupi-desktop/pull/192) 已合并，设置页提供独立 JEV URL/API Key/模型/阈值配置；API Key 只存服务端 0600 凭据文件，不进入聊天模型或浏览器 localStorage。PR [#194](https://github.com/PIGU-PPPgu/edupi-desktop/pull/194) 已发布正式 Latest `v0.3.27`，workflow `35484119032` 三平台和 manifest 全绿。
- 本机 v0.3.25 → v0.3.27 应用内更新仍受 `github.com:443` 外部网络阻塞；三次下载中断均未进入验签/替换，不能标记安装验收通过。JEV 真实付费服务、受管浏览器执行器、Core capability grant/Receipt 落账继续按 R23 保持部分实现。

## 2026-09-19 Core 执行反馈配对

- Core PR #145 将 G1 执行结果回流 Ambient planning：`draft_ready` 投影为 `already_ready`，失败进入分类等待/升级，恢复结清旧失败，stale 重新打开为 `update`；重复回放不追加事件。Desktop 已把 Core pin 更新到 merge commit `d05cf89df067a78602883c6bd95a37f8b0c122f7` 并同步 Runtime/Desktop manifest 身份。
- 源码配对验收通过：C2/C3、packaged bundle、Ambient Today runtime、Desktop 全量 1243 passed / 0 failed、TypeScript、ESLint、audit 和 release verify 均通过。证据见 [Core 执行反馈配对验收](../acceptance/2026-09-19-core-ambient-feedback-pairing.md)。安装版与真实教师价值仍未验收。

## 2026-09-19 Core L4 Today 投影配对

- Desktop 固定 Core `e8623a34715a96a1ad94cc2971727c037886fbbd`，Today 新增只读“自动准备”分区，消费 Core `l4_preparation` 投影并区分已准备好、自动进行、需要判断；Decision 保持 `apply=false`，attention 保持 `desktop_only`，ambient planning 默认关闭，仅在 `EDUPI_AMBIENT_PLANNING=1` 时启用。
- 直接 education snapshot 读取在显式 ambient 模式下先确保受管 runtime，修复与 status ensure 的竞态，避免回落到一次性 Core 后丢失 active planning 投影。干净 Chrome 验证中 workspace、材料 staging、kernel 和 reminders 均 200，控制台 error/warning 为 0；证据见 [Core L4 Today 投影配对验收](../acceptance/2026-09-19-core-l4-today-pairing.md)。
- 本批完成源码开发版隔离验收，Desktop 版本提升到 0.3.25 以满足 release verify 的公开 Latest 版本边界；v0.3.25 尚未构建发布，安装版冷启动、托盘、睡眠唤醒、通知点击、升级和数据保持仍归 R21/R22，不由开发版证据代替。
- v0.3.25 发布与实测：最终 workflow 35442065007 三平台与 manifest 成功，本机 0.3.24 原位升级到 0.3.25 且 Core/模型保持；通知二进制进入 UN 路径，但系统设置和通知中心仍无 EduPi，点击测试只证明命令返回，不能证明显示或跳转。证据见 [v0.3.25 通知交付边界](../acceptance/2026-09-19-v0.3.25-notification-boundary.md)。


## 2026-09-17 `v0.3.20` 安装更新收口

- R18/R21 收口：v0.3.21 先修复 800px 原生最小宽度并完成原位升级；v0.3.22 再修复浮层焦点恢复与 worktree 下拉 Escape。macOS 原生 800×900 窗口实际可用，主动协作 Escape 后焦点回到入口，worktree 下拉从任意子项 Escape 后关闭；Core 与 50/240/43/9 数据在两次原位升级后保持。通知中心和点击回调仍无证据，真实睡眠唤醒继续外部阻塞。证据见 [窄窗复核与通知边界](../acceptance/2026-09-18-r18-native-window-and-r21-boundaries.md)。

- R19 权限入口补强：设置页“桌面控制”收敛为一个主按钮驱动的权限流，先辅助功能、后屏幕录制、再授权重启；等待期间静默轮询，重新检测与停止控制保留为可访问图标动作。开发页 800×900、状态机、TypeScript、ESLint 和 Tauri invoke mock 流通过，原生系统授权与安装版验收见 [桌面控制权限一键流](../acceptance/2026-09-18-computer-use-permission-oneclick.md)。
- v0.3.23 发布与升级：[#179](https://github.com/PIGU-PPPgu/edupi-desktop/pull/179) 合并后 workflow [35343391371](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35343391371) 三平台与 manifest 全部成功，公开 Latest 11 项资产、7 个签名平台键；macOS 从 0.3.22 应用内下载、验签、原位替换并重启到 0.3.23，唯一安装副本、Core/数据/模型配置回读保持。原生 TCC 授权因 ad-hoc 签名仍不承诺跨版本稳定。证据见 [桌面控制权限一键流](../acceptance/2026-09-18-computer-use-permission-oneclick.md)。
- v0.3.23 跨平台 CI 安装：Linux [35406232707](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35406232707) 在干净 Ubuntu runner 下载、安装 Debian 包并在 Xvfb 启动到 Core/projection ready；Windows [35406231497](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35406231497) 下载安装 NSIS 包、启动应用并通过 native locked check。证据见 [跨平台 CI 安装验收](../acceptance/2026-09-19-v0.3.23-cross-platform-ci-installs.md)。它们不等同于学校实机升级，R22 目标设备验收继续保留。
- R21 通知授权修复：v0.3.24 在 macOS 原生命令返回前请求 UserNotifications Alert+Sound 授权，并把拒绝/超时映射为教师可处理提示；公开包二进制与 Linux/Windows runner 安装检查通过。当前本机前台为 loginwindow，安装版授权弹窗、通知显示与点击仍未验收。证据见 [v0.3.24 通知授权修复](../acceptance/2026-09-19-v0.3.24-notification-authorization.md)。
- R19/R21 追加补验：空模型安装版把模型缺失收敛为“连接模型/打开 AI 与模型”，后台管理显示“模型数据不可用”且不泄漏内部错误码；当前正式安装版连续两次 prepare ensure 后 Kernel 仍为 17 total / 15 failed / 2 succeeded，15 个缺材料 fire_key 无重复展开。系统通知点击与真实睡眠唤醒仍未验收。证据见 [行动入口与幂等补验](../acceptance/2026-09-18-r19-r21-action-recovery.md)。
- R20 追加 macOS 安装版隔离数据实测：教学重点、学生档案、材料、任务审核、日程和成长方法在安装版页面完成创建/编辑/审核/删除/恢复中的适用链路，并跨 Today、教学、材料、班级、日程、成长与回收站回读；隔离 server 重启后 Core/projection/kernel ready，对象和任务状态仍保持。2026-09-18 补齐成长“验证/发布”与真实对话产物绑定后，R20 的 macOS 安装版隔离链路验收通过。证据见 [R20 安装版对象连续性验收](../acceptance/2026-09-17-r20-installed-object-continuity.md)。
- Desktop [#165](https://github.com/PIGU-PPPgu/edupi-desktop/pull/165) 已合并，merge commit `18cd6be232737a6c0972083065f08945b371b07d`：回收站移入管理中心，聊天产物改为悬浮面板，AI 协作新增主动协作浮层并读取真实 reminder、proactive kernel 与任务投影。发布前 `npm test` 1255 tests、1230 passed、25 skipped、0 failed，TypeScript、ESLint、安全审计、Cargo locked 元数据和 release verify 均通过。
- Desktop [#166](https://github.com/PIGU-PPPgu/edupi-desktop/pull/166) 已把该批改动发布为正式 Latest `v0.3.20`，Release commit `3b173f6a95cb566bc69188542a5268d44c11c199`。Workflow [35210481151](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35210481151) 三平台构建、发布和 manifest 全部成功；11 项资产完整，`latest.json` 有 7 个签名平台键。
- 本机已从运行中的 0.3.19 应用内原位升级到 0.3.20 并重启。磁盘仍只有一个 `/Applications/EduPi.app`；更新接口返回 0.3.20/0.3.20/false；Desktop、Pi、pi-web 组件版本分别为 0.3.20、0.84.1、0.8.7，Core commit `19c0fd5182c6c20d6534973e506d6fa36acc1b06`。
- 升级后 Core/projection/kernel 均 ready，教师资料、50 名学生、240 个任务、43 个校历节点、9 个课表、45 条记忆、20 份产物、13 个可见模型和默认模型 `zai-coding-cn/glm-5.3-flash` 回读保持。安装版实际确认聊天无回收站、产物浮层不挤压聊天、主动协作显示待处理项并可进入材料；回收站读取 5 个可恢复对象和 5 条历史。完整证据见 [安装更新验收](../acceptance/2026-09-17-v0.3.20-installed-update.md)。
- 剩余边界：Windows/Linux 应用内升级、真实系统通知点击、睡眠唤醒与重启幂等补跑未验收；macOS 仍为 ad-hoc 签名，稳定 Developer ID、公证与系统授权跨版本保持继续阻塞。

## 2026-09-16 下一轮 Core 中心桌面优化

界面继续以 Core 对象、状态和可执行动作组织。图标只替代含义明确的直接动作，并始终保留 tooltip、ARIA 名称、键盘操作和必要的数量/状态；教学对象、权限模式、模型状态、错误原因及不可逆后果继续使用文字。

| 编号 | 范围 | 验收条件 | 当前状态 |
| --- | --- | --- | --- |
| R18 | 桌面动作语言与布局：统一对话、模块标题、抽屉和工具条中的图标、徽标、悬浮说明与焦点状态，删除重复文字并消除浮层争位 | 1458px 与 800px 视口无重叠；可用 Escape/Tab；图标动作有可访问名称；页面无失败请求或脚本错误 | 第一批已随 `v0.3.18` 发布：Desktop #146 让对话文件与已删除入口共享右上角空间；[#156](https://github.com/PIGU-PPPgu/edupi-desktop/pull/156) 与 [#158](https://github.com/PIGU-PPPgu/edupi-desktop/pull/158) 统一详情动作并修复窄窗布局；[#165](https://github.com/PIGU-PPPgu/edupi-desktop/pull/165) 将回收站移入管理中心，让产物和主动协作使用不挤压消息的悬浮面板。开发版 1458/800 视口、焦点、真实 Core 数据与零错误证据见 [动作验收](../acceptance/2026-09-16-core-action-icons.md) 和 [聊天浮层验收](../acceptance/2026-09-17-proactive-chat-surfaces.md)；v0.3.20 安装版页面完成 1458×900 与 800×900 重叠、Tab 循环和 Escape 复核，v0.3.21 解除 900px 最小宽度限制，v0.3.22 在原生 800×900 完成 Escape、焦点恢复和 worktree 下拉关闭。Windows/Linux 仍待验收 |
| R19 | Core 行动入口：把任务失败、材料缺失、模型不可用、权限和 Runtime 状态投影成同一套教师语言与下一步，不在页面暴露内部 code | 每类失败都能从当前对象进入唯一处理入口；恢复后原页面同步；技术详情按需展开 | 功能验收通过（macOS v0.3.20）：任务缺材料进入“补充材料”，模型缺失进入“连接模型/打开 AI 与模型”，Runtime 失败与恢复沿用 #127–#129/#139，后台失败沿用 #149，连接器接入要求沿用 #152；页面不暴露内部错误码。权限入口已收敛为一键主流程并随 v0.3.23 发布，安装版 server 页面回读到新入口；原生 TCC 授权仍未验收，Apple Developer ID/公证缺失继续阻塞，R19 不把权限开关冒充有效权限 |
| R20 | Core 对象连续性：对话、今天、工作区、教学、日程、材料、学生与成长使用稳定对象身份、来源和返回位置 | 从任一入口编辑/审核/删除/恢复后其他入口读取同一结果；会话与产物不串任务；返回原位置 | 验收通过（macOS v0.3.20 安装版隔离数据）。教学重点、学生档案、材料、任务审核、日程与成长生命周期完成创建/编辑/审核/删除/恢复并跨 Today、教学、材料、班级、日程、成长和回收站回读；真实对话 write 工具生成文件并绑定 session，重启后会话、94 字节产物和“本次产物”浮层保持。证据见 [R20 安装版对象连续性验收](../acceptance/2026-09-17-r20-installed-object-continuity.md)。真实数据迁移等价性归 R22；Windows/Linux 安装链路归 R22，不重复阻塞 R20 |
| R21 | 主动运行生命周期：通知、睡眠唤醒、后台任务、重启恢复和完全访问都由 Core run/receipt 驱动 | 同一触发只运行一次；通知点击回到对象；睡眠/重启补跑不重复；失败可重试并保留证据 | macOS v0.3.20 已验证主动协作浮层、真实 reminder/run 展示、“补充材料”入口和重复 prepare ensure 幂等：两次调用后 Kernel 仍为 17 total / 15 failed / 2 succeeded，15 个缺材料 fire_key 无重复。公开包后台恢复已有证据；v0.3.24 修复未请求授权，v0.3.25 迁移 UN 交付并完成本机原位升级，但系统设置/通知中心仍无 EduPi 条目；v0.3.26 继续补状态回读与真实 completion 结果；真实睡眠唤醒和唤醒后的端到端补跑仍待验收 |
| R22 | 发布、迁移与部署：单实例原位更新、数据/模型/权限迁移、跨平台安装和学校环境 | macOS/Windows/Linux 旧版升级后对象与配置保持；稳定签名/公证；多租户、设备、备份恢复和连接器真实闭环 | [#163](https://github.com/PIGU-PPPgu/edupi-desktop/pull/163) 修复下载中断自动重试并保持先验签后安装。macOS 已依次原位升级 v0.3.20→v0.3.21→v0.3.22→v0.3.23：单一安装副本、版本/组件/Core 身份、教师数据、模型配置、目标 UI 和日志全部回读通过，证据见 [安装更新验收](../acceptance/2026-09-17-v0.3.20-installed-update.md) 与 [窄窗复核与通知边界](../acceptance/2026-09-18-r18-native-window-and-r21-boundaries.md)。Linux/Windows v0.3.23–v0.3.24 均有干净 runner 安装启动与 native check 证据；教师学校设备上的旧版应用内升级、Apple Developer ID/公证、系统授权跨版本保持及学校账号/设备仍待验收或外部阻塞 |
| R23 | 快速浏览器决策与外部连接：JEV 仅建议浏览器下一步，OpenConnector 只执行 capability 白名单内 Action，Core 保持权限、状态与证据所有权 | 两项默认关闭且可独立启用；JEV 无效/超时/低置信度自动 fallback；外部写入可见确认；成功与失败均有脱敏回执；未配置时现有执行链不变 | Adapter、策略、Agent 工具与官方 headless runtime 合同已验证；真实 `npm.get_package` 成功执行并回读同一审计。设置页已提供独立 JEV URL、API Key、模型与阈值配置和真实连接测试，密钥只存服务端 0600 凭据文件，不进入模型选择器。JEV 付费实服、受管理浏览器执行器、OAuth 账号、Core WorkCase capability grant/Receipt 落账和安装版 runtime 生命周期仍待配对实现或外部凭据，状态为部分实现。见 [ADR-005](../architecture/ADR-005-jev-openconnector-adapters.md) 与 [验收记录](../acceptance/2026-09-20-jev-openconnector-adapters.md) |

### 0.3.19 后续执行顺序

1. **R22 发布与升级。** [发布运行](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35069469671) 当前在三平台构建；先核对三个安装包、更新包签名、组件清单和七个平台键，再在现有 0.3.17 上验收原位升级。升级前后读取应用版本、Core 身份、教师资料、模型配置、任务/学生/日历计数及进程数。当前网络下载中断已复现；若重试后仍失败，继续做可续传且最终由同一公钥验签的下载链路，不能把“检测到新版”当作升级完成。Windows 人工优化按用户要求后置，CI 安装启动与实机升级分别记录。
2. **R18 安装版交互。** 在 1458px 与 800px 原生窗口实际检查对话右上角“文件/已删除”、聊天历史滚动、抽屉和模块工具条；逐个用鼠标、Tab 与 Escape 操作，同时记录失败请求、脚本错误和控制台错误，目标均为 0。图标只用于明确的直接动作，保留可访问名称和悬浮说明；状态、权限、模型和不可逆决定继续写清文字。遇到重叠、无法点击或运行错误即修复并复测，不能用开发版截图代替。
3. **R20 Core 对象写回。** 在隔离教师数据上逐一覆盖对话、今天、工作区、教学、任务、日历、材料、学生和成长入口；从一个入口打开同一 Core 对象，实际编辑、审核、删除和恢复后从另一入口重新读取，返回原任务/会话并重启后再读一次。每类只在完整链路有证据时更新状态，现有深链回归不替代写回验收。
4. **R19/R21 主动运行。** 对模型、材料、任务失败逐个核对 Core 回执、教师可执行入口及恢复后的原页同步；安装版触发系统通知并点击回到同一对象，再做睡眠唤醒和重启后的幂等补跑。测试通知目前只确认命令返回，尚未观察送达或点击。macOS 辅助功能和屏幕录制的稳定授权需要 Developer ID 签名与公证，当前本机及 Actions 均没有相应身份，保持外部阻塞，不把系统开关视为有效权限。
5. **R22 学校与跨平台。** 获得实际连接器账号、第二租户/设备和目标学校环境后，再做真实数据隔离、备份恢复及两个 Harness 的同类任务产物回读；Windows/Linux 旧版应用内升级需各自实机证据。缺账号或设备不阻断前四项的可执行工作。

## 2026-09-16 `v0.3.18` 桌面动作、对象连续性与恢复入口

- Desktop [#146](https://github.com/PIGU-PPPgu/edupi-desktop/pull/146) 修复对话右上角重叠并完成第一批图标动作；[#147](https://github.com/PIGU-PPPgu/edupi-desktop/pull/147) 统一日程、课表和材料的 Core 对象路由；[#148](https://github.com/PIGU-PPPgu/edupi-desktop/pull/148) 在产物预览关闭或 Escape 后恢复原任务；[#149](https://github.com/PIGU-PPPgu/edupi-desktop/pull/149) 将后台失败映射为教师语言及模型/材料处理入口。每批均有隔离真实页面证据，默认页面不再泄漏后台错误码。
- Desktop [#150](https://github.com/PIGU-PPPgu/edupi-desktop/pull/150) 将这些改动发布为正式 Latest [`v0.3.18`](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.18)，固定提交 `51ec9c627232bafedcfbc617ef90d2904593a013`。Workflow [35048349842](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35048349842) 三平台全部成功：Linux 14分56秒、macOS 15分10秒、Windows 22分17秒；最终 Release 有 11 项资产，`latest.json` 提供 7 个签名平台键，组件清单和 updater 均为 `0.3.18`。
- 当前运行中的单一 `/Applications/EduPi.app` 仍为 `v0.3.17`；真实强制检查已返回 `latestVersion=0.3.18`、`updateAvailable=true`，随后的普通缓存读取也保持该结果。本轮没有替用户安装或重启，升级后版本、教师数据、模型配置和权限状态由用户验收。

## 2026-09-16 `v0.3.15`–`v0.3.17` Core 中心与发布收口

- `v0.3.15` 的第一次 workflow [35011859045](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35011859045) 因版本脚本误改 Cargo.lock 中无关的 `errno` 依赖而在三平台提前失败，没有创建 Release。Desktop [#133](https://github.com/PIGU-PPPgu/edupi-desktop/pull/133) 恢复 `errno 0.3.14` 并给每个平台增加 `cargo metadata --locked` 前置检查；workflow [35013486688](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35013486688) 随后成功发布 11 项资产的 `v0.3.15`。
- Desktop [#134](https://github.com/PIGU-PPPgu/edupi-desktop/pull/134) 将 Core [#122](https://github.com/PIGU-PPPgu/edupi/pull/122) 与 [#123](https://github.com/PIGU-PPPgu/edupi/pull/123) 的稳定失败键和旧记录折叠带入桌面；[#136](https://github.com/PIGU-PPPgu/edupi-desktop/pull/136) 让“测试通知跳转”经过与生产提醒相同的原生命令和点击回调。`v0.3.16` 三个平台均构建成功，但 manifest job 因并行 runner 产生两个同名草稿、只读到部分 `latest.json` 而失败；已将同一批构建资产合并为一个固定到 `06f167a1db94a1b28f076b45d213fd1d23630263` 的正式 Release，删除重复草稿。公开包有 11 项资产、7 个签名平台键，macOS updater SHA-256 为 `3b5572a2a520b632f527970c571bfb963f87d9505b7a954e497e72999b9cac69`。
- Desktop [#138](https://github.com/PIGU-PPPgu/edupi-desktop/pull/138) 将发布改为先创建一个绑定提交的草稿，三个 runner 共用同一 Release ID，只上传安装包和签名，最终再从四份签名集中生成 `latest.json`；缺平台、重复资产、旧草稿或提交不一致都会阻止公开。`v0.3.17` 实际运行证明唯一草稿和 9 个平台资产正确；manifest 首次收尾又暴露轻量 job 不应重新运行依赖型组件生成器，Desktop [#141](https://github.com/PIGU-PPPgu/edupi-desktop/pull/141) 改为直接校验已由三个 build 验证的提交内组件清单。
- `v0.3.16` 公开包的真实数据副本进一步暴露：课次缺材料会让系统页把健康 Core 显示成“重新连接”，并泄漏 `source_unavailable`。Desktop [#139](https://github.com/PIGU-PPPgu/edupi-desktop/pull/139) 把运行时健康与任务级失败分开；真实 Core 定时器返回该错误后，API 仍为 ready，自动运行显示“有课前任务缺少可用材料”，任务行保留“缺少可用材料 / 补充材料”，系统行显示“EduPi Core · 已就绪 · 已连接”，内部错误码不再出现在页面。
- Desktop [#140](https://github.com/PIGU-PPPgu/edupi-desktop/pull/140) 已将该修复发布为正式 Latest [`v0.3.17`](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.17)，固定构建提交 `dd5bce96bb0e1bfdf3f117cae4a7d88994b54bc0`。Release 含 11 项资产，`latest.json` 有 7 个签名平台键；公开 macOS updater SHA-256 为 `d4f88cae3e5eb96dd0b97b2f45cb188b7478726c5a097f5adfd2aa1ce09f612a`，安全解包后的 Info.plist 为 `0.3.17`。
- 原样 `v0.3.17` server、内置 Node/Pi 与固定 Core `19c0fd5182c6c20d6534973e506d6fa36acc1b06` 在真实教师数据副本启动；50 名学生、9 条课表、43 个校历节点、240 个任务和四组兼容身份均正确。旧版已把 500 条 ring 全部挤成 13 个课次的重复缺材料失败；新版投影仅保留 13 条逻辑失败，连续两次 `prepare_due` 后原始 500 条不增长。自然五分钟检查再次得到 `source_unavailable` 后，Core 仍 ready，管理中心仍显示已连接且无原始错误码。
- R14 同机公开包基准使用 `v0.3.13` 与 `v0.3.17` 原样 updater、独立空数据和交替冷进程启动。每版 5 次中，暖缓存 server ready 中位数为 240.6ms / 241.1ms，Core ready 为 1114.1ms / 1115.3ms，`v0.3.17` 差异为 +1.2ms（+0.1%）；各自首次读取为 5.57s / 2.48s，只记录观测，不归因于代码。三次新浏览器上下文的页面就绪中位数为 864.3ms / 866.6ms，管理中心为 819.2ms / 819.7ms，系统、自动运行和材料切换均在 18–38ms，失败请求与 page error 为 0。该证据不替代 Tauri 原生窗口或 Windows 实机冷启动。
- 已安装的 `v0.3.13` 真实更新接口现返回 `latestVersion=0.3.17`、`updateAvailable=true`、`releaseStatus=available`。本机仍只有 `/Applications/EduPi.app` 一个安装副本和一组主进程/server/Core 子进程；本轮没有替用户安装，最终原生文件按钮、OCR 文件打开、首配、睡眠唤醒、通知点击和本机升级数据回读由用户验收。Windows/Linux 应用内升级、Apple 稳定签名/公证、真实课堂内容质量及 R16 外部账号/学校环境继续明确保留为外部验收项。
- 外部阻塞于 2026-09-16 重新读取：GitHub Actions 仅配置 `EDUPI_CORE_DEPLOY_KEY`、`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_UPDATER_PUBLIC_KEY`，没有 Developer ID 证书或 Apple 公证所需的任何 Secret；连接器为飞书未配置、钉钉仅凭据已验证、邮箱/教务/云盘未配置；学校平台仅有 `local-school`、0 台设备、1 个 Harness，`multi_harness_ready=false`。这些项目缺真实账号、设备、第二租户和签名身份，不能用 mock 或本机单租户勾选完成。

## 2026-09-16 `v0.3.14` 公开包与 Core 恢复入口

- `/Applications/EduPi.app` 已从 `v0.3.11` 经应用内更新原位升级到 `v0.3.13`：旧 PID 被新 PID 取代，磁盘仍只发现一个安装副本。升级前后 Core、教育投影和 Kernel 均可重新就绪，50 名学生、240 个任务、43 个校历节点、9 个课表、45 条记忆、9 个自定义模型、默认模型、模型配置哈希和认证文件保持。
- 升级暴露了真实旧数据兼容缺口：一个 attempt 2 且没有历史数组的旧课前执行在启动迁移后被严格校验拒绝，桌面只看到 workspace 503。Core [#121](https://github.com/PIGU-PPPgu/edupi/pull/121) 用中性 stale/queued 边界补齐旧尝试，不伪造失败原因；真实数据迁移只改执行状态与 rhythm 的主文件/备份，随后六轮 Core、教育投影和 Kernel 读取全部 ready。Desktop [#125](https://github.com/PIGU-PPPgu/edupi-desktop/pull/125) 精确 pin Core `e6cc4f23ebc1d4a240e1ef9cb1818720e1a1b21f`。
- Desktop [#126](https://github.com/PIGU-PPPgu/edupi-desktop/pull/126) 已发布 `v0.3.14`。Release workflow [35002520172](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35002520172) 三平台并行完成，整轮约 22 分钟；11 项公开资产和 `latest.json` 七个平台键齐全且带 updater 签名。公开 macOS updater SHA-256 为 `8921b36e29b0ed79f5270136d4a363240987dcb6267e8fcea89e7207028e24c8`，与 Release digest 一致。
- R01/R02 公开包 E2：从 `v0.3.14` 公开 updater 解出的原样 server 与 bundled Core 启动隔离环境，真实模型会话 `01a0a63d-1f70-7fbf-a21d-63f568b0b646` 通过 `write` 生成 `.edupi/output/chat-file-check.md`；Core 自动登记产物 `40aa911b-62f8-4e94-8672-24c0ef19bcd0` 并绑定会话。服务重启后会话仍在、产物仍 available、同一路径只有一条登记；`/api/files` 的 read/meta 重新读取 60 字节 Markdown 正文、语言与 MIME 成功。隔离数据和临时凭据副本已删除。
- R13 公开包 E2：同一公开包完成中文图片 OCR 后台任务 `agent_job_d34fc703130ecca83c82ada39bdb9023`，首次尝试即 completed、error 为空，登记 176 字节可编辑 Markdown；日期、班级、两条数学结论、数轴原点和验收标记 7/7 核对通过。服务重启后任务仍 completed、产物仍 available；隔离数据与临时凭据副本已删除。
- Desktop [#127](https://github.com/PIGU-PPPgu/edupi-desktop/pull/127) 将 Runtime 启动失败收敛为数据库、状态、写入占用和数据根四类有限错误；[#128](https://github.com/PIGU-PPPgu/edupi-desktop/pull/128) 在管理中心提供明确恢复动作。[#129](https://github.com/PIGU-PPPgu/edupi-desktop/pull/129) 进一步把原先只刷新页面的“重新连接 Core”改为真实的受控进程重启与健康检查。隔离页面实际经历 `runtime_root_invalid` → 点击重连 → Core/教育投影/Kernel 全部 ready；第二次重连确认旧 Core PID 退出且只留下一个新实例，跨站请求为 403。
- Desktop [#130](https://github.com/PIGU-PPPgu/edupi-desktop/pull/130) 将系统页的 Desktop/Core/教育投影/自动内核与更新操作移到兼容详情之前，运行状态统一为中文；Runtime 断开显示“未连接”，版本身份不一致才显示“版本不匹配”。1280×720 实际页面中 Core 操作位于首屏，四项身份完整排布，能力详情默认收起，console/page error 均为空。
- R06 公开包完整首配：隔离用户从 0 个模型开始，在引导页填入真实 DeepSeek Key，自动发现 2 个模型；错误模型名先被明确拒绝，改用 `deepseek-flash` 后连接测试、保存和默认模型设置成功。教师五项资料经 Core 回执保存，名单步骤按界面跳过；校历、课表经当前 Desktop intake 入口写入，真实 PDF 经暂存、接入和正文确认后成为可用材料。公开 `v0.3.14` server 重启后同一 Core 任务生成本节教案、学生学案、练习与参考答案、材料准备清单 4 份文件，页面打开教案并核对 `2x+3=7 → x=2`、`x-5=9 → x=14`；再次重启后资料、模型、来源和产物均保留，引导完成并把进度复位。
- 该流程同时复现首配竞态：配置页会在选中模型测试成功后把默认模型改成另一项；教师资料成功提示会被刷新清掉；展开的引导条会盖住文件侧栏关闭键。Desktop [#131](https://github.com/PIGU-PPPgu/edupi-desktop/pull/131) 保存全部发现模型并在详情挂载前同步已测试配置，绑定“已保存”提示到可信刷新快照，同时给右上角控制留出点击区域。干净源代码页面复测默认仍为 `deepseek-flash`、2 个模型都在、“已保存”稳定可见，教师资料和文件侧栏均可真实点击关闭，console/page error 为空。
- R03 真实数据诊断发现 `g1_prepare_due` 为同一缺材料课次每五分钟生成新的 UUID 失败 run；只读副本已累计 421 条 run，其中 325 条是 13 个逻辑课次的重复 `source_unavailable`。Core [#122](https://github.com/PIGU-PPPgu/edupi/pull/122) 使用任务/错误稳定键并在投影中折叠旧 UUID 记录；[#123](https://github.com/PIGU-PPPgu/edupi/pull/123) 保证升级首轮直接复用旧失败，不再额外生成一套稳定记录。两轮真实数据副本扫描后原始 run 均保持 421，页面投影为 13 条逻辑失败；来源恢复测试把同一 run 改为 succeeded，原审计记录没有删除。
- Desktop [#134](https://github.com/PIGU-PPPgu/edupi-desktop/pull/134) pin Core `19c0fd5182c6c20d6534973e506d6fa36acc1b06`，把自动运行记录从 `g1_prepare_due / source_unavailable` 改为真实任务标题、“缺少可用材料”和“补充材料”动作；模型错误进入模型设置，其他失败进入教学或任务。真实数据副本页面显示 12 条最近记录、13 条总逻辑失败，点击“补充材料”进入材料页，console/page error 为空。
- R05 原“测试通知”只调用通用通知插件，点击后不会经过生产提醒的对象跳转，无法用于验收。Desktop [#136](https://github.com/PIGU-PPPgu/edupi-desktop/pull/136) 改为调用同一原生提醒命令和 `edupi://reminder-open` 回调；设置页显示“测试通知跳转”，点击测试通知应打开提醒收件箱。空目标、具体任务、失败任务、到期任务和简报的 JS 路由与原生目标边界均有回归；实际系统通知点击仍留给安装版人工验收。
- 本节记录的是 `v0.3.14` 当时边界；#127–#136 已进入上方 `v0.3.17` 公开版本。安装后的原生文件按钮、OCR 文件打开、R06 原生壳首配、真实睡眠唤醒、系统通知点击、Windows/Linux 应用内升级、Apple 稳定签名/公证、真实课堂质量和外部账号/学校部署仍按上方当前边界验收。

## 2026-09-16 `v0.3.13` 设置与更新热修

- Desktop [#121](https://github.com/PIGU-PPPgu/edupi-desktop/pull/121) 已修复管理中心覆盖设置、更新区与内容重叠、更新入口不明确以及桌面权限无法重新检测；1280×720和700×600实际页面操作均无重叠，“检查更新”可见可点。全量 1222 tests 为1197 passed、25 skipped、0 failed，TypeScript、ESLint和安全审计通过。
- Desktop [#122](https://github.com/PIGU-PPPgu/edupi-desktop/pull/122) 和 Release run [34995513104](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/34995513104) 已把修复发布为正式 Latest `v0.3.13`；11项资产和7个签名平台键齐全，三平台并行后整轮约22分钟。已安装 `v0.3.11` 的接口与原生界面均检测到 `v0.3.13`，尚未点击安装。
- 本机只存在 `/Applications/EduPi.app` 一个安装副本；应用内更新按当前 bundle 路径原地替换，不新建版本副本。升级前教育对象、记忆和模型基线已保存，R15 的本机升级重启与数据回读仍待最后安装操作。
- Desktop [#123](https://github.com/PIGU-PPPgu/edupi-desktop/pull/123) 已接入稳定 Developer ID 与公证 Secret；当前仓库尚未配置 Apple 凭据，`v0.3.13` 仍为临时签名。R15 的 Apple 公证和 TCC 权限跨版本保持继续列为外部阻塞，不以权限界面修复冒充签名完成。

## 2026-09-15 `v0.3.12` 发布收口

- Desktop [#119](https://github.com/PIGU-PPPgu/edupi-desktop/pull/119) 和 Release run [34983508483](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/34983508483) 已把当前 main 发布为正式 `v0.3.12`；三平台安装/更新资产、签名、`latest.json` 和组件清单完整，固定 Core 仍为 `f6145130dad4250864a3c6cd404f121be08fad17`。
- 已安装 `v0.3.11` 在本机真实回读 `latestVersion=0.3.12`、`updateAvailable=true`，应用内检测更新链成立；未点击安装，不替代本机升级重启验收。Windows/Linux 应用内升级和人工优化按用户要求后置。
- Desktop [#120](https://github.com/PIGU-PPPgu/edupi-desktop/pull/120) 将后续三平台发布改为并行，保留全平台成功后才公开的 manifest gate；预计完整发布由约55分钟降至22–25分钟。

## 2026-09-15 桌面聊天、提醒与 Core 权限收口

- Desktop [#117](https://github.com/PIGU-PPPgu/edupi-desktop/pull/117) 已合并，合并提交 `22b014d83cd874d5e73d806dc080ad45fa98640b`。提醒从 Chat 顶层移到独立提醒页，聊天滚动层补齐嵌套 flex 的最小高度约束，composer 左下提供“请求批准 / 帮我批准 / 完全访问”。
- 权限模式写入 Agent session；完全访问启动完整内置工具集，并在 Core 项目根使用 Desktop bridge 工具，避免旧 direct writer 直接触发 `Core Runtime writer admission is required`。隔离数据根中 `memory_write` bridge 实际返回 Core 成功 receipt，未写真实教师数据。
- Desktop `npm test` 为 1220 tests、1195 passed、25 skipped、0 failed；TypeScript、ESLint、`npm audit --audit-level=high` 和 `git diff --check` 通过。隔离开发版实际操作提醒入口→独立提醒页→返回对话、完全访问菜单和 session `accessMode=full` 回读。
- 安装版、Windows 实机以及真实教师数据上的权限选择仍归发布验收；本条不把源码开发版证据当成跨平台安装完成。

## 2026-09-15 R12/R17 学生双网络收口

- Desktop 当前提交完成学生详情的知识图谱与人际互动网络：稳定学生 ID、同名分离、互动事件节点、20 条分页、60 条图谱窗口、加载更多、学期/自定义时间筛选、缩放、键盘边线选择、节点居中和关联记录聚焦。
- 在隔离数据根实际创建 63 名学生（含两个不同班级的同名学生）、45 条学习记录和45条互动记录。页面确认同名不串档；图谱按20→40→45加载；点击知识点显示关联记录；“本学期”由导入周次得到 `2026-09-07` 至 `2027-01-31` 并过滤为29条；互动网络显示“学生 / 互动事件 / 活动主题”，三人同场保留一个事件节点；61人名单可翻到第3页。
- Desktop `npm test` 为 1218 tests、1193 passed、25 skipped、0 failed；`node_modules/.bin/tsc --noEmit`、`npm run lint`、`npm audit --audit-level=high` 和 `git diff --check` 通过。测试数据为隔离数据，未写真实学生档案。
- 当前仍未把 R12/R17 标为发布完成：Windows/安装版和真实课堂数据验收待发布闭环；源代码页面交互验收已完成。

## 2026-09-15 R11 教学方法与教师成长闭环

- Core [#111](https://github.com/PIGU-PPPgu/edupi/pull/111) 新增受 writer admission 保护的教学方法账本，旧 evolution 和 `SKILL.md` 自修改入口继续只读冻结。方法按草稿、真实任务试用、教师验证、发布、修订失效和停用推进；请求幂等、对象 revision、正文 revision、任务/产物绑定、停用原因、历史和教师反馈均有界保存。
- 已发布且教师验证的方法会以独立 `teaching_methods` 数据进入后续 G1 备课模型输入。方法标题、正文、哈希或发布状态变化会更新任务来源证据；执行时再次核对证据集合，不允许并发修订后的正文进入旧任务。Core 完整测试、写入 C2/C3、安全存储、bridge 固定入口和 localhost 真实模型回归均通过。
- Desktop [#115](https://github.com/PIGU-PPPgu/edupi-desktop/pull/115) 固定 Core merge commit `f6145130dad4250864a3c6cd404f121be08fad17`，在 EduPi 能力成长同页提供新增、修订、选择教学任务记录试用、验证、发布和停用。每次写入用确定性请求 ID 对账 Core 回执及最终投影；旧页面得到 409，不覆盖新状态。教师专业成长显示实际输入的反馈并可打开同一任务，计数同步。
- 隔离页面完成两轮 create → trial → validate → publish，并实际重启服务；修订后自动回草稿，旧试用留存但不能验证新正文，第二次试用后重新发布。并发旧草稿提示刷新，持久化文件确认未写入旧内容。页面控制台无错误；最终 Desktop 为 1213 tests、1188 passed、25 skipped、0 failed，TypeScript、ESLint、依赖审计和精确 Core/打包闭包检查通过。测试反馈明确是隔离验收数据，不冒充真实课堂效果。

## 2026-09-15 R08 共享任务联动与教师可读状态收口

- Desktop [#114](https://github.com/PIGU-PPPgu/edupi-desktop/pull/114) 让 Today、工作区、教学、日程和统一任务详情共用任务分类、搜索与当前状态规则。Core 正在执行的工作与老师较新手动推进的普通任务都会进入 Today“正在进行”；手动重开优先于旧审核结果，真实排队、执行、已准备和失败状态仍优先显示。`teaching_node_preparation`、课前准备、校历准备、假期和月度班级活动按明确 Core 触发类型进入同一教师分类。
- “待你决定 / 稍后处理 / 已记录”保留为审核生命周期，但接受、暂缓、稍后、拒绝和停止提示均说明提交后的去向。接受后显示结果并移到已记录；暂缓与指定日期稍后进入稍后处理；修改决定可重新处理。默认页面不再显示回执 ID、课表内部 ID、`Core 回执流转`、`timetable_class`、`confirmed` 或 `v0`；技术来源只留在显式展开的“来源与依据”。
- 每张工作候选标题都能打开统一任务详情，包括暂未形成 WorkCase 的候选。任务详情使用“任务进度”和中文记录类型、推断状态、审核人及本地时间；教学“备课任务”、任务侧栏与工作区使用同一查询字段和状态。二级分类继续作为主标题，教学子页可返回教学首页，主导航折叠后图标与偏好保留，对象列表折叠后保留展开入口。
- 实际隔离副本中，接受使待决定 18→17、已记录 0→1；暂缓使待决定 17→16、稍后处理 12→13；指定 2026-09-16 后稍后处理增至14。工作区把已接受任务从已完成重开为进行中后，Today 出现同一“正在进行”任务，教学“备课任务”搜索得到 1 条并显示进行中，进入完整任务页仍为进行中；服务重启后三入口保持。30/30 张候选卡可打开详情，无 WorkCase 候选也实际打开；各数据库二级标题、侧栏选中、教学返回、导航折叠均完成页面操作，控制台无错误，临时副本已清理。
- 最终 Desktop 回归为 1205 tests、1180 passed、25 skipped、0 failed；TypeScript、ESLint、npm audit、精确 Core bridge/manifest 检查通过。独立审查发现并修复不可点击卡片、技术文案、人工重开状态冲突、Today 漏进行中任务、Core 触发类型漏分组、跨入口搜索字段不同和无 WorkCase 任务遗漏，复审无 P1/P2。R08 验收通过。

## 2026-09-15 R10 Core 事实生命周期与证据数据库收口

- Core [#107](https://github.com/PIGU-PPPgu/edupi/pull/107)、[#108](https://github.com/PIGU-PPPgu/edupi/pull/108)、[#109](https://github.com/PIGU-PPPgu/edupi/pull/109)、[#110](https://github.com/PIGU-PPPgu/edupi/pull/110) 已合并，最终 commit 为 `9a969879c7cb7a45ce180a6e725188dfa377b244`。`education-facts` 统一承担候选接受/暂缓/拒绝、已确认事实修改、删除、分页恢复和响应丢失重放；接受与恢复同时核对目标和被替换事实的 revision，已有前序版本的事实只恢复为待确认，避免形成两条已确认谱系。公开投影只新增 `has_predecessor`，私有删除列表返回权威冲突和恢复模式。
- Desktop [#113](https://github.com/PIGU-PPPgu/edupi-desktop/pull/113) 精确 pin 最终 Core，在待我确认、学生档案、教学依据和观察与洞察中复用同一事实操作。接受、修改、删除或恢复后统一应用 Core 刷新快照；浏览器内事实 mutation 全局串行，旧响应不能覆盖新结果。替换操作确认旧事实已从公开投影消失；多冲突或第二次替换会禁用接受并显示处理当前事实的下一步。
- 观察与洞察现按学情、班级、教学和 EduPi 类别及已确认、待确认、已暂缓状态统计、筛选与分页，显示事实对象、置信度、关联对象、原始教师话语和来源 ID。删除记录从 Core 按 20 条分页读取，服务端删除对账可跨过首 100 条且不设 2000 条总量上限；恢复按钮由 Core 的 direct/replace/pending_review/blocked 模式决定，不在 Desktop 猜冲突。
- 实际隔离页面完成冲突接受、暂缓再接受、修改、删除、直接恢复、冲突恢复为待确认、处理当前事实后再次接受，并在待确认、学生、教学、洞察四个入口往返；刷新后状态和来源保持。最终页面显示“事实”“学习事实”“教学依据”，来源展开为原始教师话语，控制台无错误。未改动真实教师或学生数据。
- Desktop 最终回归为 1201 tests、1176 passed、25 skipped、0 failed；TypeScript、ESLint、npm audit、22 项 Rust 测试、精确 bridge/manifest、事实生命周期 E2 以及 C2/C3 均通过。独立审查发现并修复并发旧快照、猜测恢复冲突、只查首 100 条、总量硬上限、替换后未核对旧事实和多冲突仍可点击六类问题，复审无 P1/P2。R10 验收通过；R08 继续按完整对象联动矩阵逐项验收。

## 2026-09-15 R09 材料元信息版本与统一编辑收口

- Core [#105](https://github.com/PIGU-PPPgu/edupi/pull/105) merge commit `75cba8d4a331722ea2b34fb78e4e1943d02b79fb` 为材料名称、类型、学科和班级建立私有有界版本链；公开投影只携带 revision、历史数量和更新时间。修改、版本恢复、删除和 tombstone 恢复均在 Core 锁与幂等边界内完成，并立即刷新材料范围和课前准备来源；材料原文件不随元信息修改。
- Desktop [#112](https://github.com/PIGU-PPPgu/edupi-desktop/pull/112) 精确 pin Core #105，在材料详情提供直接修改、取消、保存、AI 协作、完整前后值历史和双向恢复。Core 明确类型优先决定分类；标题、学科、班级及课前准备摘要使用同一刷新投影。旧草稿绑定打开时 revision，只提交实际变化字段；其他入口更新后旧草稿关闭并要求重新打开，不能借用新 revision 覆盖新值。
- 隔离 E2 覆盖修改/恢复重放、旧 revision、统一删除、tombstone 恢复、备课范围移出与重新进入、重启重读和文件字节保持。实际浏览器完成修改、分类移动、取消、历史恢复、刷新、教学页联动、删除确认取消和外部并发更新；并发修复复审无 P1/P2，新标签页无 console error/warning。
- Desktop 全量为 1188 tests、1163 passed、25 skipped、0 failed；TypeScript、ESLint、npm 审计、精确 Core bridge/manifest 和22项 Rust 测试通过。教师资料、偏好/记忆、学生记录、教学重点、日程/课表、材料元信息与统一软删除现均有对应编辑、AI 协作、历史或恢复能力，R09 验收条件完成。

## 2026-09-15 R09 教学重点生命周期

- Core [#100](https://github.com/PIGU-PPPgu/edupi/pull/100) merge commit `9b79a1ce8f39980291cd1b25c8d54d77e989952f` 建立独立的 `teaching_priorities.json` 权威存储；教师重点与只读学科知识、教育事实保持分离。每条重点绑定稳定 ID、学科、可选班级、主题、说明、状态、revision、内容哈希版本链和语义幂等回执；200 条总量、50 条单对象历史与文件大小边界均由 Core 执行。统一删除扩展到第七类 `teaching_priority`，恢复保留原 ID 与全部版本。
- Core [#101](https://github.com/PIGU-PPPgu/edupi/pull/101) merge commit `1770bf759fd3f48b2f695d339d0a92c4c02cbe56` 在重点创建、修改、恢复、删除和 tombstone 恢复后立即重算课前节奏。只有 `active` 重点按学科与班级进入备课摘要；重点 ID/revision 进入证据，内容变化改变来源 fingerprint 但不改变课次 task ID，暂停、完成或删除会从摘要移除。
- Desktop [#111](https://github.com/PIGU-PPPgu/edupi-desktop/pull/111) 精确 pin Core #101，在“教学重点”中新增教师维护区，提供直接新增、取消、保存、修改、暂停、继续、完成、AI 协作、完整前后值历史恢复和统一删除。历史仅按需读取；GET 同时核对同 revision 的公开教育快照与私有版本链，外部更新会一次推进页面而不会循环启动 Core 进程。重复创建已演进的同一重点返回 409，不再误报 502。
- 教学首页优先显示 active 教师重点，本周课前准备读取同一 Core 摘要；侧栏“教学重点”计数为教师重点与只读知识条目的合计，并与学科、班级、主题、说明和中文状态筛选保持一致。AI 协作继续使用全局会话草稿并保留明确教师输入位置，不恢复已退役的 `subject_knowledge` 直写扩展。
- 隔离 Core E2 完成创建、同意图重放、同主题跨班、修改、重复创建冲突、暂停、历史恢复、完成、统一删除、tombstone 恢复、重新激活、过期 revision 拒绝和重启重读。实际浏览器完成新增、修改、暂停、历史两侧恢复、完成、删除确认、删除记录恢复和刷新；Core 删除由同一受限 API 提交，页面恢复后保留全部历史。旧 revision 页面遇到外部更新时只发出一次历史 GET，并从 revision 6 同时推进当前值与历史到 revision 7；教学首页和课前准备随即显示新重点。
- Desktop 全量为 1175 tests、1150 passed、25 skipped、0 failed；TypeScript、ESLint、npm 高危审计、Rust `cargo check`、22 项原生测试及 C2/C3、六类既有删除、教师资料版本、学生档案版本 E2 全部通过。独立审查发现并关闭历史重读循环 P2，复审无 P1/P2。R09 现只剩材料元信息版本，整体仍保持部分实现。

## 2026-09-15 R09 学生档案版本

- Core [#97](https://github.com/PIGU-PPPgu/edupi/pull/97) merge commit `0d1e2e243cbd996f0c101db0d2038247bda7cf09` 为班级、学生特征和家校备注建立同一条有界版本链。名单导入、教师修改、Agent 更新与历史恢复共用写入边界；每条版本绑定学生稳定 ID、revision、前后值、来源、请求 ID 和内容哈希。旧学生 ID、旧删除指纹、同名跨班、500 人/1 MiB 容量、版本裁剪、删除后重放和非编辑字段保持均通过 Core 全量与独立审查。
- Desktop [#110](https://github.com/PIGU-PPPgu/edupi-desktop/pull/110) 精确 pin Core #97，在学生抽屉按需读取“档案历史”，显示来源、受影响字段以及修改前/修改后的班级、学生特征和家校备注。按钮明确为“恢复修改前/恢复修改后”，并说明恢复会同时替换三个可编辑字段；当前档案一侧不显示重复恢复操作。
- 手动保存同时绑定稳定学生 ID、`updated_at` 和 `profile_revision`，请求 ID 由完整编辑语义确定；相同请求在响应丢失后重试不会增加版本。恢复只提交学生 ID、版本 ID、方向和当前 revision；Desktop 严格校验版本内容哈希、连续链、Core 回执和刷新后的投影，伪造版本、跨学生历史、同名错误路径、过期 revision 与同请求改意图均失败关闭。
- 隔离进程 E2 完成 legacy revision 0 → 手动修改 revision 1 → 恢复 revision 2 → 重放与重启重读；恢复后学习模式和成长轨迹保持不变。实际浏览器把李四从 703/认真改为 704/主动提问/愿意表达，历史显示完整前后值；点击“恢复修改前”后回到 703/认真、版本数从1变2，刷新后当前值、两条历史、学习模式和成长节点仍在。
- Desktop 当前全量为 1162 tests、1137 passed、25 skipped、0 failed；TypeScript、ESLint、npm 高危审计、C2/C3、教师资料版本、六类删除恢复和学生版本 E2 全部通过，独立只读审查无 P1/P2。验收使用 macOS 源码开发版和隔离数据，未修改真实学生档案；该功能尚未进入下一公开安装版。
- R09 的学生档案版本已验收。剩余教学重点生命周期与材料元信息版本继续沿原编号完成，R09 暂不整体勾选。

## 2026-09-14 R09 教师资料字段版本

- Core [#95](https://github.com/PIGU-PPPgu/edupi/pull/95) merge commit `76f1c9f6ef2393f96e789023e45c6dc86eac4b72` 在现有教师审核事务中保存有界的字段前后值。旧值不进入公开 v1.1 projection；生产快照通过教育工作区 source hash 绑定私有版本摘要，历史值被改动会改变快照身份。
- Desktop [#109](https://github.com/PIGU-PPPgu/edupi-desktop/pull/109) 按需读取字段版本，显示每次变更的原值和新值。恢复只提交 Core 版本、方向和字段，Core 在写锁内基于最新生效资料生成待确认提案，再走现有 `review_teacher_context` 回执形成更高 revision；缺失历史值可把单个字段恢复为“未设置”，其他字段保持不变。同一请求不能改指另一版本，旧 revision、旧来源和超时重放均不会重复恢复。
- 隔离进程 E2 完成“七年级 / 703 → 八年级 / 703 → 只恢复班级为未设置”：最终 revision 3，年级仍为八年级、称呼和学科不变，重复请求由 Core 对账为同一次恢复；刷新后教师资料和后续协作提示仍读取八年级。实际浏览器显示2个字段版本，恢复班级后当前值变为“未设置”、年级保持八年级，字段历史增至3；随后往返恢复再次证明原值/新值均可点击，中文操作说明不暴露内部字段名。
- 升级前的旧审核回执没有字段快照，继续保留为“操作历史”，不伪造旧值；从本版本起的新接受和修改才进入“字段历史”。R09 的教师资料字段版本已验收，教学重点生命周期、学生资料版本和材料元信息版本仍待完成。

## 2026-09-14 R09 Core 统一删除与恢复

- Core [#85](https://github.com/PIGU-PPPgu/edupi/pull/85) merge commit `ab1aa67293f8d75fb4f108994f494d21a1480a2c` 为校历、课表、记忆、学生、任务和材料建立同一套 tombstone、全局单调版本、幂等回执与有界操作历史；[#90](https://github.com/PIGU-PPPgu/edupi/pull/90) merge commit `93b191bfdbca74a6c7349594051225496a29c7f6` 将材料恢复绑定到 `O_NOFOLLOW` 文件描述符，并在提交恢复前再次核对路径、inode、单链接、大小和哈希。删除不改写原始对象；来源缺失、变化、身份冲突或材料文件不可验证时拒绝恢复。
- Desktop [#108](https://github.com/PIGU-PPPgu/edupi-desktop/pull/108) 只在正常工作区读取删除数量；老师点击“已删除”后才按需读取完整记录。恢复请求只携带对象类型、Core 正式 ID、由当前 tombstone 派生的稳定请求标识和备注，服务端重新读取 Core tombstone，浏览器不能提交删除版本、指纹或对象副本。恢复响应超时后按同一请求标识核对 Core 历史，不能误恢复后来再次删除的同名对象。恢复成功后刷新同一 Core 快照并进入对应模块；任务进入原任务详情，材料仍核对实际文件可见。
- 隔离 E2 依次删除并恢复六类对象，重读后原对象、来源字节和任务阶段保持，历史为 16 条；材料文件变化时恢复返回冲突，补回原字节后成功。Core 另覆盖缺失文件仍可删除、ID 命名空间碰撞、同名学生、旧 tombstone 迁移、500 条容量和 2 MiB bridge 响应边界。实际浏览器逐项恢复六类对象：课表定位周一第 7 节；记忆从错误的“学校”分类切到“教师偏好”并展开目标；学生从错误的 704 班筛选切回全部班级并打开 703 班目标；材料从错误的“测验与评估”切到全部材料并打开目标；任务进入目标详情；校历跳到 2026 年 12 月并打开 12 月 20 日目标。刷新后对象仍在，删除记录为 0，Core 历史为 12 条。
- 该批完成六类 Core 对象在 Desktop 的统一软删除、按需历史、安全恢复和页面定位验收。教学重点生命周期、学生资料版本和材料元信息版本还需要后续 Core 命令与存储，R09 保持部分实现。

## 2026-09-14 R09 现有历史与恢复入口

- 教师资料现在显示 Core 审核决定历史；校历、课表和已接入材料按 receipt 的 `appliedIds` 关联目标对象并显示操作历史，明确不冒充字段版本。隔离页面中教师资料显示2次接受记录，校历“教研会”显示2次写入记录。
- 学生学习/互动记录显示历史正文、知识点、观察日期和总版本数；点击“恢复此版本”仍调用 Core `update_event` 并携带当前 revision，因此恢复本身形成新版本。页面从“当前：移项已经掌握”恢复为“原始：移项仍需练习”，API 重读 revision 2、history_count 2；刷新后的列表同步显示旧日期和知识点。
- 该批复用了当时已有的 Core 历史与更新能力，没有伪造无法恢复的快照；后续 Core #85/#90 已补统一软删除，Core #95 已补教师资料字段版本。教学重点生命周期、学生资料版本和材料元信息版本仍需 Core 新命令与存储，R09 不整体勾完。

## 2026-09-14 R04 自建教学任务进入 Core 托管

- Core [#69](https://github.com/PIGU-PPPgu/edupi/pull/69) 已合并，merge commit `2be918baed1102133d7f22f2292a2bb41edb9781`。`create_task` 可携带受限的课表 slot、上课日期、材料 ID 和产物清单；Core 将它持久化为 source-backed manual task，再并入权威 rhythm/G1 候选，不新增旁路执行器。
- Core [#73](https://github.com/PIGU-PPPgu/edupi/pull/73) merge commit `2d310b5dd317db714d3fd9112ce7979d2eaa90b7` 保留 manual task 与 work candidate 合并后的材料关联。Desktop 创建请求使用稳定客户端 UUID 派生 task ID，同一请求可安全重放；服务端收到已绑定回执后立即启动 Core 准备，浏览器中断不会再要求重新创建。回执 target 和 applied IDs 必须与本地 task ID 完全一致。
- Core [#74](https://github.com/PIGU-PPPgu/edupi/pull/74) merge commit `a180f1c70bb9c2e6c63bb5a6e2b25499f715130b` 将显式准备的来源预检失败按 task ID 与 candidate revision 写入 Kernel。Desktop 重新打开任务或 Runtime 重启后仍显示“请先确认材料内容/请关联可用材料”，来源修复产生新 revision 后旧失败不再覆盖新执行。
- Core [#76](https://github.com/PIGU-PPPgu/edupi/pull/76) merge commit `ab0717f04cbfc747e8172cc7fcf033943622d36b` 让同 revision 来源恢复后结清原 Kernel 失败；重复失败只记一次，不耗尽重试。任务创建/启动已经持久化但最终页面刷新失败时，服务端返回 HTTP 202 与真实 preparation 状态，页面后台重读，不再谎报“任务创建失败”。
- Core [#78](https://github.com/PIGU-PPPgu/edupi/pull/78) merge commit `bf42f89227a48cdf2bfd94a636c4268d3da10759` 将任务幂等判断改为稳定命令语义：请求 ID、时间和快照变化仍可返回原回执，第二项及后续材料变化会返回冲突；旧版创建记录只在完整持久任务与原来源哈希一致时迁移。同 revision 来源“失败→恢复→再次失败”会重新打开同一 Kernel 诊断，恢复后再次结清且不增加执行次数。
- Core [#81](https://github.com/PIGU-PPPgu/edupi/pull/81) merge commit `af38213333bffcda89b3b12c3d85151861328923` 将课次存在性和星期校验放进 Core 新建事务，并位于幂等重放之后。新任务无法绕过当前课表约束；已提交任务即使随后课表被修改或移除，丢失响应后的重试仍返回原任务，不会误报创建失败。
- Core [#83](https://github.com/PIGU-PPPgu/edupi/pull/83) merge commit `9235cb5b577882bbb114ee71a713e01d87efe6c5` 在同一新建事务中逐项核对材料仍未删除、文件可读且班级/学科匹配；依赖在提交前再次比对。桌面表单刷新时同步剔除已失效的隐藏选择，不能把旧 material ID 带进新任务。
- 同一课次由老师明确创建后会取代该课次的自动候选。G1 继续核对班级、学科、已确认材料摘录和 source revision；来源移除在模型调用前失败，恢复来源后按新 revision 重生成，随后重启只重放，不重复产物。
- 实际桌面页面完成“新建任务 → 由 Core 准备教学产物 → 选择课次/日期/材料/产物 → 创建并准备”；课次显示星期，日期必须匹配课表星期，自动截止日期随课次日期变化直到老师手动修改；材料与产物在提交前执行 Core 的 20 项、唯一值和单项长度边界。任务板保持按 task ID 轮询，自动从进行中进入待我确认，无需切页或手动刷新。
- 教育工作区经过 Core 校验后只替换授权 `.edupi/output` 与 `.edupi/inbox/teacher-materials` 两个受管只读根，逐级拒绝符号链接并撤销旧数据根；不再授权整个数据目录。任务详情合并 generated index 与权威 work-case artifacts，任一索引暂缺时仍可逐份打开；索引已明确标记不可用的文件不会被 work case 重新伪装成可点击产物。该证据使用隔离 localhost 模型与测试材料；真实教学内容质量和下一安装版仍单独验收。

## 2026-09-14 Core 事实脊柱进入桌面教学流

- Desktop 现在严格读取 Core `education_fact_v1` 投影；无效投影只隔离事实区，不会清空其余教育工作区。学生档案按稳定 `student_id` 显示已确认、待确认和暂缓事实，并保留原始观察与来源；教学重点消费 Core `teaching_view`，同一事实 ID 会标出是否供下一节课采用。
- Core [#71](https://github.com/PIGU-PPPgu/edupi/pull/71) 已合并，merge commit `145875575245335f82297a46c70fd3746a4fe9f3`。事实实体投影携带受限 `school-roster` 外部标识；Desktop 先由名单 ID 映射到 fact entity ID，再核对每个学生视图、教学视图和下节课引用的事实归属，禁止按姓名猜测或跨学生引用。直接 ID 兼容只允许没有 roster 外部标识的旧实体，显式冲突不会回退。Core #74/#76 只投影仍指向当前可见事实的 use 与 observation 完整的 hypothesis；Desktop 同时核对实体归属。当前精确 pin 为 Core `9235cb5b577882bbb114ee71a713e01d87efe6c5`。
- 实际页面以名单 ID `student-roster-ui` 打开林晓档案，对应 Core entity `entity_411bafd9fcea085b81b050a48a97e8db`，两者明确不同；页面仍显示该生“移项符号仍需练习”和原始教师观察。缺失的观察投影不再吞掉其他 source ID。
- 隔离 Core 通过正式 fact store 建立学生、教师原话和已确认错因事实。实际页面在“教学重点”显示“移项符号仍需练习 · 林晓 · 下节课采用”，展开后显示原始教师话语；同一学生档案显示同一事实和来源。测试目录已清理，真实教师数据未改动。
- R10 的跨模块读取与来源追溯已补齐一段，R14 的任务抽屉和教学上下文弹窗统一使用共享 Escape/焦点恢复栈。事实修改、审核、删除、恢复和后续备课使用回执仍未全部接到桌面端，因此 R09/R10 继续保持部分实现。

## 2026-09-14 `v0.3.11` 安装验收与 Core Runtime 对齐

- `v0.3.11` Release workflow `34765761183` 的 macOS、Linux、Windows 和 manifest 全部成功；macOS updater SHA-256 为 `d90947b7cf3bd0b2d6907020e45e6f521e3eca9b072265c75eb3698ae7438a37`，与 Release digest 一致，本机 updater 公钥复核 Minisign 签名成功。
- `/Applications/EduPi.app` 已由 `v0.3.10` 备份后替换为 `v0.3.11` 并启动，原生页面显示 `v0.3.11`，原教师工作区与 Today 数据保持可读。Windows published-install run `34770908602` 与 Ubuntu 24.04 published-install run `34770910836` 均通过。
- 安装包内置 server、Node、Pi 与 pinned Core 在临时数据根完成 R03/R13 验收：启动 ensure 立即新增一次 `g1_prepare_due`；后台任务在工具执行中停止 server，旧工具进程退出，重启后同一 job 由 attempt 2 自动领取并生成、登记 `recovery.txt`。该证据明确是 packaged-server recovery，不冒充 Tauri 睡眠事件。
- Core [#66](https://github.com/PIGU-PPPgu/edupi/pull/66) 持久化后台任务阶段，Desktop [#102](https://github.com/PIGU-PPPgu/edupi-desktop/pull/102) 显示真实进度和恢复次数，并使后台恢复不受 `prepare_due` 失败影响。原 `RunEvent::Resumed` 在当前 Tao 桌面端不提供真实系统唤醒，已改为跨平台时钟间隔监测；重叠的 resume/online/visibility 触发会尾随执行，不再丢失。
- Core [#67](https://github.com/PIGU-PPPgu/edupi/pull/67) 将 Runtime lifecycle、G1/G3 激活、真实 timer interval、上次/下次检查和 timer error 纳入受验证 health；Desktop [#103](https://github.com/PIGU-PPPgu/edupi-desktop/pull/103) 删除硬编码八项计划，分别显示 Runtime、教育投影和 Kernel 状态，并同时核对 Desktop/Runtime 两份组件清单。当前 pin 为 Core `7c92b1e6dd7ec35aab7201c5565bd00c10875e51`、Desktop manifest `sha256:3e46e118acf493cbb64e24384ac3bc6c2a10733b697a965ef23ce5707642bf42`、Runtime manifest `sha256:5f52b2727926aaadf0e8c3c48c0837839a0bf5a3186d2109a0e66960ec17889f`。
- Desktop 已消费 `capability_package` 与完整 artifact 元数据；单个坏 case 不再清空其他任务。日历/课表编辑只向 Core 提交目标对象；隔离流程中三条不同来源日历只修改中间一条，另外两条逐字段不变。材料上传改为暂存后确认名称、类型、学科和班级，API 使用教师标题；提醒的本地动作明确为“从提醒中移除”，不再冒充完成 Core 任务；平台四个投影可分别失败，连接器“已配置”和“已连接”不再混用。
- 本轮 Desktop 全量为 1098 tests、1073 passed、0 failed、25 skipped，TypeScript、ESLint 通过；Core 全量 `npm test` 通过。隔离浏览器实际显示 Core 返回的下一次课程准备检查时间和材料范围表单。
- 仍未完成：把上述 #102/#103 代码打入下一安装版后的真实睡眠唤醒；干净安装 OCR；系统通知点击；R04 自建教学任务受管执行；事实脊柱在学生/教学页面的完整读写；对象历史矩阵；Windows/Linux 应用内升级、Apple 公证和 R16 外部账号/学校部署。

## 2026-09-13 Windows 修复与 `v0.3.10` 发布收口

- `v0.3.10` 已发布并完成三平台签名构建；Windows published-install 与二次启动单实例验收均通过。
- 模型配置现在清理缺失 `cacheWrite` 的价格对象，保存和连接测试不再生成无效 `models.json`；Tauri 单实例插件阻止重复启动客户端。
- 本机安装版已验证缺失 `cacheWrite` 的模型测试返回 OK，正式账户和真实 Provider Key 未被测试。

## 2026-09-13 `v0.3.9` 发布与安装版收口

- Provider/API Key 自动模型配置已合并主线并进入 `v0.3.9`；Release workflow `34738213112` 三平台和 manifest 全部通过，安装资源与签名元数据完整。
- 本机已安装并启动签名 `v0.3.9`，更新检查为 up-to-date，Core/projection ready，真实工作区 50/237/43/9 保持可读；安装版模型列表与默认模型仍可读取。
- 本轮发布边界：源码和安装包内置 server 均已验收保存 Key→自动模型→同面板自定义模型；安装版完成启动、版本、模型读取和 Core 复核，测试只使用临时 HOME/临时 Key，未接触正式账户。Apple 公证、跨平台应用内升级、通知/睡眠唤醒继续保留未验收状态。

## 2026-09-13 Provider/API Key 到模型配置收口（取代 R06/R16 旧的手动模型入口描述）

- Desktop 提交 `6541524` 为受管 Provider 增加统一模型入口：保存 API Key 后在同一 Provider 面板自动读取运行时模型目录；运行时没有模型时回退 `models.dev`，仍可在同一面板添加自定义模型。
- 首次配置新 Provider 且没有可用模型时，自动把首个匹配厂商提示的模型设为默认；已有模型配置不覆盖教师当前模型顺序和字段。模型元数据接口只返回模型字段，并递归过滤 API Key、Authorization、headers、token 等敏感键。
- 隔离浏览器真实操作：打开“添加 Provider”→选择 DeepSeek→提交临时测试 Key，页面实际显示“已自动加载 2 个”；点击“+ 自定义模型”后仍停留在 DeepSeek 面板，模型数变为 3 个，未再进入旧的独立“配置模型名称与连接测试”入口。临时 HOME、Key 和配置已清理，正式配置仍为 `zai-coding-cn / glm-5.2`。
- 定向 Provider 路由、ModelsConfig onboarding/embedded 回归、`tsc --noEmit`、ESLint 和全量 `npm test` 通过；全量结果为 1053 passed、0 failed、25 skipped（1078 tests）。
- 当前边界：该功能已在源码开发版和 `v0.3.9` 安装包内置 server 的隔离数据完成页面验收；正式账户的 Key 未被测试，外部 Provider 动态目录和真实模型内容质量仍按独立条件验收。

## 2026-09-12 发布风险收口（取代前述旧阻塞状态）

- 本机 updater 密钥对已找到并验证可签名；GitHub 的 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_UPDATER_PUBLIC_KEY` 已存在。未设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 不构成阻塞，因为私钥未加密；私有 Core 的 Actions 读取当前使用仓库专属只读 deploy key `EDUPI_CORE_DEPLOY_KEY`，旧宽权限 `EDUPI_CORE_READ_TOKEN` 已删除。
- Desktop 发布版本已推进到 `0.3.7`，组件清单和 Cargo 版本已同步；Core 修复提交 `6b1d0cf74d7a1344c881da8e34a857243e315fdb` 已通过本机全量回归并合并到公开 Core `main`（PR #58，合并提交 `ea3b1dd175d3521546cc2b3ff685f6c9c7a360c6`），Desktop 已具备按精确 pin 运行正式 Actions 的条件。
- 本轮可在本机、正式 CI 和 Windows runner 闭合的发布风险已处理；剩余未验证项明确为 Linux 实机安装升级、Apple 公证，以及真实课堂内容质量与系统通知/睡眠唤醒场景。

## 2026-09-13 正式发布验收

- 首次 run `34701579391` 因私有 Core checkout 缺少 `EDUPI_CORE_READ_TOKEN` 失败；补入 Secret 后重跑 `34702177745` 成功，macOS、Linux、Windows 与 manifest jobs 全部通过。
- `v0.3.7` 已发布为非草稿，远端资产包含 DMG、AppImage、deb、Windows NSIS、macOS updater tar.gz、三个 updater 签名文件、`latest.json` 和 `component-versions.json`。远端 `latest.json` 三个平台条目均有签名，清单版本为 `0.3.7`。
- Windows run `34705099213` 的 published-install、native source check、私有 Core diagnose、stray-scan 和原生命令检查全部通过；Linux Ubuntu runner 的 `.deb` 安装与启动也已通过，其他 Linux 发行版仍未验收。
- 已从本机已安装 `v0.3.6` 实际执行应用内升级；首次网络响应解码失败后重试成功，重启显示 `v0.3.7`，更新状态为 up-to-date，50/237/43/9 工作区计数保持可读。Linux 主机安装、Apple 公证和通知/睡眠唤醒仍未验收。
- 私有 Core 读取已改用仓库专属只读 deploy key，旧宽权限 token 已删除；preview run `34710502746` 和 Linux `.deb` 安装 run `34711422997` 均成功。

## 2026-09-13 Desktop/Core 匹配与交互复核

- Desktop 提交 `e01bab9` 纠正了能力投影：pinned Core 声明的 `import_calendar`、`import_timetable`、`intake_material` 现在在教育合同中显示为 `canonical_safe_store`，只有 manifest 与 snapshot 能力清单完全一致时才启用；日程、课表和材料入口按同一能力结果显示可用或只读原因。
- 管理中心新增 Core 兼容性面板：显示 Core commit、合同版本、组件清单摘要、投影和 11 个可交互命令；每个已启用命令可跳到对应桌面入口，未接入命令保留 Core 原因。隔离源码版浏览器实测显示“已匹配”、`11 / 11`，点击“写入校历”实际进入日程。
- Desktop 提交 `6b645ec` 修复 Next 服务端加载材料识别模块时的动态 `createRequire` 解析问题。最终 pinned Core + 隔离数据的源码版实际通过页面写入临时校历，显示“日程已写入 EduPi 行事历”；Core receipt 为 `accepted`，教育工作区重新读取到对应校历对象。课表导入接口同样返回 `accepted`。测试数据只写入隔离目录，随后删除临时校历。
- 学生记录刷新事件统一为 `edupi-student-records-updated`，对话工具写入、页面编辑/删除和观察数据库使用同一事件，避免跨入口显示旧记录。
- 管理中心的模型读取在项目 cwd 端点不可用时回退全局模型端点；基础 Core/教育数据可用时不再把单独的模型配置缺失误报为整页“数据读取失败”。隔离源码版管理中心实测为 `7/7`、`100%`。
- 当前 pinned Core 与 Desktop 兼容性证据：Core `6b1d0cf74d7a1344c881da8e34a857243e315fdb`、组件清单 `sha256:9f28910f0886fcfed4509729af8361749cbd0f0cf3b48df4093db34fed6728b5`、合同 `1.1`、投影 `education_workspace`；状态接口实际回读与 Desktop expected identity 完全相同。
- 本轮仍未把系统通知点击、睡眠唤醒、Apple 公证、Linux/Windows 应用内升级、零 API 首次完整备课、真实课堂质量和外部连接器账号闭环标为完成；这些需要目标系统、账号或人工内容核对。

## 2026-09-13 v0.3.8 发布与本机包复核

- 主线已发布 `v0.3.8`，Release workflow `34714343043` 的 macOS、Linux、Windows 和 manifest jobs 全部成功；Release 为非草稿、非预发布。
- 远端资产包含 DMG、AppImage、deb、Windows NSIS、updater tar.gz、三个签名文件、`latest.json` 和 `component-versions.json`；`latest.json` 三个平台均指向 `v0.3.8`，组件清单 `appVersion=0.3.8`。
- 使用本机 updater 公钥对远端 macOS tar.gz 签名复核成功；旧安装 `v0.3.7` 已备份后替换为 `v0.3.8`，启动后 Core/projection ready，工作区回读 50 名学生、237 个任务、43 个校历、9 个课表，更新检查为 up-to-date。
- 当前 macOS 处于锁屏状态，无法通过原生 CUA 再次点击设置页的“安装更新”按钮；本次记录是签名 updater 资产验证加本机包替换/启动证据，不把它写成新的应用内点击验收。此前 `v0.3.7` 应用内升级点击链已有独立证据。

## 2026-09-12 Today 审核交互与 Core 写入锁修复（取代本页旧 pin/Today 状态）

- 根因已确认：旧版钉钉桥接进程会在整个进程生命周期持有 Core writer admission SQLite 锁，导致 Today 的接受、调整、暂缓、稍后、停止提示、拒绝全部在提交阶段返回 `writer_admission_unavailable`，页面只显示笼统的“暂时无法提交”。Core 行为修复提交为 `5650151`，桥接清单提交为 `7e6a99ff500483a199793f4175d1e1eeaf413ae0`，writer 矩阵提交为 `94c3c3b`，最终审计断言提交为 `6b1d0cf`，配套 pin 为 `6b1d0cf74d7a1344c881da8e34a857243e315fdb`。
- 修复后钉钉桥接按连接、消息和状态写入短暂取得准入，空闲时释放；加入并通过桥接排队/释放回归。最终桌面包运行时实测：钉钉状态 `ready`，同一真实工作区 writer admission 探针成功取得并释放，进程空闲时不再占用 SQLite 文件。
- Today 页面已把列改成“待你决定 / 稍后处理 / 已记录”，列头写明进入条件和可逆性；动作按钮有明确去向与处理中状态，成功反馈包含实际状态变化和回执；快照过期会说明“本次没有写入”并提供“刷新待办”，普通暂时不可用提供“重试”。
- 最终打包隔离 E2 使用同一 `EduPi.app` 资源服务和临时数据根，真实 POST `review_work_candidate/accept` 返回 HTTP 200、回执 `accepted`；重新读取后候选为 `accepted / closed_accepted`，待决定 14→13、已记录 0→1，临时数据已清理。
- 最终桌面包由 `npm run desktop:prepare` 与 `tauri build --bundles app` 生成；包内 Core/projection/Kernel ready，真实工作区 50 名学生、9 个课表、43 个校历、237 个任务，Desktop manifest 为 `sha256:9f28910f0886fcfed4509729af8361749cbd0f0cf3b48df4093db34fed6728b5`。原生窗口截图已核对新列名、动作说明和无红色失败条。
- 追加实际浏览器验收：Today 三列和动作标题可读；点击“接下来”日程项后进入日程详情并带真实对象路由；观察记录展开后“打开来源对话”进入对应 session；从班级点开程天乐档案后，知识图谱/人际互动网络两个切换入口均可用，网络图与列表空态按当前真实记录显示。上述操作为只读页面验收，未改教师数据。
- 追加 R14 页面交互复核：学生详情抽屉打开后按 Escape 会关闭并清除 URL 选中项；768px 视口下文档宽度不溢出（scrollWidth=clientWidth=768），移动布局可读。Windows runner published-install 已验收，真实 Linux 主机仍未验收。
- 追加安装资源闭包复核：最终 bundled Core 的 clean profile loader 实际加载 7 个允许教育扩展且 `errors=[]`；测试同时确认已退休的直接写入扩展不进入包。此前失败的测试要求与当前 architecture ledger 冲突，已修正为当前闭包契约。
- 追加 R01/R02 页面只读复核：最终包材料页真实显示对话生成文件，点击 `展开与折叠学案.md` 打开材料详情抽屉，状态、来源、日期、预览和“补充 / 修订”入口均可见；未在正式数据上执行修改或删除。
- 最终 Core bundle closure 定向测试 3 项全部通过：临时复制包无 `.git` 可验证、篡改/缺失 runtime dependency 会拒绝、bundled 模式不依赖 Git；Desktop bridge transport parity 也通过。
- 配套 Core `npm test` 最终全量通过（含 live model、writer admission/enforcement/C2/C3、daemon、学生、closure 和 scoped memory runtime）；此前 writer detector 与 Desktop manifest SHA 漂移已同步并复跑通过。
- 签名风险已复核：本机永久 updater 密钥对存在，空密码签名探针和最终 `.app.tar.gz.sig` 均成功；GitHub 私钥、公钥和私有 Core 读取 Secret 均已配置。正式 `v0.3.7` Actions Release 已完成，三平台资产、签名和组件清单均已发布。
- 验证结果：Desktop 全量 1069 tests、1044 passed、0 failed、25 skipped；`tsc --noEmit`、`npm run lint`、Core live model、桥接清单和传输一致性均通过。本机包与远端 `latest.json` 均已核对为 `0.3.7`。
- 状态边界：真实教师数据没有被测试接受动作改写；真实包写入在隔离数据根完成。原生自动化当前仍不稳定，因此没有把真实工作区的鼠标点击或系统通知点击记为通过；R15/R17 跨平台安装升级、签名、公证和真实课堂内容质量继续保留外部/人工验收状态。

## 2026-09-12 R03–R17 续接验收

- R03 Core 调度修复已在独立配套 worktree 完成并固定为 `deda34d7523b5267602a5629027c367a91acaa7a`；`rhythm_heartbeat` 只把当前周期实际同步的候选传给 authoritative 列表，避免真实 238 项学期计划撞上 canonical work-candidate 200 项容量。另补齐后台 loopback 模型的 IPv6 `::1` 和 symlinked `node_modules` 运行时授权，并刷新运行时清单；205 项未来计划回归、节奏生命周期、Core live G1 与 Desktop bridge/manifest 检查通过。
- R03 管理中心现在显示与 Core 调度表对齐的下一次计划检查，并保留最近运行/失败摘要；纯显示计算有固定北京时间边界回归，未改变 Core 的实际调度权。
- R01/R03 冷启动读路径已延长只读 Core 请求窗口至 15 秒，覆盖打包 runtime 首次启动的实际耗时，避免首个状态请求在 runtime 尚未热起时提前报 process unavailable。
- 最终包冷启动序列复测：首次观察到的 `/api/edupi/status?summary=1` 响应在约 2.4 秒直接为 Core/projection `ready`，没有先返回 unavailable；工作区计数和 manifest pin 正确。
- R01/R02 追加打包隔离 E2：用临时数据根、临时 Pi 会话目录和最终 `EduPi.app` 启动 38471 实例，历史 `write` toolResult 补录返回 `registered=1, failedCount=0`，资源列表只含 `.edupi/output/package-e2.md`；临时实例关闭后正式包恢复为 ready，未写入教师数据。
- 冷启动修复后的全量 Desktop 回归为 1067 tests、1042 passed、0 failed、25 skipped，TypeScript 与 ESLint 继续通过。
- Desktop 配套修复已提交为 `50153d6`，R14 状态摘要优化提交为 `6712d50`；包含 bundled Core 根目录隔离、Core pin 同步、产物登记任务绑定、聊天文件刷新和 C1–C3 E2 admission 生命周期修正。
- 新配套 Desktop pin 的组件清单为 `sha256:b29eb3ef9a9133de6d0d3c6528197d9bd13359ab4bd6ecf75c9d675e0845ddb7`。C1/C2/C3 E2 均 GREEN：C1 为 1 observation/1 candidate/1 memory/2 receipts，C2 为 4 条教师上下文审核历史，C3 为 9 个工作候选/7 条工作审核回执；均覆盖重放、重启读回、过期快照或版本无写入、`external_send=false`。
- 最终 `deda34d7523b5267602a5629027c367a91acaa7a` pin 复跑的定向命令均通过：`EDUPI_CORE_ROOT=... npm run test:edupi-c1-e2`、`test:edupi-c2-e2`、`test:edupi-c3-e2`；C1/C2/C3 分别确认 canonical store、回放幂等、重启读回、过期快照/版本无写入，核心统计为 1/1/1、4 条上下文历史、9/7 条工作候选/回执，`external_send=false`。
- 最终 pin 下的 R09/R11/R13 定向回归也通过：记忆更新、学生资料与事件编辑/删除、实体删除、任务板直达完成、living-flow、教学能力五态、早安简报对象链接、持久后台任务均返回通过；仍未把开发隔离证据当作安装版或真实课堂质量验收。
- R04 课前准备 E2 通过 6 个课次、4 个 `draft_ready` 工作包、每包 4 份产物；chat-capture 与 living-flow 通过。C6 材料 intake/识别、任务板直接完成、记忆更新、学生资料/事件、实体删除 E2 也通过。任务历史现在保留真实审核回执，直接待处理→完成符合已确认的教师看板规则。
- R01/R02 隔离开发版真实 Agent 工具矩阵通过：同一 Session 通过 `write`、`bash`、`edupi_make_document` 生成 3 份文件，任务绑定后历史补录将 3 份文件全部关联同一 task；再次补录仍保持 3 条、无重复。安装版文件入口和真实页面冷启动仍待验收。
- R11/R13 本地 Core 生命周期和 Desktop 后台边界回归通过：教学方法 5 种生命周期、冻结 mutation/trial、发布方法读取与来源变更失效通过；后台任务取消/跨任务文件隔离/不可用产物不误报完成通过；方法反馈保存后页面显示回执状态。真实课堂效果、干净安装依赖和安装版恢复仍未验收。
- R13 隔离开发版真实后台任务再跑通：提交 `document` job 后 worker 从 queued→running→completed，生成并登记 1 份 `.docx` 产物，状态无 error、产物可定位；后台管理界面现在逐份列出同一任务的所有产物，可在 Tauri 中分别打开。安装版重启恢复仍待验收。
- R13/R16 Core live runtime 追加通过：`npm run test:core-runtime-live-model` 完整跑过隔离 SDK、父进程退出回收、取消/超时、生产 G1 备课产物读回、重放/重启、显式重试、来源失效和 artifact CAS；此前 symlinked `node_modules` 的权限误报已消除。该证据仍是隔离开发运行，不替代安装版恢复。
- R06 本地模型配置补齐无 API key 的 loopback 测试路径：隔离 mock 流式模型测试、真实 RPC Session prompt 均成功，外部 URL 仍拒绝无凭据；零 API 首次完整备课和安装版配置续接仍需单独验证。
- R06/R16 追加 IPv6 loopback：模型测试路由在 `http://[::1]` 上真实返回 OK，隔离后台 Host 与 Core 运行时清单同步允许 `::1`；外部 URL 仍要求凭据。零 API 首次完整备课和安装版配置续接仍需单独验证。
- R06/R13 材料识别兼容性已补齐：真实 C6 recognition E2 对模型省略可选 `end_date`/`notes` 的输出完成接入，3 个校历事件和 1 个课表项写入、3 个待确认校历保留、暂存清空；解析器仍拒绝未知字段。该项使用隔离开发数据，安装版和内容质量仍待验收。
- R06 最终打包路由补验：临时 localhost mock 模型通过最终 `EduPi.app` 的 `/api/models-config/test`，无 API key 返回 `ok=true`、HTTP 200、响应 `OK`；mock 服务和配置均已清理。
- R10 来源追溯界面已补齐一条可走通的入口：原始观察显示 Core provenance、可打开 C1 审核；学生学习/互动记录显示来源会话和原文，并可返回来源对话；混合本地记录与学生记录时分页会按本地行数预取服务端前缀，避免后页漏项。组件静态回归、TypeScript、ESLint 通过；浏览器实际点击、编辑后刷新同步和分页端到端仍待验收，故 R10 继续保持部分实现。
- R05 今天页对象跳转已收口：日程事项点击先建立对应校历对象，再进入日程详情；洞察点击带上真实类别与“已浮出”筛选，简报仍打开实际文件。组件回归、TypeScript、ESLint 通过；安装版原生点击仍受当前桌面自动化权限限制，R05 保持部分实现。
- 新打包 `EduPi.app` 冷启动首个状态请求约 8.3 秒；Core、教育投影、Kernel 均 ready，真实工作区为 50 名学生、9 个课表、43 个校历节点、237 个任务，原生窗口可见。构建未生成签名 updater，因为环境没有 `TAURI_SIGNING_PRIVATE_KEY`；未发布。
- R14 同机补测：工作台首页改用 `/api/edupi/status?summary=1`，新包冷启动到 summary 响应约 2.3 秒，响应体约 1.1KB；完整管理中心状态仍保留约 55.7KB、50 条 Kernel run。新包 Core/projection 仍 ready；这只是 macOS 本机基线，未替代 Windows 或浮层交互验收。
- 最新打包验收已切换到 Core `deda34d7523b5267602a5629027c367a91acaa7a` / Desktop component manifest `sha256:b29eb3…`：Tauri app bundle 构建完成，重启后原生 `EduPi` 窗口可见，38472 服务的 Core、projection、Kernel 均 ready，summary 响应 1066 字节；打包 JS 含 R05/R10 来源入口。updater 签名仍因缺少 `TAURI_SIGNING_PRIVATE_KEY` 未生成，未发布。
- R01/R02 安装版文件操作和简报对象的原生点击仍待验收；R03 真实休眠/唤醒和安装版定时补跑、R04 内容质量人工核对、R05 系统通知点击、R06 零 API 首次备课，以及 R12/R17 安装版/大班交互仍未勾为完成。R07 依用户确认跳过，R15/R16 外部账号与跨平台发布继续保留外部阻塞。

## 2026-09-11 桌面启动故障续接

本节的 Core pin、E2 状态和打包结果已由上方 2026-09-12 记录取代；以下保留故障定位过程。

- 桌面启动故障已复现并定位为三处配套漂移：开发启动脚本把默认旁路 `edupi` 数据目录误当成 Core 代码目录；被 `.gitignore` 忽略的 `src-tauri/resources/edupi-core` 仍是旧清单；Desktop 健康能力清单漏掉 Core 已提供的 `workspace-resources` 与 `generated-artifacts`。
- 已修复 `scripts/desktop-dev.mjs` 的默认根目录映射，默认数据根与锁定的 bundled Core 分离；显式 `EDUPI_CORE_ROOT` 仍保留为外部开发覆盖。已补启动根目录回归测试。
- 已用锁定 Core `1630ebcbf358b673379f67cfa6ec2525e0b43ba7` 重新生成本地桌面资源，组件清单哈希与 `contracts/edupi-core-compat.json` 的 `sha256:5a4d…` 一致；已补健康能力清单并加回归测试。
- 开发版实际重启后，`/api/edupi/workspace`、`/api/edupi/kernel`、`/api/edupi/platform`、`/api/edupi/memory-scopes` 连续返回 200；本地打包的 `EduPi.app` 通过 `open` 启动，内置服务监听 38472，原生窗口可见，以上四个接口及 `/api/edupi/status` 返回有效工作区/投影。
- 本地已生成 `EduPi.app`、DMG 和 updater tar.gz；构建末尾因当前环境未提供 `TAURI_SIGNING_PRIVATE_KEY` 未生成签名 updater 产物，未发布。Windows/Linux 实机安装与升级仍未验收。
- R01/R02 续接：产物登记在缺少显式 `task_id` 时现在读取 Desktop 任务会话绑定，并按 canonical data root 定位绑定索引；真实 Core 分进程测试验证了“绑定任务 → 登记文件 → 列表回读”的 `task_id` 保留，覆盖 macOS `/var` 与 `/private/var` 路径别名。聊天文件面板在 Agent 完成后自动刷新。普通工具完整矩阵、冷启动页面刷新和安装版文件入口仍待验收。
- R03/R04 配套 E2：聊天捕获、课前准备和 living-flow 隔离验证均通过，使用 Core `1630ebc`；课前准备覆盖 6 个课次、4 个 draft_ready 工作包和每包 4 份产物，聊天捕获为 1 条 observation/1 条 candidate。旧 C1 review E2 入口仍返回 `C1ReviewError(unavailable)`，不将其标为通过。

## 2026-09-10 续接

- R01/R02：历史补录漏掉仅在工具结果中返回路径的产物，已复现并修复。补录读取成功工具结果的实际路径，覆盖教学方法工具，排除失败及无关工具结果。7项定向检查全部通过，包含真实Core分进程登记、回读、重复补录去重；不代表普通工具完整矩阵或安装版已验收。
- R15：再次查询发布仓库，仍无EDUPI_CORE_READ_TOKEN，最新公开版仍v0.3.6；未发布新包。正式应用实际界面仍显示教育工作区503，开发修复未装入该版本。
- 系统通知：临时原生开发窗口加载隔离工作区并新增到期事项；通知中心未找到通知，系统UI查询超时，窗口恢复后的点击无变化。因此点击跳转未通过。临时应用已停止并移入废纸篓，正式应用未覆盖；本地开发服务恢复真实工作区。

## 最新验收状态 · 2026-09-09

### 新增：计划重叠与任务完成联动

- R04/R08：工作区显示AI重复计划/日期重叠建议，老师选择保留计划后合并备注；分别保留与忽略可持久化。先覆盖导入校历计划，不把正常每周课程合并掉。确认前校验来源未改变，合并部分失败可重试，不删除上传原文件。
- R08：允许待处理、进行中直接拖至已完成；完成后刷新与重启保持。人工完成仅更新工作进度，不伪造内容审核。
- R08：已确认工作自动反映在看板，较新的人工重开保持；对话提供正式任务状态工具，老师说已完成时可写回同一任务，生成候选与内容审核分开。
- 开发验收通过：页面待处理直接拖至完成、会话任务人工移回待处理、真实模型对话完成/重开、跨页面自动移列、真实模型重叠建议、页面合并中断后恢复、重启回读。Core `1630ebc`；细节见实际流程验收文档。分批/跨班/忽略/保留/并发变化另有定向行为测试。此项不代表历史路线图整体完成，安装版未更新。

### 已合并与当前限制

- Core #36/#39、Desktop #72/#75已合并。最新配套Core `8cad4b4`；Desktop合并提交 `dbb5b8e`。
- 本地30141已恢复为真实工作区的开发服务，237条任务、50名学生，workspace HTTP200。只读验证与开发服务没有改写教师任务或原文件；安装版仍是v0.3.6，尚未替换。
- 已追加实际验收：新手模型配置/重启、产物手动与AI修订/历史、课程备注重准备、学生事件到观察数据库联动、自动简报、完整资源包启动及Excel预览。细节见实际流程验收文档。
- 通知点击已有原生实现；macOS和Windows原生编译通过。临时macOS开发进程实际发起通知，但自动化无法定位系统通知条目，点击跳转仍未验收。QA程序已停止并移入废纸篓，测试凭据副本已清除，正式应用未覆盖。
- 新版远端完整构建缺少`EDUPI_CORE_READ_TOKEN`，因此未发布安装包。Windows公开v0.3.6在干净runner安装/启动通过，用户本机失败仍缺系统信息和错误日志。学校部署/其余连接器仍缺目标环境；自动能力演进仍受现有Core冻结规则约束。以上不标为完成。
- 最后继续检查原生通知入口时，工具明确返回Mac已锁定且不能自动解锁。后续原生界面验收需要用户解锁；不绕过锁屏。

通知历史诊断：原封装只发送聚合通知，没有对象点击回调。后续已使用底层平台库接出回调，未升级Rust最低版本；状态以上方最新记录为准。

### 2026-09-09 11:30 续接记录

后续取代：Core `182cd4e`、Desktop `708c47a` 加配套pin。产物手动正文修改、历史恢复、AI修订至第5版、重启回读及材料入口通过实际验收；生成来源变更后拒绝旧修订有生产回归。新Runtime早安简报漏接已修，干净目录启动自动生成且页面可打开；真实休眠/安装版仍待验收。运行日志中的重复signal listener定位到webpack重复加载proper-lockfile，改为server external；重启后的相关页面与接口未再出现该警告。

以下取代下文同项旧状态；完整操作见 `docs/acceptance/2026-09-08-live-workflows.md`。

- R03/R04：Core `00cbb93` 已接确认校历来源及未来任务手动准备。页面真实生成未来会议3份材料，课前任务4份材料；新摘录使旧产物和审核失效，重新生成后使用新来源。几何表格已正确展示，但学案仍有“相对面是否贴合”的内容错误，保持未审核，正在接正文修订和历史恢复。不能将生成成功记为教学质量全部通过。
- R09：受管记忆的对话写入、页面可见、新会话召回、删除及重启后不再召回已实测。class 仍遵循学生事件边界。
- R13：真实后台任务在 sleep 工具执行期间停止服务，重启后自动重新领取为第2次尝试，完成并登记文件，材料页打开“重启后恢复成功”。安装版恢复仍待验收。
- R06/R16：空模型目录中自定义URL、手填不公开模型名、测试、设默认、首次聊天与重启后再次聊天已完成页面验收；错误模型名可见失败，修正后成功。新手教程补上一步，教师资料保存后推进至学生名单步骤，重启续接位置正确。本地测试模型只证明配置链，首次真实备课、安装版及其他认证方式仍独立验收。
- Desktop #72、Core #36 保持实现PR；尚未发布或替换 `/Applications/EduPi.app` v0.3.6。

### 2026-09-09 运行接线进展

R03-a/b 已实现待完整页面验收。Core 生产入口支持准备、显式重试与取消；Desktop 已接私有模型进程。失败重试与已完成不重复生成测试通过。任务状态改为按 taskId 读取，避免等待其他任务；执行进程断开不再沿用旧运行状态。

隔离 localhost 模型服务验证命令：`EDUPI_CORE_ROOT=<Core 工作树> node --test lib/edupi-runtime-model-host.test.mjs scripts/runtime-model-host-files.test.mjs`，4 passed、0 skipped。包含实际 SDK 子进程、取消关闭连接、复制后的 Host 依赖执行；不代表外部教学模型、浏览器或安装版验收。

补充真实模型验证：使用隔离 agent 配置，通过 `createRuntimeModelHost.run` 生成方程 `2x+3=7` 的练习与答案，返回正确的减3、除2、代入检验及材料来源。此检查只证明私有 Host→模型→结果链，尚未经过 Core 入队和页面产物登记。

R01/R02 迁移欠项：Runtime 活跃时，聊天 `memory_write` 的新建/合并/取代目前无等价公开受管入口；`update_memory` 仅支持已有记录，不能替代。`memory_recall` 补向量也是隐式写入。需保留原语义并接入受管调用，验证重启回读和重复消息去重。学生学习/互动记录已有 `students.record_events` 路径；行为记录不能误映射成学习记录。

独立审查复现 Host 被强制结束后留下模型子进程，Core 正在补自身退出监控；修复与验证前不合并发布。最终配套版本尚未固定，完整材料→准备→跨模块产物及重启验收仍未完成。

后续取代：Core `b6ed874` 已修复孤儿进程与自身 deadline，退出及旧 G1 回归通过。Desktop 已配套启动受管 Runtime；实际打包闭包测试3 passed、0 skipped，尚未生成安装包。

实际页面材料验收：Word 上传后原先错用审核 target ID，造成预览缺失和摘录404；现按持久材料ID映射，Word正文已实际打开。重新上传带入数学/703，摘录通过页面确认并读回版本1。不支持Markdown上传现在明确提示支持的类型，不再误报服务故障。随后指定课前任务仍报 `stale_source`，该端到端流程继续保留未通过，正在定位来源匹配。

后续取代：Core `df17267` 修正精确材料范围及手动准备前同步。实际页面生成4份产物，任务与材料分别打开同一份练习，答案核对正确；重复点击不重复生成；升级依赖并重启后4份文件和教师/模型配置保留。仍待完成：几何图排版、更多教学质量样本、安装版恢复和自动通知；不整体勾完R03/R04。依赖审计已清零。

R16后台模型兼容欠项：当前私有Host仅支持API-key执行，OAuth与额外认证请求头明确返回不可用；本地模型地址尚未按用户配置实测。聊天可选择模型不能替代后台执行的供应商兼容验收。

R16后续：已修默认Host对本机可信配置localhost/127.0.0.1模型的支持，实际localhost SDK、取消及payload不能覆盖地址测试通过。零API页面配置流程、OAuth、额外认证头及IPv6仍未完成。

R02追加：Core f954af0下，真实GLM-5.2对话写偏好→教育记忆页面→新会话查询→对话删除→第三会话不再召回通过。四类受管记忆写入与只读查询已接入，class仍沿学生事件/fact体系；新记忆流程重启和安装版未验收。

R03改版发现：确认摘录新版本后，旧draft_ready仍可审核；新的排队事件又复用旧执行身份。该项已独立复现，正在修即时失效与重生成，未勾为完成。

### 新 Core 主分支整合

Core PR #37 已进入主分支，本轮 PR #36 正在合入。新增单一写入 Runtime 与 fact/capability 契约，evolution 写入入口冻结。整合前开发版实测保留为历史证据，不能直接认定新 Runtime 已通过同样流程。安装版尚未替换。

- R03/R04：生产 `prepare_task` 与私有模型执行通道尚未接通，旧 Desktop worker 不得取得绕过权限继续写 canonical 数据。沿 Core 读取任务/来源、持久化入队、lease 执行、提交前再次核验来源的路径实现。
- R03-a：Core 生产 factory 与 `prepare_task(task_id, expected_revision)`，独立于 deterministic test injection；复用已有 G1 live request/result，验证重复请求、失败、取消及来源变化。
- R03-b：NodeHost 私有模型通道，使用已配置默认模型，凭据只留在 Host/隔离模型进程；Core 保持提交权。没有活跃 Chat 也应执行。
- R03-c：Desktop 准备 API 和状态展示改走受管入口，Tauri 生命周期/恢复接线，重新跑真实材料→文件→跨模块验收。
- R11：冻结入口在桌面明确只读，旧方法正文/历史仍可查看；本轮不解除主分支的冻结政策。之前试用至晋级实测属于整合前版本。
- 合并检查：保持双方身份、删除、简报、审核修复与新 writer admission；契约镜像精确同步。未通过的 Runtime/安装验证继续保留，不因 Git 合并而勾选完成。

### 整合前开发版证据

R12/R17 身份兼容、学生删除及61人名单分页已完成开发版实测。教学页审核使用同一 Today 状态，接受、拒绝、再接受的页面往返通过。各项剩余条件按下表保留。

本节取代下方历史记录中的同项待验收描述。完整证据见 `../acceptance/2026-09-08-live-workflows.md`。环境为隔离数据的 macOS 开发版，未更新安装包。

| 范围 | 当前状态 | 已验证与剩余条件 |
| --- | --- | --- |
| 提醒续聊 | 部分验收通过 | 实际发送、绑定、离开返回、重启恢复通过；系统通知点击、精确日程提前量和安装版仍未验收 |
| 学生双网络 R12/R17 | 部分验收通过 | 同名独立选择、模型按 ID 记录、双节点图、转班、应用内删除确认、61人名单三页与筛选通过；大规模关系图与安装版未验收 |
| 首次对话 | 部分验收通过 | 已有模型配置首次发送、手填资料、教程续步、新对话直接读取资料、XLS/XLSX预览导入通过；零 API 新手流程仍待验收 |
| 简报提醒 | 部分验收通过 | 注入早上时钟实际生成简报，提醒打开正文、实际发送续聊、重启恢复通过；真实定时唤醒和系统通知仍待验收 |
| 材料驱动备课 | 部分验收通过 | Markdown/PPT 真实备课、材料改版和跨模块打开通过；PDF 本机文字提取通过；扫描件、跨平台 PDF 组件、广泛教学质量及安装版仍未验收 |
| 后台 R13 | 部分验收通过 | Word与中文OCR生成登记、Word页面预览、立即取消、开发进程恢复、双任务归属通过；干净安装OCR和安装版恢复仍待验收 |
| 教学方法 R11 | 部分验收通过 | 实际试用、评分、人工内容核对、测试审核、晋级重载、下一课采用方法、页面来源预览通过；错误候选拒绝留痕。方法修订失效已有存储回归，真实模型重备课和课堂效果未验收 |

定位并修复的实际问题：提醒首发后模板重新出现、跨日未处理提醒撤下、数据目录别名导致教育工具未加载、无历史会话无法初始化工作区、备课只拿到材料标题、模型 JSON 转义错误。未用这些局部修复替代 R01–R17 全部验收。

## 用户正式执行指令 — 2026-09-06

- R01–R17 正式启动，连续执行并逐 PR 记录证据。
- R07：用户确认飞书、钉钉已正式验收；本轮跳过，不重复验收。此状态依据用户反馈，不冒充本轮工具验证。
- R16 增补模型管理：保存 API 后在管理中心手动输入自定义模型名称/ID，选择默认使用模型，执行测试连接并显示结果。厂商不开放模型列表时也必须能完成配置，聊天选择器同步；先交付这项可独立实施的子 PR。
- 新增 R17：班级 → 学生详情直接可见两个可视化入口，分别为知识图谱与人际互动网络。展示该学生关联知识点、学习证据和同伴互动事件，可筛选学期/时间、点击查看来源；没有记录时提供添加记录入口。复用 R12 图数据，不能仅在其他页面有一个图就算完成。
- R01 状态：in_progress；正在追踪普通文件工具完成到 Core 登记及 Desktop 刷新的缺口。

### 当前实现与验收记录

班级证据贯穿修复：发现 heartbeat 会覆盖事件已保存的班级，现优先保留事件归属，仅旧记录沿用兼容推算。新增隔离测试从事件写入开始，再修改学生当前班级，验证原班备课保留旧事件、新班不误用。事件存储、班级证据、指定任务重放测试通过。学生记录页同步显示已记录班级；未把这项修复等同跨班同名支持完成。

连续实施追加：通知调用返回 attempted/skipped/failed，跳过或失败时按领取时间释放记录，过期释放不会覆盖新领取；测试通过。提醒续聊改用任务真实字段构造上下文，不再读取不存在的 summary。Core 新学生事件保存同班归属，跨班事件不强行归班，旧事件班级不随档案变化；事件存储与班级证据测试通过。Core 版本 4120676 已提交，配套桌面类型与测试通过。通知点击跳转经源码确认不能直接套用移动端 onAction，桌面原生接入仍未完成。

提醒追加验收：已接受、暂缓、拒绝、已完成或移除任务的提醒会撤下并保留历史，不再领取系统通知；列表每页 8 条。新提醒对话按任务保存独立草稿，普通工作区草稿保留，已有会话沿用会话草稿。隔离工作区接口测试通过：创建真实到期任务、提醒生成、重复读取去重、处理后持久化。936 项全测中 918 passed、18 skipped、0 failed；类型/lint 通过。未更新安装版，Windows 安装反馈仍待截图和环境信息。

用户新增：Windows 安装失败列入 R15，待复现和修复；每次公开发布后必须在旧桌面版本实测检测、下载、安装、重启和数据保留。详见 `2026-09-07-signed-updates.md`。当前继续功能实现，暂不构建新安装版。

提醒续聊追加：新会话创建后调用原任务会话接口进行绑定；失败保留对话并提供重试关联。手动新建对话清除旧提醒 task 参数，避免误关联。绑定请求和失败回归通过；全测 935 项，917 passed、18 skipped、0 failed，类型/lint 通过。真实发送后再从提醒返回同一会话尚需浏览器验收。

### Archify 图谱与执行进度

用户指定参考 https://github.com/tt-a1i/archify 。源码固定为 c6519401f7b91b9d43011657880893b0a8955548，MIT 许可。首批改编 assets/template.html 的 edge-flow 动画，用于学生选中记录的有限连线动画和真实运行状态指示；署名和许可证随桌面包分发，不安装全局技能，不向 Archify 发送数据。

已通过组件状态和减少动画测试；类型/lint 通过。未完成：浏览器动态验收、图谱缩放/聚焦增强、Pi 工具级事件节点。不得将有限连线动画视作已经移植整个 Archify 渲染器或完成学生网络数据闭环。

追加实现：图谱 75%–200% 缩放、复位、选中学生/知识点关联线聚焦；修复连线点击点硬编码宽度。Pi 动态状态接入 running_tools 的真实工具名，结束后隐藏。全测 934 项，916 passed、18 skipped、0 failed；类型检查通过。浏览器缩放与动态运行视觉验收尚未完成，未发布安装版。

#### 最新执行入口：2026-09-07，v0.3.6 后续闭环

### 主动提醒与续聊

用户补充：需要专门的提醒入口，AI 对话中也要显示主动提醒，老师可以接着聊。并入 R03/R05/R08，优先于其余界面调整。

交付范围：

- AI 对话固定显示“提醒”入口和未读数量；主导航可进入同一提醒列表。
- 提醒类型包括课前准备、日程临近、准备完成、执行失败和早安简报。每条关联真实任务、日程或产物，不把普通聊天回复当作提醒。
- 展开提醒显示事项、时间和必要摘要；提供“继续聊”“查看事项”“稍后提醒”“已处理”。
- “继续聊”优先进入该事项已有协作会话；没有会话时创建关联会话，自动带入教师和事项上下文，输入框留给老师填写，不自动发送空泛模板，不覆盖当前未发送草稿。
- 系统通知与应用内提醒共用持久化记录。系统通知失败仍能在列表找到；前台显示应用内提醒，后台按权限发送系统通知。
- 同一事件不重复创建，已读和已处理分开；重启保留状态。离线恢复补充未处理事项，避免重复弹出。
- 当前窗口内轮询不能保证应用彻底退出后通知；后台常驻或远端渠道另记运行条件，不能宣传全天提醒已支持。

验收条件：真实任务完成产生一条提醒；前台/后台各验证一次；点击继续聊能读到同一事项与教师上下文；老师回复后会话持久化；重启不丢提醒且不重复；拒绝系统通知权限仍可在应用内处理；稍后提醒按时间再次出现。

现状：已有任务完成/失败轮询和系统通知调用；尚无统一持久化提醒收件箱、未读状态及提醒续聊链路。设置“测试通知”已实现并通过类型/lint，未发布。不得把该按钮视作本功能完成。

本批进展：收件箱持久化、已读/已处理/一小时后提醒、完成/失败/今日到期事件、并发通知领取已实现。AppShell 全局轮询提醒记录，后台系统通知使用同一记录，旧完成监控只保留刷新，避免双重通知。通知领取仅表示尝试发送，不代表操作系统实际展示；系统通知失败时应用内记录仍保留。

浏览器实测读取 5 条真实提醒，展开后未读数减少；“继续聊”直接进入关联任务的聊天页面，保留已有未发送草稿、不自动发送，并显示事项标题。已有会话恢复和新会话后续绑定还需补验；当前未发送测试消息。931 项测试中 913 passed、18 skipped、0 failed，类型检查通过。

仍未完成：全局导航独立入口、日程精确时间提前量、早安简报提醒、系统通知点击返回事项、应用彻底退出后的提醒、安装版系统通知实测。新增提醒功能不因本批测试通过整体标完成。

后续浏览器验收：主导航“提醒”已加入，实测打开同一收件箱；“继续聊”已从任务执行页跳转修正为直接聊天页，事项标题可见，原未发送草稿保留。全局导航入口不再待实现。新会话发送后绑定、系统通知点击跳转、精确日程提前量及安装版通知仍待完成。当前 README 文件有其他并发改动，本批未纳入提交。

用户已确认连续完成剩余范围，不在每个 checkpoint 等待再次授权。当前分支 `codex/teaching-closure-next`。以下状态优先于下方历史记录。

- macOS 自动更新已真实完成并由用户验收，记录见 `2026-09-07-signed-updates.md`；Windows/Linux 仅构建与发布通过，尚无实机升级证据。原 R15 不整体勾完。
- 第一批：课前准备与内容质量。核对任务、课程、材料、班级证据关联；生成与教学审核分离；保留错误展开图答案作为回归案例。验收为真实材料可打开、答案复核正确、跨模块状态一致。
- 第二批：学生双网络。完成跨班同名并存、对话录入后图/表同步、编辑删除及时间筛选。仅用隔离测试档案验收，不向真实学生添加假记录。
- 第三批：日常操作。盘点资料/记忆/教学重点/日程/材料的手动修改、AI 协作、删除与历史；逐对象记录缺口及操作结果。
- 第四批：后台与新手闭环。图片 OCR、Word、PPT、取消重试与重启恢复；干净配置从 API 到首份材料。已有通过证据复用，不重复造界面。
- 第五批：成长和调度。方法试用反馈后复用、简报对象跳转、休眠唤醒补跑。真实课堂效果与自动化测试分别记录。
- 第六批：平台接入与发布。邮箱/云盘/教务和学校部署缺实际账号/目标环境；先完成可独立实现的配置与适配，不虚构已部署。R07 按用户验收跳过。
- 每批使用实现 PR 和验收记录；完成后更新安装包。未覆盖的条件保持未完成，不因已有界面或单元测试通过而勾选。
- 当前实现：[Desktop #72](https://github.com/PIGU-PPPgu/edupi-desktop/pull/72)、[Core #36](https://github.com/PIGU-PPPgu/edupi/pull/36)。课前任务旧产物只有核对清单/策略，没有教案学案；现改为本节教案、学生学案、练习与参考答案、材料准备清单。规划、学生证据筛选、指定任务重放测试通过。提示词明确学生学案不含私密观察、参考答案提供解题过程、不伪称读取未提供正文的材料；真实模型答案正确性仍待验收。
- 追加真实质量测试：会话 `01a07a4c-4d85-7a75-b842-ed75b9d54da4` 使用原默认 zai-coding-cn/glm-5.2、禁用工具，运行新版四份交付提示词和展开图回归题。持续生成但未输出正文，已主动 abort；结果为 inconclusive，不能记为质量通过。未修改默认模型或学生数据。固定样例见 `fixtures/education-quality/cube-net.json`。

#### 2026-09-07 集成检查点（优先于下方历史记录）

- 当前分支 `codex/closure-integration`；配套 Core `codex/r03-active-scheduler` 已推送至 `bf047b3`。尚未合并、发布或替换已安装的 v0.3.4。
- 配套集成草稿：[Core #34](https://github.com/PIGU-PPPgu/edupi/pull/34)。最新绑定版本的打包闭包测试 3/3 通过；以全新 agentDir 加载打包扩展测试 1/1 通过（6 个教育扩展）。`npm run security:audit` 通过 high 阈值，仍有 4 项 moderate，未声称零漏洞。
- 本次复跑：`npm test` 共 925 项，907 passed / 0 failed / 18 skipped；`node_modules/.bin/tsc --noEmit`、`npm run lint`、`git diff --check` 通过。跳过项不视为通过。
- 启动实测补抓动态路由 `[id]` / `[memoryId]` 冲突，已统一到原有 `[memoryId]` 并新增路由参数一致性测试。修复后服务可运行；再次全测 926 项，908 passed / 0 failed / 18 skipped，类型检查通过。
- R13 追加真实验收：`agent_job_1b92c57596d77d9b3ef460f32014f056` 从既有测试教案生成 Markdown 学案，状态 completed、error=null，自动登记 1 份文件。测试内容明确标注，不写学生观察或成长数据；该证据不替代 OCR 与安装版重启恢复验收。
- 上述学案内容复核失败：一排四面、上下附于第二面的展开图，相对面应为①/③、②/④、⑤/⑥；生成答案错误地给出②/⑥、③/⑤。仅交付与登记链路通过，教学正确性未通过。保留测试原文作为内容质量回归案例，不将后台 completed 等同教师审核通过。
- R01/R02：真实 write 会话已自动登记两份测试教案/学案；材料与会话文件入口可见。任务关联产物、历史成功写入补录、登记去重和软删除恢复已有回归。安装版冷启动仍待验收。
- R03/R04/R05：真实工作区异常执行记录已备份修复，原文件保留；课前准备一次返回 ready，2026-09-06 简报已生成并记入 Kernel。长期调度、休眠唤醒与升级后续跑仍待验证。
- R06：打包资源补齐 Core 扩展及内置技能；独立新配置加载测试在旧包失败、新测试包通过。最新集成包与完整首次配置流程仍待验证。
- R08/R09/R10：材料侧栏与主表共用数据；上传原文件路径接入；记忆手动编辑与历史恢复、学生记录筛选和知识点别名已接入。全对象编辑删除覆盖仍未全部验收。
- R11：方法草稿、试用输出、教师反馈接入真实存储。确定性生命周期测试通过；真实课堂效果及验证后复用仍未验收，不生成模拟成长证据。
- R12/R17：学生详情双网络、时间筛选、自适应布局及班级信息已接入。稳定 ID 保留有回归；跨班同名目前阻止覆盖，尚未完成同名并存。真实学生空图不得用虚构记录填充。
- R13：后台队列已接执行、取消、重试与失联恢复；真实 PPT 测试任务完成并登记文件。图片 OCR、文档任务和重启恢复的安装版闭环仍待验证。
- R14：资源验证缓存已实现；同一测试包暖检查约 82ms→59ms。该结果不代表整机冷启动提升；Windows 实机仍未验证。
- R16 模型：自定义模型测试实际返回 HTTP 200，教育工具通过会话模型运行有真实验证；原默认模型已恢复。邮箱、云盘、教务和学校部署仍缺目标账号/环境，不标完成。
- R07 按用户要求跳过；R15 签名、公证、升级与新版安装包未完成。下一入口：先验最新打包资源与尚未覆盖的闭环，再整理可审阅提交和 PR；不要从历史“待开始”重做已有实现。

- R01：Core [#33](https://github.com/PIGU-PPPgu/edupi/pull/33)、Desktop [#56](https://github.com/PIGU-PPPgu/edupi-desktop/pull/56)，草稿。去重/持久化/关联字段、独立 Core 进程登记后重新读取通过；真实对话、自动任务关联、重试和安装版仍待完成。
- R16 模型子项：Desktop [#58](https://github.com/PIGU-PPPgu/edupi-desktop/pull/58)，草稿。手动模型 ID、默认选择与配置入口已实现；9 项定向回归、类型与 ESLint 通过；浏览器点击已有自定义模型的测试，得到 HTTP 200 / OK。首次空配置全过程与安装版仍待验收。
- R17：Desktop [#57](https://github.com/PIGU-PPPgu/edupi-desktop/pull/57)，草稿。学生详情默认显示网络，提供知识图谱/人际互动网络切换；类型和 ESLint 通过；筛选与视觉验收待完成。
- 其他项目仍按原表待开始；R07 按用户反馈已验收，本轮跳过。以上草稿不改变 v0.3.4 已安装版本，也不代表整项完成。
- 真实工作区诊断新增：Core `buildEducationWorkspace` 成功，但 `buildSnapshotForState` 报 `invalid_state: state.executions[1].artifacts path is not deterministic for its task`，导致 workspace 返回 503。不得覆盖教师数据或简单放宽所有写入校验；先复现异常产物记录的读取影响，再补局部故障可见性与可恢复的迁移。此项与 R01 一起优先处理。
- 模型浏览器验收已得到 `已连接 · 5427ms · HTTP 200 · OK`，证明现有自定义模型测试入口可实际调用；尚未声称全新用户配置或默认模型切换已验收。
- R01 追加真实证据：只开放 write 工具的模型会话 `01a0759a-dbaa-700b-af2e-71741b9f870f` 自动生成两份标注测试的教案/学案，无手动登记和新建任务；Core 索引与材料页面均出现两条“对话生成”记录，预览入口可打开。工作区 503 的读取隔离修复使用真实原数据返回成功，浏览器今天页恢复。原执行记录保持未改写；写操作对原异常记录仍严格校验，后续需可恢复修复流程。

| 完成 | 新增编号 | 验收条件 | 实现 PR / 状态 |
| --- | --- | --- | --- |
| [x] | R17 学生详情双网络可视化 | 从班级点击学生即可找到知识图谱与人际网络；两种网络有真实来源、时间筛选、详情与空态录入入口；记录修订后同步 | 功能验收通过并已进入公开 `v0.3.17`；同名/转班、两种图网络、学期/时间筛选、关联详情、分页和大班图分层加载均有隔离页面证据，安装后的真实课堂数据复核归用户验收 |

用户已确认规划；本 PR 交付执行清单，不代表下列功能已完成。基线为 Desktop v0.3.4 / d74123d。

## 目标与状态规则

老师通过对话或文件交代工作，EduPi 结合教师、班级、学期与课程上下文提前准备；结果自动出现在任务、材料、日程和今天，老师可以打开、修改和确认。

下面 R01–R16 是稳定工作编号，不预占 GitHub PR 号码。开实现 PR 后在“实现 PR”列填真实链接；跨 Core/Desktop 的工作填两条链接。每个实现 PR 同步更新本表。代码合并、测试通过、真实运行验收分别记录；只有验收条件全部满足才勾选完成。需账号或部署环境的项目保留待验收，不能用模拟数据宣称上线。

## 已交付基线

- Desktop #48：数据源状态；#49：材料与已登记产物汇总；#50：审核决定收起与修改入口。
- Desktop #51：真实技能生命周期读取；#52：简报与 Kernel 状态展示；#53：抽屉关闭和桌面控制浮层调整；#54：v0.3.4 版本发布。
- 既有局部学生证据图和课前证据检索见 `2026-09-05-local-graph-preparation.md`；既有七步入门见 `2026-09-05-first-run-checkpoint.md`。
- 六层平台已有基础代码，见 `2026-09-03-six-stage-platform-foundations.md`。本计划补齐实际使用闭环，不重新实现所有基础。
- v0.3.4 抽屉最后一轮视觉验收因锁屏未完成；Windows 安装包构建通过，不代表 Windows 实机验收通过。
- 早安简报没有运行记录是待诊断现象，不能单独证明调度代码不存在或失效。

## 连续实现队列

| 完成 | 编号 / 拟用 PR 标题 | 本 PR 完成什么 | 验收条件 | 依赖 | 实现 PR / 状态 |
| --- | --- | --- | --- | --- | --- |
| [ ] | R01 fix(artifacts): 对话生成文件自动进入材料与任务 | 复现普通 write/bash/文档工具生成教案、学案后未登记的问题；沿实际工具完成路径接入 Core 产物登记，关联会话、任务、文件、已有任务和材料分类；无需老师再说“注册”。允许独立材料，不强制为每个文件新建任务。 | 对话生成教案和学案后材料页自动出现；有关联任务时任务可打开两份文件；重复保存不重复入库；刷新和冷启动仍在；登记失败显示可重试状态，不伪报成功。 | 无 | 部分验收通过；公开 `v0.3.14` 包的真实 write→Core 登记→重启去重与会话保持通过，安装后的原生文件入口待用户验收 |
| [ ] | R02 feat(files): 对话内文件入口与已有产物补录 | 对话结果显示文件卡片、预览、打开文件、所在文件夹、另存为；补录用户指定目录或已有会话中可确认的教育产物；源文件移动/删除后标记状态。 | 普通老师无需复制路径即可打开教案；历史文件补录可预览并去重；无关目录不被全盘扫描；上传文件与生成文件可区分。 | R01 | 部分验收通过；公开 `v0.3.14` 包重启后 read/meta 预览与历史补录去重通过，安装后的打开/所在文件夹/另存为待用户验收 |
| [ ] | R03 fix(scheduler): 安装版自动调度与重启恢复 | 核查 Kernel 实际启动、触发器启用、时区、休眠唤醒和任务执行入口；将早安简报、课表和校历准备接到真实执行器；显示下次运行和失败原因。 | 安装版在指定时间触发一次；重启/唤醒按规则补跑，不重复产物；失败可重试；运行记录能对应具体任务和文件。 | R01 | 部分验收通过；公开 `v0.3.17` 包连续 due-scan 与自然五分钟检查均不增加 13 个逻辑课次，Core #122/#123 停止重复失败，Desktop #134/#139 显示任务/原因/处理入口且不误报断连；待用户安装后做真实睡眠唤醒 |
| [ ] | R04 feat(teaching): 课程与校历提前准备闭环 | 教师口述/上传教学重点，结合课程、班级证据、材料和提前量生成备课工作；支持老师自建任务；修订来源后标记需更新。 | 一次导入课表和教学重点后，临近课次自动产出可打开教案/学案；今天、教学、日程、工作区显示同一任务与状态；缺材料有明确下一步。 | R01、R03 | 部分验收通过；自建任务已完成 Core 托管、去重、来源失效/恢复和双产物页面读回，公开 `v0.3.17` 包能显示 240 个真实任务及缺材料动作；真实课堂内容质量待用户验收 |
| [ ] | R05 feat(brief): 可操作早安简报 | 将真实当日课程、待确认事项、已准备材料和失败任务组织为简洁简报；历史可查看；如配置推送则记录渠道送达结果。 | 当日自动生成；日期正确；点击事项直接进入对象；旧简报不冒充今天；重复运行不重复推送；渠道发送遵循已配置授权。 | R03、R04 | 部分验收通过；日期/去重/续聊和对象路由通过，公开 `v0.3.17` 已包含 #136 的真实提醒点击测试路径；待用户点击系统通知并核对收件箱/任务跳转 |
| [ ] | R06 fix(onboarding): 首次配置到首次成功备课 | 补齐已有七步引导中的 API 获取链接、厂商/URL/模型配置、连接测试和错误定位；首次启动与手动重开均能续接；删冗余说明。 | 干净用户配置从无 API 到首次真实备课文件可打开；无效 key/URL/模型时能修正；跳过、返回、重启状态正确。 | R01 | 公开包 server 验收通过；真实 DeepSeek 从零配置到 4 份备课文件、打开、返回/跳过/两次重启续接均通过，#131 修复已进入 `v0.3.17`；待用户在原生壳验收首配 |
| [x] | R07 fix(connectors): 飞书钉钉真实收发验收 | 复核外链、机器人注册、权限模板、回调/长连接和多轮回复；可见连接状态、重连与测试入口。权限以供应商实际支持为准。 | 两平台分别完成配置、连续三轮回复、重启重连、文件接收及约定推送；记录真实回执；缺账号标待验收。 | R06 | 用户已验收；本轮跳过 |
| [x] | R08 refactor(workspace): 模块分工与共享对象联动 | 明确今天=当前行动、工作区=全部任务、教学=课程/重点/备课、观察=记录与洞察、成长=长期变化、材料=文件；统一对象详情与返回路径、数量和状态。 | 同一任务在各入口修改后同步；教学详情可回课程主页；删除/审核后计数一致；二级分类作为页面主标题；侧栏折叠保留图标。 | R01、R04 | 验收通过；Desktop #114 完成共享任务分类、搜索、状态与详情，Today 六种判断、人工重开、三入口同步、二级标题、返回路径和折叠导航均有实际页面与重启证据 |
| [x] | R09 feat(editing): 教育对象统一编辑删除与历史 | 盘点并补齐教师资料、偏好、记忆、学生记录、教学重点、日程、材料元信息的手动编辑/AI 协作/删除/历史入口；AI 模板提供明确输入位置。 | 每类对象完成保存、取消、删除、历史查看及支持对象的恢复；重启保持；改几个字不强制开 AI；变更传入后续协作上下文。 | R08 | 验收通过；Core #85/#90/#95/#97/#100/#101/#105 与 Desktop #108/#109/#110/#111/#112 完成统一删除、字段/对象版本、恢复、重启保持及后续备课同步，详见 2026-09-14/15 实际流程记录 |
| [x] | R10 feat(insights): 分类筛选与证据数据库 | 学期下按学生学习、教学、教师偏好等类别显示记忆；观察/洞察分层分类、筛选、分页、来源与详情；显示真实空/加载失败。 | 类别切换只显示该类；分页与筛选正确；对话新增记录可见；洞察可追溯到原始观察，编辑记录后视图同步。 | R08、R09 | 验收通过；Core #107–#110 与 Desktop #113 完成事实分类/状态筛选、来源追溯、审核、编辑、删除、分页恢复及学生/教学/洞察同步，详见 2026-09-15 实际流程记录 |
| [x] | R11 feat(growth): 教师成长与 EduPi 能力成长 | 教师成长展示真实教学实践、反馈和改进；EduPi 成长展示技能草稿/试用/验证/复用及证据，中文命名；接通生成与使用入口。 | 一次教学反馈产生可追溯成长记录；一种方法经历试用与验证后在后续备课复用；没有证据不填模拟成长；两类页面含一句必要定义。 | R04、R10 | 验收通过；Core #111 与 Desktop #115 完成受管方法生命周期、任务反馈成长、后续 G1 复用、修订失效、并发对账、重启保持和真实页面联动，隔离反馈不冒充课堂效果 |
| [x] | R12 feat(graph): 学生知识与互动网络扩展 | 扩展既有局部图：稳定学生身份与跨班同名处理、学期/时间筛选、知识点别名、记录来源、图与列表切换；互动关系保留事件含义。 | 同名学生不串档；对话记录后图中可见；修订/删除同步；多人同场事件不自动推断好友；较大班级数据可操作且可分页/分层加载。 | R09、R10 | 功能验收通过并已进入公开 `v0.3.17`；45条以上记录按20→40→45分层加载，节点聚焦、学期/时间筛选、互动事件语义、同名和61人分页均通过隔离页面证据，安装后的真实课堂数据复核由用户完成 |
| [ ] | R13 feat(background): OCR 文档 PPT 长任务交付 | 让现有后台队列实际执行 OCR/文档/PPT 任务，展示进度、取消、失败重试与恢复，并统一登记产物。 | 图片→可编辑文本、材料→教案、教案→PPT 各跑一次；重启恢复；文件可打开且内容可核对；失败不留“已完成”假状态。 | R01、R03 | 部分验收通过；公开包的干净隔离 OCR、正文核对、登记和重启保持通过，相关实现已发布到 `v0.3.17`；安装后的原生文件打开待用户验收 |
| [ ] | R14 perf(desktop): 启动性能与发布交互验收 | 测量冷启动、会话/模块切换，优化已确认瓶颈；验收关闭/Esc/焦点返回、拖动区域、响应布局；活动与记住动画绑定真实事件。 | 给出同机前后耗时；常用模块无卡死；浮层关闭无多层误关闭；动画运行/完成与真实状态一致；macOS 与 Windows 验收分别记录。 | R08–R13 | 部分验收通过；公开 `v0.3.13`/`v0.3.17` 同机基准中暖启动与页面/管理中心无性能回归，系统、自动运行、材料切换均低于 40ms；1280×720 交互通过，Tauri 原生窗口冷启动、拖动/焦点和 Windows 实机待用户验收 |
| [ ] | R15 feat(updates): 可验证安装升级 | 完善签名/公证与更新元信息，版本展示、检查/下载/安装及失败恢复；保留同一 Release 仓库与独立 Pi 配置。 | macOS/Windows 从旧版升级到新版；教师数据、API 设置与原 Pi 配置保留；更新失败可继续用旧版；无签名凭据则明确待完成，不能称静默更新已上线。 | R14 | 部分验收通过；macOS 已从 `v0.3.11` 应用内升级至 `v0.3.13` 且数据/模型配置保持，当前 `v0.3.13` 能检测正式 `v0.3.17`；本机安装和 Windows/Linux 应用内升级待验收，仓库缺全部 Apple 证书/公证 Secret |
| [ ] | R16 feat(platform): 其余连接器与学校部署 | 将邮箱、云盘、教务适配器逐个接入真实账号；基于既有 hosted/multi-harness 基础完成学校部署、身份与数据隔离、备份恢复、Harness 能力路由。实现时拆成有独立验收的子 PR，并在本行列出全部链接。 | 每个连接器至少一条真实数据闭环；两个学校隔离验证；备份恢复演练；两个 Harness 执行同类任务并回传同一产物格式；实际目标环境未提供则保留待部署状态。 | R07、R13、R15 | 部分实现；模型配置已实现；当前飞书/邮箱/教务/云盘未配置，钉钉仅凭据已验证，学校平台为 1 个本地租户、0 设备、1 Harness 且未达到 multi-harness，缺真实账号和目标部署环境 |

## R01 故障证据与实施边界

用户在 Desktop 中要求写教案和学案，AI 写文件后材料/教学入口未出现。AI 回复称“桌面端只认它自己注册过的产物……现在正式注册……再建一个教学任务”。该回复是故障线索，不是已证实根因。

先追踪：文件工具成功 → Core 产物登记 → 会话/任务关联 → workspace/material projection → Desktop 刷新。分别测试普通文件工具、后台准备 worker 和手动上传。复用 Core 现有存储和登记接口，不能再建立 Desktop 私有材料数据库。工具写入成功与材料登记成功分别记录；无法定位文件时不能靠助手文字宣布完成。禁止为解决显示问题批量创建无意义任务。

## 每个实现 PR 的交付记录

- 对应 R 编号、用户触发场景、修复后的行为。
- Core/Desktop 实际 PR 链接、必要的兼容版本更新。
- 验收条件逐项勾选，列出实际操作与结果；区分确定性测试、真实模型、安装版验证。
- 未完成条件、需要的账号/凭据/环境、下一入口。
- 回退方法与数据兼容说明，仅记录本变更实际需要的内容。

执行顺序先 R01–R05，再配置与模块收口；R06 可在产物接口稳定后提前。R16 为后续部署阶段，不阻塞本地教师版本。每完成一个 PR 更新本表和规划 PR 的状态；后续对话从本文件恢复。
