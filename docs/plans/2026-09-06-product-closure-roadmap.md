# EduPi 产品闭环 PR 路线图

## 2026-09-16 下一轮 Core 中心桌面优化

界面继续以 Core 对象、状态和可执行动作组织。图标只替代含义明确的直接动作，并始终保留 tooltip、ARIA 名称、键盘操作和必要的数量/状态；教学对象、权限模式、模型状态、错误原因及不可逆后果继续使用文字。

| 编号 | 范围 | 验收条件 | 当前状态 |
| --- | --- | --- | --- |
| R18 | 桌面动作语言与布局：统一对话、模块标题、抽屉和工具条中的图标、徽标、悬浮说明与焦点状态，删除重复文字并消除浮层争位 | 1458px 与 800px 视口无重叠；可用 Escape/Tab；图标动作有可访问名称；页面无失败请求或脚本错误 | 第一批已合并至 Desktop #146：对话文件与已删除入口共享右上角空间；新建对话、对话/文件切换、发送、复制、从此处编辑和新会话改为图标 |
| R19 | Core 行动入口：把任务失败、材料缺失、模型不可用、权限和 Runtime 状态投影成同一套教师语言与下一步，不在页面暴露内部 code | 每类失败都能从当前对象进入唯一处理入口；恢复后原页面同步；技术详情按需展开 | #129、#134、#139 已覆盖任务与 Runtime 基础；Desktop #149 将后台任务的 Core 原因映射成教师语言，模型/材料失败进入唯一处理入口，内部 code 仅通过信息图标按需展开；三种失败投影和两条恢复入口已在隔离真实页面通过，继续覆盖权限和连接器 |
| R20 | Core 对象连续性：对话、今天、工作区、教学、日程、材料、学生与成长使用稳定对象身份、来源和返回位置 | 从任一入口编辑/审核/删除/恢复后其他入口读取同一结果；会话与产物不串任务；返回原位置 | Desktop #147 让今天、教学、日程侧栏和日程网格共用校历/课表 Core ID，并让材料详情写入对象路由；Desktop #148 用最新 Core 任务快照恢复产物预览前的任务详情，关闭与 Escape 均通过隔离真实页面验收；继续核对其余跨入口返回链 |
| R21 | 主动运行生命周期：通知、睡眠唤醒、后台任务、重启恢复和完全访问都由 Core run/receipt 驱动 | 同一触发只运行一次；通知点击回到对象；睡眠/重启补跑不重复；失败可重试并保留证据 | 公开包与隔离恢复已通过，等待安装版通知/睡眠验收后继续修实机问题 |
| R22 | 发布、迁移与部署：单实例原位更新、数据/模型/权限迁移、跨平台安装和学校环境 | macOS/Windows/Linux 旧版升级后对象与配置保持；稳定签名/公证；多租户、设备、备份恢复和连接器真实闭环 | updater 已发布；Apple 身份、Windows/Linux 实机及学校账号/设备为外部阻塞 |

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
