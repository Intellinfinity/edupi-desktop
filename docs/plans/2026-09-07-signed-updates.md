# 自动下载安装

## 2026-09-24 v0.3.40 公开发布与本机原位升级

- 正式 run [`35993787607`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35993787607) 的 Linux、Windows、macOS、公证/装订和 manifest 全部成功；公开 Release [`v0.3.40`](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.40) 含 11 项资产和 7 个签名平台键，Core 固定 `68004b2`，三条 feed SHA-256 均为 `b3605f88…`。
- Linux [`35998790991`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35998790991) 公网安装通过；Windows [`35998805393`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35998805393) 的公网安装和 diagnose 全绿。公开 DMG 经 7897 下载并核对摘要、版本、严格签名和 Gatekeeper 公证。本机 v0.3.39 已经持久化 7897 完成原位下载、验签、安装和自动重启；Core、51/240/43/9、五份配置摘要保持，Today 4+27 / 4+8 及展开收起通过。完整边界见 [v0.3.40 验收](../acceptance/2026-09-24-v0.3.40-signed-release.md)。

## 2026-09-24 v0.3.39 公开发布与本机原位升级

- 正式 run [`35979258168`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35979258168) 在 `acd7ae4` 上完成 Linux、Windows、macOS、公证/装订和 manifest；公开 Release [`v0.3.39`](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.39) 含 11 项资产和 7 个签名平台键，Core 固定 `68004b2`，三条 feed SHA-256 均为 `758e0d10…`。
- Linux [`35984248531`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35984248531) 公开干净安装通过；Windows 首轮 public install 通过，diagnose 的 Core 字节恢复漏项由 #258 修复，完整重跑 [`35986226781`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35986226781) 全绿。本机后来由 v0.3.37 经原生更新到 v0.3.39、自动重启，同路径 Core/投影/Kernel ready，51/240/43/9、模型/认证/设置和桌面偏好摘要保持，唯一安装副本签名有效；完整过程边界见 [v0.3.39 验收](../acceptance/2026-09-24-v0.3.39-signed-release.md)。

## 2026-09-24 更新代理一次保存（macOS 全链通过，跨平台待验）

- 桌面设置可保存本机 HTTP 更新代理，例如 `http://127.0.0.1:7897`；配置在独立原生文件中持久化，不写 `ui-prefs.json` 的教师数据根。Tauri 签名更新的清单/资产和 `/api/updates` 的 GitHub Release 查询均使用它，后者只设置单请求 dispatcher，不影响 Core 或模型网络。设置后立即刷新版本；并发旧结果不可覆盖新结果。缺失配置沿用系统网络，损坏配置 fail closed，可显式恢复系统网络。
- 隔离代理 CONNECT、失败缓存/重试、800×900 页面、Rust/TypeScript 门禁、`35973703981` 预览、`35976790629` Windows 编译和 v0.3.39 正式构建已有证据，见 [更新代理验收](../acceptance/2026-09-24-update-proxy.md)。macOS 安装版已保存 7897，退出重启回读、Release 检查、Tauri 清单/资产下载、验签、覆盖安装与自动重启均通过；第一次到 2% 中断，第二次成功。Windows/Linux 实机仍待验。
- v0.3.38 及更早版本不含此设置；本机首次取得 v0.3.39 已走旧更新链路。保存后的代理只会影响后续检查与版本升级，不对旧包提供追溯能力。

## 2026-09-24 v0.3.38 公开发布与公网安装

