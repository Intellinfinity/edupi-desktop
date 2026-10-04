# 草稿编辑与失败恢复验收

## 状态

原任务 R01/R02/R04/R20，细项为[教师工作流计划 A3](../plans/2026-10-04-desktop-teacher-workflow.md)。实现提交 `023b5c2`，基线 Desktop `1e7c4df`；本记录只覆盖本批源码与隔离开发页面，不代表完整 A4、安装版或发布通过。

- Core main、compat pin 与实际服务均为 `22bf414c6715c312a62a04c1ed02d5fa5f51d1c8`，桥接 `edupi-bridge-v1.1`，12 个公开命令。
- Runtime IPC schema `sha256:8b4d701c64fd191019bee627eae7f9b2fbc533c0adbd41df4110ffc7719da9b8`；Runtime component manifest `sha256:4c21528e73509ccb5e6bf9876a5b75d1a5aca3aced2e4cf347c81ad3f1af469c`；Desktop component manifest `sha256:351d8fd6b02a3bf07cc037b9c6ba1c7ceaaf9e37f9b0fa665105c66b68dd7577`。本批未改 pin、合同、生成/外发许可或 Core 源码。
- macOS、Next.js 源码服务 `127.0.0.1:30151`、真实固定 Core 与确定性本地模型；仅合成 703 班数学数据。正式 `/Applications/EduPi.app` 与公开 feed 仍为 v0.3.45，本轮未启动或替换。

## 实现边界

编辑器复用现有 read/revise API。失败有明确重读入口，保存失败保留输入，不自动重交写入；读取 controller 同时约束旧读取和保存回包，切对象/卸载后的回包不更新新对象。预览只使用成功读回的 Core 产物路径。

父组件保存已打开产物的 ID 和标题，避免保存后文件路径变化或资源索引暂缺时退回普通文件预览。普通文件入口会清除该身份。该缓存不授予读取或修订权限，Core 仍作最终判定。

只增加编辑器内的布局样式，错误和恢复按钮放在同一行，主按钮复用既有样式。未添加依赖或通用状态框架。

## 页面逐项结果

目标任务 `teacher-task-22222222-2222-4222-8222-222222222222`；参考答案 `artifact_4197d12b922bc07bf8e07b67da69df1d`。

| 操作与预期 | 实际结果 | 状态 |
| --- | --- | --- |
| 任务打开参考答案、编辑并保存，Core 返回新正文/版本 | v1 → v2，显示 Core 新的 r2 路径及验算文字 | 通过 |
| 输入临时修改后取消，不新增版本 | 再进编辑仍为已保存 v2，取消文字未写入 | 通过 |
| 选择历史 v1 并恢复，保留旧历史 | Core 新建 v3，而非覆盖旧版本 | 通过 |
| v4 页面草稿遇另一入口已写 v5，旧保存应拒绝且保稿 | 同一真实 API 并发写 v5；UI 保存收到 409，输入保持，保存禁用且显示“重新读取版本” | 通过 |
| 明确重读后保留本地草稿，再由教师明确保存 | 版本选择器读回 v5，草稿仍在；再点保存成为 v6，Core 正文一致 | 通过 |
| 相同正文再次保存不得新增版本 | 仍为 v6 | 通过 |
| 首次读失败不渲染旧预览，重试恢复 | 仅对合成 localhost Fetch 注入一次 503；显示错误/重试，编辑与 AI 禁用；取消注入后点击重试读回 v6 | 通过 |
| 保存刷新时资源索引暂缺，仍保持受管对象 | 仅将一次 workspace 响应的 generatedArtifacts 置空；参考答案标题、Core 编辑器及 r6 正文保持；注入已清除 | 通过 |
| 切换普通文件，不能沿用上一份产物编辑身份 | 材料 → 早安简报 → 预览，读到 122B Markdown；受管编辑器和“编辑正文”均为 0 | 通过 |
| 服务停止并重启后再次读取同一对象 | 实际停止/重启 Next 与 Core，新页面再次打开同一任务，v6 及正文保持 | 通过，仅服务重启 |
| 800×900、1440×900 页面 | 窄窗完成冲突保稿/恢复/保存，宽窗验证读取失败与重试，操作区与正文可达 | 通过 |

早期冲突验证期间开发热更新重置过输入，该轮不作完整恢复证据；最终代码稳定后重新完成 v4 → v5 冲突 → v6 保存的完整步骤。

## 自动检查

- 编辑器 9 项行为测试通过；在内存回放旧实现时 7 项失败、2 项通过。覆盖取消后读取失败、普通保存失败不自动重交、旧请求切对象隔离及卸载后不回调，这些 VM 证据不冒充所有分支已人工操作。
- 42 项编辑器/审核/AI 入口/产物客户端与 API 相关测试通过；固定 Core 根验证 8/8 无跳过。
- 全量 `npm test`：1869 项，1843 通过、26 既有跳过、0 失败；后续标题缓存小修又通过 TypeScript 与针对文件 ESLint，最终全量由本 PR CI 校验。
- `node_modules/.bin/tsc --noEmit` 通过；`npm run lint` 无错误，保留既有 intake 路由 unused import 警告；`npm run security:audit` 为 0 漏洞；`npm run release:verify` 和 `git diff --check` 通过。
- 独立只读复审未发现 P1/P2。未改 Rust，不新增 Cargo/Windows 构建。

## 隔离脚本修复

`scripts/test-edupi-teacher-created-preparation-e2.mjs` 原夹具未创建独立状态目录、未显式授权 G1、手写 intake 状态不符合当前 Core。现改为规范课表导入、材料 staging/intake、默认关闭时 0 次模型调用、703/数学显式授权。本地模型只接受指定合成任务和确认材料；不是开放真实模型调用。

普通模式实际通过：2 产物、来源恢复后总计 2 次模型调用；重放不重做；材料字节变化的 preflight 错误在回读/重启后保持；课次移除仍拒绝授权；明确停用、重新导入和授权后才允许再次生成。`external_send=false`。来源变化后的重新生成与重复事件不重做分别记录。

可选 `--ui-checkpoint` 在完整负例前关闭脚本 Core，保留同一合成根和本地模型供页面使用；退出明确报告 `source_negative_checks=not_run`，不冒充普通模式完整通过。清理只涉及脚本自己的 mkdtemp 目录。

这些旧夹具问题不是本次证明的正式 App 故障；正式 Tauri 原本已创建私有状态目录。夹具中的 PDF 是合成占位字节，本轮不证明 PDF 渲染、OCR 或真实材料质量。

## 证据与未验

本机证据目录 `/tmp/edupi-editor-evidence-qhnj1b`：`conflict-final-800.png`、`read-failure-1440.png`、`index-gap-managed.png`、`ordinary-file-1440.png`、`unit-tests.log`。页面根由 `--ui-checkpoint` 生成，清理后不能把已删除的合成根当作保留的原始账本。

- A1 教师暂缓后的只读产物合同未实现；Desktop 没有绕过 Core held/来源/完整性检查。
- 完整 A4 从 UI 上传到生成、审核、续聊、反馈未在本轮走完；B–D 仍按计划逐项复核。
- 隔离源页面 `/api/models` 因默认 cwd 不在文件允许根返回 403；未放宽文件权限，本轮普通 Pi 对话未验。
- 本轮只重启源码服务，未重启 Tauri 安装版；新签名包、公网发布、Windows、真实跨到期睡眠、真人教学质量和六领域 Live 均未据此通过。
