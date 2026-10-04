# Desktop 教师工作流实施计划

**目标：** 老师在同一桌面流程中完成材料上传、提出要求、阅读和修改草稿、审核、续聊与再次找回，不需要理解 Core、Session 或内部错误码。

**架构：** 复用现有任务、材料、产物编辑器和对话参考卡片；Core 继续拥有对象、授权、版本和审核状态。Desktop 不增加第二份任务/材料数据库，不扫描 Core 输出目录补造列表，不把暂缓改写成接受。

**技术：** Tauri、Next.js、React、现有 Desktop/Core bridge。首批不引入新 UI 框架或 Office 编辑依赖。

进度唯一入口仍为 [产品闭环路线图](2026-09-06-product-closure-roadmap.md)。本文件细化原 R01/R02/R04/R13/R18/R19/R20/R21/R23，不替代原欠项，也不改变发布门。用户已同意此顺序，实施在当前任务继续，不再新开同分支对话。

**最新执行约束：** 用户要求验收统一放到最后。Pi 1.0.2/G2 适配已由 Desktop #296 合并，A1 由 #297 交付，当前精确配对 Core `fb2bb9f`，包含最新 #221；新 Durable 试点默认关闭。下文页面、E2、模型、安装与真人验收条件保留为待执行，不在实现过程中逐轮启动；必要单测、编译、复审与代码 CI 用于完成源码配对合并。

Core #217 当前为已实现待验收：pin/CAS、独立默认关闭的 G2 授权与模型通道、捕获消息入队、公开跟进摘要审核/反馈消费者均已写入；原 G1 权限与数据边界保持。实现和缺失的上游字段见[唯一账本最新条目](2026-09-06-product-closure-roadmap.md#2026-10-05-core-217-源码适配)。本阶段不合并为已验收能力，不触发签名包。

G2 的 `next_step`、剩余预算和执行记录已完成合同配对；原 #217 源码准备/Draft 边界由最新配对取代。A1 只读资格、正文权限与 Desktop 保稿已完成代码检查，安装验收仍独立待执行。[状态与证据](2026-09-06-product-closure-roadmap.md#2026-10-05-a1-暂缓草稿只读回看)。

## 基线与已知问题

- Desktop main `11c2c69`；当前工作树 `route1-core-a8fe471`，分支 `codex/route1-core-a8fe471-20260926`。保留所有既有改动，不 reset、clean、stash 或创建替代分支。
- 本日开始时 Core main 与 pin 为 `22bf414`；收尾回读已合并 #216 为 `17abf51`。已完成差异审查与精确 pin/两份组件清单更新，IPC/桥接/课次 schema 和 12 命令不变；[配对记录](../acceptance/2026-10-04-core-216-pairing.md)。原 A3/B 页面证据仍明确绑定 `22bf414`，不改写成新安装证据。
- 正式安装与公开 feed 为 v0.3.45；v0.3.50 仅是先前签名验收候选。10 月安全修复尚无新签名包，不能借用 .50 公证或安装证据。
- 已有官方 OpenConnector Console、常用设置直达、AI 参考卡片、输入草稿隔离和审核刷新入口。下一轮只修实际残余问题，不重复建这些能力。
- 已有安装证据：教师暂缓后，执行账本的四份草稿仍在，但 Core 不投影它们，正文 read 也拒绝；页面显示 0 项。只改 Desktop 不能完成安全回看。
- 当前源码另有数量不一致风险：`EduPiTaskDetailDrawer` 渲染 `preparedFiles`，标题却计数另一份 `taskArtifacts`。须用回归和页面复现后修复。
- 结构证据来自当前源码和既有验收记录；本轮 CodeGraph 工具不可用。静态阅读不算运行验收。

## 执行顺序

| 批次 | 原任务 | 交付 | 进入下一步的条件 |
| --- | --- | --- | --- |
| A | R01/R02/R04/R20 | 材料 → 草稿 → 修改 → 审核 → 找回 | 同一对象可回读；暂缓、过期、失败不伪报完成或清空文件 |
| B | R18/R20 | AI 协作入口复核 | 老师原话与参考分开，切换/返回/重载不覆盖、不串任务 |
| C | R19/R21 | 今天与提醒收敛 | 当前状态和唯一处理动作一致，同事项不重复打扰 |
| D | R18/R19 | 常用设置与管理中心 | 常用设置直接可达，重复入口和说明有实际删减，窄窗可用 |
| E | R01/R02/R13 | Office 产物呈现 | 先核实已有文件生成/预览/导出，再评估 Univer 的适用范围 |
| F | R23 | 连接器真实受控能力 | 一个明确服务的账号、授权、调用及 Core 回执完整；缺许可不放开 Action |