- 正式 run [`35967579321`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35967579321) 在 `8871a1b` 上完成 macOS、Windows、Linux 与 manifest；Release [`v0.3.38`](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.38) 当时为公开 Latest，非草稿/非预发布，11 项资产、7 个签名平台键，Core 固定 `68004b2`。`latest.json` SHA-256 为 `eadbc4db…`，公开 DMG 为 `f58462f5…`。
- macOS runner 的签名 packaged runtime、updater key、公证、staple 和 Gatekeeper 通过；独立下载 DMG 后挂载的 `.app` 同样为有效严格签名、`Notarized Developer ID`、stapled ticket。本机 `stapler validate` 仍因 Apple CloudKit TLS `-1200` 无结论，不覆盖 runner 和 Gatekeeper 的成功证据。
- 首轮 Linux [`35972371818`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35972371818) 与 Windows [`35972383389`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35972383389) 公网 smoke 在进入应用前因稀疏 checkout 缺开发包 `jiti` 失败。[#250](https://github.com/Intellinfinity/edupi-desktop/pull/250) 合并 `f7349df` 后，公开 smoke 不再依赖 `node_modules`；Linux [`35973841908`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35973841908) 与 Windows [`35973841420`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35973841420) 已对未改变的 v0.3.38 资产完成安装、目录和 Core/原生检查。完整边界见 [v0.3.38 验收](../acceptance/2026-09-24-v0.3.38-signed-release.md)。
- 本机未单独执行 v0.3.37→v0.3.38；后来直接完成 v0.3.37→v0.3.39 原位升级，旧 v0.3.37 `.app` 有独立临时备份。干净公网安装仍不替代 Windows/Linux 旧版原位升级。
- Desktop 旧 PR #71/#74 已关闭为 superseded；依赖 PR #32 的目标版本已由当前锁文件提供并关闭。三者均未重新合并到 v0.3.38 主线。

## 2026-09-24 教师价值与漏报反馈（已发布，待真人）

- 教师反馈现可记录真实使用、复用意愿和成对时间，并能从管理中心报告六领域漏报；隔离 Core 写入/重放/汇总与 360 像素组件浏览器验收通过，工程数据不计入真人价值。
- v0.3.38 已包含该表单和 Core 合同；macOS/Windows/Linux 签名安装版的实际评价/漏报提交与重启回读仍未执行。Tauri Next dev WebView 的既有 React interop 失败使开发窗口无结论，不能由静态浏览器 harness 或发布构建替代真人操作。

## 2026-09-24 R23 未受管 Action 隔离（已发布）

- 环境变量不再能向生产 AgentSession 注册 OpenConnector Action 工具；runtime/admin token 在扩展加载前从服务端环境清除。Provider 默认目录只读，执行、连接管理和审计回读均在网络前拒绝，旧副作用路径只允许隔离合同测试显式开启。
- 此改动已进入 v0.3.38；签名构建与公开安装保持只读 catalog host 的 Action/proxy 全阻断，生产 Agent 不再暴露旧工具。Core grant/Receipt 和受管 runtime 未实现，R23 继续部分实现，不能以“目录可查”冒充“Action 可执行”。

## 2026-09-24 v0.3.37 公开发布与本机原位升级

- 修复版 run [`35932154000`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35932154000) 的 macOS、Linux、Windows 和 manifest 全部成功；正式 Release `395131181` 非草稿、11 项资产，Raw feed 为 `0.3.37`、7 个签名平台键、清单 SHA-256 `bed10e86…`。Linux 和 Windows 公开安装启动分别由 `35936781815`、`35936813172` 验收通过。
- macOS 公开 DMG 的独立下载摘要与 Release 相同，本机 Gatekeeper 为 `Notarized Developer ID`；runner 两次 Apple submission 均 Accepted，应用与 DMG 的装订验证通过。本机 `stapler validate` 因 CloudKit TLS `-1200` 无结论。已安装的 0.3.36 从原生设置页点击更新，随后同路径变为 0.3.37、进程 `86147 → 22116`，Core `68004b2` ready、51/240/43/9 教师数据和三份模型/认证/设置摘要保持；中途锁屏使进度各阶段未逐帧可见。完整证据见 [v0.3.37 验收](../acceptance/2026-09-24-v0.3.37-signed-release.md)。

## 2026-09-24 v0.3.37 首轮 Linux 构建失败（历史，已由上节取代）

- Desktop 已将版本元数据、组件清单、Cargo 锁文件和 Release 说明同步为 `0.3.37`；目标 Core 固定 `68004b2`，包含 AI 协作自由输入、OCR、逐项日程/课表来源配对与默认关闭的 G1 试用。`release:verify`、Cargo metadata 和 40 项发布合同测试通过；首轮三平台构建未全绿，公证、公开资产及应用内升级不能记为通过。
- R23 OpenConnector 本次只合入授权止血，受管 runtime、Core grant/Receipt 与同用户 shell 隔离仍未完成；不能把这个包称为 R23 交付。下方 v0.3.36 是当前公开 Latest，待新版发布与安装验收后才改变该状态。

首轮正式 run [`35928743275`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35928743275) 建立绑定 `973babc` 的 v0.3.37 草稿；Linux 在 `linuxdeploy` 扫描 staged server 的 `@napi-rs/canvas-linux-x64-musl` 时因 glibc runner 上 `ldd` 返回 1 而失败。Windows 成功，macOS 在 DMG 公证期间随失败 run 取消，manifest 未运行。原来只移除 musl Sharp；Desktop [#241](https://github.com/Intellinfinity/edupi-desktop/pull/241) 将同平台的 musl Canvas 一并从 glibc 安装包剔除，保留 gnu 版本，定向测试、本地全量门禁和独立复审通过。旧草稿 `395112944` 经核对为未公开、仅含原提交 5 项资产且无 tag 后已删除；公开 feed 保持 v0.3.36。新 run [`35932154000`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35932154000) 在精确修复提交 `d16f9d6` 上完成 Linux 和 Windows build；macOS 签名构建完成，DMG 公证进行中。manifest、公开资产和安装验收仍未通过。

## 2026-09-24 课表来源别名与 Core `68004b2` staged 验收（未发布）

- Core [#182](https://github.com/Intellinfinity/edupi/pull/182) / [#184](https://github.com/Intellinfinity/edupi/pull/184) 已合并，Desktop `0f2c75d` 固定 `68004b2` 并通过真实隔离 Core 的纯课表、跨文件别名、教师选源增量、重复回放、旧材料删除和并发删除 CAS 流程。macOS staged bundle 的 Core/投影/Kernel ready，新课表来源 API 为 200/no-store，离线 OCR 与 DOCX smoke 均通过；详见 [课表来源别名验收](../acceptance/2026-09-24-l4-timetable-source-alias.md)。
- Release 的非 Windows 配对运行时步骤和 preview 打包前检查现都运行 `test:edupi-slot-alias-e2`；Windows 保留精确 bundle/manifest 门禁，安装版启动仍需 Windows 实机验收。`release-workflows.test.mjs` 与 `actionlint` 均核对新增步骤。
- 本批尚未生成签名/公证安装包，也未执行旧版应用内升级。公开 Latest 仍是 v0.3.36/Core `860594a…`；源码与 staged 结果不等于正式三平台安装验收。

## 2026-09-24 G1 主动运行与删除传播配对（开发验收，未发布）

- Desktop [#233](https://github.com/Intellinfinity/edupi-desktop/pull/233) 已合并为 `a3def0aa3a8f4b2655d04e50007ef4fe0c62b2cf`，[#235](https://github.com/Intellinfinity/edupi-desktop/pull/235) 的未授权领域即时 tombstone 已合并为 `e47bcca6cb18fa8feeb403dd2520a7d1a4515a6b`。此 G1 checkpoint 当时固定 Core [#183](https://github.com/Intellinfinity/edupi/pull/183) merge `26fc91ef656877b15ca3e60f14093cf52ea7b736`、Desktop/Runtime manifest `sha256:9c019d02…` / `sha256:85c6a8da…`；当前唯一配对 pin 已由上方 `68004b2` 取代。默认仍关闭；单班单科显式 canary 的期限、预算和 `external_send=false` 不变。
- Core/ Desktop 已覆盖串行启停与 stale CAS、停止失败栅栏、grant 到期、未授权领域即时 tombstone、多个普通课次共享材料、自然请求/修订/取消、反馈回读及 synthetic 排除、两阶段无正文 message ledger、会话删除前来源撤回、停止后撤回、active Goal/队列/草稿级联失效和 capture-crash pending 恢复。真实 merge Core E2 与 staged runtime 通过。
- Desktop 全量为 1673 tests，1647 passed / 26 skipped / 0 failed；TypeScript、lint、audit、actionlint、staged Desktop/feedback/occurrence/conflict/ICS/OCR/DOCX、Core closure 3/3 和 model host 2/2 通过。
- 后续 v0.3.37 已正式发布并安装。macOS 同一签名 `.app` 使用隔离 data/config/agent 目录实际完成 G1 启用、Core active、停止和重启后保持 disabled；状态始终 `external_send=false`。恢复真实 config 后 Core `68004b2`、Projection/Kernel 与 51/240/43/9 保持。Windows/Linux G1 原生 UI、真实睡眠、通知点击、Windows 旧版原位升级、真实模型内容、正式盲测和教师试用保持 Unverified，整体仍为“L4 功能收敛中”。

## 2026-09-24 同名多项逐项配对 staged 验收（未发布）

- Desktop `b029a45` 的教师逐项配对、Core CAS 和保留原事项身份已在隔离 Core/打包页面验收；签名后的 macOS 包新增 DOCX 提取 smoke，Release/preview 的三平台 staged 构建也需运行它。详情见 [逐项配对验收](../acceptance/2026-09-24-l4-document-pairing.md)。
- 当前没有包含该提交的正式安装包；公开 Latest 仍为 v0.3.36。macOS 签名公证与升级、Windows/Linux 安装版、真实老师材料和最终冲突决议仍需正式验收。

## 2026-09-24 扫描材料 OCR staged 验收（未发布）

- Desktop `77e88f8` 将离线 OCR/PDF 运行依赖纳入三平台打包准备，Release/preview 在打包后用真实图片与图片版 PDF 执行 OCR smoke；macOS 签名后的 bundle 也增加同一 smoke。固定 Core `c1edefd…` 的隔离 OCR→日程 E2 与 macOS staged server/Core 回读通过，详细边界见 [验收记录](../acceptance/2026-09-24-l4-scanned-material-ocr.md)。
- 尚无包含该提交的正式 Release。公开 Latest 仍是 v0.3.36；签名/公证后的 macOS 包、Windows/Linux 安装包及旧客户端应用内升级必须在正式发布时另验，不能用 staged 结果替代。

## 2026-09-23 文档同名 occurrence 配对（开发验收，未发布）

- [Desktop #229](https://github.com/Intellinfinity/edupi-desktop/pull/229) 的提交 `082648e` 支持同一 PDF/DOCX 的多条同名同类事项：完整语义 variant ref、exact duplicate 折叠、旧 singleton 保持、精确优先与剩余 1:1 配对。单项变化沿用原 ID，由 Core 按 revision/conflict 规则处理；日期或时段变化进入 held/conflict，多项变化不猜测。
- pre-typed inferred legacy 可在同字节证明下升级为 typed held；foreign legacy 同 anchor、deleted sibling 复活和确认内容漂移继续 fail closed。真实 DOCX E2、1521 passed / 26 skipped / 0 failed、TypeScript、lint、audit、packaged build、staged runtime 与独立复审通过。
- 本节未生成或安装正式 Release；公开 Latest 仍为 v0.3.36/Core `860594a…`。多项同时变化的逐项 UI、slot alias、可信 OCR、安装版、盲测和真人价值继续留在 Unverified。

## 2026-09-23 文档 evidence alias 与删除传播配对（开发验收，未发布）

- [Core #177](https://github.com/Intellinfinity/edupi/pull/177) 合并为 `c1edefd2a2b77e3d10dfc9f0a47eceb7b5f7b1de`；[Desktop #228](https://github.com/Intellinfinity/edupi-desktop/pull/228) 的提交 `3b7f1e5` 固定该 Core，并为 H2→H 精确重放恢复 Core-owned alias。自动恢复要求当前 accepted material hash 证明；删除状态、残留混合 evidence、slot 和歧义来源不会静默绑定。
- 真实 DOCX route E2 完成同哈希双副本删除、全部隐藏、明确恢复和恢复后 alias；全量 1519 passed / 26 skipped / 0 failed，staged Desktop/ICS/occurrence/feedback 与 bundle/model-host 8/8 通过。`proactivity=disabled`、`external_send=false`。
- 本节没有生成正式安装包；公开 Latest 仍为 v0.3.36/Core `860594a…`。重复同名同类事项的单项变化已由上方 #229 收敛；多项同时变化、slot alias、可信 OCR、正式安装、盲测和真实教师价值继续留在 Unverified。

## 2026-09-23 文档日程跨修订来源配对（开发验收，未发布）

- [Desktop #226](https://github.com/Intellinfinity/edupi-desktop/pull/226) 的提交 `0f9ec30`、`f255674`、`bd10438` 把 PDF/DOCX 修订绑定 Core logical source 和 occurrence，补跨格式去重、legacy/filename issuer 接管、教师确认防降级、omission 保留、tombstone 恢复与真实 route POST；详细边界和证据见 [验收记录](../acceptance/2026-09-23-document-schedule-revision-source.md)。
- 本节没有生成正式安装包；公开 Latest 仍为 v0.3.36/Core `860594a…`。source-hash alias 已由上方 #177/#228 收敛；重复同名同类事项、slot alias、图片/扫描 PDF、正式三平台安装及应用内升级仍需后续交付。

## 2026-09-23 文本日程证据配对（开发验收，未发布）

- [Desktop #225](https://github.com/Intellinfinity/edupi-desktop/pull/225) 的提交 `fe53b51` 让文本 PDF/DOCX 仅在原文可证明完整 typed time/location 时进入 Core v1.2，并新增真实 DOCX E2 与 release gate；packaged symlink worktree 同时补齐 `undici` 外部依赖闭包。证据见 [验收记录](../acceptance/2026-09-23-text-schedule-evidence.md)。
- 本节没有生成正式安装包；公开 Latest 仍为 v0.3.36/Core `860594a…`，三平台签名、公证、公开安装和后续应用内升级仍需单独执行。

## 2026-09-23 非 ICS 日程来源身份（开发配对，未发布）

- [Desktop #223](https://github.com/Intellinfinity/edupi-desktop/pull/223) 的提交 `c8cb6f0` 让 PDF、图片和 Word 的 schedule issuer 以校验后的内容 SHA-256 为准；同字节改名稳定、同名不同字节隔离。该项没有生成安装包，详细边界见 [验收记录](../acceptance/2026-09-23-document-schedule-content-identity.md)。
- 公开 Latest 仍为 v0.3.36/Core `860594a…`；下个正式包仍需重跑三平台构建、签名、公证、安装与应用内升级，不能用源码测试替代。

## 2026-09-23 ICS 来源收敛开发配对（未发布）

- 当前开发分支已固定 Core `b2c2bb809d4c4f8c09af7bc0e2741c025985dd3e`，[Desktop #222](https://github.com/Intellinfinity/edupi-desktop/pull/222) 以提交 `e097865`、`1e4c2c8`、`1402691`、`ee71640` 完成严格 ICS 暂存、确定性解析、来源 CAS、单次/整组取消、循环系列替换、精确重放和 tombstone 恢复防护。
- `desktop:prepare`、staged uploaded-calendar/occurrence/conflict/feedback/desktop、bundle closure 3/3 和 model host 2/2 均通过；packaged 页面在隔离数据根实际完成首次导入和来源更新，console error/warn 为 0。验收详见 [上传 ICS 日历来源收敛验收](../acceptance/2026-09-23-uploaded-calendar-source-sync.md)。
- 本节不改变公开更新状态：Latest 仍是 v0.3.36/Core `860594a…`。包含 Core `b2c2bb8` 的正式三平台构建、签名、公证、公开安装和应用内升级尚未执行，不能以 staged 资源替代安装版验收。

## 2026-09-23 v0.3.36 应用内更新风险验收（当前）

- Desktop #220 merge `71d9670` 要求正式构建内嵌 updater 公钥，并在 macOS 最终可执行文件公证前比对精确公钥；缺公钥构建负测按预期拒绝。正式 run `35820263217` 三平台与 manifest 全绿，Release `394308386` 为公开 v0.3.36、11 项资产、7 个签名 updater 键。Apple DMG submission `fb9c113d-aad4-461a-8f14-61170f43b1b3` Accepted，三条 feed 均回读 v0.3.36、清单 SHA-256 `e6b474a0…`。
- 本机从已安装的 v0.3.35 设置页实际点击“更新”：完成清单检查、下载、验签、安装与自动重启，进程 `10848 → 58654`，原路径版本为 0.3.36；Core/投影/Kernel ready、Core `860594a…`，51/240/43/9 和三份模型/认证/设置摘要保持，手机仍关闭、JEV 设置保持，唯一安装副本与 Gatekeeper 通过。固定 Tauri updater 2.10.1 在 `download` 返回前验签，失败不会进入 `install`。完整证据见 [v0.3.36 应用内更新验收](../acceptance/2026-09-23-v0.3.36-in-app-updater.md)。
- v0.3.29 已发布的 macOS 二进制无法原地补入 updater 插件；v0.3.25–v0.3.28 固化旧 endpoint，因此这些版本仍需一次性手动替换。这台 Mac 已在上一版完成该 bootstrap。Windows/Linux 旧版应用内升级尚需独立验收。

## 2026-09-23 v0.3.35 签名启动恢复（历史，首次手动安装通过）

- v0.3.29 应用内更新在清单检查阶段返回 `UPD-227408f2`，解码为 `plugin updater not found`；旧二进制未内嵌 updater 公钥。手动 bootstrap 的 v0.3.34 通过 Gatekeeper 后，在内置签名 Node 的 V8 初始化处 SIGTRAP；v0.3.30/v0.3.33 的同类 helper 也重现。根因是发布脚本以 Hardened Runtime 二次签名 helper 时丢失 `allow-jit` entitlement。
- v0.3.30/v0.3.33/v0.3.34 已调回 draft；中途公开 Latest/三条 feed 曾回到 v0.3.29，feed commit `18d87dba`，清单 SHA-256 `2b0e934a…`。该回滚和 v0.3.34 本机失败见 [安装回滚证据](../acceptance/2026-09-23-v0.3.34-core-occurrence-release.md)。
- v0.3.35 只给 Node helper 加 `allow-jit`，签名后执行 V8 命令，Tauri 最终 `.app` 再启动隔离 Core。正式 run `35815288358` 三平台、DMG 公证与 manifest 全绿；Release `394282553` 为公开 Latest，11 项资产、7 个签名 updater 键。Apple submission `f9b1d9ff-93cc-4374-a36f-77061c6e7653` Accepted，公开 DMG SHA-256 `b766f9be…`；canonical Raw、旧 Raw 和旧 Latest 均返回同一份 v0.3.35 manifest `d306677b…`。
- Linux `35817527851` 和 Windows `35817533119` 公共安装通过。本机从 v0.3.29 保留备份手动安装 v0.3.35 后，应用窗口与 Core `860594a…` 就绪；51/240/43/9 数据和模型/认证/设置摘要保持，手机仍关闭、JEV 设置保留、唯一 `/Applications/EduPi.app`。完整证据见 [v0.3.35 签名启动恢复与安装验收](../acceptance/2026-09-23-v0.3.35-signed-macos-recovery.md)。v0.3.29 没有 updater 插件；v0.3.35 后续自动升级现以上方 v0.3.36 实测为准。

## 2026-09-23 v0.3.34 Core occurrence 配对发布（历史，macOS 启动失败后撤回）

- Desktop PR #212/#215/#216 最终发布 merge 为 `c492aea8e50b3aadd207be9bae40a34e0412dedc`，固定 Core `860594a05c5d32617fffdbdf03d56e6ade6dc211`；occurrence mutation 连续性、旧 owner key 安全降级和 owner read 503 映射均已进入公开包。
- 全平台 run `35805159993` 完成 Linux/Windows 构建；macOS 的已知 hosted runner 临时根 writer admission 波动没有生成资产。同 SHA 的一次 macOS 补跑 `35808315316` 完成构建、公证和 manifest。Release `394223451` 为公开 v0.3.34，11 项资产、7 个签名键，feed commit `9e70f0e`。
- Apple submission `192c6e32-de59-47d3-9f12-4e5b54702eb4` Accepted，runner 的 DMG staple/validate、Gatekeeper 与 Release ID 替换事务通过；公开 DMG SHA-256 为 `a40b23b9…`。三条迁移期 endpoint 返回同一份 v0.3.34 manifest `539bffd4…`。
- 公开 updater tar 在仓库外启动后 Core/投影/Kernel ready，Core 精确为 `860594a…`，proactivity 与 external send 关闭。Linux `35811719843` 与 Windows `35811727023` 公共安装启动均通过。完整证据见 [v0.3.34 Core occurrence 与签名发布验收](../acceptance/2026-09-23-v0.3.34-core-occurrence-release.md)。
- 当时本机唯一安装副本为 v0.3.29，Mac 锁屏使该版本的安装验收尚未执行；后来的 v0.3.34 失败和 v0.3.35 成功以上方当前状态为准。通知点击、睡眠恢复与 Windows/Linux 旧版应用内升级仍未由公共干净安装替代。

## 2026-09-23 v0.3.31-v0.3.32 启动回滚与 v0.3.33 修复

- 受限 Core 只读凭据恢复后，正式 run `35757858707` 在 merge `bef61195` 上完成 macOS、Linux、Windows 和 manifest；v0.3.31 已公开为非草稿 Release，11 项资产、7 个签名 updater 平台键与 canonical Raw feed 完整。DMG、macOS updater 和 `latest.json` 的 Release digest 分别为 `fa4ccd48…`、`da2f3e79…`、`6e32a370…`。
- 独立复核发现 v0.3.31 只对 `.app` 完成 Apple 公证：解包应用为 `accepted / Notarized Developer ID`，公开 DMG 没有 stapled ticket，`spctl --type open` 为 `Unnotarized Developer ID`。应用内 updater tar 可继续由 Tauri 验签升级，但 v0.3.31 DMG 不满足离线 ticket 验收。
- v0.3.32 将 canonical 仓库和首选 feed 固定为 `Intellinfinity/edupi-desktop`，保留两个旧 endpoint 作迁移 fallback；macOS workflow 新增 DMG `notarytool submit --wait`、staple 和 Gatekeeper 验证。公证后的 DMG 不再用 tag `--clobber`：脚本绑定 release ID、唯一 tag、draft、目标 SHA，先改名保留旧资产，再通过 `uploads.github.com/.../releases/{release_id}/assets` 上传并重新下载核对 size/SHA-256，最后删除备份。
- 发布事务在首次删除备份时进入提交状态；之后只幂等重试同一 backup asset ID，404 视为已删除。其他 cleanup 不确定性会同时保留已验真的正式 DMG 与备份，使精确资产集合门禁失败并保持 draft，不会再回滚删除已验真 DMG。上传、验真或提交前错误恢复旧资产。
- 本地最终门禁：`npm test` 1373 passed / 25 skipped / 0 failed，TypeScript、ESLint、npm audit（0 vulnerabilities）、release verify、目标仓库校验、actionlint、Cargo metadata 和 28 项 Rust library tests 通过；发布事务 41 项定向测试及独立复审无 P1/P2。
- DMG 验收：全平台 run `35771039553` 完成 Linux/Windows 构建，macOS 的一次 G6 临时根失败保持 draft；同提交 macOS retry `35772209888` 完成 manifest。Release ID `394034871` 固定 `9f33463`，Apple submission `500735b4-4a03-4b0b-8376-c6cf3270c48c` Accepted；runner 的 DMG staple/validate、Gatekeeper 和重新下载 SHA-256 `3ee2667b…` 全部通过。公开 DMG 本机 Gatekeeper 为 `Notarized Developer ID`，本机 `stapler validate` 仍受 Apple CloudKit TLS `-1200` 阻断，未记为通过。
- 启动回归：Linux `35783207989` 和 Windows `35783220232` 均从已安装 v0.3.32 的 `server.log` 读到 `Cannot find module 'next'`。原因是普通 standalone `node_modules` 被排除，而 staged 测试从源码上级依赖形成假通过。v0.3.31/v0.3.32 已退回 draft，v0.3.30 已恢复 Latest；feed commit `446a73a` 为 v0.3.30、7 个签名键，三条 endpoint 与本机更新接口均已回读。
- v0.3.33 增加普通目录复制、symlink/NFT 兼容、最终产物零 symlink/realpath containment 和三平台隔离 staged server 启动门禁；正式 run `35789747783` 三平台/manifest 全绿，Release `394151776` 有 11 项资产与 7 个签名键。Linux public install `35792864973` 和 Windows `35792875124` 均成功；DMG 公证与本机 Gatekeeper 通过。完整证据见 [v0.3.33 packaged server 恢复验收](../acceptance/2026-09-23-v0.3.33-packaged-server-recovery.md)。
- v0.3.33 发布后合并的 Core occurrence 配对不在旧包内；现已由 v0.3.34 独立构建、签名、公证并完成 Linux/Windows 公共安装。macOS 应用内原位升级仍待本机解锁。
- v0.3.34 同时修复 occurrence mutation 即时投影回退和旧 owner key 升级阻断；全量 1425 passed / 26 skipped / 0 failed，真实 source occurrence mutation、lost credential conflict 和旧 owner state 升级演练通过。首次 run `35804036187` 在上传前发现 owner read 的错误状态映射并取消，空 draft `394218266` 已删除；最终 Release 不复用该 run 的任何资产。

## 2026-09-22 v0.3.31 发布阻塞（历史，已解除）

- Desktop #207 合并为 `0d36b5f`，Release run `35714740346` 创建 `v0.3.31` 草稿；三平台 npm/type/lint/audit 及 Apple 六项 Secret 门禁通过，但私有 Core checkout 都在 `git@github.com:Intellinfinity/edupi.git` 返回 `Repository not found`。manifest job 未运行，Release 未公开，旧版更新不可见。
- Core 仓库仍列有旧只读 Deploy Key；组织策略禁用 Deploy Key 后它不能读取，创建新 Key 返回 HTTP 422。未注册的临时私钥已删除。不得把当前广权限个人 `gh` OAuth token 写入 Actions Secret。
- 后续须使用组织允许的、仅 `Intellinfinity/edupi` Contents 只读的短期凭据（或等价的 GitHub App 授权）恢复 checkout；同一 draft 绑定原 merge SHA，凭据恢复后可重跑失败 job。三平台公证、11 项资产、7 平台 feed 和 0.3.29 原位升级仍分别待验收。
- [Desktop #210](https://github.com/Intellinfinity/edupi-desktop/pull/210) 已提交凭据优先级与新仓库路径修正：29 项定向测试、release/preview actionlint 和 lint 通过；Windows debug 的完整 actionlint 仍报原有 ShellCheck `SC2012`，没有当作通过。该修复目前是另一 PR，不会改变已经失败 run 的代码；`gh auth` 已返回 401，需要恢复登录后才能继续远端操作。

## 2026-09-20 v0.3.29 执行记录

- 最终发布与安装：PR #200 合并为 `a7b83a9`；workflow `35548760372` attempt 2 成功，v0.3.29 正式发布，11 个资产、7 个 Raw feed 平台键完整。本机从 v0.3.28 手动 bootstrap 到 v0.3.29，唯一安装副本、教师数据、模型/认证哈希和默认模型保持；Safe Mode 与 LAN 手机配对/撤销完成安装版实测。见 [完整验收](../acceptance/2026-09-21-v0.3.29-update-safe-mobile.md)。
- Feed 专用树：发现首次分支沿用了 main 树后，使用非强制快进 commit `7ae9dd2` 把当前树收敛为唯一 `latest.json`；发布 workflow 已改为直接创建 manifest-only Git tree，不再从 main 复制仓库内容。

- 代码状态：更新 manifest、Tauri endpoint、release workflow、Safe Mode、手机 bridge 和 v0.3.29 版本元数据已落地，未执行 reset/clean 或重建分支。
- 自动化证据：初始实现回归 `npm test` 1332 项中 1307 passed、25 skipped、0 failed；`tsc --noEmit`、针对性 updater/Safe Mode/mobile 测试和 Cargo library tests 已通过。最终复跑结果见下行。
- 最终本地复跑：`npm test` 1334 项中 1309 passed、25 skipped、0 failed；`npm run lint`、`npm audit --audit-level=high`（0 vulnerabilities）、`tsc --noEmit`、`cargo metadata --locked`、默认/无 custom-protocol Cargo tests 和 `actionlint` 均通过。`PI_WEB_DESKTOP_BUILD=1 next build --webpack` 成功，保留既有 export route 的 critical dependency warning。
- 公开传输实证：以 Latest `v0.3.28` 资产回放新脚本，生成 7 个 updater 平台键、4 个唯一 GitHub API asset URL；API asset endpoint + `Accept: application/octet-stream` 取得 1024 字节 ELF 分片。当前 `updater-feed` Raw URL 仍为 404，因为分支尚未推送。
- 打包边界：`npm run desktop:prepare` 的 Next standalone build 成功，随后因本机没有计划固定的 Core commit `d05cf89…` 而停止；旁边 `../edupi` 为另一提交且有未提交改动，未使用或修改。
- 未验收：公开 `updater-feed` 分支首次写入、v0.3.29 三平台 Release、旧客户端手动 bootstrap、安装版 Safe Mode、真实手机配对/续聊/撤销。源码测试或 API 可达性不替代安装版与手机端到端证据。
- 本地交付提交：`45e1a55`（主实现）、`93fc5e0`（执行记录）、`cff8dd6`（旧客户端 bootstrap 边界）、`4f599a3`（手机窄屏布局）。推送到既有 origin 分支时因本机 GitHub HTTPS 凭据失效而被拒绝，未尝试覆盖远端或重建分支。

## 2026-09-20 更新中断分层诊断

- 安装版内置 server 的 `GET /api/updates?refresh=1` 返回 `currentVersion=0.3.25`、`latestVersion=0.3.28`、`releaseStatus=available`；该查询走 `api.github.com`，HTTP 200。
- 当前 Tauri updater endpoint 仍是 `https://github.com/PIGU-PPPgu/edupi-desktop/releases/latest/download/latest.json`。从同一机器请求该 manifest，以及 `latest.json` 中的 macOS 资产 URL，均在 0 字节阶段超时；强制 HTTP/1.1 或 IPv4 也未改变结果。
- 通过 GitHub API 的同一 Release asset（`Accept: application/octet-stream`）可以收到 302，并跟随到 `release-assets.githubusercontent.com`；`latest.json` 完整解析成功，macOS tar 通过该路径取得 1024 字节 gzip 分片。`api.github.com` 与 `release-assets.githubusercontent.com` 均可达。
- 结论：故障是 `github.com` origin 下载路径的目的地主机/重定向链路，不是 Release 文件损坏、签名缺失或整个网络不可用。当前 UI 的“更新包下载中断”来自 `desktopUpgradeErrorKind` 对响应体/连接错误的统一映射，尚未记录具体 host 和阶段。
- 本轮没有重复点击同一失败入口，也没有手动覆盖安装；下一步应把 updater manifest/资产下载从 `github.com` origin 解耦（API-backed stable manifest/proxy 或明确的网络 allowlist），再做一次完整验签、替换、重启验收。

## 2026-09-20 `v0.3.28` 提醒工作台发布

- Release workflow [`35505373874`](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35505373874) 三平台质量门、固定 Core 配对、桌面壳测试、签名资产上传和 manifest 全部成功；正式 Latest [`v0.3.28`](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.28) 固定到 `d3b96f96f9344a98dfba1cc145c84309c9dbf08d`。
- Release 非草稿、非预发布，共 11 项资产；`latest.json` 版本为 `0.3.28`，包含 `darwin-aarch64`、macOS app、Linux AppImage/deb、Windows NSIS 等 7 个 updater 平台键。组件清单为 Desktop `0.3.28`、Pi `0.84.1`、pi-web `0.8.7`。
- `v0.3.28` 包含全宽提醒队列/详情、提醒状态切换，以及隐藏对话侧栏后遗留空白列与窄窗裁切修复。开发版 1440×900、800×900、390×844 与亮/暗色均已操作验收。
- 本机安装副本仍为 `v0.3.25`；`github.com:443` 当前 5 秒连接超时，无法开始 updater 下载，因此尚未验签、替换或重启。macOS Release 仍为 ad-hoc 签名，安装版页面、数据保持和授权状态继续保留未验收。

## 2026-09-20 `v0.3.27` JEV 设置发布

- Release workflow `35484119032` 三平台构建、签名、上传和 manifest 全部成功；正式 Latest [`v0.3.27`](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.27) 固定到 `56d9e94daadb496491912e3d6999fdc2289d71a8`，11 项资产、7 个 updater 平台键完整。
- `v0.3.27` 包含 JEV 快速浏览器决策设置、服务端密钥存储和 OpenConnector 适配器；JEV 默认关闭且不参与聊天模型。
- 本机安装副本仍为 `v0.3.25`。从设置页检测到 `v0.3.27` 后，三次应用内下载都在 `github.com:443` 下载阶段中断，尚未验签、替换或重启；待该网络入口恢复后继续同一更新入口验收。

## 2026-09-20 `v0.3.26` 发布与本机更新阻塞

- Release workflow `35445254882` 的 macOS、Linux、Windows 与 manifest 全部成功；正式 `v0.3.26` 固定到 `4f85114942f4e65f9463ec5d3dd7ccf6e4c35b8b`，非草稿、非预发布，共 11 项资产和 7 个 updater 平台键。
- 本机仍为 `v0.3.25`。设置页真实检测到 `v0.3.26`，三次点击应用内“更新”都在下载阶段返回“更新包下载中断”，没有进入验签、替换或重启；安装目录和进程保持原版。
- 网络诊断显示 `api.github.com` HTTP 200，但 `github.com:443` 请求无响应或连接超时，三轮更新器连接同一地址停在 `SYN_SENT` 后消失。未用手动下载或覆盖安装替代应用内验收。
- 升级前基线：Core/projection/kernel ready；51 名学生、240 个任务、43 个校历节点、9 个课表、28 个已登记产物；默认模型 `zai-coding-cn/glm-5.3-flash`，自定义配置 3 个 Provider/9 个模型；`.edupi` 147 个文件。模型和认证文件摘要已在本轮内存证据中核对，未写入密钥。
- 当前状态为外部网络阻塞。待 `github.com` 恢复后从同一设置入口重试，成功后核对版本、进程、上述数据和模型摘要，再继续通知授权、显示与点击验收。

## 2026-09-16 `v0.3.15`–`v0.3.17` 发布与旧客户端检测

- `v0.3.15` 首轮因 Cargo.lock 的无关 `errno` 版本被误改而失败且未生成 Release；Desktop [#133](https://github.com/PIGU-PPPgu/edupi-desktop/pull/133) 恢复依赖并在打包前强制校验 lockfile。workflow [35013486688](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35013486688) 随后以 macOS 15分57秒、Linux 16分05秒、Windows 21分36秒完成，发布 11 项资产。
- `v0.3.16` workflow [35016438326](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35016438326) 的三平台全部成功，旧 manifest job 因两个并发草稿各只有部分 updater 平台而失败。两个草稿的原构建资产和签名经摘要核对后合并到 Release `389446081`，完整 `latest.json` 有 7 个平台键，Release 固定到 `06f167a1db94a1b28f076b45d213fd1d23630263` 并公开，重复草稿已删除。公开 macOS updater 与实测包相同，SHA-256 为 `3b5572a2a520b632f527970c571bfb963f87d9505b7a954e497e72999b9cac69`。
- Desktop [#138](https://github.com/PIGU-PPPgu/edupi-desktop/pull/138) 让并行构建共用一个 commit-bound Release ID，并由最终 job 从真实签名集中生成 `latest.json`。`v0.3.17` workflow [35022297439](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35022297439) 实际只创建一个草稿，macOS、Linux、Windows 分别约13分40秒、14分51秒、20分19秒并全部成功，草稿准确收齐 9 个平台资产。最终 job 已正确生成 7 平台清单，但随后调用需要 `node_modules` 的冗余组件生成器而失败；Desktop [#141](https://github.com/PIGU-PPPgu/edupi-desktop/pull/141) 改为校验提交内组件清单，使用同一修复步骤完成当前草稿。
- 正式 Latest [`v0.3.17`](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.17) 固定到实际构建提交 `dd5bce96bb0e1bfdf3f117cae4a7d88994b54bc0`，非草稿、非预发布，共 11 项资产；`latest.json` 的 7 个条目全部带签名，组件清单为 Desktop `0.3.17`、Pi `0.84.1`、pi-web `0.8.7`。公开 macOS updater SHA-256 为 `d4f88cae3e5eb96dd0b97b2f45cb188b7478726c5a097f5adfd2aa1ce09f612a`，解包版本为 `0.3.17`。
- 本机唯一安装副本 `/Applications/EduPi.app` 仍为 `0.3.13`；其真实 `/api/updates?refresh=1` 已返回 `latestVersion=0.3.17`、`updateAvailable=true`、`releaseStatus=available`，证明现有客户端无需重新下载安装包即可发现新版。本轮按用户安排不执行安装；升级重启、教师数据/模型保持、权限重查、通知点击和睡眠唤醒留给用户验收。Windows/Linux 应用内升级与 Apple 稳定签名/公证仍未验收。

## `v0.3.17` 用户安装验收清单

升级前基线已在 2026-09-16 重新读取；验收时只核对数量、身份和交互，不把任何 API Key 写入记录。

| 状态 | 项目 | 升级前 | `v0.3.17` 预期 |
| --- | --- | --- | --- |
| [ ] | 安装与进程 | `/Applications/EduPi.app` 一个副本，版本 `0.3.13`，一个主进程及其 server/Core 子进程 | 同一路径原位变为 `0.3.17`，旧进程退出，不出现第二个应用或窗口 |
| [ ] | Core 身份 | `f6145130dad4250864a3c6cd404f121be08fad17`，旧界面因课次缺材料显示 degraded | `19c0fd5182c6c20d6534973e506d6fa36acc1b06`，系统页显示“EduPi Core · 已就绪 · 已连接” |
| [ ] | 教师数据 | 50 名学生、240 个任务、43 个校历节点、9 条课表 | 四项数量保持；今天、教学、日程、工作区可打开同一对象 |
| [ ] | 模型配置 | 13 个可见模型，默认 `zai-coding-cn/glm-5.3-flash` | 数量和默认模型保持，既有 API Key 无需重填，模型测试可用 |
| [ ] | 自动运行 | 旧客户端显示 500 条重复失败 | 页面投影为 13 个真实课次；显示“缺少可用材料 / 补充材料”，不出现 `g1_prepare_due` 或 `source_unavailable` |
| [ ] | 更新状态 | 当前 `0.3.13`、最新 `0.3.17`、可更新 | 重启后当前与最新均为 `0.3.17`，不再显示可更新 |

按以下顺序完成原生交互验收：

1. 在“管理中心 → 系统 → 应用更新”点击更新，等待下载、安装和应用自行重启；不要手动打开第二份 EduPi。
2. 重启后依次核对上表六项，再从自动运行点击一次“补充材料”，确认进入材料页。
3. 在设置中点击“测试通知跳转”，把 EduPi 切到后台后点击系统通知，确认回到同一应用的提醒收件箱。
4. 在对话框选择“完全访问”，读取一个工作区文件并新建一个明确标记为验收用的文件；确认 Core 写入不再报 writer admission，随后删除该验收文件。
5. 从对话产物分别执行预览、打开文件、显示所在文件夹和另存为；从 OCR 结果打开可编辑文本，确认不是只有“已完成”状态。
6. 让系统睡眠后唤醒，等待一次自动检查；同一课次不得新增重复记录，失败仍能进入对应材料或任务。
7. 返回系统设置页点击“重新检测”；若 macOS 因当前临时签名要求重新授权，重新开启辅助功能和屏幕录制后重启 EduPi，再确认状态生效。

## 2026-09-16 `v0.3.13` 实际升级与 `v0.3.14` 发布

- 用户授权后，已从 `v0.3.11` 设置页点击真实“更新”。下载进度走完后应用自行重启，旧 PID `88791` 被新 PID `90028` 取代，路径仍为 `/Applications/EduPi.app`，版本为 `0.3.13`；磁盘搜索没有发现第二个 EduPi 安装副本。
- 升级前基线与升级后回读一致：Core、教育投影和 Kernel ready；50 名学生、240 个任务、43 个校历节点、9 个课表、45 条记忆、9 个自定义模型、默认模型、模型配置 SHA-256 和认证文件均保留。升级后暴露的旧 Runtime 重试历史兼容问题已由 Core [#121](https://github.com/PIGU-PPPgu/edupi/pull/121) 修复并由 Desktop [#125](https://github.com/PIGU-PPPgu/edupi-desktop/pull/125) 精确 pin；迁移后连续六轮状态/工作区读取为 200。
- `v0.3.14` 已由 Desktop [#126](https://github.com/PIGU-PPPgu/edupi-desktop/pull/126) 发布。Workflow [35002520172](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35002520172) 的 macOS、Linux、Windows 分别约 13、15、22 分钟，整轮约 22 分钟；11 项 Release 资产、七个平台 updater 签名和组件清单完整。公开 macOS updater SHA-256 `8921b36e29b0ed79f5270136d4a363240987dcb6267e8fcea89e7207028e24c8` 与 Release digest 相同，解包后的应用版本为 `0.3.14`。
- 当前已安装 `v0.3.13` 能检测 `v0.3.14`，但本机尚未安装它；用户将在后续自行验收。当前 Release 仍使用 ad-hoc macOS 身份，Apple 稳定签名/公证和 Windows/Linux 应用内升级仍未完成；因此更新后 TCC 权限仍可能要求重新开启并重启应用。

## 2026-09-16 `v0.3.13` 更新入口热修与权限身份

- Desktop [#121](https://github.com/PIGU-PPPgu/edupi-desktop/pull/121) 修复管理中心覆盖设置窗口、更新区与首张卡片重叠、更新入口含义不清和权限状态无法重查；系统页现在明确显示“应用更新 / 检查更新”，打开时先关闭管理中心。设置窗口固定头部并让正文独立滚动，去掉仓库标签和第二行说明；桌面权限可重新检测、返回应用时自动刷新，并可打开对应系统设置或重启 EduPi。
- Desktop [#122](https://github.com/PIGU-PPPgu/edupi-desktop/pull/122) 将版本推进到 `0.3.13`。Release workflow [34995513104](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/34995513104) 的 macOS、Linux、Windows 分别用时14分40秒、15分58秒、21分50秒，manifest 16秒；三平台并行后整轮约22分钟。正式 Release 含11项资产，`latest.json` 的7个平台键全部带签名，组件为 Desktop `0.3.13`、Pi `0.84.1`、pi-web `0.8.7`。
- 本机磁盘只找到 `/Applications/EduPi.app` 一个安装副本，当前为 `0.3.11`；其真实更新接口已返回 `latestVersion=0.3.13`、`updateAvailable=true`，原生设置页也显示可用的“更新”按钮。升级前基线为 Core/projection/Kernel ready、50名学生、240个任务、43个校历节点、9个课表、45条记忆、9个自定义模型；尚未执行安装，不把升级重启与数据保持记为通过。
- Tauri macOS updater 的实际实现会先把当前 `.app` 移到临时备份，再把新包移动回同一路径；正常应用内更新替换当前安装，不另建版本副本。Desktop [#123](https://github.com/PIGU-PPPgu/edupi-desktop/pull/123) 已接入 Developer ID 证书和可选公证凭据，并在缺少凭据时明确警告临时签名。仓库当前没有 Apple 证书类 Secret，因此 `v0.3.13` 仍是临时签名；Apple 确认 TCC 依赖稳定代码身份，辅助功能与屏幕录制授权可能在更新后需要重新开启。[Apple 说明](https://developer.apple.com/forums/thread/819406) [Tauri 环境变量](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/reference/environment-variables.mdx)

## 2026-09-15 `v0.3.12` 发布与更新检测

- Desktop [#119](https://github.com/PIGU-PPPgu/edupi-desktop/pull/119) 将四处版本元数据统一到 `0.3.12`。Release workflow [34983508483](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/34983508483) 的 macOS、Linux、Windows build 和最终 manifest 全部成功，`v0.3.12` 已发布为非草稿、非预发布的 Latest Release。
- Release 包含 DMG、macOS updater、AppImage、deb、Windows NSIS、对应签名、`latest.json` 与 `component-versions.json` 共11项资产。`latest.json` 的7个安装/更新平台条目均带签名；组件清单为 Desktop `0.3.12`、Pi `0.84.1`、pi-web `0.8.7`。
- 本机已安装 `v0.3.11` 的 `/api/updates?refresh=1` 实际返回 `latestVersion=0.3.12`、`updateAvailable=true`、release status `available`，证明既有客户端可以在应用内检测并下载更新，无需用户重新寻找安装包。本轮只验证检测，没有替用户点击安装。
- 本次三平台因 `max-parallel: 1` 串行耗时约55分钟。Desktop [#120](https://github.com/PIGU-PPPgu/edupi-desktop/pull/120) 将独立平台并发数改为3，同时保留每平台质量门、Rust测试、签名、草稿保护、全平台 manifest gate 和失败通知；按本次各平台耗时，后续完整发布预计约22–25分钟。
- Windows/Linux 应用内升级、Apple 公证、系统通知点击和真实睡眠唤醒仍未验收；按用户要求 Windows 人工优化与应用内升级后置，不再阻塞本地产品主线。

## 2026-09-14 `v0.3.11` 发布与三平台安装复核

- Release workflow `34765761183` 的三平台构建和 manifest 全部成功；`v0.3.11` 为正式 Release，DMG、macOS updater、AppImage、deb、NSIS、三平台签名、`latest.json` 与组件清单齐全。
- macOS updater tar.gz 的 SHA-256 为 `d90947b7cf3bd0b2d6907020e45e6f521e3eca9b072265c75eb3698ae7438a37`，与远端 digest 一致；将本机 Base64 公钥和 `.sig` 解码后，`minisign-verify 0.2.5` 校验成功。解码文件仅用于临时验收。
- 本机已安装并启动 `v0.3.11`，原生导航显示版本正确，既有教师工作区仍可读；安装包内置 server 的隔离恢复测试确认启动立即 due-scan、后台任务 attempt 2 恢复、旧工具进程退出和产物登记。
- Windows published-install run `34770908602` 与 Ubuntu 24.04 published-install run `34770910836` 均成功。它们验证公开安装包安装与启动，不替代 Windows/Linux 从旧版点击应用内升级。
- 下一安装版将包含 Desktop #102/#103 和 Core #66/#67 的真实睡眠间隔监测、Runtime health、后台进度与 Core 投影对齐；当前 `v0.3.11` 不包含这些后续提交。Apple 公证、Windows/Linux 应用内升级和系统通知点击仍未验收。

## 2026-09-13 `v0.3.10` Windows 修复发布与验收

- Release workflow `34754561484` 的 macOS、Linux、Windows 和 manifest 全部成功；`v0.3.10` 已发布为非草稿、非预发布版本，三平台资产、签名文件、`latest.json` 和组件清单齐全。
- Windows published-install workflow `34757893517` 成功：从 `v0.3.10` NSIS 安装包安装并启动，工作区服务可用，Tauri native source check 通过。
- Windows acceptance workflow `34758285479` 成功：同一已安装可执行文件第二次启动后退出，运行中的 `pi-agent-desktop` 保持单个，覆盖单实例回归。
- 本机 `v0.3.10` 安装包模型测试实际提交缺失 `cacheWrite` 的 cost 对象，返回 HTTP 200 / `OK`；说明 Windows 报错的 schema 路径已在包内修复。单实例插件 Rust 编译和本机 Tauri 21 项测试通过。
- 未验证：Apple 公证、Linux/Windows 应用内升级、系统通知点击与睡眠唤醒；真实 Provider Key 仍未写入正式账户。

## 2026-09-13 `v0.3.9` Provider 模型配置发布与本机包复核

- Release workflow `34738213112` 的 macOS、Linux、Windows build 和 manifest 全部成功；`v0.3.9` 已发布为非草稿、非预发布版本。
- Release 资产包含 DMG、AppImage、deb、Windows NSIS、macOS updater tar.gz、三平台签名文件、`latest.json` 和 `component-versions.json`。`latest.json` 的 `darwin-aarch64`、`linux-x86_64`、`windows-x86_64` 均指向 `v0.3.9`；组件清单为 Desktop `0.3.9`、Pi `0.84.1`、pi-web `0.8.7`。
- 本机远端 macOS updater tar.gz SHA-256 为 `39627a85d77d13283358344981bc91bd628df932cbb9cf3eda15b5bb78533c71`，与 GitHub asset digest 一致；使用本机 updater 公钥复核签名为 `valid`。
- `/Applications/EduPi.app` 已从 `v0.3.8` 备份并替换为签名 `v0.3.9` 包后启动。Info.plist、`/api/updates?refresh=1` 和 `/api/edupi/status?summary=1` 分别回读 `0.3.9`、up-to-date、Core/projection ready；工作区回读 50 名学生、237 个任务、43 个校历、9 个课表。
- 安装版模型接口回读默认 `zai-coding-cn/glm-5.2`，模型列表包含 DeepSeek、Z.AI Coding CN 和自定义 `edupi-test`；管理中心页面显示 `v0.3.9`。进一步使用该安装包内置 server、临时 HOME 和临时 Key 实际完成保存 Key→自动加载 2 个模型→添加同面板自定义模型（3 个）的页面流程，临时环境已清理。
- 未验证：Apple 公证、Linux/Windows 应用内升级、系统通知点击与睡眠唤醒；未在正式教师数据或正式账户上输入 API Key。

## 2026-09-12 本地签名复核（取代“缺少私钥”的当前风险描述）

- 已找到本机永久 updater 密钥对：`~/.config/edupi-release/updater.key` 与 `.pub`。用私钥对临时文件签名成功，确认该私钥未设置密码。
- GitHub 仓库 Actions Secret 名称 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_UPDATER_PUBLIC_KEY` 已存在；`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 不需要补值。Core 仓库实际为私有，当前正式 Actions 使用仓库专属只读 deploy key `EDUPI_CORE_DEPLOY_KEY`；旧宽权限 `EDUPI_CORE_READ_TOKEN` 已删除。
- 使用本机密钥临时注入公钥后，最终 `EduPi.app.tar.gz` 已生成对应 `.sig` 文件（404 bytes）；随后恢复源码中的临时公钥配置，没有提交密钥或配置改动。
- 当前剩余事项是 Linux 实机安装与应用内升级、Apple 公证、系统通知/睡眠唤醒和真实课堂内容质量；本地签名、正式 Release 与 Windows runner 安装阻塞已解除。

## 2026-09-12 正式发布链路准备（取代“缺少 Core token”的当前风险描述）

- Desktop 版本已从 `0.3.6` 推进到 `0.3.7`，`Cargo.toml`、`Cargo.lock`、包元数据和 `component-versions.json` 已保持一致。
- `release.yml`、`preview-installers.yml`、`windows-build-debug.yml` 当前优先使用 `EDUPI_CORE_DEPLOY_KEY`，并保留 token/public mirror fallback；私有 Core checkout 缺少 deploy key 时会在 checkout 阶段明确失败。
- Core 修复提交 `6b1d0cf74d7a1344c881da8e34a857243e315fdb` 已通过本机全量回归并合并到公开 Core `main`（PR #58，合并提交 `ea3b1dd175d3521546cc2b3ff685f6c9c7a360c6`）；Desktop Actions 现在可以按精确 pin checkout。
- 仍需远端实证的项目是 Linux 实机安装与应用内升级、Apple 公证、系统通知/睡眠唤醒和真实课堂内容质量；正式三平台 Release 与 Windows runner 安装已在下方记录。

## 2026-09-13 正式 `v0.3.7` Release（取代远端发布未验证状态）

- 首次 Release run `34701579391` 的三个平台均在私有 Core checkout 失败，根因为 `EDUPI_CORE_READ_TOKEN` 未设置；没有生成草稿或发布资产。
- 当时使用现有 GitHub 登录凭据临时写入 `EDUPI_CORE_READ_TOKEN`，不回显 token；重跑 `34702177745` 成功。随后改为仓库专属只读 deploy key，并删除该宽权限 token。
- `v0.3.7` 已发布为非草稿、非预发布版本：DMG、AppImage、deb、Windows NSIS、三类 updater `.sig`、macOS updater tar.gz、`latest.json` 和 `component-versions.json` 均存在；`latest.json` 的 `darwin-aarch64`、`linux-x86_64`、`windows-x86_64` 三项均有签名和 `v0.3.7` 下载地址，组件清单 `appVersion=0.3.7`。
- 仍未完成的是 Windows/Linux 实机安装与应用内升级、Apple 公证、系统睡眠唤醒/通知点击和真实课堂内容质量；CI 产物存在不替代这些验收。
- Windows published-install run `34705099213` 已在干净 Windows runner 安装并启动 `v0.3.7`，同时 native source check、私有 Core diagnose、资源 stray-scan 和原生命令检查均通过。

## 2026-09-13 CI 读取权限与 Linux 安装验收

- 私有 Core 的 Actions 读取已改为仓库专属只读 deploy key（Core key id `163097454`），Secret 为 `EDUPI_CORE_DEPLOY_KEY`；原有宽权限 `EDUPI_CORE_READ_TOKEN` 已删除。preview workflow `34710502746` 的 macOS/Windows checkout、质量和预览构建全部通过。
- Linux published-install workflow `34711422997` 已在 Ubuntu 24.04 下载并安装 Release `v0.3.7` 的 `.deb`，在 Xvfb 下启动已安装二进制，Core/projection readiness 检查通过。
- 当前剩余边界收窄为 Apple 公证、Linux/Windows 应用内升级、系统通知/睡眠唤醒和真实课堂内容质量；Windows 首次安装与 macOS 应用内升级已有证据。

## 2026-09-13 macOS 应用内升级验收

- `/Applications/EduPi.app` 升级前为 `0.3.6`；设置页真实检查返回 `latestVersion=0.3.7`、`updateAvailable=true`。先备份旧应用到 `/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/edupi-before-037-4bf_lkm1/EduPi.app`。
- 第一次下载在约 80% 返回原生 `error decoding response body`，进程和旧应用保持不变；点击重试后下载、签名校验、安装和 relaunch 均成功。
- 重启后的原生窗口显示 `v0.3.7`；`/api/edupi/status?summary=1` 返回 Core/projection/Kernel `ready`，计数为 students 50、tasks 237、calendar 43、timetable 9；`/api/updates?refresh=1` 返回 current/latest `0.3.7` 和 `updateAvailable=false`。
- 升级前后 `.edupi` 文件清单均为 121 个；变化仅落在 dingtalk/kernel/rhythm/teacher-review 与 Core runtime 状态文件，学生、任务、校历和课表投影均重新读取成功。Linux 实机安装、Apple 公证和通知/睡眠唤醒仍未验收。

## 2026-09-13 `v0.3.8` 发布与本机安装复核

- Release workflow `34714343043` 的三平台 build 与 manifest 全部成功；`v0.3.8` 已发布为非草稿、非预发布，资产和签名元数据完整。
- 远端 `latest.json` 的 `darwin-aarch64`、`linux-x86_64`、`windows-x86_64` 均指向 `v0.3.8`；`component-versions.json` 回读为 Desktop `0.3.8`、Pi `0.84.1`、pi-web `0.8.7`。
- 本机 updater tar.gz 用公钥复核成功；由于 Mac 锁屏无法操作原生设置页，本次将已安装 `v0.3.7` 备份并替换为签名 `v0.3.8` 包后启动。应用版本、Core/projection readiness、50/237/43/9 工作区计数和 up-to-date 状态均回读成功。
- Apple 公证、Linux/Windows 应用内升级、系统通知点击和睡眠唤醒仍未验收。

## 2026-09-12 Today 修复包（取代下方旧 Core pin 记录）

- 最终包配套 Core pin 为 `6b1d0cf74d7a1344c881da8e34a857243e315fdb`，Desktop component manifest 为 `sha256:9f28910f0886fcfed4509729af8361749cbd0f0cf3b48df4093db34fed6728b5`。旧的 `deda34d… / b29eb3…` 记录仅保留为历史证据；writer detector 矩阵和 daemon manifest 断言均已同步。
- 钉钉长驻进程不再独占 Core 写锁；最终包启动后钉钉为 ready，空闲 writer admission 可由另一写入者成功取得并释放。
- 隔离打包服务真实执行一次 Today 接受：HTTP 200、receipt `accepted`，重新读取为 `accepted / closed_accepted`，证明包内 UI 所接的写入链可持久化并重新投影。
- Today 页面已显示“待你决定 / 稍后处理 / 已记录”，动作反馈和刷新/重试入口随包交付。macOS 原生窗口已冷启动并截图核对。
- `tauri build --bundles app` 已生成 `.app` 和 tar.gz；updater 私钥缺失导致签名步骤退出，未上传发布。Windows/Linux 实机安装升级、签名/公证仍未验收。

## 2026-09-12 本地修复包状态

本地打包已使用锁定 Core `deda34d7523b5267602a5629027c367a91acaa7a`（Desktop component manifest `sha256:b29eb3…`）生成 `EduPi.app` 并实际冷启动；最新序列首个状态响应约 2.4 秒即为 ready，内置服务监听 38472，Core、教育投影和 Kernel 返回 ready，真实工作区为 50 名学生、9 个课表、43 个校历节点、237 个任务，原生窗口可见。构建最后的 updater 签名步骤因当前环境没有 `TAURI_SIGNING_PRIVATE_KEY` 失败，未上传或发布此包；DMG/updater 签名和跨平台升级仍未完成。

同一包还包含 R03 下一次计划运行显示、R05/R10 来源跳转、R13 多产物入口和 C6 识别可选字段兼容；启动初期的 Core process 状态会在运行时完成后恢复为 ready，最终状态请求已回读 ready。

最终包的模型测试路由用临时 localhost mock 服务复核通过：未提供 API key 时返回 `ok=true`、HTTP 200 和 `OK`，测试服务未写入持久配置。

用临时数据根启动同一 `EduPi.app` 的独立 38471 实例完成文件补录 E2：历史会话 `write` 结果登记 1 份文件并重新读取成功；临时实例关闭后正式 38472 服务恢复 ready，未改真实教师数据。

## 2026-09-09 Windows安装基线

后续运行 `34316941057`：公开版安装检查及当前原生代码编译均通过。原生编译使用公开版资源夹具，不包含新版Core/前端完整构建；私有Core构建仍未执行，不能据此宣称新版Windows安装包已通过。

- 运行 `34315814729` 的独立 `published-install` job通过：Windows GitHub runner从公开Release下载v0.3.6 x64 NSIS，安装退出0，应用进程保持运行，`/api/edupi/workspace`返回200。
- 这是干净Windows runner安装与服务启动证据，未复现用户本机失败，也未验证窗口操作、旧版升级或新通知回调。用户系统版本、失败步骤/日志仍缺失。
- 同次 `diagnose` job失败于私有Core checkout：`EDUPI_CORE_READ_TOKEN`不存在。没有进入新版编译；未将个人GitHub凭据上传替代。新品跨平台构建/发布依赖恢复相应读取凭据。
- 当前已安装macOS v0.3.6出现工作区503。新Core已只读验证其真实237条任务可投影；修复尚未发布，未改写安装包或教师数据。

## 新增发布要求

用户反馈 Windows 安装包无法正常安装。状态为待复现，不能归因为系统拦截或安装器缺陷，尚缺报错、系统版本与失败步骤。构建通过不作为安装通过证据。

排查与验收：

1. 从公开 Release 下载确切版本，记录 Windows 版本、架构、安装权限、失败步骤和安装日志；分别复现全新安装、覆盖旧版、安装后首次启动。
2. 定位 NSIS、WebView2、文件路径、运行库或应用启动的具体失败点，修复后使用同一环境复测。不以关闭系统保护作为修复。
3. 每次发布后保留旧版客户端，从桌面设置检查公开 Release，确认能识别新版本；实际下载、验签、安装并重启，核对新进程版本及工作区可用。
4. 核对教师资料、模型配置、课程、材料和原 Pi 配置仍保留；网络失败后可重试，升级失败可继续使用旧版。
5. macOS、Windows 分别记录完整升级证据。缺少实机时标为未验收，不能借用另一平台或 CI 的结果。

本轮先继续功能开发，安装版延后统一更新。发布前必须处理 Windows 安装反馈；首次定位所需截图或日志可由用户补充，不阻塞其他本地功能。

## 范围

现有更新检测可用，但 v0.3.5 未内置更新公钥，Rust 未注册 updater 插件。旧用户需覆盖安装一次启用版；后续保留同一个公钥验证更新。

## 发布

- 专用私钥仅存受限本机配置目录和 GitHub Secrets，不提交源码。
- v0.3.6 使用既有 release.yml 生成平台安装包、签名和 latest.json。
- Linux 补 AppImage，Debian 安装包不能替代 Linux updater 产物。
- 各平台质量和构建成功后才能公开 Release。
- 更新包签名不等于 Apple 公证或 Windows Authenticode；不宣传为已获系统认证。

## 验收

- [x] 更新公钥配置、发布工作流定向测试 27 项通过。
- [x] 远端平台包、签名、latest.json 完整。v0.3.6 已公开；Mac/Windows 构建通过，Linux 最终运行 34057453397 的 build/manifest 通过。
- [x] 本地启用 updater 的 0.3.5 测试包检查到 0.3.6。安装版 `/api/updates?refresh=1` 返回 updateAvailable=true。
- [x] macOS 实际下载、签名验证、安装、重启到 0.3.6；教师身份、课程和 27 条记忆可见，工作区 HTTP 200。不是全面数据一致性审计。
- [ ] Windows 安装内升级实机验收；构建通过不代表实机通过。

升级前保留旧应用，更新失败不删除教师数据。签名私钥不得重新生成替换，否则已安装客户端将无法验证后续更新。

## 2026-09-07 实际结果

- 发布地址：https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.6
- PR #60、#61、#62、#63、#65、#66、#67、#68 已合并，分别修复发布配置、质量检查顺序、npm 命令、Linux 构建库、Windows 文件检出、单平台重试、AppImage 处理和错误 libc 可选包。
- 完整发布包含 Mac tar.gz + sig、Windows exe + sig、Linux AppImage + sig、latest.json 与组件版本文件。
- 本机当前是启用 updater 的 0.3.5 验收包，原应用备份 `/tmp/edupi-before-updater.r1k28J/EduPi.app`。未声称已经自动升级至 0.3.6。
- 原生点击验收受阻：Orca 报 `permission_denied`，应用有可见窗口但 AX 无法读取；权限查询显示 granted，restore-window 重试仍失败。需要可访问的桌面会话后继续“检查更新→升级→重启→版本/数据核对”。不绕过系统访问限制。
- 构建临时 Core checkout token 已从 GitHub Secrets 移除；正式 updater 签名密钥保留供后续版本使用。
- 旧的无 updater 版本必须先手动覆盖安装一次 v0.3.6，以后才具备应用内更新能力。

### 解锁后完成原生验收

用户解锁后，通过设置中的“检查更新→更新”实际升级。首次原生清单请求发生网络错误，手动重试后成功进入安装并重启。未绕过签名校验，未用手动拷贝替代此次升级。

应用进程从 44392 变为 12712；Info.plist 显示 0.3.6，界面管理中心显示 v0.3.6；安装版检查接口返回 currentVersion=latestVersion=0.3.6。工作区接口 HTTP 200，教师身份、学科年级、课程及记忆仍可读取。此前窗口访问阻塞已解除；上文 0.3.5 状态为历史记录。Windows 和 Linux 的安装内升级尚未实机验证。
