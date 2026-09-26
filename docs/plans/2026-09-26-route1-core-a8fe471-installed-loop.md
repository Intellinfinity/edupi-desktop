# Route 1: Core a8fe471 Installed Proactive Loop

**Goal:** 在单教师、单班、单学科的隔离安装版里，证明可信事件到内部草稿、提醒、续聊、审核及 Core 反馈的连续流程，并保持真实教师根和 launchd 不变。

**Architecture:** 继续使用 Core 唯一状态、现有 G1 Live 处理器、队列和持久回执；Desktop 只负责受限启动、原生通知、会话导航与教师表单。通过独立 `codex/route1-core-a8fe471-20260926` Desktop 工作树和 detached Core `a8fe471` 检出执行。G2/G3/G4 只在隔离 canary 按 Core permit 运行；G5 及未证实材料/课次/学期关系一律 hold。

**Stack:** Next.js 16 / React 19、Tauri 2、Node 22、Core runtime v1、GitHub Actions macOS/Windows。

## 基线和选择

- Desktop `main` 起点 `9ff46e58e2adf07030d91bdd0e711a42c220cc9c`，原工作树干净；Core 主工作树有未提交改动，不作为打包来源。Core 目标 `a8fe4711419fe3f36a19fd342e17abe33a7825b9` 包含 #192 功能与 #193 文档。
- Core Runtime schema `sha256:9c8c287a8d8eeaea2905fb83b64742a5841e664d766cfa58b0791bf17caf88dc`、bridge v1.1 与课次 v1.2 schema 均未变；Core Runtime component hash 为 `sha256:844eebaf4339062f0189df2af66762152780db043c8ea0b6baefa45fb118c851`，Desktop component hash 为 `sha256:8092bd3d10af41683433e87e6a06d0da4d9fdc2e83a631eb1b9e59c267486bf7`。
- 采用可信、具有 canonical class ID 的隔离课次/任务事件做主验收。普通对话 capture 保留现有回归，但不以未持久重试的消息镜像冒充本次到期闭环。
- 不增加第二个 scheduler 或队列。包内 host 已用 factory 注入 G1 Live；先复现“WebView 不参与时是否仍自动启动”，若失败则在 packaged server 启动路径做一次有界、自校验的 Core ensure，交给 Core 自身定时器处理睡眠后补跑。不得通过 Core CLI 环境变量开放 Live。
- 通知点击优先进入同一任务的续聊流程，保持普通草稿和已绑定会话；失败回到提醒工作台。审核后由教师明确填写现有价值反馈表单，再用当前 revision/fingerprint 写入 Core，不把通知 delivery 当审核。

## 实现顺序

1. **精确配对。** 先在 `contracts/edupi-core-compat.json` 的现有测试中加 a8 pin/manifest 断言并看红；仅更新 commit、两份 component hash 和配对 PR，保留 schema/fixture/supported command。运行 `npm run test:release-tools`、`npm run test:staged-desktop-runtime` 的精确 Core 资源校验；不读取脏 Core 主工作树打包。
2. **G1 包内后台启动与复跑。** 用 `desktop/core-runtime-host.test.mjs`、`scripts/test-staged-desktop-runtime.mjs` 和新增隔离模型桩测试先证明无 WebView 冷启动缺口及重复 `ensure/prepare_due` 不新增产物；必要时修改 `desktop/server-launcher.cjs`，仅在包内受验证 server 就绪后有界启动 Core，失败保留可诊断状态，不新增独立任务调度。验收跨到期时刻、重启与重复事件时读回同一 Core work case/artifact/receipt。
3. **通知状态与点击续聊。** 在 `lib/edupi-reminder-store.test.mjs`、`hooks/useEduPiReminderNotifications.test.mjs`、`components/AppShell` 定向测试中先复现重复/迟到失败回调和点击未续聊；调整 claim attempt 绑定与 Windows 原生送达确认，通知失败保留站内提醒。点击目标复用 `continueReminder`，验证普通草稿不丢、旧会话复用、新会话绑定、重入不串任务。
4. **教师审核与 Core 反馈。** 使用 `components/EduPiTodayWork.tsx` 已有评价合同，补任务/提醒路径的明确入口；先为错误 revision、取消、重试和反馈重放写测试。隔离浏览器与安装版完成草稿打开、教师接受/调整/拒绝、价值反馈填写和 Core `teacher_feedback_target_read` → `teacher_feedback_record` 回读；synthetic 反馈不得计入真人价值。
5. **隔离安装验收。** `scripts/test-packaged-background-recovery.mjs` 与新 route-1 fixture 只写临时数据/agent/state，使用本机 loopback 合成模型，`external_send=false`。macOS 用独立 bundle identifier 的可安装 canary，不搬动真实 App config；Windows 用干净 runner 安装 NSIS。分别记录冷启、托盘隐藏/恢复、真实跨到期睡眠（若宿主拒绝，保留失败证据而不写通过）、重启、通知拒绝/失败与系统点击、重复事件无二次模型/产物、教师数据保留。安装版 UI 与 Core 后置回读必须是同一隔离对象。
6. **发布门禁与账本。** 全量 `npm test`、TypeScript、lint、audit、Cargo locked metadata/tests、staged Core/模型/通知 E2、macOS/Windows 安装包 CI 与独立复审；开 PR、等待 CI、合并。将逐项实际结果及代码 commit、操作、预期/实际、证据路径、未验条件写回 `docs/plans/2026-09-06-product-closure-roadmap.md`、`docs/plans/2026-09-07-signed-updates.md` 与一份路线 1 验收记录。合并不等于安装或真人价值通过。

## 验收状态表

| 条件 | macOS 隔离安装 | Windows 隔离安装 | 边界 |
| --- | --- | --- | --- |
| 冷启后 G1 active 且 G2/G3 默认 pending | 未验 | 未验 | Core schema/manifest 先配对 |
| 单班单科可信事件 → 到期一次 → 内部草稿/回执 | 未验 | 未验 | 未核实材料不得作为已验证来源 |
| 托盘后台、跨到期睡眠、重启补跑且无重复执行 | 未验 | 未验 | 进程 SIGSTOP 不等于系统睡眠 |
| 系统通知失败可站内恢复，点击直接续聊 | 源码/持久层已实现，安装未验 | 源码/持久层已实现，安装未验 | 点击须精确到同一 reminder/task；Windows Toast 实际回调待验 |
| 教师审核后反馈写回 Core、重读与重放 | 未验 | 未验 | delivery receipt 不代替 feedback |
| G2/G3/G4 canary permit 与 G5/material/归属 hold | Core 单元已过，安装未验 | Core 单元已过，安装未验 | 默认关闭、无外发 |
| Core Runtime Windows 原生盘证明 | 不适用 | a8 源码固定返回 `native_attestation_required` | 不绕过；需要新 Core 合同或如实记阻塞 |
| 真实教师根、配置、launchd 未修改 | 过程核对中 | 不适用 | 使用独立工作树与隔离数据 |
