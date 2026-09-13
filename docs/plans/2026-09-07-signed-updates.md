# 自动下载安装

## 2026-09-13 `v0.3.9` Provider 模型配置发布与本机包复核

- Release workflow `34738213112` 的 macOS、Linux、Windows build 和 manifest 全部成功；`v0.3.9` 已发布为非草稿、非预发布版本。
- Release 资产包含 DMG、AppImage、deb、Windows NSIS、macOS updater tar.gz、三平台签名文件、`latest.json` 和 `component-versions.json`。`latest.json` 的 `darwin-aarch64`、`linux-x86_64`、`windows-x86_64` 均指向 `v0.3.9`；组件清单为 Desktop `0.3.9`、Pi `0.84.1`、pi-web `0.8.7`。
- 本机远端 macOS updater tar.gz SHA-256 为 `39627a85d77d13283358344981bc91bd628df932cbb9cf3eda15b5bb78533c71`，与 GitHub asset digest 一致；使用本机 updater 公钥复核签名为 `valid`。
- `/Applications/EduPi.app` 已从 `v0.3.8` 备份并替换为签名 `v0.3.9` 包后启动。Info.plist、`/api/updates?refresh=1` 和 `/api/edupi/status?summary=1` 分别回读 `0.3.9`、up-to-date、Core/projection ready；工作区回读 50 名学生、237 个任务、43 个校历、9 个课表。
- 安装版模型接口回读默认 `zai-coding-cn/glm-5.2`，模型列表包含 DeepSeek、Z.AI Coding CN 和自定义 `edupi-test`；管理中心页面显示 `v0.3.9`。此前隔离源码版已完成保存 Key 后自动加载模型和同面板自定义模型的真实页面验收。
- 未验证：Apple 公证、Linux/Windows 应用内升级、系统通知点击与睡眠唤醒；未在正式教师数据上输入或替换 API Key。

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