A–D 以同一 macOS 候选集中验收；不为每个按钮改动重新打包。E/F 必须分别确认兼容与许可边界，不将“有界面”计为能力完成。Windows 构建/安装/排查、远程手机和学校部署后置；Univer 暂不安装或接入，先完成 A–D。

## A：材料、草稿和审核

### A1 暂缓产物的 Core 只读合同

2026-10-05 源码已进入收口：独立 Core 读资格与 `access` 合同、Desktop 只读/保稿控制和针对性回归已实现；配对、代码 CI 和产品验收分别见[最新账本](2026-09-06-product-closure-roadmap.md#2026-10-05-a1-暂缓草稿只读回看)，下述验收条件仍保留。

**涉及文件：** Core `scripts/calendar_work_execution_store.mjs`、`scripts/preparation_artifacts.mjs`、`scripts/preparation_artifact_revision.mjs`、`scripts/calendar_work_case_projection.mjs`；Desktop `lib/edupi-generated-artifacts.ts`、`lib/edupi-preparation-artifact-client.ts`、`contracts/edupi-core-compat.json` 仅在需要配对时修改。

1. 用隔离已完成 execution 验证 pending → 教师 hold 后的列表和 read 拒绝，记录与自动 held/pending_review 的区别。
2. 将“能否继续执行/修订”与“能否查看已生成内容”分开设计。只读回看仍须通过现有对象身份、来源、版本、文件完整性和数据根验证；不改生成或外发许可。
3. 若现有 Core 合同不能表达，只提交必要的 Core 合同与行为测试；经复审和适用 CI 后，再更新 schema/Runtime manifest/Desktop manifest/compat pin。不得在 Desktop 直接读账本或用磁盘路径绕过。
4. Core 前置未就绪时，Desktop 如实显示暂缓/不可查看，不声称文件不存在；继续 A2/A3 与 B 的独立工作。

**已核对的安全边界：** 现有 `calendarWorkExecutionFingerprintForCandidate` 和 `readCandidate` 同时供生成/队列使用，不可把 held 加入可执行集合。新增资格只能用于 read/list，且必须由 Core 标识只读，Desktop 不显示保存/AI 修订动作。旧调度 `reconcileCalendarWorkExecutions` 会将 held execution 标为 stale，已有测试要求如此；历史回看需要区分“仅由教师暂缓造成的保留”与真正来源失效，不能放开所有 stale。现有 read 操作已是 bridge_read，无需新增 Runtime 操作；涉及的两份 component manifest 和精确 pin 仍须更新。

**验收：** 同一 execution 的已验证产物可只读回看；hold 状态、artifact revision、attempt 和模型调用数保持；候选 withdrawn、任务/来源删除、跨班、篡改及来源失效继续拒绝；未完成草稿和自动系统 hold 不获得同等许可；read 不产生写入、重生成或外发。保留现有 owner grant 停用/撤销后教师读取和手工修订有效旧草稿的能力，不把自动运行权限撤销等同于删除教师产物。

**验证：** Core 针对性测试、bridge 读回、Desktop 真实页面，再到 macOS 安装候选。仅文件存在、HTTP 200 或测试桩成功不能勾选本项。

### A2 任务各入口的产物数量和状态

**修改：** `components/EduPiTaskDetailDrawer.tsx`、`components/EduPiTaskStage.tsx`；必要时使用现有 `lib/edupi-workbench.ts`，不新增通用状态框架。

**测试：** `components/EduPiReviewGate.test.mjs`、任务详情对应回归文件。

1. 复现 generatedArtifacts/workCase 有文件但 legacy taskArtifacts 为空时的数量差异；覆盖重复 ID、文件失效、真正空列表。
2. 数量直接来自实际渲染的去重列表。暂缓/加载失败与真正没有产物分别呈现，不用假 0 掩盖状态。
3. 在任务详情、任务产物、材料入口打开同一文件；返回原任务，不能串到另一份草稿。

**验收：** 数量与列表一致；不可用文件不能打开；审核门不因修显示而放宽；800×900、1440×900 无裁切，鼠标、Tab、Escape 均可操作。

### A3 阅读、修改、冲突和取消

**修改：** `components/EduPiPreparationArtifactEditor.tsx`、`lib/edupi-preparation-artifact-client.ts`，仅必要时修改父组件 `components/EduPiEducationPanel.tsx`。

**测试：** `components/EduPiPreparationArtifactEditor.test.mjs`、`app/api/edupi/preparation-artifact/route.test.mjs`。

1. 页面复核读取中、读取失败、编辑、取消、保存成功、版本冲突、历史恢复和切换产物。
2. 保存成功须校验 Core 回读的 artifact ID、内容和 revision；失败保留教师草稿，不自动再次提交。
3. 旧请求不能覆盖新对象或老师正在修改的内容；取消不新增版本；从任务和材料重新打开均读到同一修订。

**验收：** 输入保留、保存反馈清楚、版本冲突可恢复；离开再进及重启后内容一致；只对实际复现的问题改代码，不重做已经通过的历史功能。

### A4 首批完整用户流程

使用新的隔离数据根，单教师、单班、数学。上传一份明确标记的测试材料，从 UI 确认材料和要求，生成草稿、阅读、修改、审核、续聊，再从材料/任务入口找回同一对象。使用确定性本地模型验证接线；真实教学正确性另记，不把合成反馈计为真人价值。

复用 `scripts/test-route1-packaged-loop.mjs` 和 `scripts/test-edupi-teacher-created-preparation-e2.mjs` 的已知安全设置；需要留存页面环境时只加最小参数，不复制整套测试框架。不改真实数据根、launchd、时钟、能源设置或现有安装版。

## B：AI 协作入口

**复核文件：** `components/AppShell.tsx`、`components/EduPiEducationPanel.tsx`、`components/EduPiMaterialsWorkspace.tsx`、`components/EduPiPreparationArtifactEditor.tsx`、`lib/edupi-composer-context.ts`、`lib/draft-store.ts`。

**测试：** `components/EduPiEditableAiPrompts.test.mjs`、`lib/edupi-composer-context.test.mjs` 及已有草稿/任务绑定回归。

- 按任务、材料、产物、学生、教师信息入口逐个实际点开；不以源码里存在 context 卡片为验收。
- 老师要求留在输入框，对象事实放在可查看、可移除的参考里；已有文字/附件时不自动覆盖或混入另一任务。
- 连续走“旧草稿 → 新事项 → 自己输入 → 发送 → 返回 → 再进入”，回读同一 Session 和对象；发送失败及切换中途不丢稿。

**完成条件：** 所列入口都明确记录通过/失败/不适用；只修失败项。已有三点菜单、停止图标与附件加号不重新设计，除非实测有缺陷。

## C：今天与提醒

**复核文件：** `components/EduPiTodayWork.tsx`、`components/EduPiReminderInbox.tsx`、`lib/edupi-work-case.ts`、`hooks/useEduPiReminderNotifications.ts`；沿用各自测试和验收记录。

- 待教师决定、运行中、失败、已完成、暂缓分开；卡片动作取自当前 Core 状态。
- 同一任务在多个入口保持对象身份，重复刷新/送达不新增一条提醒或重跑任务。
- 失败能直接回到材料、模型或当前任务的处理入口；技术详情按需展开，不把日志代码放在默认页面。

**完成条件：** 点击、处理、返回后的列表状态同步；加载/失败不显示空列表；通知失败仍可站内处理。真实跨到期睡眠仍是单独欠项，不借本批 UI 通过补勾。

## D：设置和管理中心

**复核文件：** `components/AppSettings.tsx`、`components/EduPiAdminPanel.tsx`、`components/JevSettingsCard.tsx`、`components/UpdateProxySettingsCard.tsx`、`components/OpenConnectorAdminPanel.tsx`。

- 从主工作台直接进入外观、模型、代理等常用设置；先记录点击路径，再删多余中间页，不凭模块数盲目合并。
- 教师日常资源留在工作流，运行诊断/权限明细收进管理入口；同一个设置只保留一个编辑源。
- JEV API/URL 继续独立配置，不进入对话模型列表；OpenConnector 复用官方 Console，未开放的连接/执行明确保留状态。

**完成条件：** 保存后立即回读且重启保持；取消不写入；800×900 可见主要动作，无重复说明和横向溢出；不改用户现有模型、7897 代理和连接器开关。

## E/F 后续能力边界

- Office：先列出现有 DOCX/PPTX/XLSX 生成、原生打开、预览与导出各自的真实支持。Univer 要独立核对当前许可、格式互操作、离线资产、体积和编辑回写，再决定最小嵌入；不把某一种编辑器推断成全部 Office 能力。
- 连接器：先选一个明确的读取操作跑通“老师授权 → 参数确认 → 受管调用 → Core 回执 → 页面结果”。真实账号/授权缺失时列具体缺项，不解除默认拒绝，也不自动对外发送。

## 验证与交付规则

每个子项分别记录：源码实现、开发页面、包内服务、签名安装、公开发布；不能用同一个“完成”覆盖五种状态。

1. 修改前用最小行为测试或页面操作复现；修改后跑受影响测试。全量检查在批次收口执行，已通过且未受后续改动影响的证据复用。
2. 代码门：`npm test`、`node_modules/.bin/tsc --noEmit`、`npm run lint`、`npm run security:audit`、`git diff --check`。只因 Core pin/manifest 变化才增加相应合同/组件清单验证；Rust 修改才扩大 Cargo 测试。
3. UI 门：完整操作结果、失败分支、对象写后读回、返回位置、800×900/1440×900、键盘关闭和焦点。仅 SSR 渲染、mock 或 HTTP 成功不算完整用户流程。
4. 合并前做精简与安全复审，提交现有 `codex/` 分支，PR/CI 完成后合并；不同时开第二个写入同一模块的任务。
5. A–D 源码与页面验证完成后，进入原 R22 安装阶段才集中做新的 macOS 签名候选；本轮源码/UI 阶段不自动触发打包或替换安装。安装阶段沿用已有授权和安全边界，不覆盖旧 Draft 资产；使用新版本号、准确 Core 身份和隔离根，唯一 `/Applications/EduPi.app`，保留公开版并验后恢复。发布仍遵守原门，不因本计划取消未验项。
6. 不让 Windows 或手机端阻塞 A–D 的源码/页面优化，也不声称它们已经验收。没有新的实证不重跑旧睡眠课次，不重新启动旧心跳。

## 当前进度

| 子项 | 状态 | 证据或下一步 |
| --- | --- | --- |
| 基线、历史去重与 Core pin | 已实现待验收 | Core #217 `00d05a1`；两份清单与 CAS 更新，schema/12 命令不变；本轮只做最小合同/静态检查，运行验收后置 |
| Core G2 适配 | 已实现待验收 | 独立授权与模型通道、捕获后入队、follow_up 摘要/审核/反馈；默认关闭、仅隔离非 Windows，缺失字段不猜测 |
| A1 暂缓只读合同 | 部分分析，未实现 | 已定位 Core 列表/read 的 candidate 状态门；安全合同与测试仍待实施 |
| A2 数量/状态 | 部分实现与组件验收通过 | 三项回归先失败后通过；最小修复使数量来自实际去重列表，35 项相关测试通过；完整跨入口与暂缓状态仍待验 |
| A3 编辑与恢复 | 核心源码与开发页面验收通过，未安装 | `023b5c2`；真实 Core 修改/取消/历史恢复/409 保稿重读重存/503 重试/服务重启读回，800×900 与 1440×900；[逐项证据](../acceptance/2026-10-04-preparation-editor-recovery.md) |
| A4 首批完整流程 | 部分验证 | 隔离脚本的规范导入、默认关闭、授权、生成/去重与来源失效恢复已通过；本轮未从 UI 上传一直走完审核、续聊和反馈 |
| B 协作入口 | 部分页面验收与修复 | `ae8b42f` 修复准备状态抢走协作入口、内部层级条和工具图标遮字；材料/任务/产物三个入口已实际发送、会话回读，学生/教师信息及失败恢复仍未完整验收 |
| C–D 提醒、设置 | 待逐项页面复核 | 不以旧版本通过替代本轮改动验收；只修实际缺口 |
| E/F Office 与连接器 | 后续批次 | A–D 后核定范围和许可，不提前引入依赖或开放执行 |
| 新签名安装与发布 | 未执行 | 不复用 .50 的旧签名安装证据 |

### 2026-10-04 首个修复证据

- 交付跟踪：[Desktop PR #293](https://github.com/Intellinfinity/edupi-desktop/pull/293)，实现提交 `4e28e63707a110977d9f56330733f026b8919308`；[GitHub CI 37175608089](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37175608089) 固定该代码提交。后续仅文档变动不改变代码验证对象。
- 环境：macOS，当前 Desktop 源码，现有 Next.js 开发服务的临时隔离组件页；只加载真实 `EduPiTaskDetailDrawer` 和应用样式，输入为合成 fixture，不连接 Core 或真实教师数据，不运行正式 App。
- 复现：两份 Core work-case 文件、空旧 deliverables 时，标题错误显示 0 项；另一个去重后 3 项的 fixture 错显为计划交付的 1 项。旧单文件回退另有“已有打开入口却仍显示空状态”的问题，已一起修正。三个新增行为测试均先失败，修改后通过，相关 35 项测试 0 失败、0 跳过。
- 页面：在 800×900 打开详情，标题 2 项与教案/学案列表一致；选择教案回传同一合成路径，Escape 后焦点回到入口。模拟教案不可用后该按钮禁用、学案仍可用，数量保持 2 项；末尾按钮 Tab 回到关闭按钮。800×900 与 1440×900 均无横向溢出，页面控制台 error/warn 为 0。
- 证据：`/tmp/edupi-teacher-workflow-ui.dyfuQ4/task-details-800.png`、`task-details-1440.png`。临时验收页已移除，不进入正式构建。该页面没有验证 Core 写回、文件正文、安装版或暂缓只读合同，不能据此完成 A1/A4。
