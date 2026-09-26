# OpenConnector 官方 Console 接入验收

## 状态

- 代码基线：Desktop 发布提交 `7611f0d49bfa3ee4e5fa07919e2f17d7f631d89a`；Core 仍固定 `86a49de9278704b3b64ad637c13acc03f21d34b5`。下文分别记录源码、公开发布和安装验收，未完成项不算通过。
- 来源为 `oomol-lab/open-connector` 的 v1.6.5 tag `c6f55b58f98bae95c14d0848eb612dfa09b80291`。官方源码包 SHA-256、Apache-2.0 许可、NOTICE、EduPi 源码差异及每个生成资产的摘要记录在 `desktop/open-connector-console-assets`；`node scripts/verify-openconnector-console-assets.mjs` 检测改动或额外资产。
- 管理中心入口改为打开独立、无 Tauri capability 的原生控制台窗口。窗口内使用上游的 Overview、Providers、Actions、Runs 页面，而不再把自建目录页当作官方控制台。只保留服务识别文字，不分发 OOMOL 标志、favicon 或第三方 provider 图标。

## 隔离验证

- 官方 v1.6.5 源码应用 `edupi-console.patch` 后运行 `npm run build:web`；与提交的 `index.html` 和四个静态资产逐项字节一致。官方包的 1554 个服务和 18010 个 Action 在独立浏览器窗口可见；完成服务搜索、Google Sheets 详情、`npm.get_package` 必填参数查看、运行记录空状态；1280 与 800 像素视口无横向溢出，页面 console error/warning 为零。
- 以固定 Core `86a49de` 执行 `EDUPI_CORE_ROOT=... npm run desktop:prepare`，完整 Next、Node helper、Core 与 OpenConnector 打包资源成功；使用 staged Node 和 `EDUPI_STAGED_RESOURCES=src-tauri/resources npm run test:staged-openconnector`：官方页面、身份状态、千级服务、Action schema 均返回；连接写入、Action POST 返回 403，原目录 host 仍拒绝 execute。`npm run test:staged-desktop-runtime` 中 Core/投影 ready、`externalSend=false`。临时目录不包含真实教师数据和凭据。
- HTTP host 仅在 `127.0.0.1` 随机端口监听，并且只转发显式允许的 GET；Host、Origin、路径、静态资源和响应体均有限制。独立 Console 窗口没有主窗口的 Tauri 命令权限；即使控制台前端发出账号写入或 Action 请求，后端也拒绝，runtime 同时设置 `blockedActions:["*"]` 和 `blockedProxies:["*"]`。
- `npm test` 在本批 Console 代码阶段为 1765 total / 1739 passed / 26 skipped / 0 failed，Windows CRLF 修复后为 1766 total / 1740 passed / 26 skipped / 0 failed；后续 CI 鉴权脚本修复后为 1767 total / 1741 passed / 26 skipped / 0 failed。开发版无 staging 兜底的真实 route 测试先复现 503 再通过；Console HTTP、桌面令牌、窗口权限与资产摘要测试也通过。`tsc --noEmit`、`npm run lint`、`npm audit --audit-level=high`（0 漏洞）、`npm run release:verify`（0.3.45）、`cargo metadata --locked` 与 `cargo test --lib --locked`（31/31）通过。只读复审未发现剩余可复现 P1/P2。Tauri debug WebView 的本地预览 IPC 失败，不充当原生窗口验收；正式签名版的窗口操作记录见下文。

## 边界

- 当前只接入官方 Console 的只读目录界面；没有账号连接、OAuth、API Key 写入或真实 Action。它不等于 OpenConnector 完整管理能力。原因是 Core WorkCase grant/Receipt、可信授权和受管进程隔离尚未完成；不能因有官方按钮就把外部写入开放给同用户 Agent 进程。
- 用户真实教师目录未写入测试数据。macOS 原位升级与数据/配置保持、Linux/Windows 公开安装均已另行验证；Windows/Linux 安装版还没有逐项点击官方控制台四页，不能由 macOS 结果推定。跨平台旧版原位升级仍未验。

## 首轮发布门禁

- PR #277 合并为 `8bbd84b`。v0.3.45 的首轮发布 run `36188308476` 在 Windows `desktop:prepare` 的资产摘要校验报 `console_asset_drift`；Release 保持 draft，没有公开，已请求取消该失败流程。原因是文字许可、NOTICE、补丁和 HTML 未禁用 Windows Git CRLF checkout，校验的是上游构建原字节。现给整个固定资产目录设置 `-text`，并以 `core.autocrlf=true` 的隔离 checkout 实际重放 10 个文件，9 个被验资产摘要全部一致；新增跨平台回归测试。修正后 `npm test` 为 1766 total / 1740 passed / 26 skipped / 0 failed，lint 与 release verify 通过。修正版本须完整重跑三平台，不复用旧 draft 资产充当通过。

## v0.3.45 公开发布与安装检查

