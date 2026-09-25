# OpenConnector 官方 Console 接入验收

## 状态

- 代码基线：Desktop `fca6c43` 上的 v0.3.45 候选改动；Core 仍固定 `86a49de9278704b3b64ad637c13acc03f21d34b5`。本记录先覆盖源码和隔离资源，合并、公开发布与安装版结果另行补记。
- 来源为 `oomol-lab/open-connector` 的 v1.6.5 tag `c6f55b58f98bae95c14d0848eb612dfa09b80291`。官方源码包 SHA-256、Apache-2.0 许可、NOTICE、EduPi 源码差异及每个生成资产的摘要记录在 `desktop/open-connector-console-assets`；`node scripts/verify-openconnector-console-assets.mjs` 检测改动或额外资产。
- 管理中心入口改为打开独立、无 Tauri capability 的原生控制台窗口。窗口内使用上游的 Overview、Providers、Actions、Runs 页面，而不再把自建目录页当作官方控制台。只保留服务识别文字，不分发 OOMOL 标志、favicon 或第三方 provider 图标。

## 隔离验证

- 官方 v1.6.5 源码应用 `edupi-console.patch` 后运行 `npm run build:web`；与提交的 `index.html` 和四个静态资产逐项字节一致。官方包的 1554 个服务和 18010 个 Action 在独立浏览器窗口可见；完成服务搜索、Google Sheets 详情、`npm.get_package` 必填参数查看、运行记录空状态；1280 与 800 像素视口无横向溢出，页面 console error/warning 为零。
- 以固定 Core `86a49de` 执行 `EDUPI_CORE_ROOT=... npm run desktop:prepare`，完整 Next、Node helper、Core 与 OpenConnector 打包资源成功；使用 staged Node 和 `EDUPI_STAGED_RESOURCES=src-tauri/resources npm run test:staged-openconnector`：官方页面、身份状态、千级服务、Action schema 均返回；连接写入、Action POST 返回 403，原目录 host 仍拒绝 execute。`npm run test:staged-desktop-runtime` 中 Core/投影 ready、`externalSend=false`。临时目录不包含真实教师数据和凭据。
- HTTP host 仅在 `127.0.0.1` 随机端口监听，并且只转发显式允许的 GET；Host、Origin、路径、静态资源和响应体均有限制。独立 Console 窗口没有主窗口的 Tauri 命令权限；即使控制台前端发出账号写入或 Action 请求，后端也拒绝，runtime 同时设置 `blockedActions:["*"]` 和 `blockedProxies:["*"]`。
- `npm test` 最终为 1765 total / 1739 passed / 26 skipped / 0 failed。开发版无 staging 兜底的真实 route 测试先复现 503 再通过，定向 3/3；Console HTTP、桌面令牌、原生窗口权限与资产摘要测试也通过。`tsc --noEmit`、`npm run lint`、`npm audit --audit-level=high`（0 漏洞）、`npm run release:verify`（0.3.45）、`cargo metadata --locked` 与 `cargo test --lib --locked`（31/31）通过。只读复审未发现剩余可复现 P1/P2。Tauri debug WebView 的本地预览 IPC 失败，不能算原生窗口验收；须以正式签名安装版重新验证打开、关闭、再打开及窄窗布局。

## 边界

- 当前只接入官方 Console 的只读目录界面；没有账号连接、OAuth、API Key 写入或真实 Action。它不等于 OpenConnector 完整管理能力。原因是 Core WorkCase grant/Receipt、可信授权和受管进程隔离尚未完成；不能因有官方按钮就把外部写入开放给同用户 Agent 进程。
- 用户真实教师目录未写入测试数据；发布后需核对升级前后版本、Core 身份、学生/任务/校历/课表数、模型与认证配置，以及唯一安装副本。Windows/Linux 公开安装需分别验证官方控制台窗口，不能由 macOS 结果推定。

## 首轮发布门禁

- PR #277 合并为 `8bbd84b`。v0.3.45 的首轮发布 run `36188308476` 在 Windows `desktop:prepare` 的资产摘要校验报 `console_asset_drift`；Release 保持 draft，没有公开，已请求取消该失败流程。原因是文字许可、NOTICE、补丁和 HTML 未禁用 Windows Git CRLF checkout，校验的是上游构建原字节。现给整个固定资产目录设置 `-text`，并以 `core.autocrlf=true` 的隔离 checkout 实际重放 10 个文件，9 个被验资产摘要全部一致；新增跨平台回归测试。修正后 `npm test` 为 1766 total / 1740 passed / 26 skipped / 0 failed，lint 与 release verify 通过。修正版本须完整重跑三平台，不复用旧 draft 资产充当通过。
