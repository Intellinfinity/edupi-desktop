# Pi 1 与暂缓草稿风险验收

状态：审核快照错配与工具选择丢失已修复，开发页面与 `.52` 签名候选核验通过；安装交互受辅助功能权限阻断。本机 stapler 联网复核仍失败，未计为通过。本文补充原 R01/R20/R22，不替代发布门。

## 基线

- 初始 Desktop `0972f4f`；v0.3.51 候选 `8fdd2a1a066a64308a04d50361cd73b769026941`；Core `fb2bb9f8caa1b9633ea9954ca8fdde168856754f`，Pi/PiDurable `1.0.2`。
- Core 快照修复 [#222](https://github.com/Intellinfinity/edupi/pull/222) 经 CI `37275916396` 通过后合并为 `a84590cbd62ada4f75fa10e109f0cdc07a13368e`。Desktop 精确 pin 和双组件摘要已同步，带真实 Core 根的合同/打包检查 15/15 通过、0 skipped，schema 与 SDK 版本不变。
- macOS arm64、Node 22.23.1。开发页面仅使用 `edupi-teacher-created-e2-RsDTcf` 合成根、703 班数学与本机确定性模型；没有向真实学生档案写入。
- 真实数据/配置只读基线：173 文件，SHA-256 `26b1fd1e114f39986a3bcc75d37ecfeb43d2d08d41534731374e3c0928a87f6a`。中途仅既有 `feishu-bridge.error.log` 内容变化，另 172 文件相同；不能称整个 173 文件摘要未变。脚本与逐文件摘要位于 `/private/tmp/edupi-pi1-acceptance-18lQMA`，偏好中的运行端口单独排除。
- 开发验收结束时，公开 `.45` 已于北京时间 15:58:31 启动，PID 80004；本任务没有启动该公开实例。之后摘要比对为 169 项一致，变动为提醒状态、飞书错误日志、`last-version.json` 与 `ui-prefs.json`。未据此宣称真实根全量无变化，未回滚这些变动；全部模型配置仍一致。证据为 `real-data-after-dev.json`。测试临时根已备份为该证据目录内的 `first-page-evidence`、`final-tools-page-evidence`、`held-fixed-page-evidence`、`dirty-held-page-evidence`，测试服务和浏览器均已退出。

## A1 历史拒绝与恢复

新 Core `fb2bb9f` 与旧 Core `00d05a1` 在真实隔离子进程、loopback HTTP 上完成六阶段演练：旧版两任务各四稿；新版本明确暂缓；旧版拒绝新账本；同根恢复旧备份；同根恢复完整新版备份。六个子进程均正常退出，复制或恢复前全部关闭句柄。

| 核对 | 实际结果 |
| --- | --- |
| 新字段被旧版读取 | `invalid_state`，整根 28 文件字节摘要不变 |
| 恢复旧版完整备份 | 8 稿可读，反馈、预算及领域文件与备份一致 |
| 恢复新版完整备份 | 有原始完成历史的 4 稿只读；缺历史的 4 稿仍 `stale_source`，原文件保留 |
| 拒绝写入 | 只读修订返回 `artifact_read_only` |
| 去重与预算 | 两任务 attempt=1、artifact revision=1；used=2、remaining=2；恢复期间无模型调用 |

恢复阶段 G1 已暂停，此证据不代表启用中的真实模型自动恢复。旧版仍不支持新字段，降级必须恢复升级前完整备份；新版备份另外保留升级后的数据，不删字段伪造兼容。

演练命令与脚本见 Core `scripts/test_a1_version_rollback.mjs --old-core <旧版树>` 和 `docs/loop/evidence/2026-10-05-a1-version-rollback.md`。原始证据：`/private/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/edupi-a1-rollback-NtzdJN/evidence.json`。

## 开发页面

从任务板打开同一任务，实际显示两份草稿。编辑检测卷，增加检验题并保存为 revision=2；填写暂缓意见并点击暂缓。随后从任务教学产物和材料列表分别打开同一 artifact，均看到相同修订正文及“只读”；编辑、保存、AI 修订入口消失。历史选择 revision=1 可查看原文，未提供恢复按钮。800×900 与 1440×900 无横向溢出，截图已人工查看。

- 页面证据：`output/playwright/pi1-a1-held-history-800.png`、`output/playwright/pi1-a1-materials-readonly-1440.png`。
- 实际缺陷：暂缓已写入一次、历史只有一条，但 `/api/edupi/education` 返回 `invalid_envelope`。Core 审核预览用新状态，产物读取却使用旧磁盘候选，造成回执 after-snapshot 与落盘后快照不一致。
- 复现证据：`edupi-a1-snapshot-repro-rFPbTN/evidence.json`；同一 after state 的 preview 无产物，persisted 有两份产物。修复后的 `edupi-a1-snapshot-repro-9wqyWq/evidence.json` 两者 snapshot hash 一致。
- 修复后使用新合成根 `edupi-teacher-created-e2-eGGYu7` 重新生成两稿，从真实页面填写审核意见并点击一次暂缓：POST 返回 200，页面显示已暂缓、审核历史 1 条，无失败提示；截图 `output/playwright/pi1-held-review-fixed.png`。再次打开检测卷是只读，直接修订负例返回 409 `artifact_read_only`，attempt=1、两稿 revision=1 均保持。
- 首次“编辑中遇暂缓”试验被开发热重载中断。代码稳定后在新根 `edupi-teacher-created-e2-bvTuBA` 重验：页面输入未保存文字，再通过实际 Core 审核 API 暂缓，页面点击保存收到 409，只读状态保留整段可复制输入，保存按钮消失；重新读取仍保留，只有明确点击“放弃修改”才清除，原产物未写入这段文字。截图 `output/playwright/pi1-held-dirty-preserved.png`；暂缓按钮本身已由上一项真实 UI 操作覆盖。
- Desktop 对无法核对的回执改为“审核结果未能确认，请刷新任务后核对”，提供只读刷新；不再保证“没有写入”，不自动重发审核。
- Pi 1 页面关闭工具后发送合成消息、服务重启后续聊、从第二条消息前分叉并在子会话发送、回原会话核对均通过。父会话 `01a10ad2-22c9-719b-a8d4-2b7b202e3bac`，子会话 `01a10af6-7921-7631-bbbe-f29f4bdf65aa`；父会话不含子消息，子会话不含被截去的第二条，截图 `output/playwright/pi1-fork-child.png`。这属于本地模型接线与开发页面证据。
- 同时发现原有工具选择持久化缺口：显式关闭在重启/空闲释放后恢复默认工具，分叉亦会丢失。修复将显式选择写入原会话 JSONL，资源加载前恢复，不另建状态库或改全局配置。两个导航入口完成后读取最新选择，避免导航中的关闭被旧值覆盖；只读工具选择不再自动多启用 PowerShell。
- 真 SDK 定向回归覆盖冷启动、分叉、两类导航与并发、保存失败停会话、坏偏好拒绝、教师背景恢复及全局配置不变。工具偏好最终 11/11、相关 Pi 会话组、TypeScript/lint 通过。独立复审发现的导航覆盖及背景遗漏均已修。
- 页面曾出现后端全部关闭但工具按钮显示默认，定位为初始 `get_tools` 晚到覆盖人工选择；两个修改入口失效旧读取，回归验证新读取仍可同步。修复后从 UI 选择关闭，实际停止/重启 Next/Core，再打开原会话，显示关闭，`get_tools` 活跃数组为 `[]`，原两轮对话保留；截图 `output/playwright/pi1-tools-disabled-after-restart.png`。没有持久化记录的旧会话仍沿用旧默认，无法倒推出过去的选择。

## G2 真实模型

独立隔离根、单合成教师/学生/班级、数学；模型 `zai-coding-cn/glm-5.3-flash`。证据代码仍绑定 `8fdd2a1`/`fb2bb9f`，属于 Core HTTP 与 Desktop 合同消费者层，未冒充 Desktop 页面或安装证据。

默认关闭及未授权入队拒绝通过。明确授予一次模型预算后，自然消息形成跟进草稿与 `next_step`；一次真实请求成功，execution completed、attempt=1。Desktop 消费者修改摘要和下一步，经真实 bridge 写回并重读 revision=2；synthetic 反馈 1 条，真人反馈 0 条。重复事件返回同一 execution；实际关闭重启及暂停授权后草稿、反馈、used=1 保持，模型未重跑。只读预算/执行投影前后账本字节相同。

原始证据：`/private/tmp/edupi-g2-real-final-20261005.AqEHIb/report.json` 与 `acceptance.md`。真实 settings/models/auth 三文件摘要不变，G3/G4 与新 Durable 试点未启用，外发为 false。

本轮共 3 次真实请求尝试：两次有效输出，一次 `model_unavailable`。首轮失败后 Core 自动重试成功，但演练脚本对调用次数的错误假设导致提前退出，且丢失内存控制身份，续跑被正确拒绝。该失败根原样保留；最终验收使用新根并封存 0600 恢复材料，没有重签旧授权。尚无首轮底层错误与计费用量，不武断归因网络；有限合成材料不能证明真人教学质量。

## 签名候选与门禁

- Desktop 本轮审核相关测试 17 项、公证与 workflow 测试 40 项、迟到工具读取回归通过；加入工具偏好修复后的最终全量 `npm test` 为 1941 通过、27 skipped、0 失败，skipped 不计验收。带 Core 根的合同/打包 15/15 另行通过。`tsc --noEmit --incremental false`、完整 lint及新增文件定向 lint、`npm run security:audit`、diff 检查通过，npm 审计 0 漏洞；lint 保留未修改 intake route 的 1 条 unused-import 警告。
- [PR #298](https://github.com/Intellinfinity/edupi-desktop/pull/298) 的版本元数据 CI `37267587024` 质量与 Rust 审计通过。
- 最终代码 `072f2fa` 的 PR CI `37281657664` 质量与 Rust 审计通过；#298 已合并为 `bffbd9198296ee1e15599c409c24e409c2b284e8`。macOS-only `.52` Draft CI `37281905644` 绑定该代码并成功，安装与签名结果在下方单列，不从合并推定通过。
- macOS-only [Draft CI 37267593584](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37267593584) 的编译、签名、包内运行、OCR/DOCX/OpenConnector、updater key 与公证提交通过；最终 App `stapler validate` 连接 CloudKit 报 `NSURLErrorDomain -1009`/exit 68，整次 CI 失败。
- Release `403389428` 保持 Draft，绑定 `8fdd2a1`。DMG asset `611680481` 预期 SHA-256 `231b27f36b9bb61fb2a59cebdc75f5c2f3d1b781a1c85134a37340ddb4067030`；首次本机下载中断且摘要不匹配，未安装该文件。
- 后续修复采用新版本 `.52`，不覆盖 `.51` 资产。公证校验仅对已观察到的 CloudKit `-1009` 最多重试三次，仍必须得到成功结果；票据错误立即失败。
- 唯一 `/Applications/EduPi.app` 仍是公开 `.45`。Orca 桌面控制两次实际返回 `permission_denied`，权限面板虽显示 granted，重试仍失败；已请求用户重新切换辅助功能授权。未绕过该拒绝，未改真实数据根或 launchd。
- 安装前对正在运行的 EduPi 再查：先返回 `window_not_found`，按工具指引尝试一次 `--restore-window` 后仍为 `permission_denied`。公开实例继续保留，尚未退出或替换安装；需要恢复 Orca Computer Use 的辅助功能访问才能执行安装交互验收。

## v0.3.52 实际资产核验

- Draft Release `403498252`，代码 `072f2fa8dcfd0618ae2391312f18dfd6ff82436e`。macOS CI 的 App/DMG 公证 Accepted、装订、严格签名、stapler 与 Gatekeeper 全部通过；签名后的包内服务、OCR/DOCX/OpenConnector 和 updater 公钥核验亦通过。仅 macOS 构建，三平台 draft-proof 与发布 manifest 步骤未执行。
- DMG asset `612017261`，208953199 字节，SHA-256 `ad416f27d16cee418f0b7d80aee65e8ee5a490cdd54db025c5abb4d188316087`。API 下载首次 TLS 连接超时，有限重试后成功；本机摘要完全匹配。App archive 与 `.sig` 的资产 ID 为 `612002677` / `612003050`，本轮仅记录远端摘要，没有本机 updater 安装验签演练。
- 只读挂载下载的 DMG 后，App 严格 `codesign --verify --deep --strict` 通过；App 与 DMG 的 `spctl --assess` 均 accepted，source 为 Notarized Developer ID。没有从挂载卷启动 App。
- `CFBundleShortVersionString` 与内嵌组件版本均为 `.52`；内嵌 compat 与源码逐项一致。按 bundled 模式核对 Core 文件闭包通过，Core 为 `a84590cbd62ada4f75fa10e109f0cdc07a13368e`、Pi/PiDurable 1.0.2、Desktop component 摘要 `e9db9a19be023e6c7c57d9079f199caaa5d7b9b5ebd229c8c2022563b9933c35`。本机记录为 `candidate-identity.json`。
- 本机对 App 与 DMG 运行 `xcrun stapler validate` 均因 Apple CloudKit TLS `NSURLErrorDomain -1200` 失败，exit 68。这不计通过，也不覆盖 CI 同资产的成功装订核验与本机 Gatekeeper 接受结果；未关闭证书校验或改系统网络设置。
- `.52` 留在 Draft。回读公开 Latest 与 raw feed 仍为 `.45`、7 个 updater 平台键；唯一 `/Applications/EduPi.app` 仍是运行中的公开 `.45`。下载包与证据保留于 `/private/tmp/edupi-pi1-acceptance-18lQMA`，挂载验证完成后卸载该卷。

Windows 安装继续延期。真实跨到期睡眠、真人价值、六领域 Live 和公开更新安装仍未通过，不由本轮合成验收代替。