- PR #278 合并为 `7611f0d49bfa3ee4e5fa07919e2f17d7f631d89a` 后，[完整三平台发布 run 36190180285](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36190180285) 全绿；[公开 v0.3.45](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.45) 非草稿、11 项资产，Raw feed 是 0.3.45 且七个平台键均有签名/API 资产 URL。Mac runner 的 DMG 公证、staple、严格签名和 Gatekeeper 步骤均成功。
- Linux [公开安装 run 36194964574](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36194964574) 通过。独立下载公开 DMG 大小 210255357 字节、SHA-256 `54de27d5c9e0663b334afb7679e027072914ef43424d29233a821ef183f25160`，与 Release digest 相同；只读挂载版本为 0.3.45，严格 `codesign` 和 `.app`/DMG 的 Gatekeeper 均为 `accepted / Notarized Developer ID`。包内 Console 的资产 9/9 摘要、服务/Action/inspect、写入/执行阻断均通过；组件清单摘要 `d293c63408ebf3af1be18a02b258f55dc88e3752464f5ba4d0d359cf5efc5bdc` 与 Release 相同。镜像已卸载。本机 `stapler validate` 因 Apple CloudKit TLS `-1200` 无结论，不抹去 runner 通过记录，也不写成本机通过。
- Windows [公开安装 run 36194964352](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36194964352) 的安装 job 在下载前调用匿名 Release API，遇到 runner 共享 IP 的 GitHub API 速率限制；没有安装或启动应用，不能算应用故障或安装成功。修复让该单步使用现有 `github.token` 的 Contents 只读权限，并通过环境变量传入 PowerShell Bearer 请求头，不记录令牌；结构回归先失败后通过，`npm test` 为 1767 total / 1741 passed / 26 skipped / 0 failed，TypeScript、lint 与 `actionlint` 通过。
- 分支临时 [run 36195789626](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36195789626) 的日志记录到安装退出 0、应用保持运行、工作区 HTTP 200 和第二次启动复用原进程，但复审在它运行时发现 `GH_TOKEN` 仍可能被后续安装器及应用继承，已请求取消，run 最终为 cancelled，不能计为完整验收。脚本将 Release GET 放入 `try/finally`，请求结束立即从进程环境删除 token 并清空请求头，删除失败则停止；顺序回归先失败后通过。CI-only [#279](https://github.com/Intellinfinity/edupi-desktop/pull/279) 合并为 `9669f19`，不改变已发布包。[Windows 最终 run 36197070379](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36197070379) 对同一个 v0.3.45 的公开安装及独立诊断两项均通过。

## 2026-09-26 本机原位升级与原生 Console

- 升级前唯一 `/Applications/EduPi.app` 为 v0.3.44，Core/投影/Kernel ready、Core `86a49de9278704b3b64ad637c13acc03f21d34b5`、`externalSend=false`、教师数据 51 学生/160 任务/24 校历/6 课表。五份模型/认证/设置摘要依次为 `37e90c3a…`、`093af081…`、`abe47833…`、`48a5eb0f…`、`c8eefffd…`；严格签名的旧应用备份到 `/tmp/edupi-before-045.60uv0l/EduPi.app`。
- 教师解锁后，旧版设置页检测到 0.3.45；点击“更新”后实际观察“正在准备更新”“正在下载”“正在安装并重启”，原生窗口重启显示 0.3.45。旧进程 `71560` 退出，新进程 `65867` 启动；`/Applications` 仍只有一个 EduPi.app。严格 `codesign` 与 Gatekeeper `accepted / Notarized Developer ID` 通过。Core/投影/Kernel 继续 ready、相同 Core commit、51/160/24/6、`externalSend=false`；五份摘要升级后逐项未变。设置页回读当前为最新版本、更新代理仍为 `http://127.0.0.1:7897`，JEV 仍已配置且不参与对话，手机局域网入口升级前后均为“已启用”。
- 签名版管理中心点击 OpenConnector，独立无 Tauri capability 的原生窗口打开官方 Console；概览显示 1554 个服务、0 个可执行操作。提供商页搜索 Google Sheets 得 1/1554，详情显示 40 项操作与“连接账号 暂未开放”；操作页列出 18010 项，搜索 `npm.get_package` 得 4 项，进入详情展开可见必填 `packageName: string`；运行记录为空并标明执行尚未开放。窗口关闭后在主窗口点“显示窗口”可再次打开概览，同一个目录端口仍可用。直接对安装版 loopback 发送连接 PUT 与 Action POST 均为 HTTP 403，GET 服务目录为 1554 项；没有写入真实账号或执行外部 Action。
- 原生 Console 的正常窗口和 macOS“窗口 → 移动与调整大小 → 左侧”半屏窗口均已操作；半屏截图为 768×846 像素，窄于 800 像素目标。概览、提供商搜索、Google Sheets 详情、全局 Action 搜索及展开 `packageName` 均可操作，截图无目视横向裁切；随后通过“返回到以前的大小”恢复窗口并关闭，主工作台保留。此处是截图尺寸，不冒充精确 800×900 CSS viewport 的像素测量；隔离浏览器此前也已覆盖 800 像素。`cargo fmt --check` 对现有 `lib.rs` 的多处格式漂移（包括本次新增行）仍失败；该项不是发布门禁，Rust 31 项单测及三平台原生编译通过，未为格式化整个大文件改写无关代码。
